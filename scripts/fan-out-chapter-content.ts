#!/usr/bin/env tsx
/**
 * Fan out a chapter's best content row to every sibling topic that has none.
 *
 * Thin CLI wrapper — the real logic lives in src/lib/scraper/coverage/fan-out.ts
 * (also used by POST /api/admin/coverage/run).
 *
 * Behaviour is unchanged: pick the best (published, q>=0.5, non-refusal,
 * length>200) content row per chapter, then clone it to every orphan topic
 * (zero content_items rows). Idempotent and safe to re-run.
 *
 * Usage:
 *   pnpm tsx scripts/fan-out-chapter-content.ts --dry-run
 *   pnpm tsx scripts/fan-out-chapter-content.ts --board CBSE --grade 10 --subject Mathematics
 *   pnpm tsx scripts/fan-out-chapter-content.ts --board CBSE --grade 10 --subject Mathematics --chapter 2
 *   pnpm tsx scripts/fan-out-chapter-content.ts                # whole catalog
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { fanOutChapterContent, type CoverageFilter } from "../src/lib/scraper/coverage";

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
    dryRun: argv.includes("--dry-run"),
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

  const filterDesc = [
    args.board ? `board=${args.board}` : null,
    args.grade ? `grade=${args.grade}` : null,
    args.subject ? `subject~${args.subject}` : null,
    args.chapter ? `chapter=${args.chapter}` : null,
  ].filter(Boolean).join(" | ") || "(whole catalog)";

  console.log(`\n=== Fan-out chapter content to orphan topics (${args.dryRun ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`Filter: ${filterDesc}\n`);

  const result = await fanOutChapterContent(filter, {
    dryRun: args.dryRun,
    onLog: (line) => console.log(line),
  });

  console.log(`\n=== Summary ===`);
  console.log(`  chapters with orphans:              ${result.chaptersWithOrphans}`);
  console.log(`  chapters handled (had source):      ${result.chaptersHandled}`);
  console.log(`  chapters skipped (no source body):  ${result.chaptersSkippedNoSource}`);
  console.log(`  topics ${args.dryRun ? "would get" : "received"} a clone:  ${result.topicsCloned}`);
  if (result.chaptersSkippedNoSource > 0) {
    console.log(`\n  For skipped chapters, run: pnpm tsx scripts/bootstrap-core-content.ts --grade <N> --subjects "<Subject>"`);
  }
  process.exit(0);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
