#!/usr/bin/env tsx
/**
 * Audit student-visible content coverage across the curriculum.
 *
 * Thin CLI wrapper — classification logic lives in
 * src/lib/scraper/coverage/audit.ts (also used by GET /api/admin/coverage).
 *
 * For every topic under the filter, classifies into exactly one bucket — the
 * FIRST that applies:
 *
 *   ok            ≥1 content row passes the student filter
 *   no_row        0 content_items rows
 *   empty_body    all rows length(body) = 0
 *   refusal_body  all rows match refusal patterns
 *   too_short     all rows length(body) <= 100
 *   low_quality   all rows qualityScore < 0.5
 *   bad_review    all rows review_status in ('needs_review','rejected')
 *   not_published all rows is_published = false
 *   unknown       fell through — investigate manually
 *
 * Read-only. Produces a hierarchical report; with --gaps-only emits a flat
 * list suitable for piping into a regeneration script.
 *
 * Usage:
 *   pnpm tsx scripts/audit-content-coverage.ts
 *   pnpm tsx scripts/audit-content-coverage.ts --board CBSE --grade 10 --subject Mathematics
 *   pnpm tsx scripts/audit-content-coverage.ts --board CBSE --grade 10 --subject Mathematics --chapter 2
 *   pnpm tsx scripts/audit-content-coverage.ts --board CBSE --grade 10 --subject Mathematics --gaps-only
 *   pnpm tsx scripts/audit-content-coverage.ts --board CBSE --grade 10 --subject Mathematics --verbose
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import {
  auditCoverage,
  COVERAGE_BUCKET_ORDER,
  COVERAGE_BUCKET_LABEL,
  type CoverageBucket,
  type CoverageFilter,
} from "../src/lib/scraper/coverage";

function parseArgs(argv: string[]) {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    board: val("--board"),
    grade: val("--grade") ? Number(val("--grade")) : undefined,
    subject: val("--subject"),
    chapter: val("--chapter") ? Number(val("--chapter")) : undefined,
    gapsOnly: argv.includes("--gaps-only"),
    verbose: argv.includes("--verbose") || argv.includes("-v"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const filter: CoverageFilter = {
    boardCode: args.board,
    grade: args.grade,
    subjectName: args.subject,
    chapterNumber: args.chapter,
  };

  const report = await auditCoverage(filter);
  if (report.topics.length === 0) {
    console.log("No topics matched the filter.");
    process.exit(0);
  }

  // --gaps-only: flat list of non-OK topics, one per line
  if (args.gapsOnly) {
    for (const subj of report.subjects) {
      for (const ch of subj.chapters) {
        for (const t of ch.topics) {
          if (t.bucket === "ok") continue;
          console.log(
            `${t.topicId}\t${t.bucket}\t[${subj.boardCode}] Gr${subj.grade} ${subj.subjectName} / Ch${ch.chapterNumber} ${ch.title} / ${t.title}`
          );
        }
      }
    }
    process.exit(0);
  }

  // Hierarchical report
  const bucketPad: Record<CoverageBucket, string> = {
    ok: "OK        ",
    no_row: "NO_ROW    ",
    empty_body: "EMPTY_BODY",
    refusal_body: "REFUSAL   ",
    too_short: "TOO_SHORT ",
    low_quality: "LOW_QUAL  ",
    bad_review: "BAD_REVIEW",
    not_published: "UNPUB     ",
    unknown: "UNKNOWN   ",
  };

  console.log(`\n=== Content coverage audit ===`);
  const filterDesc = [
    args.board ? `board=${args.board}` : null,
    args.grade ? `grade=${args.grade}` : null,
    args.subject ? `subject~${args.subject}` : null,
    args.chapter ? `chapter=${args.chapter}` : null,
  ].filter(Boolean).join(" | ") || "(whole catalog)";
  console.log(`Filter: ${filterDesc}`);
  console.log(`Topics scanned: ${report.topics.length}\n`);

  for (const subj of report.subjects) {
    for (const ch of subj.chapters) {
      const parts = COVERAGE_BUCKET_ORDER
        .filter((b) => ch.bucketCounts[b] > 0)
        .map((b) => `${COVERAGE_BUCKET_LABEL[b]}=${ch.bucketCounts[b]}`)
        .join("  ");
      const badge = ch.gapCount === 0 ? "OK " : "GAP";
      const label = `[${subj.boardCode}] Gr${subj.grade} ${subj.subjectName} — Ch${ch.chapterNumber} "${ch.title}"`;
      console.log(`${badge}  ${label}   (${ch.topics.length} topics)  ${parts}`);

      if (args.verbose || ch.gapCount > 0) {
        for (const t of ch.topics) {
          if (!args.verbose && t.bucket === "ok") continue;
          console.log(
            `     ${bucketPad[t.bucket]} id=${String(t.topicId).padStart(5)} rows=${t.rowCount} pass=${t.passingCount}  "${t.title}"`
          );
        }
      }
    }
  }

  // Summary
  console.log(`\n=== Summary ===`);
  const total = report.summary.totalTopics;
  for (const b of COVERAGE_BUCKET_ORDER) {
    if (report.summary.buckets[b] === 0) continue;
    const pct = ((report.summary.buckets[b] / total) * 100).toFixed(1);
    console.log(`  ${bucketPad[b]} ${String(report.summary.buckets[b]).padStart(5)}  (${pct}%)`);
  }

  if (report.summary.gaps === 0) {
    console.log(`\n  ✓ All ${total} topics have student-visible content.`);
  } else {
    console.log(`\n  ✗ ${report.summary.gaps}/${total} topics have a gap.`);
    console.log(`\nRecommended remediation (run against the same --board/--grade/--subject filter):`);
    const b = report.summary.buckets;
    if (b.no_row > 0) {
      console.log(`  NO_ROW     (${b.no_row}) → pnpm tsx scripts/bootstrap-core-content.ts --grade <N> --subjects "<Subject>"`);
    }
    if (b.empty_body > 0) {
      console.log(`  EMPTY_BODY (${b.empty_body}) → pnpm tsx scripts/regenerate-cleared-content.ts`);
    }
    if (b.refusal_body + b.too_short + b.low_quality > 0) {
      console.log(`  REFUSAL/SHORT/LOW_QUAL (${b.refusal_body + b.too_short + b.low_quality}) → inspect + re-extract from PDF`);
    }
    if (b.bad_review > 0) {
      console.log(`  BAD_REVIEW (${b.bad_review}) → admin review queue; flip to 'pending'/'auto_approved' after manual check`);
    }
    if (b.not_published > 0) {
      console.log(`  UNPUB      (${b.not_published}) → pnpm tsx scripts/auto-publish-high-quality-ncert.ts`);
    }
    if (b.unknown > 0) {
      console.log(`  UNKNOWN    (${b.unknown}) → inspect individually with --verbose`);
    }
    console.log(`\n  Emit machine-readable gap list:  add --gaps-only`);
  }

  process.exit(0);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
