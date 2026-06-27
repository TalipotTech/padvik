import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { generalConversations } from "@/db/schema/general-chat";
import { topics, chapters, subjects } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod/v4";
import { aiChat, AI_MODELS, type AIModel } from "@/lib/ai/provider";

// Provider auto-rotation order
const PROVIDER_ROTATION: Array<{ name: string; model: AIModel }> = [
  { name: "claude", model: AI_MODELS.PRIMARY },
  { name: "gemini", model: AI_MODELS.GEMINI_FLASH },
  { name: "mistral", model: AI_MODELS.MISTRAL_LARGE },
  { name: "openai", model: AI_MODELS.FALLBACK },
];
let rotationIndex = 0;

function getNextProvider(): { name: string; model: AIModel } {
  const provider = PROVIDER_ROTATION[rotationIndex % PROVIDER_ROTATION.length];
  rotationIndex++;
  return provider;
}

/**
 * GET /api/chat/general?limit=20&id=123
 * - Without id: List recent conversations (summary)
 * - With id: Get full conversation detail (with messages) for loading last chat
 */
export async function GET(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch {}
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const conversationIdParam = request.nextUrl.searchParams.get("id");

  // Single conversation detail — return full messages
  if (conversationIdParam) {
    const convId = parseInt(conversationIdParam, 10);
    const [conv] = await db
      .select()
      .from(generalConversations)
      .where(eq(generalConversations.id, convId))
      .limit(1);

    if (!conv || conv.userId !== userId) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: conv });
  }

  // List conversations
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10), 50);

  const conversations = await db
    .select({
      id: generalConversations.id,
      title: generalConversations.title,
      messageCount: generalConversations.messageCount,
      aiProvider: generalConversations.aiProvider,
      updatedAt: generalConversations.updatedAt,
    })
    .from(generalConversations)
    .where(eq(generalConversations.userId, userId))
    .orderBy(desc(generalConversations.updatedAt))
    .limit(limit);

  return NextResponse.json({ success: true, data: conversations });
}

/**
 * POST /api/chat/general — Send a message to the general AI assistant
 */
const chatSchema = z.object({
  message: z.string().min(1).max(5000),
  conversationId: z.number().int().nullable().optional(),
  /** "auto" = rotate providers, or specify one */
  provider: z.enum(["auto", "claude", "gemini", "openai", "mistral"]).nullable().optional(),
  boardCode: z.string().nullable().optional(),
  grade: z.number().int().nullable().optional(),
  /** Current-topic context — when the student is viewing a specific topic, the
   *  assistant answers in that context (additive; history is untouched). */
  topicId: z.number().int().nullable().optional(),
  topicTitle: z.string().max(500).nullable().optional(),
  topicSubject: z.string().max(255).nullable().optional(),
});

export async function POST(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch {}
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const { message, conversationId, provider: requestedProvider, boardCode, grade, topicId, topicTitle, topicSubject } = parsed.data;

  // Build current-topic context (the topic the student is viewing). Prefer a
  // fresh DB lookup by id (more reliable + pulls study material); fall back to
  // the title/subject the client passed.
  let topicContext = "";
  if (topicId) {
    try {
      const [t] = await db
        .select({
          title: topics.title,
          description: topics.description,
          chapterTitle: chapters.title,
          subjectName: subjects.name,
        })
        .from(topics)
        .innerJoin(chapters, eq(chapters.id, topics.chapterId))
        .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
        .where(eq(topics.id, topicId))
        .limit(1);
      if (t) {
        const [content] = await db
          .select({ body: contentItems.body })
          .from(contentItems)
          .where(and(eq(contentItems.topicId, topicId), eq(contentItems.isPublished, true)))
          .limit(1);
        const material = content?.body?.slice(0, 12000) ?? "";
        topicContext =
          `The student is currently viewing the topic "${t.title}" (${t.subjectName}${t.chapterTitle ? `, ${t.chapterTitle}` : ""}). ` +
          `When their question relates to this topic, answer in this context; otherwise answer normally.\n` +
          (t.description ? `Topic description: ${t.description}\n` : "") +
          (material ? `Topic study material:\n${material}\n` : "");
      }
    } catch {
      /* non-critical — fall back to whatever the client provided */
    }
  }
  if (!topicContext && topicTitle) {
    topicContext = `The student is currently viewing the topic "${topicTitle}"${topicSubject ? ` (${topicSubject})` : ""}. When their question relates to it, answer in that context; otherwise answer normally.\n`;
  }

  // Get or create conversation
  type ChatMsg = { role: string; content: string; timestamp: string; provider?: string; model?: string; suggestions?: string[] };
  let conversation: { id: number; messages: ChatMsg[]; totalTokens: number };

  if (conversationId) {
    const [existing] = await db
      .select()
      .from(generalConversations)
      .where(eq(generalConversations.id, conversationId))
      .limit(1);

    if (!existing || existing.userId !== userId) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } }, { status: 404 });
    }

    conversation = {
      id: existing.id,
      messages: (existing.messages as ChatMsg[]) ?? [],
      totalTokens: existing.totalTokens,
    };
  } else {
    const [created] = await db
      .insert(generalConversations)
      .values({
        userId,
        messages: [],
        messageCount: 0,
        title: message.slice(0, 200),
        boardCode: boardCode ?? undefined,
        grade: grade ?? undefined,
      })
      .returning();

    conversation = { id: created.id, messages: [], totalTokens: created.totalTokens };
  }

  // Add user message
  conversation.messages.push({ role: "user", content: message, timestamp: new Date().toISOString() });

  // System prompt
  const boardContext = boardCode && grade ? `The student studies under the ${boardCode} board, Class ${grade}.` : "";

  const systemPrompt = `${topicContext ? `${topicContext}\n` : ""}You are Padvik AI, a friendly and knowledgeable educational assistant for Indian K-12 students. You help with:
- Explaining concepts from any subject (Math, Science, Social Studies, Languages, etc.)
- Solving problems step-by-step
- Answering doubts about homework and exams
- Providing study tips and exam preparation strategies
- Explaining diagrams, formulas, and theorems
- Helping with NCERT, CBSE, ICSE, and state board content

${boardContext}

Guidelines:
- Be concise but thorough. Use examples when helpful.
- For math/science: show step-by-step solutions with formulas.
- For social studies: provide context and key facts.
- Use simple language appropriate for school students.
- If asked about something harmful or inappropriate, politely redirect to educational topics.

At the end of your response, suggest 2-3 follow-up questions formatted as:
[[suggest: question text here]]`;

  // Resolve provider — auto-rotate or use specified
  let selectedProvider: { name: string; model: AIModel };
  const providerMap: Record<string, { name: string; model: AIModel }> = {
    claude: { name: "claude", model: AI_MODELS.PRIMARY },
    gemini: { name: "gemini", model: AI_MODELS.GEMINI_FLASH },
    openai: { name: "openai", model: AI_MODELS.FALLBACK },
    mistral: { name: "mistral", model: AI_MODELS.MISTRAL_LARGE },
  };

  if (!requestedProvider || requestedProvider === "auto") {
    selectedProvider = getNextProvider();
  } else {
    selectedProvider = providerMap[requestedProvider] ?? getNextProvider();
  }

  // Build message history (last 10 for context)
  const recentMessages = conversation.messages.slice(-10);
  const fullPrompt = recentMessages.map((m) => `${m.role === "user" ? "Student" : "AI"}: ${m.content}`).join("\n\n");

  try {
    const result = await aiChat(fullPrompt, {
      systemPrompt,
      model: selectedProvider.model,
      temperature: 0.4,
      maxTokens: 2048,
    });

    // Extract suggestions
    const suggestions: string[] = [];
    const cleanContent = result.content.replace(/\[\[suggest:\s*(.+?)\]\]/g, (_, s: string) => {
      suggestions.push(s.trim());
      return "";
    }).trim();

    // Add AI response with provider info and suggestions
    conversation.messages.push({
      role: "assistant",
      content: cleanContent,
      timestamp: new Date().toISOString(),
      provider: result.provider,
      model: result.model,
      suggestions,
    });

    // Update DB
    await db
      .update(generalConversations)
      .set({
        messages: conversation.messages,
        messageCount: conversation.messages.length,
        totalTokens: conversation.totalTokens + (result.inputTokens + result.outputTokens),
        aiProvider: result.provider,
        updatedAt: new Date(),
      })
      .where(eq(generalConversations.id, conversation.id));

    return NextResponse.json({
      success: true,
      data: {
        message: cleanContent,
        conversationId: conversation.id,
        suggestions,
        model: result.model,
        provider: result.provider,
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "AI request failed";
    return NextResponse.json({ success: false, error: { code: "AI_ERROR", message: errMsg } }, { status: 500 });
  }
}
