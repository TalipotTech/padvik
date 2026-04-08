import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { topics, chapters, subjects } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { z } from "zod/v4";
import { readFile } from "fs/promises";
import { join } from "path";
import { aiChat, aiPdfVision, AI_MODELS } from "@/lib/ai/provider";
import { computeQualityScore } from "@/lib/ai/quality-scorer";
import { extractTextFromPdf } from "@/lib/scraper/parser";

/**
 * GET /api/admin/content/fill-gaps?subjectId=245
 * Returns topics without content for a specific subject.
 *
 * POST /api/admin/content/fill-gaps
 * Extracts topic-specific content from the DOWNLOADED chapter PDFs.
 * NOT AI-generated from scratch — uses actual textbook content.
 */

export async function GET(request: NextRequest) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin" || process.env.NODE_ENV === "development";
  if (!isAdmin) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } }, { status: 403 });
  }

  const subjectId = request.nextUrl.searchParams.get("subjectId");
  if (!subjectId) {
    return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "subjectId required" } }, { status: 400 });
  }

  const sid = parseInt(subjectId, 10);

  const topicRows = await db.execute<{
    topic_id: number;
    topic_title: string;
    chapter_number: number;
    chapter_title: string;
    content_count: number;
    chapter_pdf_path: string | null;
  }>(sql`
    SELECT
      t.id AS topic_id,
      t.title AS topic_title,
      ch.chapter_number,
      ch.title AS chapter_title,
      (SELECT count(*)::int FROM content_items ci WHERE ci.topic_id = t.id) AS content_count,
      (SELECT ci2.metadata->>'pdfPath' FROM content_items ci2 JOIN topics t2 ON t2.id = ci2.topic_id WHERE t2.chapter_id = ch.id AND ci2.metadata->>'pdfPath' IS NOT NULL LIMIT 1) AS chapter_pdf_path
    FROM topics t
    JOIN chapters ch ON ch.id = t.chapter_id
    WHERE ch.subject_id = ${sid}
    ORDER BY ch.chapter_number, t.sort_order
  `);

  const allTopics = [...topicRows];
  const missingTopics = allTopics.filter((t) => t.content_count === 0);
  const withPdf = missingTopics.filter((t) => t.chapter_pdf_path !== null);

  const [subj] = await db.select({ name: subjects.name, code: subjects.code }).from(subjects).where(eq(subjects.id, sid)).limit(1);

  const estimatedCost = withPdf.length * 0.003 + (missingTopics.length - withPdf.length) * 0.005;

  return NextResponse.json({
    success: true,
    data: {
      subject: subj,
      totalTopics: allTopics.length,
      topicsWithContent: allTopics.filter((t) => t.content_count > 0).length,
      topicsMissing: missingTopics.length,
      topicsWithPdf: withPdf.length,
      topicsWithoutPdf: missingTopics.length - withPdf.length,
      estimatedCostUsd: Math.round(estimatedCost * 100) / 100,
      missingTopics: missingTopics.map((t) => ({
        topicId: t.topic_id,
        title: t.topic_title,
        chapter: `Ch ${t.chapter_number}: ${t.chapter_title}`,
        hasPdf: t.chapter_pdf_path !== null,
        pdfPath: t.chapter_pdf_path,
      })),
    },
  });
}

const fillSchema = z.object({
  subjectId: z.number().int(),
  topicIds: z.array(z.number().int()).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  dryRun: z.boolean().optional(),
  notes: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin" || process.env.NODE_ENV === "development";
  if (!isAdmin) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = fillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const { subjectId, topicIds, limit: maxTopics, dryRun } = parsed.data;

  // Find missing topics WITH their chapter's PDF path
  const missingRows = await db.execute<{
    topic_id: number;
    topic_title: string;
    chapter_number: number;
    chapter_title: string;
    chapter_pdf_path: string | null;
    subject_name: string;
    grade: number;
    board_code: string;
  }>(sql`
    SELECT
      t.id AS topic_id,
      t.title AS topic_title,
      ch.chapter_number,
      ch.title AS chapter_title,
      (SELECT ci2.metadata->>'pdfPath' FROM content_items ci2 JOIN topics t2 ON t2.id = ci2.topic_id WHERE t2.chapter_id = ch.id AND ci2.metadata->>'pdfPath' IS NOT NULL LIMIT 1) AS chapter_pdf_path,
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
    LIMIT ${maxTopics ?? 50}
  `);

  let toProcess = [...missingRows];
  if (topicIds && topicIds.length > 0) {
    toProcess = toProcess.filter((r) => topicIds.includes(r.topic_id));
  }

  if (dryRun) {
    return NextResponse.json({
      success: true,
      data: {
        dryRun: true,
        topicsToProcess: toProcess.length,
        withPdf: toProcess.filter((t) => t.chapter_pdf_path).length,
        withoutPdf: toProcess.filter((t) => !t.chapter_pdf_path).length,
        estimatedCostUsd: Math.round(toProcess.length * 0.004 * 100) / 100,
      },
    });
  }

  // Process each missing topic — extract content from its chapter PDF
  let processed = 0;
  let totalCost = 0;
  const errors: string[] = [];

  // Cache PDF text per chapter to avoid re-reading the same file
  const pdfTextCache = new Map<string, string>();

  for (const topic of toProcess) {
    try {
      let content: string;
      let modelUsed: string;
      let costUsd: number;
      let tokens: number;

      if (topic.chapter_pdf_path) {
        // STRATEGY 1: Extract from downloaded PDF — the real textbook content
        const pdfPath = topic.chapter_pdf_path;

        // Get the chapter's full extracted text (cached)
        let fullText = pdfTextCache.get(pdfPath);
        if (!fullText) {
          try {
            const pdfBuffer = await readFile(join(process.cwd(), pdfPath));
            fullText = await extractTextFromPdf(pdfBuffer);
            pdfTextCache.set(pdfPath, fullText);
          } catch {
            fullText = "";
          }
        }

        if (fullText.length > 100) {
          // Send the chapter text to AI with instruction to extract ONLY the specific topic
          const systemPrompt = `You are an NCERT textbook content extractor. You will be given the full text of a chapter from an NCERT textbook. Extract ONLY the section that covers the specific topic requested.

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
          // PDF text too short — fall back to AI generation
          const result = await generateFromContext(topic);
          content = result.content;
          modelUsed = result.model;
          costUsd = result.costUsd;
          tokens = result.tokens;
        }
      } else {
        // STRATEGY 2: No PDF available — generate using AI with chapter context
        const result = await generateFromContext(topic);
        content = result.content;
        modelUsed = result.model;
        costUsd = result.costUsd;
        tokens = result.tokens;
      }

      // Store the content
      const qualityScore = computeQualityScore(content, 0);

      await db.insert(contentItems).values({
        topicId: topic.topic_id,
        contentType: "note",
        title: `${topic.topic_title}`,
        body: content,
        bodyFormat: "markdown",
        sourceType: topic.chapter_pdf_path ? "ncert" : "ai_generated",
        sourceUrl: topic.chapter_pdf_path ? `file://${topic.chapter_pdf_path}` : null,
        language: "en",
        qualityScore: qualityScore.toFixed(2),
        reviewStatus: "pending",
        isPublished: false,
        metadata: {
          extractedFrom: topic.chapter_pdf_path ?? null,
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
      console.log(`[FillGaps] Topic "${topic.topic_title}" — ${topic.chapter_pdf_path ? "from PDF" : "AI generated"} (${modelUsed}, $${costUsd.toFixed(4)})`);
    } catch (err) {
      errors.push(`Topic ${topic.topic_id} (${topic.topic_title}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      processed,
      totalCostUsd: Math.round(totalCost * 10000) / 10000,
      errors,
    },
  });
}

// ---------------------------------------------------------------------------
// Fallback: Generate from existing chapter content as context
// ---------------------------------------------------------------------------

async function generateFromContext(topic: {
  topic_title: string;
  chapter_title: string;
  subject_name: string;
  grade: number;
  board_code: string;
  topic_id: number;
}): Promise<{ content: string; model: string; costUsd: number; tokens: number }> {
  // Check if chapter has existing parsed content to use as reference
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

  const systemPrompt = `You are an NCERT textbook content expert for ${topic.board_code} Class ${topic.grade} ${topic.subject_name}. Create study notes for the specific topic requested, based on the NCERT textbook content.`;

  const userPrompt = `Create study notes for:
Topic: ${topic.topic_title}
Chapter: ${topic.chapter_title}
Subject: ${topic.subject_name}, Class ${topic.grade}

${context ? `Reference content from the chapter:\n${context}\n\nExtract and expand on the section about "${topic.topic_title}" from the above.` : `Generate comprehensive notes on "${topic.topic_title}" as it appears in the NCERT ${topic.subject_name} textbook for Class ${topic.grade}.`}`;

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
