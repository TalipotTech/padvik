#!/usr/bin/env tsx
/**
 * Upgrade any subject with a degenerate code (numeric-only, punctuation stub,
 * or N/A) to a letter-based code synthesized from its name. Uses the same
 * `deriveSubjectCode` logic that the parser now applies on insert — this is
 * the one-shot retroactive cleanup for rows that landed before the safeguard.
 *
 * Idempotent, collision-safe: skips rows where the derived code already exists
 * at the same standard_id (reports for manual resolution).
 *
 * Usage:
 *   pnpm tsx scripts/upgrade-degenerate-subject-codes.ts --dry-run
 *   pnpm tsx scripts/upgrade-degenerate-subject-codes.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db";

function deriveSubjectCode(name: string): string {
  // Strip parentheticals first so "Name (Region)" doesn't pollute initials
  // with individual letters from the parenthetical abbreviation.
  const stripped = name.replace(/\([^)]*\)/g, " ");
  const words = stripped
    .replace(/[^A-Za-z\s&]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^(and|of|the|for|a|an|&)$/i.test(w));
  if (words.length === 0) return "SUBJ";
  if (words.length === 1) return words[0].slice(0, 12).toUpperCase();
  // For short names use full initials; for long names (>=4 words) cap at 8.
  const cap = words.length >= 4 ? 8 : 10;
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, cap)
    .toUpperCase();
}

function isDegenerateCode(code: string): boolean {
  const t = code.trim();
  if (t.length === 0) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^[-_\s]+$/.test(t)) return true;
  if (/^n\/?a$/i.test(t)) return true;
  return false;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`\n=== Upgrade degenerate subject codes (${dryRun ? "DRY RUN" : "LIVE"}) ===\n`);

  const r = await db.execute(sql`
    SELECT sb.id, sb.code, sb.name, sb.standard_id, st.grade, b.code AS board_code
    FROM subjects sb
    JOIN standards st ON st.id = sb.standard_id
    JOIN boards b ON b.id = st.board_id
    ORDER BY b.code, st.grade, sb.name
  `);
  const rows = (Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows ?? []) as Array<{
    id: number; code: string; name: string; standard_id: number; grade: number; board_code: string;
  }>;

  let updated = 0;
  let collisions = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!isDegenerateCode(row.code)) continue;
    const newCode = deriveSubjectCode(row.name);
    if (newCode === row.code) {
      skipped++;
      continue;
    }

    // Collision check at the same standard
    const collide = await db.execute(sql`
      SELECT id, name FROM subjects
      WHERE standard_id = ${row.standard_id} AND code = ${newCode} AND id <> ${row.id}
    `);
    const collRows = (Array.isArray(collide) ? collide : (collide as { rows?: unknown[] }).rows ?? []) as Array<{ id: number; name: string }>;
    if (collRows.length > 0) {
      // Try to disambiguate by appending a short suffix derived from the name
      const words = row.name
        .replace(/[^A-Za-z\s&]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 0 && !/^(and|of|the|for|a|an|&)$/i.test(w));
      const suffix = (words[words.length - 1] ?? "X").slice(0, 3).toUpperCase();
      const dedupCode = `${newCode}_${suffix}`.slice(0, 50);
      const collide2 = await db.execute(sql`
        SELECT id FROM subjects
        WHERE standard_id = ${row.standard_id} AND code = ${dedupCode} AND id <> ${row.id}
      `);
      const collRows2 = (Array.isArray(collide2) ? collide2 : (collide2 as { rows?: unknown[] }).rows ?? []) as Array<{ id: number }>;
      if (collRows2.length > 0) {
        console.log(`  [${row.board_code}] id=${row.id} Gr${row.grade} "${row.name}" "${row.code}" → "${newCode}" COLLIDES with "${collRows[0].name}" (id=${collRows[0].id}); dedupCode "${dedupCode}" also taken — skip`);
        collisions++;
        continue;
      }
      console.log(`  [${row.board_code}] id=${row.id} Gr${row.grade} "${row.name}" "${row.code}" → "${dedupCode}" (disambiguated from "${newCode}", conflicting with "${collRows[0].name}")`);
      if (!dryRun) {
        await db.execute(sql`UPDATE subjects SET code = ${dedupCode} WHERE id = ${row.id}`);
      }
      updated++;
      continue;
    }

    console.log(`  [${row.board_code}] id=${row.id} Gr${row.grade} "${row.name}" "${row.code}" → "${newCode}"`);
    if (!dryRun) {
      await db.execute(sql`UPDATE subjects SET code = ${newCode} WHERE id = ${row.id}`);
    }
    updated++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  updated:    ${updated}`);
  console.log(`  collisions: ${collisions}`);
  console.log(`  skipped:    ${skipped}`);
  process.exit(0);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
