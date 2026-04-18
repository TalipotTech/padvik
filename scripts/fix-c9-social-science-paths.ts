#!/usr/bin/env tsx
/**
 * Fix a downloader bug: NCERT book codes iess1..iess4 (Political Science,
 * History, Geography, Economics) were saved under the WRONG subject-slug
 * directories. Every social-science PDF is physically present but misfiled.
 *
 * Observed mapping  →  Correct mapping:
 *   data/ncert-pdfs/9/economics/         contains iess1 (Political Science)
 *   data/ncert-pdfs/9/geography/         contains iess2 (History)
 *   data/ncert-pdfs/9/political-science/ contains iess3 (Geography)
 *   data/ncert-pdfs/9/history/           contains iess4 (Economics)
 *
 * This script:
 *   1. Rotates the four directories into their correct slots.
 *   2. Deletes the stale title caches (data/ncert-chapter-titles/9-*.json
 *      for the four social sciences). Remap will re-extract from the now-
 *      correct PDFs.
 *   3. Rewrites source_url and metadata.pdfPath in content_items wherever
 *      they reference the old (rotated) paths, so stored references match
 *      the filesystem again.
 *
 * Dry-run by default. Pass --apply to commit.
 *
 * Usage:
 *   pnpm tsx scripts/fix-c9-social-science-paths.ts
 *   pnpm tsx scripts/fix-c9-social-science-paths.ts --apply
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { existsSync, renameSync, rmSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const DRY = !process.argv.includes("--apply");

function log(msg = "") { console.log(msg); }
function plan(msg: string) { console.log(`  ${DRY ? "[plan]" : "[apply]"} ${msg}`); }

// Observed-dir → Correct-dir (what each on-disk directory SHOULD be called)
const ROTATION: Array<[string, string]> = [
  ["economics", "political-science"],
  ["political-science", "geography"],
  ["geography", "history"],
  ["history", "economics"],
];

async function main() {
  log("╔══════════════════════════════════════════════════════════╗");
  log(`║   FIX C9 SOCIAL-SCIENCE PATHS — ${DRY ? "DRY RUN" : "APPLY  "}                ║`);
  log("╚══════════════════════════════════════════════════════════╝");
  if (DRY) log("⚠ DRY RUN — no filesystem or database changes written. Pass --apply to commit.\n");

  const pdfRoot = join(process.cwd(), "data", "ncert-pdfs", "9");
  const cacheRoot = join(process.cwd(), "data", "ncert-chapter-titles");

  // ────────────────────────────────────────────────────────────────
  // Step 1 — Rotate directories via a scratch staging dir.
  // ────────────────────────────────────────────────────────────────
  log("── Step 1: rotate directories ──");
  const stagingRoot = join(pdfRoot, "_rotate_staging");
  const sources = ROTATION.map(([src]) => src);
  const targets = ROTATION.map(([, tgt]) => tgt);

  // Verify all source directories exist and no staging collision
  for (const src of sources) {
    const p = join(pdfRoot, src);
    if (!existsSync(p)) { console.error(`ERROR: source missing: ${p}`); process.exit(1); }
  }
  if (existsSync(stagingRoot)) { console.error(`ERROR: staging path exists, remove manually: ${stagingRoot}`); process.exit(1); }

  // Plan: move each source into staging under its target name, then move staging/* back to pdfRoot.
  for (const [src, tgt] of ROTATION) {
    plan(`mv ${pdfRoot}/${src}  →  ${stagingRoot}/${tgt}`);
  }
  for (const [, tgt] of ROTATION) {
    plan(`mv ${stagingRoot}/${tgt}  →  ${pdfRoot}/${tgt}`);
  }

  if (!DRY) {
    require("fs").mkdirSync(stagingRoot, { recursive: true });
    for (const [src, tgt] of ROTATION) {
      renameSync(join(pdfRoot, src), join(stagingRoot, tgt));
    }
    for (const [, tgt] of ROTATION) {
      renameSync(join(stagingRoot, tgt), join(pdfRoot, tgt));
    }
    rmSync(stagingRoot, { recursive: true, force: true });
  }

  // ────────────────────────────────────────────────────────────────
  // Step 2 — Clear stale title caches for the 4 subjects.
  // ────────────────────────────────────────────────────────────────
  log("\n── Step 2: clear stale title caches ──");
  for (const slug of new Set([...sources, ...targets])) {
    const cacheFile = join(cacheRoot, `9-${slug}.json`);
    if (existsSync(cacheFile)) {
      plan(`rm ${cacheFile}`);
      if (!DRY) rmSync(cacheFile, { force: true });
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Step 3 — Rewrite content_items paths.
  // ────────────────────────────────────────────────────────────────
  log("\n── Step 3: rewrite content_items paths ──");
  // Apply rotation in a single pass with a CASE expression so partial matches
  // don't leak (if we did sequential UPDATEs, a row rewritten in pass 1 could
  // get caught by pass 2).
  const caseUrl = sql`
    CASE
      WHEN source_url LIKE '%/9/economics/%'        THEN REPLACE(source_url, '/9/economics/', '/9/political-science/')
      WHEN source_url LIKE '%/9/political-science/%' THEN REPLACE(source_url, '/9/political-science/', '/9/geography/')
      WHEN source_url LIKE '%/9/geography/%'        THEN REPLACE(source_url, '/9/geography/', '/9/history/')
      WHEN source_url LIKE '%/9/history/%'          THEN REPLACE(source_url, '/9/history/', '/9/economics/')
      ELSE source_url
    END
  `;
  // Do it using a two-phase tag trick: first prefix with __SWAP__ marker, then rewrite off the marker
  // to avoid the chained-rewrite problem inside a single CASE (REPLACE evaluates all branches independently here).
  const urls = await db.execute<{ c: number }>(sql`
    SELECT COUNT(*)::int AS c FROM content_items
    WHERE source_url LIKE '%/9/economics/%'
       OR source_url LIKE '%/9/geography/%'
       OR source_url LIKE '%/9/history/%'
       OR source_url LIKE '%/9/political-science/%'
       OR (metadata->>'pdfPath') LIKE '%/9/economics/%'
       OR (metadata->>'pdfPath') LIKE '%/9/geography/%'
       OR (metadata->>'pdfPath') LIKE '%/9/history/%'
       OR (metadata->>'pdfPath') LIKE '%/9/political-science/%'
  `);
  log(`  ${urls[0].c} content_items reference rotated paths.`);
  plan(`rewrite source_url and metadata.pdfPath with the rotation mapping (two-phase via __SWAP_MARKER__)`);

  if (!DRY) {
    // Phase A — tag each source with a unique marker so no REPLACE overlaps
    await db.execute(sql`
      UPDATE content_items SET
        source_url = REPLACE(REPLACE(REPLACE(REPLACE(source_url,
          '/9/economics/',        '/9/__ROT_A__/'),
          '/9/political-science/','/9/__ROT_B__/'),
          '/9/geography/',        '/9/__ROT_C__/'),
          '/9/history/',          '/9/__ROT_D__/'),
        metadata = jsonb_set(
          metadata,
          '{pdfPath}',
          to_jsonb(
            REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(metadata->>'pdfPath',''),
              '/9/economics/',        '/9/__ROT_A__/'),
              '/9/political-science/','/9/__ROT_B__/'),
              '/9/geography/',        '/9/__ROT_C__/'),
              '/9/history/',          '/9/__ROT_D__/')
          )
        )
      WHERE source_url LIKE '%/9/economics/%' OR source_url LIKE '%/9/geography/%'
         OR source_url LIKE '%/9/history/%'   OR source_url LIKE '%/9/political-science/%'
         OR (metadata->>'pdfPath') LIKE '%/9/economics/%'
         OR (metadata->>'pdfPath') LIKE '%/9/geography/%'
         OR (metadata->>'pdfPath') LIKE '%/9/history/%'
         OR (metadata->>'pdfPath') LIKE '%/9/political-science/%'
    `);
    // Phase B — markers → real target slugs
    await db.execute(sql`
      UPDATE content_items SET
        source_url = REPLACE(REPLACE(REPLACE(REPLACE(source_url,
          '/9/__ROT_A__/', '/9/political-science/'),
          '/9/__ROT_B__/', '/9/geography/'),
          '/9/__ROT_C__/', '/9/history/'),
          '/9/__ROT_D__/', '/9/economics/'),
        metadata = jsonb_set(
          metadata,
          '{pdfPath}',
          to_jsonb(
            REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(metadata->>'pdfPath',''),
              '/9/__ROT_A__/', '/9/political-science/'),
              '/9/__ROT_B__/', '/9/geography/'),
              '/9/__ROT_C__/', '/9/history/'),
              '/9/__ROT_D__/', '/9/economics/')
          )
        )
      WHERE source_url LIKE '%/9/__ROT_%' OR (metadata->>'pdfPath') LIKE '%/9/__ROT_%'
    `);
  }

  // Same rewrite for chapters.metadata.pdfPath / sourcePdf
  log(`\n  (also rewriting chapters.metadata.pdfPath / sourcePdf)`);
  if (!DRY) {
    for (const field of ["pdfPath", "sourcePdf"]) {
      await db.execute(sql`
        UPDATE chapters SET
          metadata = jsonb_set(
            metadata,
            ${`{${field}}`}::text[],
            to_jsonb(
              REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(metadata->>${field},''),
                '/9/economics/',         '/9/__ROT_A__/'),
                '/9/political-science/', '/9/__ROT_B__/'),
                '/9/geography/',         '/9/__ROT_C__/'),
                '/9/history/',           '/9/__ROT_D__/')
            )
          )
        WHERE (metadata->>${field}) LIKE '%/9/economics/%'
           OR (metadata->>${field}) LIKE '%/9/political-science/%'
           OR (metadata->>${field}) LIKE '%/9/geography/%'
           OR (metadata->>${field}) LIKE '%/9/history/%'
      `);
      await db.execute(sql`
        UPDATE chapters SET
          metadata = jsonb_set(
            metadata,
            ${`{${field}}`}::text[],
            to_jsonb(
              REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(metadata->>${field},''),
                '/9/__ROT_A__/', '/9/political-science/'),
                '/9/__ROT_B__/', '/9/geography/'),
                '/9/__ROT_C__/', '/9/history/'),
                '/9/__ROT_D__/', '/9/economics/')
            )
          )
        WHERE (metadata->>${field}) LIKE '%/9/__ROT_%'
      `);
    }
  }

  void caseUrl;
  log("\n────────────────────────────────────────────────────────────");
  log(DRY ? "Dry run complete. Re-run with --apply to commit." : "Applied. Next: re-run remap --all --re-enrich.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
