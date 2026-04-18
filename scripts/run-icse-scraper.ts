#!/usr/bin/env tsx
/**
 * CLI entry point for the ICSE/ISC scraper.
 *
 * Typical runs:
 *   # smoke test: parse 1 PDF from ICSE 2027 page
 *   pnpm tsx scripts/run-icse-scraper.ts --max 1 --source "ICSE 2027"
 *
 *   # full 2027 cycle (ICSE + ISC)
 *   pnpm tsx scripts/run-icse-scraper.ts --source 2027
 *
 *   # ISC only, cheap model for parsing
 *   pnpm tsx scripts/run-icse-scraper.ts --source "ISC 2027" --provider anthropic-haiku
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { IcseScraper } from "../src/lib/scraper/icse-scraper";
import type { AIProviderChoice } from "../src/lib/queue";

function parseArgs(argv: string[]) {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    maxPdfs: val("--max") ? Number(val("--max")) : undefined,
    sourceLabelFilter: val("--source"),
    subjectFilter: val("--subject"),
    provider: (val("--provider") as AIProviderChoice | undefined) ?? undefined,
    grades: val("--grades")?.split(",").map((g) => Number(g.trim())).filter(Boolean),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n=== ICSE/ISC scraper ===`);
  console.log(`  source filter: ${args.sourceLabelFilter ?? "(all)"}`);
  console.log(`  max PDFs:      ${args.maxPdfs ?? "(all)"}`);
  console.log(`  subject hint:  ${args.subjectFilter ?? "(none)"}`);
  console.log(`  grades filter: ${args.grades?.join(",") ?? "(none)"}`);
  console.log(`  AI provider:   ${args.provider ?? "(default)"}\n`);

  const scraper = new IcseScraper();
  const processed = await scraper.scrape({
    maxPdfs: args.maxPdfs,
    sourceLabelFilter: args.sourceLabelFilter,
    subjectFilter: args.subjectFilter,
    aiProvider: args.provider,
    grades: args.grades,
  });

  console.log(`\n=== Done. Processed ${processed} PDFs. ===`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
