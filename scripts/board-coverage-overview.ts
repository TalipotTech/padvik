#!/usr/bin/env tsx
/**
 * Quick per-board inventory: subjects, chapters, topics across all boards.
 * Useful before kicking off a new-board scrape to see where we stand.
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db";

(async () => {
  const r = await db.execute(sql`
    SELECT b.code, b.name,
      count(DISTINCT sb.id) AS subjects,
      count(DISTINCT c.id)  AS chapters,
      count(DISTINCT t.id)  AS topics
    FROM boards b
    LEFT JOIN standards st ON st.board_id = b.id
    LEFT JOIN subjects sb  ON sb.standard_id = st.id
    LEFT JOIN chapters c   ON c.subject_id = sb.id
    LEFT JOIN topics   t   ON t.chapter_id = c.id
    GROUP BY b.code, b.name
    ORDER BY b.code
  `);
  const rows = (Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows ?? []) as Array<{
    code: string; name: string; subjects: string | number; chapters: string | number; topics: string | number;
  }>;

  console.log("\n=== Per-board coverage ===");
  console.log(`  ${"CODE".padEnd(10)} ${"SUBJECTS".padStart(8)} ${"CHAPTERS".padStart(8)} ${"TOPICS".padStart(7)}  NAME`);
  for (const row of rows) {
    console.log(
      `  ${row.code.padEnd(10)} ${String(row.subjects).padStart(8)} ${String(row.chapters).padStart(8)} ${String(row.topics).padStart(7)}  ${row.name}`
    );
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
