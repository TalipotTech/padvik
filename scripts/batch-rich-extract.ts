#!/usr/bin/env tsx
/**
 * Batch rich extraction for all PDFs in a directory.
 * Calls the admin API for each PDF.
 *
 * Usage:
 *   pnpm tsx scripts/batch-rich-extract.ts data/ncert-pdfs/9/political-science/ --topicId 1
 *   pnpm tsx scripts/batch-rich-extract.ts data/ncert-pdfs/9/political-science/ --topicId 1 --max-pages 5
 *   pnpm tsx scripts/batch-rich-extract.ts data/ncert-pdfs/9/political-science/ --topicId 1 --standalone
 *
 * With --standalone: runs extraction without DB/API (outputs to data/test-output/)
 * Without --standalone: calls POST /api/admin/rich-extract (requires running dev server)
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { readdir } from "fs/promises";
import { resolve, join, basename } from "path";
import { mkdir, writeFile } from "fs/promises";

async function main() {
  const args = process.argv.slice(2);
  const dirPath = args.find((a) => !a.startsWith("--"));

  if (!dirPath) {
    console.error("Usage: pnpm tsx scripts/batch-rich-extract.ts <pdf-dir> --topicId N [--max-pages N] [--standalone]");
    process.exit(1);
  }

  const topicIdIdx = args.indexOf("--topicId");
  const topicId = topicIdIdx !== -1 ? parseInt(args[topicIdIdx + 1], 10) : 1;

  const maxPagesIdx = args.indexOf("--max-pages");
  const maxPages = maxPagesIdx !== -1 ? parseInt(args[maxPagesIdx + 1], 10) : undefined;

  const standalone = args.includes("--standalone");

  const resolvedDir = resolve(dirPath);
  const files = await readdir(resolvedDir);
  const pdfFiles = files.filter((f) => f.endsWith(".pdf")).sort();

  console.log(`\nBatch Rich Extraction`);
  console.log(`Directory: ${resolvedDir}`);
  console.log(`PDFs found: ${pdfFiles.length}`);
  console.log(`Mode: ${standalone ? "standalone (no DB)" : "API (requires dev server)"}`);
  console.log(`Topic ID: ${topicId}`);
  if (maxPages) console.log(`Max pages: ${maxPages}`);
  console.log("=".repeat(60));

  const results: Array<{ file: string; success: boolean; blocks?: number; error?: string }> = [];

  for (const file of pdfFiles) {
    const pdfPath = join(dirPath, file).replace(/\\/g, "/");
    console.log(`\n[${results.length + 1}/${pdfFiles.length}] Processing: ${file}`);

    try {
      if (standalone) {
        const { extractFromPdf } = await import("../src/lib/document-parser");
        const pdfName = basename(file, ".pdf");
        const outputDir = resolve("data/test-output", pdfName);
        await mkdir(outputDir, { recursive: true });

        const result = await extractFromPdf(resolve(pdfPath), {
          language: "en",
          maxPages,
        });

        await writeFile(
          join(outputDir, "extraction-result.json"),
          JSON.stringify(result, null, 2),
          "utf-8"
        );
        await writeFile(
          join(outputDir, "markdown-fallback.md"),
          result.markdownFallback,
          "utf-8"
        );

        results.push({ file, success: true, blocks: result.blocks.length });
        console.log(`  OK: ${result.blocks.length} blocks, $${result.metadata.costUsd.toFixed(4)}`);
      } else {
        const res = await fetch("http://localhost:3000/api/admin/rich-extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pdfPath,
            topicId,
            title: `Rich: ${basename(file, ".pdf")}`,
            maxPages,
          }),
        });

        const data = await res.json();
        if (data.success) {
          results.push({ file, success: true, blocks: data.data.blockCount });
          console.log(`  OK: ${data.data.blockCount} blocks, $${data.data.cost?.toFixed(4)}`);
        } else {
          results.push({ file, success: false, error: data.error?.message });
          console.error(`  FAIL: ${data.error?.message}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ file, success: false, error: msg });
      console.error(`  FAIL: ${msg}`);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("BATCH SUMMARY");
  console.log("=".repeat(60));
  const success = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  console.log(`Total: ${results.length} | Success: ${success.length} | Failed: ${failed.length}`);
  console.log(`Total blocks: ${success.reduce((sum, r) => sum + (r.blocks ?? 0), 0)}`);

  if (failed.length > 0) {
    console.log("\nFailed files:");
    for (const f of failed) {
      console.log(`  ${f.file}: ${f.error}`);
    }
  }
}

main();
