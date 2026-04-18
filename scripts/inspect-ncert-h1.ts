/**
 * Inspect H1 of AI-extracted content for a given grade (and optional
 * subjects filter). Use this to catch NCERT URL→subject rotation drift
 * before trusting a bootstrap run — compare the H1 that NCERT actually
 * served vs. the subject it was filed under.
 *
 * Usage:
 *   pnpm tsx scripts/inspect-ncert-h1.ts --grade 11
 *   pnpm tsx scripts/inspect-ncert-h1.ts --grade 11 --subjects "History,Political Science"
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });
import { sql } from "drizzle-orm";
import { db } from "../src/db";

function parseArgs(argv: string[]) {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    grade: Number(val("--grade") ?? "0"),
    subjects: (val("--subjects") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.grade) {
    console.error("--grade required");
    process.exit(1);
  }
  const subjectFilter = args.subjects.length > 0
    ? sql`AND s.name IN (${sql.raw(args.subjects.map((s) => `'${s.replace(/'/g, "''")}'`).join(","))})`
    : sql``;

  const r = await db.execute(sql`
    SELECT ci.metadata->>'ncertBookCode' AS book_code,
           (ci.metadata->>'ncertChapter')::int AS chapter_num,
           t.id AS topic_id,
           c.id AS chapter_id,
           s.id AS subject_id,
           s.name AS subject,
           ci.id AS content_id,
           left(ci.body, 100) AS h1
    FROM content_items ci
    JOIN topics t ON t.id = ci.topic_id
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    WHERE st.grade = ${args.grade}
      ${subjectFilter}
      AND ci.metadata->>'ncertBookCode' IS NOT NULL
    ORDER BY ci.metadata->>'ncertBookCode', (ci.metadata->>'ncertChapter')::int
  `);
  const rows = (Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;
  console.log(`Inspect ${rows.length} Gr${args.grade} rows\n`);
  let lastBook = "";
  for (const row of rows) {
    if (row.book_code !== lastBook) {
      console.log(`\n── ${row.book_code} (filed as ${row.subject}) ──`);
      lastBook = String(row.book_code);
    }
    const h1 = String(row.h1 ?? "").replace(/\n/g, " ").slice(0, 100);
    console.log(`  ch${row.chapter_num} topic=${row.topic_id} content=${row.content_id}  ${h1}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
