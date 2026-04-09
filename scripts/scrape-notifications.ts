/**
 * CLI script to trigger board notification scraping.
 *
 * Usage:
 *   pnpm tsx scripts/scrape-notifications.ts          # scrape all boards
 *   pnpm tsx scripts/scrape-notifications.ts CBSE     # scrape only CBSE
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { scrapeNotifications } from "../src/lib/scraper/notification-scraper";

async function main() {
  const boardCode = process.argv[2] || undefined;

  console.log(
    boardCode
      ? `Scraping notifications for ${boardCode}...`
      : "Scraping notifications for all boards..."
  );

  const result = await scrapeNotifications(boardCode);

  console.log("\n=== Results ===");
  console.log(`Scraped: ${result.scraped} total notifications found`);
  console.log(`New:     ${result.new} inserted into database`);
  console.log(`Errors:  ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log("\nErrors:");
    result.errors.forEach((e) => console.log(`  - ${e}`));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
