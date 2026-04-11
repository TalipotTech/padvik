import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { doubts, doubtResponses } from "@/db/schema/doubts";
import { eq } from "drizzle-orm";
import { aiChat, AI_MODELS } from "@/lib/ai/provider";

/**
 * POST /api/doubts/[id]/ask-ai — Generate an AI response for a doubt on demand
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const { id } = await params;
  const doubtId = Number(id);

  const [doubt] = await db.select({ questionText: doubts.questionText, status: doubts.status })
    .from(doubts).where(eq(doubts.id, doubtId)).limit(1);

  if (!doubt) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Doubt not found" } }, { status: 404 });

  try {
    const result = await aiChat(
      `You are a helpful educational tutor. A student asked:\n\n"${doubt.questionText}"\n\nProvide a clear, concise answer for an Indian K-12 student. Use LaTeX for math. Under 300 words.`,
      { model: AI_MODELS.BULK, temperature: 0.3, maxTokens: 500 }
    );

    if (result.content) {
      await db.insert(doubtResponses).values({
        doubtId,
        responderId: 1,
        responseText: result.content,
        responseType: "text",
        isAi: true,
      });

      if (doubt.status === "open") {
        await db.update(doubts).set({ status: "ai_answered", updatedAt: new Date() }).where(eq(doubts.id, doubtId));
      }
    }

    return NextResponse.json({ success: true, data: { generated: true } });
  } catch (err) {
    return NextResponse.json({ success: false, error: { code: "AI_ERROR", message: err instanceof Error ? err.message : "AI failed" } }, { status: 500 });
  }
}
