/**
 * CLI script to import schools from various sources.
 *
 * Usage:
 *   pnpm tsx scripts/import-schools.ts --source=cbse_github
 *   pnpm tsx scripts/import-schools.ts --source=sametham --state=Kerala
 *   pnpm tsx scripts/import-schools.ts --source=udise --file=data/udise-schools.csv
 *   pnpm tsx scripts/import-schools.ts --source=all
 *   pnpm tsx scripts/import-schools.ts --stats
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { importAllSchools } from "../src/lib/schools/import-all";
import type { SchoolSource } from "../src/lib/schools/types";

// Simple arg parser
function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find(a => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function showStats() {
  const { db } = await import("../src/db");
  const { schools } = await import("../src/db/schema/schools");
  const { sql } = await import("drizzle-orm");

  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(schools);
  const bySource = await db.select({ source: schools.source, count: sql<number>`count(*)::int` }).from(schools).groupBy(schools.source);
  const byBoard = await db.select({ board: schools.boardCode, count: sql<number>`count(*)::int` }).from(schools).groupBy(schools.boardCode);
  const byState = await db.select({ state: schools.state, count: sql<number>`count(*)::int` }).from(schools).groupBy(schools.state).orderBy(sql`count(*) DESC`).limit(10);

  console.log("\n📊 School Directory Stats");
  console.log("=".repeat(50));
  console.log(`Total schools: ${total?.count ?? 0}`);

  console.log("\nBy Source:");
  for (const s of bySource) console.log(`  ${(s.source || "unknown").padEnd(15)} ${s.count}`);

  console.log("\nBy Board:");
  for (const b of byBoard) console.log(`  ${(b.board || "unknown").padEnd(15)} ${b.count}`);

  console.log("\nTop States:");
  for (const s of byState) console.log(`  ${(s.state || "unknown").padEnd(25)} ${s.count}`);

  process.exit(0);
}

async function main() {
  if (hasFlag("help")) {
    console.log(`
Schools Import CLI
  --source=cbse_github|sametham|cbse_saras|icse_scrape|udise|all
  --state=Kerala          Filter by state (for testing)
  --file=data/udise.csv   Path to UDISE CSV file
  --stats                 Show current school counts
  --help                  Show this help
`);
    process.exit(0);
  }

  if (hasFlag("stats")) {
    await showStats();
    return;
  }

  const source = getArg("source");
  if (!source) {
    console.error("Error: --source is required. Use --help for usage.");
    process.exit(1);
  }

  const stateFilter = getArg("state");
  const udiseCsvPath = getArg("file");

  const sources = source === "all"
    ? ["cbse_github", "sametham", "icse_scrape"] as SchoolSource[]
    : [source as SchoolSource];

  const results = await importAllSchools({ sources, stateFilter, udiseCsvPath });

  const hasErrors = results.some(r => r.errors.length > 0 && r.inserted === 0 && r.updated === 0);
  process.exit(hasErrors ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
