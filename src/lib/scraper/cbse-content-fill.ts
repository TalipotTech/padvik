/**
 * CBSE content-fill runner.
 *
 * Extracts topic-level study notes from an already-downloaded CBSE textbook
 * PDF (scraped from cbseacademic.nic.in). One job = one subject. For every
 * topic without content_items, the runner finds the chapter's PDF, extracts
 * the relevant section via AI, and inserts a `content_items` row tagged
 * `source_type = "cbse_textbook"`.
 *
 * This file is consumed from two places:
 *   1. The BullMQ worker in `pipeline-worker.ts` — pass a `jobId` so the
 *      runner streams progress to the `scrape_jobs` row (itemsFound,
 *      itemsProcessed, errorLog, status). The admin UI polls that row.
 *   2. The synchronous POST handler in `/api/admin/content/fill-gaps` — no
 *      `jobId`, just returns the final counts. Used by the student-facing
 *      syllabus explorer which expects an inline response.
 */
import { and, eq, sql } from "drizzle-orm";
import { readFile } from "fs/promises";
import { join } from "path";
import { db } from "@/db";
import { chapters, topics } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { scrapeJobs } from "@/db/schema/system";
import { aiChat, AI_MODELS } from "@/lib/ai/provider";
import { computeQualityScore } from "@/lib/ai/quality-scorer";
import { extractTextFromPdfWithPages, findChapterPage } from "@/lib/scraper/parser";
import { splitSyllabusByClass } from "@/lib/scraper/class-section-splitter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CbseContentFillOptions {
  subjectId: number;
  /** Optional — if set, only these topics are processed (intersected with missing). */
  topicIds?: number[];
  /** Topic processing cap. Default 50, hard-capped at 500 to bound a single job. */
  limit?: number;
  /**
   * scrape_jobs.id — when provided, the runner streams live progress
   * (itemsFound/itemsProcessed/status/errorLog) into the row. Omit for
   * synchronous callers that don't have a job row.
   */
  jobId?: number;
}

export interface CbseContentFillResult {
  processed: number;
  totalCostUsd: number;
  errors: string[];
  topicsCandidate: number;
}

// Using a type alias (vs interface) so it implicitly satisfies the
// Record<string, unknown> constraint that Drizzle's db.execute<T>() imposes
// on its row shape generic.
type TopicRow = {
  topic_id: number;
  topic_title: string;
  chapter_number: number;
  chapter_title: string;
  chapter_pdf_path: string | null;
  subject_name: string;
  grade: number;
  board_code: string;
};

// ---------------------------------------------------------------------------
// Progress helper — updates scrape_jobs if jobId was supplied.
// Noops when jobId is undefined so synchronous callers pay zero DB cost.
// ---------------------------------------------------------------------------
async function updateJobProgress(
  jobId: number | undefined,
  patch: Partial<{
    status: "queued" | "running" | "completed" | "failed";
    itemsFound: number;
    itemsProcessed: number;
    errorLog: string | null;
  }>
): Promise<void> {
  if (!jobId) return;
  const values: Record<string, unknown> = { ...patch };
  if (patch.status === "running") values.startedAt = new Date();
  if (patch.status === "completed" || patch.status === "failed") {
    values.completedAt = new Date();
  }
  try {
    await db.update(scrapeJobs).set(values).where(eq(scrapeJobs.id, jobId));
  } catch (err) {
    // Never let progress-write failures kill the actual job.
    console.error(`[CbseContentFill] updateJobProgress(${jobId}) failed:`, err);
  }
}

// ---------------------------------------------------------------------------
// Core runner.
// ---------------------------------------------------------------------------
export async function runCbseContentFill(
  opts: CbseContentFillOptions
): Promise<CbseContentFillResult> {
  const { subjectId, topicIds, jobId } = opts;
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 500);

  await updateJobProgress(jobId, { status: "running", itemsProcessed: 0 });

  // Find missing topics WITH their chapter's PDF path. Priority for the PDF
  // path: existing content_items metadata → chapter metadata → subject
  // metadata. The latter two are set by the CBSE syllabus inserter, so this
  // works even before any content_items row exists.
  const missingRows = await db.execute<TopicRow>(sql`
    SELECT
      t.id AS topic_id,
      t.title AS topic_title,
      ch.chapter_number,
      ch.title AS chapter_title,
      COALESCE(
        (SELECT ci2.metadata->>'pdfPath' FROM content_items ci2 JOIN topics t2 ON t2.id = ci2.topic_id WHERE t2.chapter_id = ch.id AND ci2.metadata->>'pdfPath' IS NOT NULL LIMIT 1),
        ch.metadata->>'sourcePdf',
        s.metadata->>'sourcePdf'
      ) AS chapter_pdf_path,
      s.name AS subject_name,
      st.grade,
      b.code AS board_code
    FROM topics t
    JOIN chapters ch ON ch.id = t.chapter_id
    JOIN subjects s ON s.id = ch.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    WHERE ch.subject_id = ${subjectId}
      AND NOT EXISTS (SELECT 1 FROM content_items ci WHERE ci.topic_id = t.id)
    ORDER BY ch.chapter_number, t.sort_order
    LIMIT ${limit}
  `);

  let toProcess: TopicRow[] = [...missingRows];
  if (topicIds && topicIds.length > 0) {
    toProcess = toProcess.filter((r) => topicIds.includes(r.topic_id));
  }

  await updateJobProgress(jobId, { itemsFound: toProcess.length });

  let processed = 0;
  let totalCost = 0;
  const errors: string[] = [];

  // Cache PDF text + per-page offsets per chapter so we don't re-extract
  // (expensive) and re-split for every topic in the same chapter. The
  // pageOffsets array is what lets us report a 1-indexed #page=N for the
  // embedded PDF viewer — see extractTextFromPdfWithPages in parser.ts.
  type PdfCacheEntry = { text: string; pageOffsets: number[] };
  const pdfTextCache = new Map<string, PdfCacheEntry>();

  // Per-(pdfPath, grade) cache for class-split slices. CBSE "Secondary" and
  // "Senior Secondary" textbook PDFs cover two classes in one document
  // (IX+X or XI+XII). Without splitting, the AI extractor sees both classes
  // and happily echoes the wrong one's header/content ("CLASS IX (2025-26)"
  // bleeding into Class X topics). We split once per PDF and reuse the
  // slice (plus its start page AND its offsets into the original text) for
  // every topic whose grade matches. The offsets are what let the
  // per-chapter page finder bound its search to just this grade's half of
  // the PDF — a Class X "Networking" chapter must not match the Class IX
  // "Networking" chapter that appears earlier in the same document.
  //
  // Key format: `${pdfPath}::${grade}`. Value is either the grade slice
  // (on successful split) or the SLICE_FALLBACK sentinel indicating
  // "no split needed / possible" so we fall back to the full text.
  type SliceCacheEntry = {
    text: string;
    startPage?: number;
    startOffset?: number;
    endOffset?: number;
  };
  const SLICE_FALLBACK: SliceCacheEntry = { text: "__UNSPLIT__" };
  const pdfSliceCache = new Map<string, SliceCacheEntry>();

  // Per-chapter page cache. Key: `${pdfPath}::${grade}::${chapterNumber}`.
  // Value is the 1-indexed PDF page where the chapter's header appears,
  // or null if findChapterPage couldn't locate the chapter (memoize the
  // miss so we don't retry for every topic in that chapter).
  const chapterPageCache = new Map<string, number | null>();

  for (const topic of toProcess) {
    try {
      let content: string;
      let modelUsed: string;
      let costUsd: number;
      let tokens: number;
      // Page in the source PDF where this topic's grade-section starts.
      // Gets stashed on content_items.metadata.pdfPage so the learn-view
      // PdfViewer opens at #page=N and students don't see the sibling
      // grade's cover page first. undefined = no split applied or not
      // applicable; the viewer defaults to page 1 in that case.
      let pdfPageForTopic: number | undefined;

      if (topic.chapter_pdf_path) {
        // STRATEGY 1: Extract from downloaded PDF — the real textbook content.
        const pdfPath = topic.chapter_pdf_path;

        let cacheEntry = pdfTextCache.get(pdfPath);
        if (!cacheEntry) {
          try {
            const pdfBuffer = await readFile(join(process.cwd(), pdfPath));
            const extracted = await extractTextFromPdfWithPages(pdfBuffer);
            cacheEntry = { text: extracted.text, pageOffsets: extracted.pageOffsets };
            pdfTextCache.set(pdfPath, cacheEntry);
          } catch {
            cacheEntry = { text: "", pageOffsets: [] };
          }
        }
        let fullText = cacheEntry.text;
        const pageOffsets = cacheEntry.pageOffsets;
        const originalFullText = cacheEntry.text; // Un-sliced text for chapter search
        // Bounds within `originalFullText` where this topic's grade section
        // lives. Default to the whole document; narrowed when the class
        // splitter runs successfully. Used to scope findChapterPage so a
        // Class X chapter can't match the Class IX chapter of the same number.
        let gradeStartOffset = 0;
        let gradeEndOffset = originalFullText.length;
        // Page where this grade's section starts — used as the fallback when
        // the per-chapter page finder can't locate the chapter header.
        let gradeStartPage: number | undefined;

        // Combined-class PDF guard. If the extracted text covers two classes
        // (IX+X or XI+XII), slice down to just the current topic's grade
        // BEFORE handing it to the AI extractor. See class-section-splitter.ts
        // for the marker-detection heuristic and bail-out conditions.
        //
        // We only attempt the split for the CBSE Secondary/Senior-Secondary
        // pair the topic belongs to — splitting IX-vs-X is pointless when
        // grade is 11. Other grades fall through to full text unchanged.
        if (fullText.length > 100) {
          const pairedGrades =
            topic.grade === 9 || topic.grade === 10
              ? [9, 10]
              : topic.grade === 11 || topic.grade === 12
              ? [11, 12]
              : null;

          if (pairedGrades) {
            const cacheKey = `${pdfPath}::${topic.grade}`;
            const cached = pdfSliceCache.get(cacheKey);
            if (cached && cached !== SLICE_FALLBACK) {
              fullText = cached.text;
              gradeStartPage = cached.startPage;
              if (cached.startOffset !== undefined) gradeStartOffset = cached.startOffset;
              if (cached.endOffset !== undefined) gradeEndOffset = cached.endOffset;
            } else if (cached !== SLICE_FALLBACK) {
              const sliced = splitSyllabusByClass(fullText, pairedGrades, pageOffsets);
              const mySlice = sliced?.get(topic.grade);
              if (mySlice) {
                const entry: SliceCacheEntry = {
                  text: mySlice.text,
                  startPage: mySlice.startPage,
                  startOffset: mySlice.startOffset,
                  endOffset: mySlice.endOffset,
                };
                pdfSliceCache.set(cacheKey, entry);
                // Also store the "other grade" slice under its key to save
                // work for the next topic from that grade (if any).
                const otherGrade = pairedGrades.find((g) => g !== topic.grade);
                if (otherGrade) {
                  const otherSlice = sliced?.get(otherGrade);
                  if (otherSlice) {
                    pdfSliceCache.set(`${pdfPath}::${otherGrade}`, {
                      text: otherSlice.text,
                      startPage: otherSlice.startPage,
                      startOffset: otherSlice.startOffset,
                      endOffset: otherSlice.endOffset,
                    });
                  }
                }
                fullText = mySlice.text;
                gradeStartPage = mySlice.startPage;
                gradeStartOffset = mySlice.startOffset;
                gradeEndOffset = mySlice.endOffset;
                console.log(
                  `[CbseContentFill] PDF "${pdfPath}" split by class → Class ${topic.grade} slice = ${mySlice.text.length} chars${
                    mySlice.startPage !== undefined ? ` (page ${mySlice.startPage}+)` : ""
                  }`
                );
              } else {
                // Splitter bailed — PDF is single-class, or markers weren't
                // detectable, or slices were suspiciously short. Memoize
                // the decision so we don't re-split for every topic.
                pdfSliceCache.set(cacheKey, SLICE_FALLBACK);
              }
            }
          }
        }

        // Per-chapter page precision. Now that we know the grade's bounds
        // within the original PDF text, find where THIS topic's chapter
        // header lives and open the viewer at that page instead of the
        // grade-section cover. Falls back to gradeStartPage when the
        // chapter header can't be located (rare — PDFs with inline
        // chapter numbering usually match the explicit markers).
        if (pageOffsets.length > 0) {
          const chKey = `${pdfPath}::${topic.grade}::${topic.chapter_number}`;
          let chapterPage = chapterPageCache.get(chKey);
          if (chapterPage === undefined) {
            const found = findChapterPage({
              fullText: originalFullText,
              startOffset: gradeStartOffset,
              endOffset: gradeEndOffset,
              chapterNumber: topic.chapter_number,
              chapterTitle: topic.chapter_title,
              pageOffsets,
            });
            chapterPage = found ?? null;
            chapterPageCache.set(chKey, chapterPage);
            if (found !== undefined) {
              console.log(
                `[CbseContentFill] Chapter ${topic.chapter_number} "${topic.chapter_title}" (Class ${topic.grade}) → PDF page ${found}`
              );
            }
          }
          pdfPageForTopic = chapterPage ?? gradeStartPage;
        } else {
          pdfPageForTopic = gradeStartPage;
        }

        if (fullText.length > 100) {
          const systemPrompt = `You are a CBSE/NCERT textbook content extractor. You will be given the full text of a chapter from a textbook. Extract ONLY the section that covers the specific topic requested.

Output requirements:
- Use Markdown with proper H2/H3 headings
- Preserve ALL mathematical formulas using LaTeX ($...$ inline, $$...$$ block)
- Include ALL definitions with **bold** key terms
- Include ALL examples and solved problems from the textbook for this topic
- Include ALL diagrams described as [Figure: description]
- Preserve the exact content from the textbook — do NOT invent or add content not in the source
- If the topic is not explicitly covered in the chapter text, extract the most relevant related content
- Add a "Key Points" section at the end`;

          const userPrompt = `From this ${topic.board_code} Class ${topic.grade} ${topic.subject_name} textbook chapter, extract the content specifically about "${topic.topic_title}".

Chapter: ${topic.chapter_title}
Topic to extract: ${topic.topic_title}

Full chapter text:
${fullText.slice(0, 25000)}`;

          const result = await aiChat(userPrompt, {
            model: AI_MODELS.GEMINI_FLASH,
            systemPrompt,
            temperature: 0.1,
            maxTokens: 8192,
          });

          content = result.content;
          modelUsed = result.model;
          costUsd = result.costUsd;
          tokens = result.inputTokens + result.outputTokens;
        } else {
          // PDF text too short (corrupt? password-protected?) — fall back.
          const r = await generateFromContext(topic);
          content = r.content;
          modelUsed = r.model;
          costUsd = r.costUsd;
          tokens = r.tokens;
        }
      } else {
        // STRATEGY 2: No PDF available — generate from chapter context.
        const r = await generateFromContext(topic);
        content = r.content;
        modelUsed = r.model;
        costUsd = r.costUsd;
        tokens = r.tokens;
      }

      const qualityScore = computeQualityScore(content, 0);

      // Provenance tag — path prefix tells us which publisher the PDF came
      // from. NCERT lives under data/ncert-pdfs/, CBSE under data/pdfs/CBSE/.
      const pdfPath = topic.chapter_pdf_path ?? "";
      const sourceType = !pdfPath
        ? "ai_generated"
        : pdfPath.includes("ncert-pdfs")
        ? "ncert"
        : pdfPath.includes("/CBSE/") || pdfPath.includes("\\CBSE\\")
        ? "cbse_textbook"
        : "ncert";

      await db.insert(contentItems).values({
        topicId: topic.topic_id,
        contentType: "note",
        title: topic.topic_title,
        body: content,
        bodyFormat: "markdown",
        sourceType,
        sourceUrl: topic.chapter_pdf_path ? `file://${topic.chapter_pdf_path}` : null,
        language: "en",
        qualityScore: qualityScore.toFixed(2),
        reviewStatus: "pending",
        isPublished: false,
        metadata: {
          extractedFrom: topic.chapter_pdf_path ?? null,
          // 1-indexed page in extractedFrom where this content was sourced
          // from. Populated when the class-splitter ran on a combined-class
          // PDF (CBSE Sec/Sr_Sec). Consumed by ContentViewToggle to open
          // PdfViewer at #page=N so students see the correct grade's pages.
          pdfPage: pdfPageForTopic ?? null,
          chapterNumber: topic.chapter_number,
          chapterTitle: topic.chapter_title,
          aiModel: modelUsed,
          aiCostUsd: costUsd,
          aiTokens: tokens,
          board: topic.board_code,
          grade: topic.grade,
          subject: topic.subject_name,
          generatedAt: new Date().toISOString(),
        },
      });

      processed++;
      totalCost += costUsd;
      console.log(
        `[CbseContentFill] Topic "${topic.topic_title}" — ${
          topic.chapter_pdf_path ? "from PDF" : "AI generated"
        } (${modelUsed}, $${costUsd.toFixed(4)})`
      );

      // Stream progress after every topic so the UI poll sees movement.
      await updateJobProgress(jobId, { itemsProcessed: processed });
    } catch (err) {
      errors.push(
        `Topic ${topic.topic_id} (${topic.topic_title}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Final status write. If we processed at least one topic OR there were no
  // candidates at all, we consider the job "completed" (zero is valid — it
  // just means there was nothing to do). Only mark failed when every
  // candidate errored out.
  const allFailed = toProcess.length > 0 && processed === 0 && errors.length > 0;
  await updateJobProgress(jobId, {
    status: allFailed ? "failed" : "completed",
    errorLog: errors.length ? errors.slice(0, 10).join("\n") : null,
  });

  return {
    processed,
    totalCostUsd: Math.round(totalCost * 10000) / 10000,
    errors,
    topicsCandidate: toProcess.length,
  };
}

// ---------------------------------------------------------------------------
// Fallback path: generate from existing chapter content as context.
// ---------------------------------------------------------------------------
async function generateFromContext(topic: {
  topic_title: string;
  chapter_title: string;
  subject_name: string;
  grade: number;
  board_code: string;
  topic_id: number;
}): Promise<{ content: string; model: string; costUsd: number; tokens: number }> {
  const [chapterContent] = await db
    .select({ body: contentItems.body })
    .from(contentItems)
    .innerJoin(topics, eq(topics.id, contentItems.topicId))
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .where(
      and(
        eq(chapters.title, topic.chapter_title),
        eq(contentItems.sourceType, "ncert")
      )
    )
    .limit(1);

  const context = chapterContent?.body?.slice(0, 12000) ?? "";

  const systemPrompt = `You are a CBSE/NCERT textbook content expert for ${topic.board_code} Class ${topic.grade} ${topic.subject_name}. Create study notes for the specific topic requested, based on the textbook content.`;

  const userPrompt = `Create study notes for:
Topic: ${topic.topic_title}
Chapter: ${topic.chapter_title}
Subject: ${topic.subject_name}, Class ${topic.grade}

${
  context
    ? `Reference content from the chapter:\n${context}\n\nExtract and expand on the section about "${topic.topic_title}" from the above.`
    : `Generate comprehensive notes on "${topic.topic_title}" as it appears in the ${topic.subject_name} textbook for Class ${topic.grade}.`
}`;

  const result = await aiChat(userPrompt, {
    model: AI_MODELS.GEMINI_FLASH,
    systemPrompt,
    temperature: 0.2,
    maxTokens: 4096,
  });

  return {
    content: result.content,
    model: result.model,
    costUsd: result.costUsd,
    tokens: result.inputTokens + result.outputTokens,
  };
}
