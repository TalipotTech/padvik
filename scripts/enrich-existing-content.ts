#!/usr/bin/env tsx
/**
 * Enrich existing content items with rich extraction (images + structured blocks).
 * Finds content items with a PDF sourceUrl, re-extracts with AI Vision,
 * and updates metadata.richBlocks + metadata.pageImages.
 *
 * Usage:
 *   pnpm tsx scripts/enrich-existing-content.ts
 *   pnpm tsx scripts/enrich-existing-content.ts --dry-run        # preview only
 *   pnpm tsx scripts/enrich-existing-content.ts --max 5          # limit to 5 items
 *   pnpm tsx scripts/enrich-existing-content.ts --max-pages 10   # limit pages per PDF
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { db } from "../src/db";
import { contentItems } from "../src/db/schema/content";
import { eq, sql, and, or, like } from "drizzle-orm";
import { stat, mkdir, writeFile } from "fs/promises";
import { join, basename } from "path";
import { extractFromPdf } from "../src/lib/document-parser";
import { getImageUrl } from "../src/lib/document-parser";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const maxIdx = args.indexOf("--max");
  const maxItems = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : Infinity;
  const maxPagesIdx = args.indexOf("--max-pages");
  const maxPages = maxPagesIdx !== -1 ? parseInt(args[maxPagesIdx + 1], 10) : undefined;

  console.log("=".repeat(60));
  console.log("Enrich Existing Content Items with Rich Extraction");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log("=".repeat(60));

  // Find content items that:
  // 1. Have a sourceUrl pointing to a PDF
  // 2. Don't already have richBlocks in metadata
  const candidates = await db
    .select({
      id: contentItems.id,
      topicId: contentItems.topicId,
      title: contentItems.title,
      sourceUrl: contentItems.sourceUrl,
      sourceType: contentItems.sourceType,
      metadata: contentItems.metadata,
    })
    .from(contentItems)
    .where(
      and(
        or(
          like(contentItems.sourceUrl, "%.pdf"),
          like(contentItems.sourceUrl, "%/pdfs/%")
        ),
        // Exclude items that already have richBlocks
        sql`(${contentItems.metadata}->>'richBlocks') IS NULL OR (${contentItems.metadata}->>'status') = 'extracting'`
      )
    )
    .limit(maxItems === Infinity ? 1000 : maxItems);

  console.log(`\nFound ${candidates.length} content items to enrich\n`);

  if (candidates.length === 0) {
    console.log("Nothing to do. All content items already have rich blocks or no PDF source.");
    process.exit(0);
  }

  let enriched = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of candidates) {
    const pdfPath = item.sourceUrl;
    if (!pdfPath) {
      skipped++;
      continue;
    }

    // Resolve the PDF — download from URL if needed
    let fullPath: string;
    const isUrl = pdfPath.startsWith("http://") || pdfPath.startsWith("https://");
    const isFileUrl = pdfPath.startsWith("file://");

    if (isUrl) {
      // Download the PDF to a local cache directory
      const cacheDir = join(process.cwd(), "data", "pdf-cache");
      await mkdir(cacheDir, { recursive: true });
      const fileName = basename(new URL(pdfPath).pathname);
      fullPath = join(cacheDir, `${item.id}-${fileName}`);

      // Check if already cached
      let cached = false;
      try {
        const s = await stat(fullPath);
        cached = s.isFile() && s.size > 1000;
      } catch { /* not cached */ }

      if (!cached) {
        try {
          console.log(`  Downloading: ${pdfPath}`);
          const res = await fetch(pdfPath);
          if (!res.ok) {
            console.log(`  SKIP [${item.id}] ${item.title} — download failed: ${res.status} ${res.statusText}`);
            skipped++;
            continue;
          }
          const buffer = Buffer.from(await res.arrayBuffer());
          if (buffer.length < 1000) {
            console.log(`  SKIP [${item.id}] ${item.title} — downloaded file too small (${buffer.length} bytes)`);
            skipped++;
            continue;
          }
          await writeFile(fullPath, buffer);
          console.log(`  Downloaded: ${(buffer.length / 1024).toFixed(0)} KB → ${fullPath}`);
        } catch (err) {
          console.log(`  SKIP [${item.id}] ${item.title} — download error: ${err instanceof Error ? err.message : err}`);
          skipped++;
          continue;
        }
      }
    } else if (isFileUrl) {
      fullPath = pdfPath.replace("file://", "");
      fullPath = fullPath.startsWith("/") || fullPath.includes(":") ? fullPath : join(process.cwd(), fullPath);
    } else {
      fullPath = pdfPath.startsWith("/") || pdfPath.includes(":")
        ? pdfPath
        : join(process.cwd(), pdfPath);
    }

    // Check if file exists
    try {
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) {
        console.log(`  SKIP [${item.id}] ${item.title} — file not found: ${fullPath}`);
        skipped++;
        continue;
      }
    } catch {
      console.log(`  SKIP [${item.id}] ${item.title} — file not found: ${fullPath}`);
      skipped++;
      continue;
    }

    console.log(`[${enriched + failed + 1}/${candidates.length}] Enriching: [${item.id}] ${item.title}`);
    console.log(`  PDF: ${fullPath}`);

    if (dryRun) {
      console.log("  DRY RUN — would extract and update");
      enriched++;
      continue;
    }

    try {
      const result = await extractFromPdf(fullPath, {
        contentItemId: item.id,
        language: "en",
        maxPages,
      });

      // Patch image blocks with API URLs
      for (const block of result.blocks) {
        if (block.type === "image" && block.imagePath) {
          const match = block.imagePath.match(/rich-content\/([^/]+)\/page-(\d+)\.png/);
          if (match) {
            block.imagePath = getImageUrl(match[1], parseInt(match[2], 10));
          }
        }
      }

      // Update the content item
      const existingMeta = (item.metadata as Record<string, unknown>) ?? {};
      await db
        .update(contentItems)
        .set({
          body: result.markdownFallback,
          metadata: {
            ...existingMeta,
            richBlocks: result.blocks,
            pageImages: result.pageImages.map((p) => ({
              ...p,
              url: getImageUrl(item.id, p.pageNumber),
            })),
            extraction: result.metadata,
            status: "completed",
          },
          updatedAt: new Date(),
        })
        .where(eq(contentItems.id, item.id));

      enriched++;
      console.log(`  OK: ${result.blocks.length} blocks, ${result.pageImages.length} pages, $${result.metadata.costUsd.toFixed(4)}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("ENRICHMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`Enriched: ${enriched} | Failed: ${failed} | Skipped: ${skipped}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
