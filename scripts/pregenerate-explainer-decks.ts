/**
 * Pre-generate Adaptive Visual Explainer decks so students never wait on a
 * cold open. Decks generated here use the default (Sonnet) model for quality;
 * cached decks always take precedence over on-demand generation.
 *
 * Examples:
 *   pnpm tsx scripts/pregenerate-explainer-decks.ts --subjectId 245 --level 2 --limit 40
 *   pnpm tsx scripts/pregenerate-explainer-decks.ts --grade 10 --level 2 --limit 50
 *   pnpm tsx scripts/pregenerate-explainer-decks.ts --boardId 1 --grade 10 --level 2
 *
 * Flags: --boardId --subjectId --standardId --grade --level --limit --language --rateMs
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { bulkGenerateDecks } from "../src/lib/explainer/bulk-generate";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function num(name: string): number | undefined {
  const v = arg(name);
  return v != null ? Number(v) : undefined;
}

async function main() {
  const level = (num("level") ?? 2) as 1 | 2 | 3;
  const limit = num("limit") ?? 25;
  const opts = {
    boardId: num("boardId"),
    subjectId: num("subjectId"),
    standardId: num("standardId"),
    grade: num("grade"),
    level,
    language: arg("language") ?? "en",
    limit,
    rateLimitMs: num("rateMs") ?? 3000,
  };

  console.log("Pre-generating explainer decks with:", opts);
  console.log("(Ctrl+C to stop; already-generated topics are skipped.)\n");

  const result = await bulkGenerateDecks({
    ...opts,
    onProgress: (p) => {
      const tag = p.status === "ok" ? "✓" : "✗";
      console.log(
        `  ${tag} [${p.processed}/${p.total}] topic ${p.topicId}` +
          (p.error ? ` — ${p.error}` : "")
      );
    },
  });

  console.log("\n=== Done ===");
  console.log(`Generated: ${result.generated}  Failed: ${result.failed}`);
  console.log(`Total cost: $${result.totalCostUsd.toFixed(4)}`);
  if (result.failures.length) {
    console.log("Failures:");
    for (const f of result.failures.slice(0, 20)) {
      console.log(`  topic ${f.topicId}: ${f.error}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Pre-generation failed:", err);
    process.exit(1);
  });
