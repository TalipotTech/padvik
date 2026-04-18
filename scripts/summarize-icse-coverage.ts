#!/usr/bin/env tsx
/**
 * Post-ingest summary: per-grade × per-subject chapter+topic counts for ICSE/ISC.
 * Run after `scripts/run-icse-scraper.ts` completes, to verify coverage and spot
 * subjects with anomalously low chapter counts (parse failure / boilerplate PDF).
 *
 * Usage:
 *   pnpm tsx scripts/summarize-icse-coverage.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db";

(async () => {
  const r = await db.execute(sql`
    SELECT
      st.grade,
      sb.id AS subject_id,
      sb.code AS subject_code,
      sb.name AS subject_name,
      (SELECT count(*) FROM chapters c WHERE c.subject_id = sb.id) AS chapter_count,
      (SELECT count(*) FROM topics t JOIN chapters c ON c.id = t.chapter_id WHERE c.subject_id = sb.id) AS topic_count,
      sb.metadata->>'sourceUrl' AS source_url
    FROM subjects sb
    JOIN standards st ON st.id = sb.standard_id
    JOIN boards b ON b.id = st.board_id
    WHERE b.code = 'ICSE'
    ORDER BY st.grade, sb.name
  `);
  const rows = (Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows ?? []) as Array<{
    grade: number;
    subject_id: number;
    subject_code: string;
    subject_name: string;
    chapter_count: string | number;
    topic_count: string | number;
    source_url: string | null;
  }>;

  console.log(`\n=== ICSE/ISC coverage ===\n`);
  const byGrade = new Map<number, typeof rows>();
  for (const row of rows) {
    if (!byGrade.has(row.grade)) byGrade.set(row.grade, []);
    byGrade.get(row.grade)!.push(row);
  }

  for (const [grade, gradeRows] of [...byGrade.entries()].sort((a, b) => a[0] - b[0])) {
    const label = grade <= 10 ? "ICSE" : "ISC";
    console.log(`── Class ${grade} (${label}) — ${gradeRows.length} subjects ──`);
    for (const r of gradeRows) {
      const cc = Number(r.chapter_count);
      const tc = Number(r.topic_count);
      const flag = cc === 0 ? " ⚠ no chapters!" : cc === 1 ? " ⚠ only 1 chapter" : "";
      console.log(
        `  ${r.subject_name.padEnd(50)} code=${r.subject_code.padEnd(10)} ch=${String(cc).padStart(3)} topics=${String(tc).padStart(3)}${flag}`
      );
    }
    console.log();
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.subjects += 1;
      acc.chapters += Number(r.chapter_count);
      acc.topics += Number(r.topic_count);
      return acc;
    },
    { subjects: 0, chapters: 0, topics: 0 }
  );
  console.log(`=== Totals ===`);
  console.log(`  subjects: ${totals.subjects}`);
  console.log(`  chapters: ${totals.chapters}`);
  console.log(`  topics:   ${totals.topics}`);

  // Flag subjects with zero chapters (likely parse failures)
  const failed = rows.filter((r) => Number(r.chapter_count) === 0);
  if (failed.length > 0) {
    console.log(`\n=== Subjects with zero chapters (parse failures) ===`);
    for (const r of failed) {
      console.log(`  Gr${r.grade} ${r.subject_name} (${r.subject_code}) — ${r.source_url ?? "(no source url)"}`);
    }
  }

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
