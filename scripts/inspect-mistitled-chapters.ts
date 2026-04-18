#!/usr/bin/env tsx
/**
 * Inspect the 5 mis-titled chapter groups: show each chapter's metadata
 * and topic titles side-by-side so we can decide how to rename them.
 *
 * Read-only.
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { db } from "../src/db";
import { sql } from "drizzle-orm";

type ChapterRow = {
  chapter_id: number;
  subject_id: number;
  subject_name: string;
  grade: number;
  chapter_number: number;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
};

async function main() {
  const groups = await db.execute<{ subject_id: number; title: string }>(sql`
    SELECT c.subject_id, c.title
    FROM chapters c
    GROUP BY c.subject_id, c.title
    HAVING COUNT(*) >= 3
    ORDER BY c.subject_id, c.title
  `);

  for (const g of groups) {
    const rows = await db.execute<ChapterRow>(sql`
      SELECT c.id AS chapter_id, c.subject_id, s.name AS subject_name, st.grade,
             c.chapter_number, c.title, c.description, c.metadata
      FROM chapters c
      JOIN subjects s ON s.id = c.subject_id
      JOIN standards st ON st.id = s.standard_id
      WHERE c.subject_id = ${g.subject_id} AND c.title = ${g.title}
      ORDER BY c.chapter_number
    `);
    const first = rows[0];
    console.log(`\n━━━ Class ${first.grade} ${first.subject_name} / "${first.title}" ━━━`);
    for (const ch of rows) {
      console.log(`  ch${ch.chapter_number}  id=${ch.chapter_id}`);
      console.log(`    description: ${(ch.description ?? "").slice(0, 120)}`);
      const topics = await db.execute<{ sort_order: number; title: string; description: string }>(sql`
        SELECT sort_order, title, COALESCE(description, '') AS description
        FROM topics WHERE chapter_id = ${ch.chapter_id}
        ORDER BY sort_order
      `);
      for (const t of topics) {
        console.log(`      · ${t.title}`);
        if (t.description) console.log(`          ${t.description.slice(0, 120)}`);
      }
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
