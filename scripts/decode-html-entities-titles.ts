#!/usr/bin/env tsx
/**
 * Decode HTML entities (&amp;, &#039;, &quot; etc.) in subject/chapter/topic
 * titles that slipped through earlier ingest runs before syllabus-parser
 * learned to decode them.
 *
 * Safe to re-run — only updates rows where the decoded form differs from
 * what's currently stored.
 *
 * Usage:
 *   pnpm tsx scripts/decode-html-entities-titles.ts --dry-run
 *   pnpm tsx scripts/decode-html-entities-titles.ts
 *   pnpm tsx scripts/decode-html-entities-titles.ts --board ICSE
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db";

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseArgs(argv: string[]) {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    dryRun: argv.includes("--dry-run"),
    board: val("--board"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n=== Decode HTML entities in titles (${args.dryRun ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`board filter: ${args.board ?? "(all)"}\n`);

  const boardFilter = args.board ? sql`AND b.code = ${args.board}` : sql``;

  // Subjects
  const subjectsRes = await db.execute(sql`
    SELECT sb.id, sb.name, sb.code
    FROM subjects sb
    JOIN standards st ON st.id = sb.standard_id
    JOIN boards b ON b.id = st.board_id
    WHERE (sb.name LIKE '%&%;%' OR sb.code LIKE '%&%;%')
      ${boardFilter}
  `);
  const subjectRows = (Array.isArray(subjectsRes) ? subjectsRes : (subjectsRes as { rows?: unknown[] }).rows ?? []) as Array<{ id: number; name: string; code: string }>;
  let subjectsFixed = 0;
  for (const r of subjectRows) {
    const newName = decodeHtmlEntities(r.name);
    const newCode = decodeHtmlEntities(r.code);
    if (newName === r.name && newCode === r.code) continue;
    console.log(`  subject ${r.id}: "${r.name}"/"${r.code}" → "${newName}"/"${newCode}"`);
    if (!args.dryRun) {
      await db.execute(sql`UPDATE subjects SET name = ${newName}, code = ${newCode} WHERE id = ${r.id}`);
    }
    subjectsFixed++;
  }

  // Chapters
  const chaptersRes = await db.execute(sql`
    SELECT c.id, c.title, c.description
    FROM chapters c
    JOIN subjects sb ON sb.id = c.subject_id
    JOIN standards st ON st.id = sb.standard_id
    JOIN boards b ON b.id = st.board_id
    WHERE (c.title LIKE '%&%;%' OR c.description LIKE '%&%;%')
      ${boardFilter}
  `);
  const chapterRows = (Array.isArray(chaptersRes) ? chaptersRes : (chaptersRes as { rows?: unknown[] }).rows ?? []) as Array<{ id: number; title: string; description: string | null }>;
  let chaptersFixed = 0;
  for (const r of chapterRows) {
    const newTitle = decodeHtmlEntities(r.title);
    const newDesc = r.description ? decodeHtmlEntities(r.description) : null;
    if (newTitle === r.title && newDesc === r.description) continue;
    console.log(`  chapter ${r.id}: "${r.title}" → "${newTitle}"`);
    if (!args.dryRun) {
      await db.execute(sql`UPDATE chapters SET title = ${newTitle}, description = ${newDesc} WHERE id = ${r.id}`);
    }
    chaptersFixed++;
  }

  // Topics
  const topicsRes = await db.execute(sql`
    SELECT t.id, t.title, t.description
    FROM topics t
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects sb ON sb.id = c.subject_id
    JOIN standards st ON st.id = sb.standard_id
    JOIN boards b ON b.id = st.board_id
    WHERE (t.title LIKE '%&%;%' OR t.description LIKE '%&%;%')
      ${boardFilter}
  `);
  const topicRows = (Array.isArray(topicsRes) ? topicsRes : (topicsRes as { rows?: unknown[] }).rows ?? []) as Array<{ id: number; title: string; description: string | null }>;
  let topicsFixed = 0;
  for (const r of topicRows) {
    const newTitle = decodeHtmlEntities(r.title);
    const newDesc = r.description ? decodeHtmlEntities(r.description) : null;
    if (newTitle === r.title && newDesc === r.description) continue;
    console.log(`  topic ${r.id}: "${r.title}" → "${newTitle}"`);
    if (!args.dryRun) {
      await db.execute(sql`UPDATE topics SET title = ${newTitle}, description = ${newDesc} WHERE id = ${r.id}`);
    }
    topicsFixed++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  subjects fixed: ${subjectsFixed}`);
  console.log(`  chapters fixed: ${chaptersFixed}`);
  console.log(`  topics fixed:   ${topicsFixed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
