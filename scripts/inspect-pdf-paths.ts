#!/usr/bin/env tsx
/**
 * Count content_items that reference PDFs in the 4 rotated C9 social-science
 * directories. If many do, a directory rename needs to be accompanied by
 * source_url / metadata.pdfPath rewrites.
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { db } from "../src/db";
import { sql } from "drizzle-orm";

async function main() {
  const dirs = ["economics", "geography", "history", "political-science"];
  for (const d of dirs) {
    const [{ c }] = await db.execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c FROM content_items
      WHERE source_url LIKE ${`%/9/${d}/%`}
         OR (metadata->>'pdfPath') LIKE ${`%/9/${d}/%`}
    `);
    console.log(`data/ncert-pdfs/9/${d}/  →  ${c} content_items reference this path`);
  }

  const [{ chapters_with_ncert_meta }] = await db.execute<{ chapters_with_ncert_meta: number }>(sql`
    SELECT COUNT(*)::int AS chapters_with_ncert_meta FROM chapters
    WHERE (metadata->>'pdfPath') LIKE '%/9/%' OR (metadata->>'sourcePdf') LIKE '%/9/%'
  `);
  console.log(`\nchapters with pdfPath/sourcePdf under /9/*: ${chapters_with_ncert_meta}`);

  // Sample a few paths
  const samples = await db.execute<{ id: number; source_url: string; metadata: string }>(sql`
    SELECT id::int AS id, source_url, metadata::text AS metadata FROM content_items
    WHERE source_url LIKE '%/9/%' OR (metadata->>'pdfPath') LIKE '%/9/%'
    LIMIT 10
  `);
  console.log(`\nSample content_items:`);
  for (const r of samples) {
    console.log(`  #${r.id}  url=${r.source_url}\n    meta=${r.metadata.slice(0, 200)}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
