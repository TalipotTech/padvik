#!/usr/bin/env tsx
/**
 * Test script for rich PDF content extraction.
 * Runs the extraction pipeline WITHOUT any database dependency.
 *
 * Usage:
 *   pnpm tsx scripts/test-rich-extract.ts data/ncert-pdfs/9/political-science/ch01.pdf
 *   pnpm tsx scripts/test-rich-extract.ts data/ncert-pdfs/9/political-science/ch01.pdf --max-pages 3
 */

import { config } from "dotenv";
// Load .env.local (Next.js convention) then .env as fallback
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { resolve, basename } from "path";
import { mkdir, writeFile } from "fs/promises";
import { extractFromPdf } from "../src/lib/document-parser";

async function main() {
  const args = process.argv.slice(2);
  const pdfPath = args.find((a) => !a.startsWith("--"));

  if (!pdfPath) {
    console.error("Usage: pnpm tsx scripts/test-rich-extract.ts <pdf-path> [--max-pages N]");
    process.exit(1);
  }

  const maxPagesArg = args.indexOf("--max-pages");
  const maxPages = maxPagesArg !== -1 ? parseInt(args[maxPagesArg + 1], 10) : undefined;

  const resolvedPath = resolve(pdfPath);
  const pdfName = basename(pdfPath, ".pdf");
  const outputDir = resolve("data/test-output", pdfName);
  await mkdir(outputDir, { recursive: true });

  console.log("=".repeat(60));
  console.log(`Rich Content Extraction Test`);
  console.log(`PDF: ${resolvedPath}`);
  console.log(`Output: ${outputDir}`);
  if (maxPages) console.log(`Max pages: ${maxPages}`);
  console.log("=".repeat(60));

  const start = Date.now();

  try {
    const result = await extractFromPdf(resolvedPath, {
      contentItemId: undefined, // will use test-{timestamp}
      language: "en",
      maxPages,
      outputDir,
    });

    // Write results
    await writeFile(
      resolve(outputDir, "extraction-result.json"),
      JSON.stringify(result, null, 2),
      "utf-8"
    );

    await writeFile(
      resolve(outputDir, "markdown-fallback.md"),
      result.markdownFallback,
      "utf-8"
    );

    // Print summary
    const duration = Date.now() - start;
    console.log("\n" + "=".repeat(60));
    console.log("EXTRACTION COMPLETE");
    console.log("=".repeat(60));
    console.log(`Total blocks: ${result.blocks.length}`);
    console.log(`Page images:  ${result.pageImages.length}`);
    console.log(`Strategy:     ${result.metadata.strategy}`);
    console.log(`Model:        ${result.metadata.model}`);
    console.log(`Input tokens: ${result.metadata.inputTokens}`);
    console.log(`Output tokens:${result.metadata.outputTokens}`);
    console.log(`Cost:         $${result.metadata.costUsd.toFixed(4)}`);
    console.log(`Duration:     ${duration}ms (${(duration / 1000).toFixed(1)}s)`);

    // Block type distribution
    const typeCounts: Record<string, number> = {};
    for (const b of result.blocks) {
      typeCounts[b.type] = (typeCounts[b.type] ?? 0) + 1;
    }
    console.log("\nBlock distribution:");
    for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }

    // Sample blocks
    console.log("\nFirst 5 blocks:");
    for (const block of result.blocks.slice(0, 5)) {
      const preview = block.content.length > 100
        ? block.content.substring(0, 100) + "..."
        : block.content;
      console.log(`  [${block.type}] p${block.pageNumber}: ${preview}`);
    }

    // Warnings
    if (result.warnings.length > 0) {
      console.log("\nWarnings:");
      for (const w of result.warnings) {
        console.log(`  ⚠ ${w}`);
      }
    }

    console.log(`\nResults saved to: ${outputDir}/`);
    console.log("  - extraction-result.json (full structured output)");
    console.log("  - markdown-fallback.md (text-only fallback)");

  } catch (err) {
    console.error("\nEXTRACTION FAILED:", err);
    process.exit(1);
  }
}

main();
