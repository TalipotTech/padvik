#!/usr/bin/env tsx
/**
 * Curriculum structure consolidation.
 *
 * Rationalizes the subject/chapter/topic tree by merging artifacts of two
 * overlapping scraper runs (CBSE curriculum doc + NCERT downloader):
 *
 *   Phase 1 — Merge duplicate subjects per (board, grade, canonical name).
 *             Winner wins by (NCERT-catalog-code match ▶ content count ▶ topic
 *             count ▶ lower id). Loser's chapters are re-parented to the
 *             winner, renumbered to avoid UNIQUE(subject_id, chapter_number)
 *             collisions. Side-tables (exams, classrooms, etc.) get their
 *             subject_id repointed to the winner so SET-NULL FKs don't
 *             silently unlink.
 *
 *   Phase 2 — Within each subject, merge chapters with the same normalized
 *             title (e.g. two "Probability"). Winner wins by
 *             (content count ▶ topic count ▶ lower id). Loser's topics are
 *             moved to the winner; SET-NULL FKs repointed; loser deleted.
 *
 *   Phase 3 — Tag strand-style chapters (Mathematics Standard, Geometry,
 *             Mensuration, etc.) with metadata.kind = 'strand'. They stay in
 *             the tree for exam-weighting use but the student UI can hide
 *             them. No deletes — they may contain CBSE strand topics with
 *             real content.
 *
 *   Phase 4 — Report cross-grade bleed and manual-review queue. No writes.
 *
 * ALWAYS starts in dry-run. Pass --apply to commit. Every change is logged
 * before the DB is touched.
 *
 * Usage:
 *   pnpm tsx scripts/consolidate-curriculum.ts --board CBSE --grade 10
 *   pnpm tsx scripts/consolidate-curriculum.ts --board CBSE --grade 10 --apply
 *   pnpm tsx scripts/consolidate-curriculum.ts --all                 # every board/grade
 *   pnpm tsx scripts/consolidate-curriculum.ts --all --apply
 *   pnpm tsx scripts/consolidate-curriculum.ts --phase 2 --board CBSE --grade 10
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { NCERT_BOOK_CATALOG } from "../src/lib/scraper/ncert-downloader";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
  board?: string;
  grade?: number;
  all: boolean;
  apply: boolean;
  phases: Set<number>;
}

function parseArgs(argv: string[]): Args {
  const flag = (n: string) => argv.includes(n);
  const val = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const gradeRaw = val("--grade");
  const phaseRaw = val("--phase");
  return {
    board: val("--board"),
    grade: gradeRaw ? parseInt(gradeRaw, 10) : undefined,
    all: flag("--all"),
    apply: flag("--apply"),
    phases: new Set(phaseRaw ? phaseRaw.split(",").map((s) => parseInt(s, 10)) : [1, 2, 3, 4]),
  };
}

const args = parseArgs(process.argv.slice(2));
const DRY = !args.apply;

function log(msg = "") { console.log(msg); }
function logPlan(msg: string) { console.log(`  ${DRY ? "[plan]" : "[apply]"} ${msg}`); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip parenthetical variants, collapse whitespace, casefold. */
function canonicalName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Normalized chapter title for dedup comparison. */
function normalizedTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** NCERT catalog subject codes (set of canonical lowercase names). */
function buildNcertNameSet(): Set<string> {
  const s = new Set<string>();
  for (const b of NCERT_BOOK_CATALOG) s.add(b.subject.toLowerCase());
  return s;
}
const NCERT_SUBJECT_NAMES = buildNcertNameSet();

/**
 * Strand-style chapter title heuristic (pedagogical strand, not a book chapter).
 *
 * Exclude titles that are also valid NCERT chapter names (Statistics, Probability,
 * Trigonometry) — those get disambiguated by the NCERT-title cache check below.
 */
const STRAND_TITLE_PATTERNS = [
  /\bstandard\b/i, /\bbasic\b/i,
  /^(geometry|algebra|arithmetic|mensuration|number sense|computation|measurement|reasoning|problem solving)$/i,
];

// Cache of extracted NCERT chapter titles, keyed "grade|subject-slug".
// Populated from data/ncert-chapter-titles/*.json on first use.
let ncertTitleCache: Map<string, Set<string>> | null = null;

function loadNcertTitleCache(): Map<string, Set<string>> {
  if (ncertTitleCache) return ncertTitleCache;
  ncertTitleCache = new Map();
  const dir = require("path").join(process.cwd(), "data", "ncert-chapter-titles");
  const fs = require("fs") as typeof import("fs");
  if (!fs.existsSync(dir)) return ncertTitleCache;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const key = f.replace(/\.json$/, "");
    try {
      const raw = JSON.parse(fs.readFileSync(require("path").join(dir, f), "utf8")) as Record<string, string>;
      const titles = new Set<string>();
      for (const v of Object.values(raw)) titles.add(normalizedTitle(String(v)));
      ncertTitleCache.set(key, titles);
    } catch { /* skip malformed */ }
  }
  return ncertTitleCache;
}

function isKnownNcertChapterTitle(title: string, grade: number, subjectName: string): boolean {
  const cache = loadNcertTitleCache();
  const slug = subjectName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const titles = cache.get(`${grade}-${slug}`);
  if (!titles) return false;
  return titles.has(normalizedTitle(title));
}

function isStrandTitle(title: string, grade: number, subjectName: string): boolean {
  const t = title.trim();
  // If it literally matches an extracted NCERT chapter title, it's a real chapter.
  if (isKnownNcertChapterTitle(t, grade, subjectName)) return false;
  return STRAND_TITLE_PATTERNS.some((rx) => rx.test(t));
}

/** Pick winner from an array of candidate subject/chapter rows. */
function pickWinner<T extends { id: number; score: number }>(rows: T[]): T {
  return rows.slice().sort((a, b) => b.score - a.score || a.id - b.id)[0];
}

// ---------------------------------------------------------------------------
// Phase 1 — Merge duplicate subjects
// ---------------------------------------------------------------------------

interface SubjectRow {
  id: number;
  name: string;
  code: string;
  standard_id: number;
  board_code: string;
  grade: number;
  topic_count: number;
  content_count: number;
  [k: string]: unknown;
}

async function loadSubjects(a: Args): Promise<SubjectRow[]> {
  const whereBoard = a.board ? sql`AND b.code = ${a.board}` : sql``;
  const whereGrade = a.grade !== undefined ? sql`AND st.grade = ${a.grade}` : sql``;
  const rows = await db.execute<SubjectRow>(sql`
    SELECT s.id::int AS id, s.name, s.code, s.standard_id::int AS standard_id,
           b.code AS board_code, st.grade::int AS grade,
           (SELECT COUNT(*)::int FROM topics t JOIN chapters c ON c.id = t.chapter_id WHERE c.subject_id = s.id) AS topic_count,
           (SELECT COUNT(*)::int FROM content_items ci JOIN topics t ON t.id = ci.topic_id JOIN chapters c ON c.id = t.chapter_id WHERE c.subject_id = s.id) AS content_count
    FROM subjects s
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    WHERE 1=1 ${whereBoard} ${whereGrade}
    ORDER BY b.code, st.grade, s.name, s.id
  `);
  return rows as unknown as SubjectRow[];
}

interface SubjectMergeGroup {
  board_code: string;
  grade: number;
  canonical: string;
  rows: SubjectRow[];
}

function groupDuplicateSubjects(rows: SubjectRow[]): SubjectMergeGroup[] {
  const map = new Map<string, SubjectMergeGroup>();
  for (const r of rows) {
    const canon = canonicalName(r.name);
    const key = `${r.board_code}|${r.grade}|${canon}`;
    if (!map.has(key)) map.set(key, { board_code: r.board_code, grade: r.grade, canonical: canon, rows: [] });
    map.get(key)!.rows.push(r);
  }
  return [...map.values()].filter((g) => g.rows.length > 1);
}

/** Only merge when we're confident rows represent the same subject. */
function safeToAutoMerge(group: SubjectMergeGroup): boolean {
  // Regional variants like "Telugu (A.P)" vs "Telugu (Telangana)" strip to same
  // canonical but are legitimately distinct — refuse to merge.
  const rawNames = new Set(group.rows.map((r) => r.name.trim()));
  if (rawNames.size === group.rows.length) {
    // every row has a different raw name — check whether parentheticals differ
    const parens = group.rows.map((r) => (r.name.match(/\(([^)]*)\)/g) ?? []).join("|"));
    const distinctParens = new Set(parens.filter((p) => p.length > 0));
    if (distinctParens.size > 1) return false; // legit variants
  }
  return true;
}

function subjectWinnerScore(r: SubjectRow): number {
  let score = 0;
  if (NCERT_SUBJECT_NAMES.has(canonicalName(r.name))) score += 100;
  score += r.content_count * 10;
  score += r.topic_count;
  // Short, all-caps codes like MATH, SCI typically come from modern scrape
  if (/^[A-Z_]{2,10}$/.test(r.code)) score += 5;
  return score;
}

async function phase1MergeSubjects(a: Args): Promise<void> {
  log("\n════════════════════════════════════════════════════════════");
  log(" PHASE 1 — Merge duplicate subjects");
  log("════════════════════════════════════════════════════════════");

  const subjects = await loadSubjects(a);
  const groups = groupDuplicateSubjects(subjects);

  if (groups.length === 0) { log("  ✓ no duplicate subjects in scope"); return; }

  let merged = 0, skipped = 0;
  for (const g of groups) {
    log(`\n[${g.board_code} Class ${g.grade}] "${g.canonical}" (${g.rows.length} rows)`);
    for (const r of g.rows) {
      const tag = NCERT_SUBJECT_NAMES.has(canonicalName(r.name)) ? " [ncert-name]" : "";
      log(`    #${r.id} "${r.name}" code=${r.code} topics=${r.topic_count} content=${r.content_count}${tag}`);
    }

    if (!safeToAutoMerge(g)) {
      log("    ⚠ parentheticals differ — likely regional variants; skipping auto-merge");
      skipped++;
      continue;
    }

    const scored = g.rows.map((r) => ({ ...r, score: subjectWinnerScore(r) }));
    const winner = pickWinner(scored);
    const losers = scored.filter((r) => r.id !== winner.id);
    logPlan(`winner = #${winner.id} (score ${winner.score})`);

    for (const loser of losers) {
      logPlan(`migrate from loser #${loser.id} → winner #${winner.id}`);
      if (!DRY) {
        await db.transaction(async (tx) => {
          // 1. Re-parent loser's chapters, renumbering to avoid UNIQUE collision
          const [{ max_num }] = await tx.execute<{ max_num: number }>(sql`
            SELECT COALESCE(MAX(chapter_number), 0)::int AS max_num FROM chapters WHERE subject_id = ${winner.id}
          `);
          const offset = max_num;
          // Update chapter numbers in-place (safe because loser's subject_id is unique scope)
          await tx.execute(sql`
            UPDATE chapters SET chapter_number = chapter_number + ${offset}, subject_id = ${winner.id}
            WHERE subject_id = ${loser.id}
          `);
          // 2. Repoint SET-NULL side-table FKs to winner
          await tx.execute(sql`UPDATE classrooms SET subject_id = ${winner.id} WHERE subject_id = ${loser.id}`);
          await tx.execute(sql`UPDATE conversations SET subject_id = ${winner.id} WHERE subject_id = ${loser.id}`);
          await tx.execute(sql`UPDATE creator_content SET subject_id = ${winner.id} WHERE subject_id = ${loser.id}`);
          await tx.execute(sql`UPDATE exams SET subject_id = ${winner.id} WHERE subject_id = ${loser.id}`);
          await tx.execute(sql`UPDATE learning_sessions SET subject_id = ${winner.id} WHERE subject_id = ${loser.id}`);
          await tx.execute(sql`UPDATE performance_reports SET subject_id = ${winner.id} WHERE subject_id = ${loser.id}`);
          await tx.execute(sql`UPDATE question_papers SET subject_id = ${winner.id} WHERE subject_id = ${loser.id}`);
          // 3. Delete the now-empty loser subject (no chapters reference it)
          await tx.execute(sql`DELETE FROM subjects WHERE id = ${loser.id}`);
          // 4. Stash merge trail on winner
          await tx.execute(sql`
            UPDATE subjects SET metadata = COALESCE(metadata, '{}'::jsonb)
              || jsonb_build_object('merged_from', COALESCE(metadata->'merged_from', '[]'::jsonb) || to_jsonb(${loser.id}::int))
            WHERE id = ${winner.id}
          `);
        });
      }
      merged++;
    }
  }

  log(`\n  subject groups merged=${merged}  skipped=${skipped}`);
}

// ---------------------------------------------------------------------------
// Phase 2 — Merge duplicate chapters within a subject
// ---------------------------------------------------------------------------

interface ChapterRow {
  id: number;
  subject_id: number;
  chapter_number: number;
  title: string;
  topic_count: number;
  content_count: number;
  ncert_content_count: number;
  ncert_merge_flag: number;
  board_code: string;
  grade: number;
  subject_name: string;
  [k: string]: unknown;
}

async function loadChapters(a: Args): Promise<ChapterRow[]> {
  const whereBoard = a.board ? sql`AND b.code = ${a.board}` : sql``;
  const whereGrade = a.grade !== undefined ? sql`AND st.grade = ${a.grade}` : sql``;
  return (await db.execute<ChapterRow>(sql`
    SELECT c.id::int, c.subject_id::int, c.chapter_number::int, c.title,
           (SELECT COUNT(*)::int FROM topics t WHERE t.chapter_id = c.id) AS topic_count,
           (SELECT COUNT(*)::int FROM content_items ci JOIN topics t ON t.id = ci.topic_id WHERE t.chapter_id = c.id) AS content_count,
           (SELECT COUNT(*)::int FROM content_items ci JOIN topics t ON t.id = ci.topic_id
              WHERE t.chapter_id = c.id
                AND (ci.source_type = 'ncert'
                     OR ci.source_url ILIKE '%ncert-pdfs%'
                     OR ci.metadata->>'pdfPath' ILIKE '%ncert-pdfs%')
           ) AS ncert_content_count,
           (CASE WHEN c.metadata->>'source' = 'ncert_merge' THEN 1 ELSE 0 END)::int AS ncert_merge_flag,
           b.code AS board_code, st.grade::int AS grade, s.name AS subject_name
    FROM chapters c
    JOIN subjects s ON s.id = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    WHERE 1=1 ${whereBoard} ${whereGrade}
    ORDER BY b.code, st.grade, s.name, c.chapter_number, c.id
  `)) as unknown as ChapterRow[];
}

function chapterWinnerScore(c: ChapterRow): number {
  let score = 0;
  score += c.ncert_merge_flag * 100;           // ncert_merge chapter: definitive winner signal
  score += c.ncert_content_count * 50;         // content linked to real NCERT PDF
  score += c.content_count * 10;
  score += c.topic_count;
  // Penalize strand-pattern titles so the NCERT-aligned row wins on tiebreak
  if (STRAND_TITLE_PATTERNS.some((rx) => rx.test(c.title.trim()))) score -= 20;
  score += 1 / (c.chapter_number + 1);
  return score;
}

async function phase2MergeChapters(a: Args): Promise<void> {
  log("\n════════════════════════════════════════════════════════════");
  log(" PHASE 2 — Merge duplicate chapters within a subject");
  log("════════════════════════════════════════════════════════════");

  const chapters = await loadChapters(a);
  const groups = new Map<string, ChapterRow[]>();
  for (const c of chapters) {
    const key = `${c.subject_id}|${normalizedTitle(c.title)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const dup = [...groups.values()].filter((g) => g.length > 1);
  if (dup.length === 0) { log("  ✓ no duplicate chapters in scope"); return; }

  let merged = 0, skippedGroups = 0;
  for (const g of dup) {
    const head = g[0];
    log(`\n[${head.board_code} Class ${head.grade}] ${head.subject_name} / "${head.title}" (${g.length} chapters)`);
    for (const c of g) log(`    #${c.id} ch${c.chapter_number} topics=${c.topic_count} content=${c.content_count}`);

    // Safety: groups larger than 2 almost always indicate a scraper titling
    // bug (every chapter in the book got the same title), not real duplicates.
    // Merging would collapse 10+ distinct chapters into one and destroy content.
    if (g.length > 2) {
      log(`    ⚠ ${g.length} chapters share this title — likely a mis-titling bug, not duplicates. SKIPPED. Re-scrape or re-extract titles instead.`);
      skippedGroups++;
      continue;
    }

    const scored = g.map((c) => ({ ...c, score: chapterWinnerScore(c) }));
    const winner = pickWinner(scored);
    const losers = scored.filter((c) => c.id !== winner.id);
    logPlan(`winner = #${winner.id} (ch${winner.chapter_number} score ${winner.score.toFixed(2)})`);

    for (const loser of losers) {
      logPlan(`move topics from #${loser.id} (ch${loser.chapter_number}) into winner #${winner.id}`);
      if (!DRY) {
        await db.transaction(async (tx) => {
          // Move topics; handle UNIQUE(chapter_id, title) if any such constraint exists
          // (There isn't one, so straight UPDATE works.)
          await tx.execute(sql`UPDATE topics SET chapter_id = ${winner.id} WHERE chapter_id = ${loser.id}`);
          // SET-NULL FKs on chapters
          await tx.execute(sql`UPDATE creator_content SET chapter_id = ${winner.id} WHERE chapter_id = ${loser.id}`);
          await tx.execute(sql`UPDATE learning_sessions SET chapter_id = ${winner.id} WHERE chapter_id = ${loser.id}`);
          await tx.execute(sql`DELETE FROM chapters WHERE id = ${loser.id}`);
          await tx.execute(sql`
            UPDATE chapters SET metadata = COALESCE(metadata, '{}'::jsonb)
              || jsonb_build_object('merged_from', COALESCE(metadata->'merged_from', '[]'::jsonb) || to_jsonb(${loser.id}::int))
            WHERE id = ${winner.id}
          `);
        });
      }
      merged++;
    }
  }

  log(`\n  chapter pairs merged=${merged}  groups skipped (suspected mis-titling)=${skippedGroups}`);
}

// ---------------------------------------------------------------------------
// Phase 3 — Tag strand-style chapters
// ---------------------------------------------------------------------------

async function phase3TagStrands(a: Args): Promise<void> {
  log("\n════════════════════════════════════════════════════════════");
  log(" PHASE 3 — Tag strand-style chapters");
  log("════════════════════════════════════════════════════════════");

  const chapters = await loadChapters(a);
  // A chapter is flagged "strand" only if:
  //   (a) its title matches the strand-pattern heuristic, AND
  //   (b) none of its topic content points at a real NCERT PDF.
  // Rule (b) matters because the remap script may have linked topics under a
  // strand-named chapter to real NCERT PDFs — hiding those would lose good
  // content.
  const strands = chapters.filter((c) =>
    isStrandTitle(c.title, c.grade, c.subject_name) && c.ncert_content_count === 0
  );
  if (strands.length === 0) { log("  ✓ no strand chapters in scope"); return; }

  for (const c of strands) {
    log(`  ${c.board_code} Class ${c.grade} / ${c.subject_name} / ch${c.chapter_number} "${c.title}" (topics=${c.topic_count})`);
    logPlan(`SET metadata.kind = 'strand'`);
    if (!DRY) {
      await db.execute(sql`
        UPDATE chapters SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('kind', 'strand')
        WHERE id = ${c.id}
      `);
    }
  }
  log(`\n  strand chapters tagged=${strands.length}`);
}

// ---------------------------------------------------------------------------
// Phase 4 — Report cross-grade bleed (no writes)
// ---------------------------------------------------------------------------

async function phase4Report(a: Args): Promise<void> {
  log("\n════════════════════════════════════════════════════════════");
  log(" PHASE 4 — Manual-review queue (no writes)");
  log("════════════════════════════════════════════════════════════");

  // Titles that ONLY appear in Class 9 NCERT (not Class 7/8/10+). Exact-match
  // against normalizedTitle() to avoid flagging "Lines and Angles" in Class 7,
  // which is legitimate there too.
  const class9OnlyNormalized = new Set([
    normalizedTitle("Introduction to Euclid's Geometry"),
    normalizedTitle("Areas of Parallelograms and Triangles"),
    normalizedTitle("Heron's Formula"),
    normalizedTitle("Heron's Formula (Areas)"),
  ]);
  const chapters = await loadChapters(a);
  const bleed = chapters.filter((c) => {
    if (c.grade === 9) return false;
    return class9OnlyNormalized.has(normalizedTitle(c.title));
  });
  if (bleed.length === 0) { log("  ✓ no cross-grade bleed in scope"); return; }
  for (const c of bleed) {
    log(`  ${c.board_code} Class ${c.grade} / ${c.subject_name} / ch${c.chapter_number} "${c.title}" (topics=${c.topic_count}) — manual review`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log("╔══════════════════════════════════════════════════════════╗");
  log(`║           CURRICULUM CONSOLIDATION — ${DRY ? "DRY RUN" : "APPLY  "}           ║`);
  log("╚══════════════════════════════════════════════════════════╝");
  const scope = args.all
    ? "ALL boards/grades"
    : `${args.board ?? "ALL boards"} Class ${args.grade ?? "ALL"}`;
  log(`Scope: ${scope}`);
  log(`Phases: ${[...args.phases].sort().join(",")}`);
  if (DRY) log("⚠ DRY RUN — no database changes will be written. Pass --apply to commit.");

  if (args.phases.has(1)) await phase1MergeSubjects(args);
  if (args.phases.has(2)) await phase2MergeChapters(args);
  if (args.phases.has(3)) await phase3TagStrands(args);
  if (args.phases.has(4)) await phase4Report(args);

  log("\n────────────────────────────────────────────────────────────");
  log(DRY ? "Dry run complete. Re-run with --apply to commit." : "Consolidation applied.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
