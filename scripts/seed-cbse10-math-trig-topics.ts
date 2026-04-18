#!/usr/bin/env tsx
/**
 * Seed CBSE Class 10 Mathematics topics for Ch 8 "Introduction To Trigonometry"
 * and Ch 9 "Some Applications Of Trigonometry" — both chapters exist in the DB
 * as empty stubs (topics=0) because prior syllabus parses dropped them.
 *
 * Topic list is the standard 2025-26 CBSE Class 10 Mathematics syllabus
 * (post-2023 revision — "Trigonometric Ratios of Complementary Angles" was
 * removed). Source:
 *   https://cbseacademic.nic.in/web_material/CurriculumMain26/SrSec/Maths_SrSec_2025-26.pdf
 *
 * Idempotent: skips insert when a topic with the same (chapter_id, title)
 * already exists. Matches the board/grade/subject via codes rather than
 * hard-coded chapter IDs so it survives a reseed.
 *
 * Usage:
 *   pnpm tsx scripts/seed-cbse10-math-trig-topics.ts --dry-run
 *   pnpm tsx scripts/seed-cbse10-math-trig-topics.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { boards, standards, subjects, chapters, topics } from "../src/db/schema/curriculum";

// ── Topic plan ────────────────────────────────────────────────────────────
// sortOrder starts at 0 to match the schema's .min(0) constraint.
const PLAN: Array<{ chapterNumber: number; topics: Array<{ title: string; description: string }> }> = [
  {
    chapterNumber: 8,
    topics: [
      {
        title: "Trigonometric Ratios",
        description:
          "Trigonometric ratios of an acute angle of a right triangle (sin, cos, tan, cosec, sec, cot). Proof of their existence (well-defined); motivate the ratios whichever are defined at 0° and 90°.",
      },
      {
        title: "Trigonometric Ratios of Specific Angles",
        description:
          "Values of the trigonometric ratios at 30°, 45°, and 60°. Evaluation of simple expressions using these values.",
      },
      {
        title: "Trigonometric Identities",
        description:
          "Proof and applications of the identity sin²A + cos²A = 1. Only simple identities to be given. Trigonometric ratios of complementary angles (overview).",
      },
    ],
  },
  {
    chapterNumber: 9,
    topics: [
      {
        title: "Heights and Distances",
        description:
          "Simple problems on heights and distances. Problems should not involve more than two right triangles. Angles of elevation / depression should be only 30°, 45°, and 60°.",
      },
    ],
  },
];

function parseArgs(argv: string[]) {
  return { dryRun: argv.includes("--dry-run") };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n=== Seed CBSE Cl 10 Math trigonometry topics (${args.dryRun ? "DRY RUN" : "LIVE"}) ===\n`);

  // Resolve the target subject: CBSE / Class 10 / Mathematics.
  const [subject] = await db
    .select({ id: subjects.id, name: subjects.name, code: subjects.code })
    .from(subjects)
    .innerJoin(standards, eq(standards.id, subjects.standardId))
    .innerJoin(boards, eq(boards.id, standards.boardId))
    .where(and(
      eq(boards.code, "CBSE"),
      eq(standards.grade, 10),
      sql`LOWER(${subjects.name}) LIKE '%mathematics%'`,
    ))
    .limit(1);

  if (!subject) {
    console.error("  ✗ Could not resolve CBSE Class 10 Mathematics subject — aborting.");
    process.exit(1);
  }
  console.log(`  subject: id=${subject.id} code=${subject.code} "${subject.name}"`);

  let created = 0;
  let skipped = 0;

  for (const entry of PLAN) {
    const [chapter] = await db
      .select({ id: chapters.id, title: chapters.title })
      .from(chapters)
      .where(and(
        eq(chapters.subjectId, subject.id),
        eq(chapters.chapterNumber, entry.chapterNumber),
      ))
      .limit(1);

    if (!chapter) {
      console.log(`  ✗ Ch${entry.chapterNumber} not found under subject ${subject.id} — skipped`);
      continue;
    }

    console.log(`\n  Ch${entry.chapterNumber} "${chapter.title}" (id=${chapter.id}):`);

    for (let i = 0; i < entry.topics.length; i++) {
      const t = entry.topics[i];

      // Idempotent: match on case-insensitive title under the same chapter.
      const [existing] = await db
        .select({ id: topics.id, title: topics.title })
        .from(topics)
        .where(and(
          eq(topics.chapterId, chapter.id),
          sql`LOWER(${topics.title}) = LOWER(${t.title})`,
        ))
        .limit(1);

      if (existing) {
        console.log(`    ⤵ skip — already exists: id=${existing.id} "${existing.title}"`);
        skipped++;
        continue;
      }

      if (args.dryRun) {
        console.log(`    + would insert: sortOrder=${i} "${t.title}"`);
        continue;
      }

      const [inserted] = await db
        .insert(topics)
        .values({
          chapterId: chapter.id,
          title: t.title,
          description: t.description,
          sortOrder: i,
          metadata: { source: "manual-seed", seededFor: "cbse-10-math-trig" },
        })
        .returning({ id: topics.id });

      console.log(`    ✓ inserted id=${inserted.id} sortOrder=${i} "${t.title}"`);
      created++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  created: ${created}`);
  console.log(`  skipped: ${skipped} (already existed)`);
  process.exit(0);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
