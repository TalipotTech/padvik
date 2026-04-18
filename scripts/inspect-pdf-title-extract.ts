#!/usr/bin/env tsx
/**
 * Debug tool: dump the first ~60 lines of an NCERT PDF so we can see why the
 * title extractor is picking up "Science" (running header) instead of the real
 * chapter title. Pass path(s) as args.
 *
 * Usage:
 *   pnpm tsx scripts/inspect-pdf-title-extract.ts data/ncert-pdfs/9/science/ch01.pdf
 *   pnpm tsx scripts/inspect-pdf-title-extract.ts data/ncert-pdfs/9/science/ch02.pdf
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { readFileSync } from "fs";
import { extractTextFromPdf } from "../src/lib/scraper/parser";

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) { console.error("usage: tsx inspect-pdf-title-extract.ts <pdf-path>..."); process.exit(1); }
  for (const p of paths) {
    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(` ${p}`);
    console.log(`═══════════════════════════════════════════════════════════`);
    const buf = readFileSync(p);
    const text = await extractTextFromPdf(buf);
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < Math.min(lines.length, 80); i++) {
      console.log(`  [${String(i).padStart(3)}] ${JSON.stringify(lines[i])}`);
    }
    console.log(`  ... (${lines.length} total lines)`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
