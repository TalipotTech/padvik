import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { contentPipelineLogs } from "@/db/schema/system";
import { eq } from "drizzle-orm";

// Extend timeout for long AI calls (5 minutes)
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// POST /api/admin/parse-errors/[id]/retry — Re-process a failed document
// ---------------------------------------------------------------------------
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const { id } = await params;
  const logId = parseInt(id, 10);
  if (isNaN(logId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid log ID" } },
      { status: 400 }
    );
  }

  // Get the failed log entry
  const [logEntry] = await db
    .select()
    .from(contentPipelineLogs)
    .where(eq(contentPipelineLogs.id, logId))
    .limit(1);

  if (!logEntry) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Log entry not found" } },
      { status: 404 }
    );
  }

  const data = (logEntry.outputData ?? {}) as Record<string, unknown>;
  const pdfUrl = data.url as string | undefined;

  if (!pdfUrl) {
    return NextResponse.json(
      { success: false, error: { code: "NO_URL", message: "No source URL stored for this document" } },
      { status: 400 }
    );
  }

  const grade = (data.grade as number) ?? 10;
  const paperType = (data.paperType as string) ?? "sqp";
  const _filename = (data.filename as string) ?? pdfUrl.split("/").pop() ?? "unknown.pdf";

  try {
    // Dynamic imports to avoid loading heavy modules for non-retry routes
    const { extractTextFromPdf } = await import("@/lib/scraper/parser");
    const { aiChat } = await import("@/lib/ai/provider");
    const {
      SYSTEM_PROMPT,
      buildUserPrompt,
      parseResponse,
      config: promptConfig,
    } = await import("@/lib/ai/prompts/question-paper-parser");
    const { insertParsedQuestions } = await import("@/lib/scraper/question-inserter");
    const { boards } = await import("@/db/schema/curriculum");

    // Step 1: Re-download PDF
    console.log(`[Retry] Downloading PDF: ${pdfUrl}`);
    const pdfResponse = await fetch(pdfUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PadvikBot/1.0; educational-content)" },
    });
    if (!pdfResponse.ok) {
      throw new Error(`PDF download failed: HTTP ${pdfResponse.status}`);
    }
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    console.log(`[Retry] Downloaded ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    // Step 2: Extract text (for figure detection and fallback)
    let pdfText = "";
    try {
      pdfText = await extractTextFromPdf(pdfBuffer);
      console.log(`[Retry] Extracted ${pdfText.length} chars`);
    } catch {
      console.log(`[Retry] Text extraction failed — will use PDF vision mode`);
    }

    // Step 3: AI parse — prefer PDF Vision mode for documents with figures
    const { AI_MODELS, aiPdfVision } = await import("@/lib/ai/provider");
    const hasFigures = /\b(figure|fig\.|diagram|image|picture|shown below|given below|observe the)\b/i.test(pdfText);
    const maxTokens = Math.min(Math.max(32768, Math.ceil(Math.max(pdfText.length, 10000) * 1.2)), 65536);

    // Estimate expected question count from text patterns
    const mainQCount = (pdfText.match(/^\s*\d+\.\s/gm) ?? []).length;
    const subQCount = new Set(pdfText.match(/\d+\.\d+/g) ?? []).size;
    const estimatedTotal = subQCount || mainQCount || 0;
    console.log(`[Retry] Estimated questions: ~${estimatedTotal} (${mainQCount} main, ${subQCount} sub), maxTokens: ${maxTokens}`);

    let aiResult = null;

    // Try PDF Vision first (Gemini can see figures/diagrams)
    if (pdfBuffer.length < 10 * 1024 * 1024) {
      console.log(`[Retry] Using PDF Vision mode (${hasFigures ? "figures detected" : "preferred for accuracy"})...`);
      const pdfBase64 = pdfBuffer.toString("base64");
      const visionPrompt = [
        `Board: CBSE, Class/Grade: ${grade}, Paper Type: ${paperType}`,
        estimatedTotal > 0 ? `This document contains approximately ${estimatedTotal} questions. You MUST extract ALL of them.` : "",
        "",
        "Parse EVERY SINGLE question from this question paper PDF into structured JSON.",
        "Do NOT stop early. Extract questions from ALL pages, including the last page.",
        "For questions with figures/diagrams: describe the figure in [Figure: ...] brackets within questionText.",
        "Return ONLY valid JSON matching the expected structure.",
      ].filter(Boolean).join("\n");

      const visionModels = [AI_MODELS.GEMINI_FLASH, AI_MODELS.GEMINI_PRO];
      for (const model of visionModels) {
        try {
          console.log(`[Retry] PDF Vision with ${model}...`);
          aiResult = await aiPdfVision(visionPrompt, pdfBase64, {
            model,
            systemPrompt: SYSTEM_PROMPT,
            temperature: promptConfig.temperature,
            maxTokens,
            jsonOutput: true,
          });
          console.log(`[Retry] Vision response (${model}): ${aiResult.inputTokens} in / ${aiResult.outputTokens} out ($${aiResult.costUsd.toFixed(4)})`);
          break;
        } catch (err) {
          console.error(`[Retry] Vision ${model} failed:`, err instanceof Error ? err.message : String(err));
        }
      }
    }

    // Fallback to text-only parsing
    if (!aiResult) {
      if (pdfText.trim().length < 200) {
        throw new Error(`PDF text too short (${pdfText.trim().length} chars) and vision mode failed`);
      }

      console.log(`[Retry] Falling back to text-only parsing...`);
      const userPrompt = buildUserPrompt({ pdfText, boardCode: "CBSE", grade, paperType });
      const modelsToTry = [AI_MODELS.GEMINI_FLASH, AI_MODELS.GEMINI_PRO, AI_MODELS.PRIMARY];

      for (const model of modelsToTry) {
        try {
          const isGemini = model.startsWith("gemini-");
          console.log(`[Retry] Text mode with ${model}...`);
          aiResult = await aiChat(userPrompt, {
            model,
            systemPrompt: SYSTEM_PROMPT,
            temperature: promptConfig.temperature,
            maxTokens,
            jsonOutput: isGemini,
          });
          console.log(`[Retry] AI response (${model}): ${aiResult.inputTokens} in / ${aiResult.outputTokens} out`);
          break;
        } catch (err) {
          console.error(`[Retry] ${model} failed:`, err instanceof Error ? err.message : String(err));
          if (model === modelsToTry[modelsToTry.length - 1]) throw err;
        }
      }
    }
    if (!aiResult) throw new Error("All AI models failed");

    // Step 4: Validate
    let parsed = parseResponse(aiResult.content);

    // Step 4b: Completeness check — if we got much fewer than expected, retry with continuation
    if (estimatedTotal > 0 && parsed.questions.length < estimatedTotal * 0.7) {
      console.log(`[Retry] Incomplete: got ${parsed.questions.length}/${estimatedTotal} questions. Requesting missing ones...`);

      const lastQ = parsed.questions[parsed.questions.length - 1];
      const lastQNum = lastQ?.questionNumber ?? "?";

      try {
        const continuationPrompt = [
          `You previously parsed questions up to Q${lastQNum} (${parsed.questions.length} questions).`,
          `But the document has approximately ${estimatedTotal} questions total.`,
          `Continue parsing from where you stopped. Extract questions AFTER Q${lastQNum}.`,
          `Return ONLY the remaining questions in the same JSON format: { "questions": [...] }`,
        ].join("\n");

        const continueModel = AI_MODELS.GEMINI_FLASH;
        let contResult;

        if (pdfBuffer.length < 10 * 1024 * 1024) {
          contResult = await aiPdfVision(continuationPrompt, pdfBuffer.toString("base64"), {
            model: continueModel,
            systemPrompt: SYSTEM_PROMPT,
            temperature: promptConfig.temperature,
            maxTokens,
            jsonOutput: true,
          });
        } else {
          contResult = await aiChat(
            `${continuationPrompt}\n\n---TEXT---\n${pdfText.slice(0, 50000)}`,
            { model: continueModel, systemPrompt: SYSTEM_PROMPT, temperature: promptConfig.temperature, maxTokens, jsonOutput: true }
          );
        }

        const contParsed = parseResponse(contResult.content);
        if (contParsed.questions.length > 0) {
          console.log(`[Retry] Continuation got ${contParsed.questions.length} more questions`);
          parsed = {
            ...parsed,
            questions: [...parsed.questions, ...contParsed.questions],
          };
        }
      } catch (contErr) {
        console.error(`[Retry] Continuation failed:`, contErr instanceof Error ? contErr.message : String(contErr));
        // Continue with what we have
      }
    }

    console.log(`[Retry] Final: ${parsed.questions.length} questions parsed`);

    // Step 5: Insert into DB
    const [board] = await db
      .select()
      .from(boards)
      .where(eq(boards.code, "CBSE"))
      .limit(1);

    if (!board) throw new Error("CBSE board not found");

    const insertResult = await insertParsedQuestions(
      board.id, grade, parsed, undefined,
      (msg) => console.log(`[Retry] ${msg}`),
      { pdfUrl, aiModel: aiResult.model, boardCode: "CBSE" },
      { forceReinsert: true }
    );

    // Step 6: Update the log entry to mark as resolved
    await db
      .update(contentPipelineLogs)
      .set({
        status: "retried_success",
        outputData: {
          ...data,
          retryResult: {
            questionsInserted: insertResult.questionsInserted,
            questionsSkipped: insertResult.questionsSkipped,
            questionPaperId: insertResult.questionPaperId,
            model: aiResult.model,
            costUsd: aiResult.costUsd,
            retriedAt: new Date().toISOString(),
            retriedBy: session.user.email,
          },
        },
      })
      .where(eq(contentPipelineLogs.id, logId));

    return NextResponse.json({
      success: true,
      data: {
        questionsInserted: insertResult.questionsInserted,
        questionsSkipped: insertResult.questionsSkipped,
        model: aiResult.model,
        costUsd: aiResult.costUsd,
      },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Log the retry failure
    await db
      .update(contentPipelineLogs)
      .set({
        outputData: {
          ...data,
          retryError: errorMsg,
          retriedAt: new Date().toISOString(),
          retriedBy: session.user.email,
        },
      })
      .where(eq(contentPipelineLogs.id, logId));

    return NextResponse.json(
      { success: false, error: { code: "RETRY_FAILED", message: errorMsg } },
      { status: 500 }
    );
  }
}
