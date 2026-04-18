#!/usr/bin/env tsx
/**
 * Curriculum-structure audit.
 *
 * Finds structural anomalies that cause topic→PDF mismatch downstream:
 *   1. Duplicate subjects per (board, grade, name) — e.g. "Mathematics" vs
 *      "Mathematics (Standard)" competing for the same NCERT content.
 *   2. Strand-style chapters with generic names ("Mathematics Standard",
 *      "Geometry", "Mensuration") that do not map to any NCERT PDF.
 *   3. Duplicate chapter titles within one subject (two "Probability").
 *   4. Topics whose chapter title is clearly from another grade (Class 9
 *      chapters under a Class 10 subject, etc.).
 *
 * Read-only — produces a report only. Use the output to decide what the
 * consolidation script should rewrite.
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { db } from "../src/db";
import { sql } from "drizzle-orm";

// Chapter titles that are pedagogical strands, not book chapters.
// These come from CBSE's curriculum document, not NCERT TOC.
const STRAND_PATTERNS = [
  /\bstandard\b/i, /\bbasic\b/i,
  /^(geometry|algebra|arithmetic|mensuration|statistics|probability|trigonometry|number sense|computation|measurement|reasoning|problem solving)$/i,
];

// Class-9-only NCERT chapter titles that should never appear under Class 10+.
const CLASS9_ONLY_TITLES = [
  "introduction to euclid", "lines and angles", "areas of parallelograms",
  "heron", "quadrilaterals",
];

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║           CURRICULUM STRUCTURE AUDIT                     ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // ─────────────────────────────────────────────────────────────────
  // 1. Duplicate subjects per (board, grade, normalized name)
  // ─────────────────────────────────────────────────────────────────
  const dupSubjects = await db.execute<{
    board_code: string; grade: number; base_name: string;
    subject_ids: string; names: string; codes: string; topic_counts: string;
  }>(sql`
    WITH subj AS (
      SELECT s.id, s.name, s.code,
             b.code AS board_code, st.grade,
             lower(regexp_replace(s.name, '\\s*\\([^)]*\\)\\s*', '', 'g')) AS base_name
      FROM subjects s
      JOIN standards st ON st.id = s.standard_id
      JOIN boards b ON b.id = st.board_id
    )
    SELECT board_code, grade, base_name,
           string_agg(id::text, ',' ORDER BY id) AS subject_ids,
           string_agg(name, ' | ' ORDER BY id) AS names,
           string_agg(code, ',' ORDER BY id) AS codes,
           string_agg(
             (SELECT COUNT(*)::text FROM topics t JOIN chapters c ON c.id = t.chapter_id WHERE c.subject_id = subj.id),
             ',' ORDER BY id
           ) AS topic_counts
    FROM subj
    GROUP BY board_code, grade, base_name
    HAVING COUNT(*) > 1
    ORDER BY board_code, grade, base_name
  `);
  console.log("── 1. Duplicate subjects (same board+grade+base name) ──");
  if (dupSubjects.length === 0) console.log("  ✓ none");
  for (const r of dupSubjects) {
    console.log(`  ${r.board_code} Class ${r.grade} "${r.base_name}"`);
    console.log(`    subject ids: ${r.subject_ids}   names: ${r.names}`);
    console.log(`    codes: ${r.codes}   topic counts: ${r.topic_counts}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. Strand-style chapters
  // ─────────────────────────────────────────────────────────────────
  const allChapters = await db.execute<{
    id: number; subject_id: number; chapter_number: number; title: string;
    board_code: string; grade: number; subject_name: string; topic_count: number;
  }>(sql`
    SELECT c.id, c.subject_id, c.chapter_number, c.title,
           b.code AS board_code, st.grade, s.name AS subject_name,
           (SELECT COUNT(*)::int FROM topics t WHERE t.chapter_id = c.id) AS topic_count
    FROM chapters c
    JOIN subjects s ON s.id = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    ORDER BY b.code, st.grade, s.name, c.chapter_number
  `);

  const strandChapters = allChapters.filter((c) =>
    STRAND_PATTERNS.some((rx) => rx.test(c.title.trim()))
  );
  console.log("\n── 2. Strand-style chapters (don't map to an NCERT PDF) ──");
  if (strandChapters.length === 0) console.log("  ✓ none");
  for (const c of strandChapters) {
    console.log(`  ${c.board_code} Class ${c.grade} / ${c.subject_name} / ch${c.chapter_number} "${c.title}" (topics=${c.topic_count})`);
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. Duplicate chapter titles within one subject
  // ─────────────────────────────────────────────────────────────────
  const dupChapters = await db.execute<{
    board_code: string; grade: number; subject_name: string; subject_id: number;
    title: string; chapter_ids: string; chapter_numbers: string;
  }>(sql`
    SELECT b.code AS board_code, st.grade, s.name AS subject_name, s.id AS subject_id,
           lower(c.title) AS title,
           string_agg(c.id::text, ',' ORDER BY c.id) AS chapter_ids,
           string_agg(c.chapter_number::text, ',' ORDER BY c.chapter_number) AS chapter_numbers
    FROM chapters c
    JOIN subjects s ON s.id = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    GROUP BY b.code, st.grade, s.name, s.id, lower(c.title)
    HAVING COUNT(*) > 1
    ORDER BY b.code, st.grade, s.name
  `);
  console.log("\n── 3. Duplicate chapter titles within one subject ──");
  if (dupChapters.length === 0) console.log("  ✓ none");
  for (const r of dupChapters) {
    console.log(`  ${r.board_code} Class ${r.grade} / ${r.subject_name} / "${r.title}" @ ch${r.chapter_numbers} (ids: ${r.chapter_ids})`);
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. Cross-grade bleed (Class-9-only chapter titles under other grades)
  // ─────────────────────────────────────────────────────────────────
  const crossGradeBleed = allChapters.filter((c) => {
    if (c.grade === 9) return false;
    const low = c.title.toLowerCase();
    return CLASS9_ONLY_TITLES.some((k) => low.includes(k));
  });
  console.log("\n── 4. Suspected cross-grade bleed (Class-9 titles elsewhere) ──");
  if (crossGradeBleed.length === 0) console.log("  ✓ none");
  for (const c of crossGradeBleed) {
    console.log(`  ${c.board_code} Class ${c.grade} / ${c.subject_name} / ch${c.chapter_number} "${c.title}" (topics=${c.topic_count})`);
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. Summary counters
  // ─────────────────────────────────────────────────────────────────
  const [{ total_boards }] = await db.execute<{ total_boards: number }>(sql`SELECT COUNT(*)::int AS total_boards FROM boards`);
  const [{ total_standards }] = await db.execute<{ total_standards: number }>(sql`SELECT COUNT(*)::int AS total_standards FROM standards`);
  const [{ total_subjects }] = await db.execute<{ total_subjects: number }>(sql`SELECT COUNT(*)::int AS total_subjects FROM subjects`);
  const [{ total_chapters }] = await db.execute<{ total_chapters: number }>(sql`SELECT COUNT(*)::int AS total_chapters FROM chapters`);
  const [{ total_topics }] = await db.execute<{ total_topics: number }>(sql`SELECT COUNT(*)::int AS total_topics FROM topics`);
  const [{ total_content }] = await db.execute<{ total_content: number }>(sql`SELECT COUNT(*)::int AS total_content FROM content_items`);

  console.log("\n── 5. DB-wide totals ──");
  console.log(`  boards=${total_boards}  standards=${total_standards}  subjects=${total_subjects}  chapters=${total_chapters}  topics=${total_topics}  content=${total_content}`);

  console.log("\n──────────────────────────────────────────────────────────\n");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
