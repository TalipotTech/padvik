#!/usr/bin/env tsx
/**
 * Re-extract questions from source PDFs with image awareness.
 * Finds questions with empty questionImages that have a source paper with a PDF,
 * extracts page images, and updates question records with image references.
 *
 * Usage:
 *   pnpm tsx scripts/enrich-existing-questions.ts
 *   pnpm tsx scripts/enrich-existing-questions.ts --dry-run
 *   pnpm tsx scripts/enrich-existing-questions.ts --max-papers 3
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { db } from "../src/db";
import { questions, questionPapers } from "../src/db/schema/questions";
import { fileUploads } from "../src/db/schema/content";
import { eq, sql, and, isNotNull } from "drizzle-orm";
import { stat } from "fs/promises";
import { join } from "path";
import { savePageImages, getImageUrl } from "../src/lib/document-parser";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const maxPapersIdx = args.indexOf("--max-papers");
  const maxPapers = maxPapersIdx !== -1 ? parseInt(args[maxPapersIdx + 1], 10) : Infinity;

  console.log("=".repeat(60));
  console.log("Enrich Questions with Page Images from Source PDFs");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log("=".repeat(60));

  // Find question papers that have a file upload (PDF source)
  const papers = await db
    .select({
      paperId: questionPapers.id,
      paperTitle: questionPapers.paperTitle,
      fileUploadId: questionPapers.fileUploadId,
      storageUrl: fileUploads.storageUrl,
      fileName: fileUploads.fileName,
    })
    .from(questionPapers)
    .innerJoin(fileUploads, eq(fileUploads.id, questionPapers.fileUploadId))
    .where(isNotNull(questionPapers.fileUploadId))
    .limit(maxPapers === Infinity ? 500 : maxPapers);

  console.log(`\nFound ${papers.length} question papers with source PDFs\n`);

  if (papers.length === 0) {
    console.log("No question papers with file uploads found.");
    process.exit(0);
  }

  let papersProcessed = 0;
  let questionsUpdated = 0;
  let papersFailed = 0;

  for (const paper of papers) {
    const pdfPath = paper.storageUrl;
    if (!pdfPath) {
      console.log(`  SKIP paper [${paper.paperId}] — no storage URL`);
      continue;
    }

    const fullPath = pdfPath.startsWith("/") || pdfPath.includes(":")
      ? pdfPath
      : join(process.cwd(), pdfPath);

    // Check file exists
    try {
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) {
        console.log(`  SKIP paper [${paper.paperId}] ${paper.paperTitle} — PDF not found`);
        continue;
      }
    } catch {
      console.log(`  SKIP paper [${paper.paperId}] ${paper.paperTitle} — PDF not found: ${pdfPath}`);
      continue;
    }

    // Find questions for this paper with empty images
    const paperQuestions = await db
      .select({
        id: questions.id,
        questionNumber: questions.questionNumber,
        questionText: questions.questionText,
        questionImages: questions.questionImages,
      })
      .from(questions)
      .where(
        and(
          eq(questions.sourcePaperId, paper.paperId),
          sql`(${questions.questionImages} IS NULL OR ${questions.questionImages} = '[]'::jsonb)`
        )
      );

    if (paperQuestions.length === 0) {
      console.log(`  SKIP paper [${paper.paperId}] ${paper.paperTitle} — all questions already have images`);
      continue;
    }

    console.log(`\n[Paper ${papersProcessed + 1}] ${paper.paperTitle} — ${paperQuestions.length} questions need images`);
    console.log(`  PDF: ${pdfPath}`);

    if (dryRun) {
      console.log(`  DRY RUN — would render pages and update ${paperQuestions.length} questions`);
      papersProcessed++;
      continue;
    }

    try {
      // Render page images for this paper
      const paperId = `paper-${paper.paperId}`;
      const pageImages = await savePageImages(fullPath, paperId);
      console.log(`  Rendered ${pageImages.length} pages`);

      // For each question, assign the page image based on question number
      // Simple heuristic: distribute questions across pages proportionally
      const questionsPerPage = Math.ceil(paperQuestions.length / pageImages.length);

      for (let i = 0; i < paperQuestions.length; i++) {
        const q = paperQuestions[i];
        const estimatedPage = Math.min(
          Math.floor(i / questionsPerPage) + 1,
          pageImages.length
        );

        const imageRef = [{
          url: getImageUrl(paperId, estimatedPage),
          caption: `Source page ${estimatedPage} from ${paper.paperTitle}`,
          pageNumber: estimatedPage,
        }];

        await db
          .update(questions)
          .set({
            questionImages: imageRef,
            updatedAt: new Date(),
          })
          .where(eq(questions.id, q.id));

        questionsUpdated++;
      }

      papersProcessed++;
      console.log(`  OK: Updated ${paperQuestions.length} questions with page images`);
    } catch (err) {
      papersFailed++;
      console.error(`  FAIL: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("QUESTION ENRICHMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`Papers processed: ${papersProcessed} | Failed: ${papersFailed}`);
  console.log(`Questions updated: ${questionsUpdated}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
