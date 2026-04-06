import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { contentPipelineLogs } from "@/db/schema/system";
import { eq, inArray, and } from "drizzle-orm";

// Extend timeout for batch processing (10 minutes)
export const maxDuration = 600;

// ---------------------------------------------------------------------------
// POST /api/admin/parse-errors/retry-all — Batch retry all failed documents
// ---------------------------------------------------------------------------
export async function POST() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  // Get all failed validation logs that have a URL
  const failedLogs = await db
    .select({ id: contentPipelineLogs.id, outputData: contentPipelineLogs.outputData })
    .from(contentPipelineLogs)
    .where(
      and(
        inArray(contentPipelineLogs.pipelineStage, ["validation", "validation_recovery"]),
        eq(contentPipelineLogs.status, "failed")
      )
    )
    .limit(100);

  const retryable = failedLogs.filter((log) => {
    const data = log.outputData as Record<string, unknown> | null;
    return data?.url && typeof data.url === "string";
  });

  if (retryable.length === 0) {
    return NextResponse.json({
      success: true,
      data: { retried: 0, succeeded: 0, failed: 0, message: "No retryable failures found" },
    });
  }

  // Process each one by calling the individual retry endpoint logic
  let succeeded = 0;
  let failed = 0;
  const results: { id: number; filename: string; status: string; error?: string }[] = [];

  for (const log of retryable) {
    const data = (log.outputData ?? {}) as Record<string, unknown>;
    const pdfUrl = data.url as string;
    const filename = (data.filename as string) ?? pdfUrl.split("/").pop() ?? "unknown";
    const grade = (data.grade as number) ?? 10;
    const paperType = (data.paperType as string) ?? "sqp";

    try {
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

      const pdfResponse = await fetch(pdfUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PadvikBot/1.0; educational-content)" },
      });
      if (!pdfResponse.ok) throw new Error(`HTTP ${pdfResponse.status}`);

      const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
      const pdfText = await extractTextFromPdf(pdfBuffer);
      if (pdfText.trim().length < 200) throw new Error(`Text too short (${pdfText.trim().length} chars)`);

      const { AI_MODELS } = await import("@/lib/ai/provider");
      const userPrompt = buildUserPrompt({ pdfText, boardCode: "CBSE", grade, paperType });
      const modelsToTry = [AI_MODELS.GEMINI_FLASH, AI_MODELS.GEMINI_PRO, AI_MODELS.PRIMARY];
      let aiResult = null;
      const maxTokens = Math.min(Math.max(32768, Math.ceil(pdfText.length * 0.8)), 65536);

      for (const model of modelsToTry) {
        try {
          const isGemini = model.startsWith("gemini-");
          console.log(`[RetryAll] ${filename}: trying ${model} (maxTokens: ${maxTokens})...`);
          aiResult = await aiChat(userPrompt, {
            model,
            systemPrompt: SYSTEM_PROMPT,
            temperature: promptConfig.temperature,
            maxTokens,
            jsonOutput: isGemini,
          });
          console.log(`[RetryAll] ${filename}: ${model} OK (${aiResult.inputTokens} in / ${aiResult.outputTokens} out)`);
          break;
        } catch (modelErr) {
          console.error(`[RetryAll] ${filename}: ${model} failed:`, modelErr instanceof Error ? modelErr.message : String(modelErr));
          if (model === modelsToTry[modelsToTry.length - 1]) throw modelErr;
        }
      }
      if (!aiResult) throw new Error("All AI models failed");

      const parsed = parseResponse(aiResult.content);

      const [board] = await db
        .select()
        .from(boards)
        .where(eq(boards.code, "CBSE"))
        .limit(1);
      if (!board) throw new Error("CBSE board not found");

      const insertResult = await insertParsedQuestions(
        board.id, grade, parsed, undefined,
        (msg) => console.log(`[RetryAll] ${filename}: ${msg}`),
        { pdfUrl, aiModel: aiResult.model, boardCode: "CBSE" },
        { forceReinsert: true }
      );

      await db
        .update(contentPipelineLogs)
        .set({
          status: "retried_success",
          outputData: {
            ...data,
            retryResult: {
              questionsInserted: insertResult.questionsInserted,
              model: aiResult.model,
              costUsd: aiResult.costUsd,
              retriedAt: new Date().toISOString(),
              retriedBy: session.user.email,
            },
          },
        })
        .where(eq(contentPipelineLogs.id, log.id));

      succeeded++;
      results.push({ id: log.id, filename, status: "success" });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      failed++;
      results.push({ id: log.id, filename, status: "failed", error: errorMsg });

      await db
        .update(contentPipelineLogs)
        .set({
          outputData: {
            ...data,
            retryError: errorMsg,
            retriedAt: new Date().toISOString(),
          },
        })
        .where(eq(contentPipelineLogs.id, log.id));
    }
  }

  return NextResponse.json({
    success: true,
    data: { retried: retryable.length, succeeded, failed, results },
  });
}
