#!/usr/bin/env tsx
/**
 * Retry ICSE/ISC PDFs that failed AI-JSON validation on the first pass.
 *
 * Scans /tmp/icse-2027-full.log (or the path you pass) for the URL immediately
 * above each "AI response validation failed" line, then replays those PDFs
 * through the scraper with Claude as the primary provider (Claude does not emit
 * malformed JSON for these long syllabi, unlike Gemini). Successful parses will
 * land as new subjects; already-inserted subjects are idempotent.
 *
 * Usage:
 *   pnpm tsx scripts/retry-icse-failures.ts
 *   pnpm tsx scripts/retry-icse-failures.ts --log /tmp/icse-2027-full.log --provider anthropic
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { readFileSync, existsSync } from "fs";
import { IcseScraper } from "../src/lib/scraper/icse-scraper";
import type { AIProviderChoice } from "../src/lib/queue";

function parseArgs(argv: string[]) {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    logPath: val("--log") ?? "/tmp/icse-2027-full.log",
    provider: (val("--provider") as AIProviderChoice | undefined) ?? "anthropic",
  };
}

/**
 * A failed URL together with the grade implied by the seed-page label in the
 * ingest log ("[ICSE 2027]" → Gr10, "[ISC 2027]" → Gr12). This avoids the
 * fragile URL-based grade inference, which misfiles PDFs that live under
 * /wp-content/uploads/ without "ISC" in the filename (e.g. 12.-Psychology.pdf).
 */
interface FailedUrl {
  url: string;
  grade: number;
}

/**
 * Parse the ingest log to extract URLs of PDFs that hit a JSON-validation
 * failure or "All AI models failed" on the first pass. A URL is failed if the
 * sequence "[N/M] ... URL ... (no Inserted: line before the next [N/M] ...)".
 * Simpler heuristic: match "AI response validation failed" and grab the most
 * recent "[i/N] ... URL" above it. Also captures the seed label so the grade
 * is correct in the retry.
 */
function extractFailedUrls(logText: string): FailedUrl[] {
  const lines = logText.split(/\r?\n/);
  const failedUrls: FailedUrl[] = [];
  const urlRe = /^\s*\[\d+\/\d+\]\s+\[([^\]]+)\]\s+(https?:\/\/\S+)/;
  const failRe = /AI response validation failed|All AI models failed|Failed to process PDF/;

  let currentUrl: string | null = null;
  let currentGrade: number = 10;
  let urlHasInserted = false;
  let urlHasFailed = false;
  for (const line of lines) {
    const m = line.match(urlRe);
    if (m) {
      // Close out previous URL
      if (currentUrl && urlHasFailed && !urlHasInserted) {
        failedUrls.push({ url: currentUrl, grade: currentGrade });
      }
      const label = m[1];
      currentUrl = m[2];
      // ISC labels imply Gr12, ICSE labels imply Gr10
      currentGrade = /\bISC\b/i.test(label) && !/\bICSE\b/i.test(label) ? 12 : 10;
      urlHasInserted = false;
      urlHasFailed = false;
      continue;
    }
    if (!currentUrl) continue;
    if (/Inserted:\s+\d+\s+chapters/.test(line)) urlHasInserted = true;
    if (failRe.test(line)) urlHasFailed = true;
  }
  // Close final URL
  if (currentUrl && urlHasFailed && !urlHasInserted) {
    failedUrls.push({ url: currentUrl, grade: currentGrade });
  }
  // De-dupe by URL (keep first grade seen)
  const seen = new Set<string>();
  const unique: FailedUrl[] = [];
  for (const f of failedUrls) {
    if (seen.has(f.url)) continue;
    seen.add(f.url);
    unique.push(f);
  }
  return unique;
}

/**
 * Run the scraper but ONLY process the given URL subset. We achieve this by
 * extending IcseScraper and overriding scrape() — but easier: just re-use the
 * scraper with a sourceLabelFilter that matches the right seed page, then
 * let the scraper's own filter eliminate non-matching URLs. Since we need
 * arbitrary URLs, easier to just call processPdf directly via a subclass.
 */
class RetryIcseScraper extends IcseScraper {
  async retryUrls(failed: FailedUrl[], provider: AIProviderChoice) {
    // Fetch board id via the same path the real scraper uses
    const { db } = await import("../src/db");
    const { boards } = await import("../src/db/schema/curriculum");
    const { eq } = await import("drizzle-orm");
    const [b] = await db.select().from(boards).where(eq(boards.code, "ICSE")).limit(1);
    if (!b) throw new Error("ICSE board not found");
    this.log(`Retrying ${failed.length} failed URLs with provider=${provider}`);
    let ok = 0;
    for (let i = 0; i < failed.length; i++) {
      const { url, grade } = failed[i];
      this.log(`\n[retry ${i + 1}/${failed.length}] ${url} (grade=${grade} from seed label)`);
      try {
        // Access the private processPdf via type-assertion
        const result = await (this as unknown as {
          processPdf(
            url: string,
            bid: number,
            grade: number,
            opts?: { aiProvider?: AIProviderChoice }
          ): Promise<boolean>;
        }).processPdf(url, b.id, grade, { aiProvider: provider });
        if (result) ok++;
      } catch (err) {
        this.logError(`Retry failed for ${url}`, err);
      }
    }
    return ok;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.logPath)) {
    console.error(`Log not found: ${args.logPath}`);
    process.exit(1);
  }
  const logText = readFileSync(args.logPath, "utf8");
  const failed = extractFailedUrls(logText);
  console.log(`\n=== Retry ICSE failures ===`);
  console.log(`  log: ${args.logPath}`);
  console.log(`  found ${failed.length} failed URLs`);
  console.log(`  provider: ${args.provider}\n`);
  for (const f of failed) console.log(`  - [Gr${f.grade}] ${f.url}`);
  if (failed.length === 0) {
    console.log("Nothing to retry.");
    process.exit(0);
  }

  const scraper = new RetryIcseScraper();
  const ok = await scraper.retryUrls(failed, args.provider);
  console.log(`\n=== Done. Successfully retried ${ok}/${failed.length} PDFs. ===`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
