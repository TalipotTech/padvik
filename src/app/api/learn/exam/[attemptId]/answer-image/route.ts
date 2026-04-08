import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq, and } from "drizzle-orm";
import { examAttempts, examResponses } from "@/db/schema/exams";
import { fileUploads } from "@/db/schema/content";
import { questions } from "@/db/schema/questions";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { aiVision } from "@/lib/ai/provider";

/**
 * POST /api/learn/exam/[attemptId]/answer-image
 * Upload a photo of handwritten exam answer. AI extracts text and optionally evaluates.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch {}
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const { attemptId: aidStr } = await params;
  const attemptId = parseInt(aidStr, 10);

  // Verify attempt
  const [attempt] = await db.select().from(examAttempts)
    .where(and(eq(examAttempts.id, attemptId), eq(examAttempts.userId, userId))).limit(1);
  if (!attempt) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Attempt not found" } }, { status: 404 });

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const questionIdStr = formData.get("questionId") as string | null;

    if (!file || !questionIdStr) {
      return NextResponse.json({ success: false, error: { code: "MISSING_FIELDS", message: "file and questionId required" } }, { status: 400 });
    }

    const questionId = parseInt(questionIdStr, 10);

    // Save image
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `${Date.now()}-answer.${file.name.split(".").pop() ?? "jpg"}`;
    const dirPath = join(process.cwd(), "data", "uploads", "exam-answers", String(userId));
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
    writeFileSync(join(dirPath, fileName), buffer);

    const imageUrl = `/api/uploads/exam-answers/${userId}/${fileName}`;

    // Create fileUploads record
    await db.insert(fileUploads).values({
      userId, fileName: file.name, fileType: file.type.split("/")[1] ?? "jpeg",
      fileSizeBytes: file.size, storageKey: `data/uploads/exam-answers/${userId}/${fileName}`,
      storageUrl: imageUrl, processingStatus: "processing", uploadContext: "exam_answer",
    });

    // Extract text with AI Vision
    let extractedText = "";
    try {
      const base64 = buffer.toString("base64");
      const result = await aiVision(
        "Extract all text from this handwritten exam answer. Preserve mathematical formulas in LaTeX. Output the student's complete answer.",
        base64,
        file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        { temperature: 0.1, maxTokens: 2048 }
      );
      extractedText = result.content;
    } catch {
      extractedText = "[OCR failed]";
    }

    // Get the question for evaluation context
    const [question] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);

    // AI evaluation for descriptive answers
    let aiEvaluation: Record<string, unknown> | null = null;
    if (question && extractedText.length > 10) {
      try {
        const evalResult = await aiVision(
          `Evaluate this student's handwritten answer.
Question: ${question.questionText}
Expected Answer: ${question.correctAnswer ?? question.solution ?? "Not available"}
Marks: ${question.marks}

Score the answer out of ${question.marks} marks. Provide:
1. Score (number)
2. Brief feedback (2-3 sentences)
3. Key points covered (array)
4. Key points missed (array)

Output as JSON: { "score": number, "feedback": "...", "covered": [...], "missed": [...] }`,
          buffer.toString("base64"),
          file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
          { temperature: 0.2, maxTokens: 1024, jsonOutput: true }
        );

        try {
          const jsonMatch = evalResult.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) aiEvaluation = JSON.parse(jsonMatch[0]);
        } catch { /* JSON parse failed */ }
      } catch { /* evaluation failed */ }
    }

    // Save or update exam response
    const [existingResp] = await db.select().from(examResponses)
      .where(and(eq(examResponses.attemptId, attemptId), eq(examResponses.questionId, questionId))).limit(1);

    if (existingResp) {
      const existingImages = (existingResp.responseImages ?? []) as Array<{ url: string }>;
      await db.update(examResponses).set({
        responseText: extractedText,
        responseImages: [...existingImages, { url: imageUrl, extractedText }],
        aiEvaluation: aiEvaluation ?? existingResp.aiEvaluation,
        marksObtained: aiEvaluation ? String((aiEvaluation as { score?: number }).score ?? 0) : existingResp.marksObtained,
        updatedAt: new Date(),
      }).where(eq(examResponses.id, existingResp.id));
    } else {
      await db.insert(examResponses).values({
        attemptId, questionId,
        responseText: extractedText,
        responseImages: [{ url: imageUrl, extractedText }],
        aiEvaluation,
        marksObtained: aiEvaluation ? String((aiEvaluation as { score?: number }).score ?? 0) : "0",
      });
    }

    return NextResponse.json({
      success: true,
      data: { imageUrl, extractedText, aiEvaluation },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: { code: "UPLOAD_ERROR", message: err instanceof Error ? err.message : "Failed" } }, { status: 500 });
  }
}
