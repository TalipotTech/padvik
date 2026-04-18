#!/usr/bin/env tsx
/**
 * Publish high-quality NCERT content rows that landed as pending/unpublished.
 *
 * Thin CLI wrapper — logic lives in src/lib/scraper/coverage/auto-publish.ts
 * (also used by POST /api/admin/coverage/run).
 *
 * Target: source_type='ncert' + source_url LIKE 'https://ncert.nic.in/%'
 *         + quality_score >= 0.7 + is_published=false + not-rejected
 *         + body passes refusal/length filters.
 * Action: is_published=true, review_status='auto_approved'.
 *
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   pnpm tsx scripts/auto-publish-high-quality-ncert.ts --dry-run
 *   pnpm tsx scripts/auto-publish-high-quality-ncert.ts
 *   pnpm tsx scripts/auto-publish-high-quality-ncert.ts --board CBSE --grade 10 --subject Mathematics
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { autoPublishHighQualityNcert, type CoverageFilter } from "../src/lib/scraper/coverage";

function parseArgs(argv: string[]) {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    board: val("--board"),
    grade: val("--grade") ? Number(val("--grade")) : undefined,
    subject: val("--subject"),
    dryRun: argv.includes("--dry-run"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n=== Auto-publish high-quality NCERT content (${args.dryRun ? "DRY RUN" : "LIVE"}) ===\n`);

  const filter: CoverageFilter = {
    boardCode: args.board,
    grade: args.grade,
    subjectName: args.subject,
  };

  const result = await autoPublishHighQualityNcert(filter, {
    dryRun: args.dryRun,
    onLog: (line) => console.log(line),
  });

  console.log(`\nCandidates: ${result.candidates}`);
  for (const s of result.sample) {
    console.log(`  ci=${s.contentItemId} topic=${s.topicId} q=${s.qualityScore} len=${s.bodyLength}  ${s.label}`);
  }

  if (result.candidates === 0 || result.dryRun) {
    console.log(`\n${result.dryRun ? "DRY RUN — no changes written." : "Nothing to update."}`);
    process.exit(0);
  }

  console.log(`\n✓ Updated ${result.updated} row(s): is_published=true, review_status='auto_approved'`);
  process.exit(0);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
