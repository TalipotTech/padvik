import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { topicConversations } from "@/db/schema/learn";
import { topics, chapters, subjects } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { aiChat, AI_MODELS, type AIModel } from "@/lib/ai/provider";

/**
 * GET /api/learn/chat?topicId=14 — Get conversation history for a topic
 * POST /api/learn/chat — Send a message to the AI tutor
 */

export async function GET(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch { /* auth failed */ }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }
  const topicId = request.nextUrl.searchParams.get("topicId");

  if (!topicId) {
    return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "topicId required" } }, { status: 400 });
  }

  const conversations = await db
    .select()
    .from(topicConversations)
    .where(and(eq(topicConversations.userId, userId), eq(topicConversations.topicId, parseInt(topicId, 10))))
    .orderBy(desc(topicConversations.updatedAt))
    .limit(10);

  return NextResponse.json({ success: true, data: conversations });
}

const chatSchema = z.object({
  topicId: z.number().int(),
  message: z.string().min(1).max(5000),
  /** Continue an existing conversation */
  conversationId: z.number().int().optional(),
  /** AI provider override: claude/gemini/openai/mistral/sarvam */
  provider: z.enum(["claude", "gemini", "openai", "mistral", "sarvam"]).optional(),
  /** Selected text context for "Ask AI" from text selection */
  selectedText: z.string().optional(),
});

export async function POST(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch { /* auth failed */ }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const { topicId, message, conversationId, provider: requestedProvider, selectedText } = parsed.data;

  // Get topic context for the AI
  const [topic] = await db
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

  if (!topic) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Topic not found" } }, { status: 404 });
  }

  // Get content context (first 15KB of published content for this topic)
  const topicContent = await db
    .select({ body: contentItems.body })
    .from(contentItems)
    .where(and(eq(contentItems.topicId, topicId), eq(contentItems.isPublished, true)))
    .limit(1);

  const contentContext = topicContent[0]?.body?.slice(0, 15000) ?? "";

  // Get or create conversation
  let conversation: {
    id: number;
    messages: Array<{ role: string; content: string; timestamp: string }>;
    totalTokens: number;
  };

  if (conversationId) {
    const [existing] = await db
      .select()
      .from(topicConversations)
      .where(and(eq(topicConversations.id, conversationId), eq(topicConversations.userId, userId)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } }, { status: 404 });
    }

    conversation = {
      id: existing.id,
      messages: (existing.messages as Array<{ role: string; content: string; timestamp: string }>) ?? [],
      totalTokens: existing.totalTokens,
    };
  } else {
    const [created] = await db
      .insert(topicConversations)
      .values({
        userId,
        topicId,
        messages: [],
        messageCount: 0,
        keyword: message.slice(0, 500),
      })
      .returning();

    conversation = { id: created.id, messages: [], totalTokens: created.totalTokens };
  }

  // Add user message
  const userMsg = { role: "user" as const, content: message, timestamp: new Date().toISOString() };
  conversation.messages.push(userMsg);

  // Build AI context — last 10 messages for continuity
  const recentMessages = conversation.messages.slice(-10);

  const systemPrompt = `You are a helpful AI tutor for Indian school students. You are helping a student study the following topic:

Subject: ${topic.subjectName}
Chapter: ${topic.chapterTitle}
Topic: ${topic.title}
${topic.description ? `Description: ${topic.description}` : ""}

${contentContext ? `Here is the study material for context:\n${contentContext}\n` : ""}

Instructions:
- Answer questions clearly and concisely
- Use examples when explaining concepts
- Reference the study material when relevant
- Use LaTeX for math: $inline$ and $$block$$
- If the student seems confused, break down the concept step by step
- Be encouraging and supportive
- At the end of your response, suggest 2-3 follow-up questions the student might ask, formatted as: [[suggest: question text]]`;

  // Build the conversation for the AI
  const aiMessages = recentMessages.map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`).join("\n\n");

  // If selected text was provided, add it as context
  const selectionContext = selectedText ? `\n\n[The student has selected this text from the study material: "${selectedText.slice(0, 500)}"]\n` : "";
  const aiPrompt = `${aiMessages}${selectionContext}\n\nTutor:`;

  // Map provider name to model
  const providerModelMap: Record<string, string> = {
    claude: AI_MODELS.PRIMARY,
    gemini: AI_MODELS.GEMINI_FLASH,
    openai: AI_MODELS.FALLBACK,
    mistral: AI_MODELS.MISTRAL_SMALL,
  };

  try {
    let aiResult: { content: string; model: string; provider: string; inputTokens: number; outputTokens: number; costUsd: number };

    if (requestedProvider === "sarvam") {
      // Sarvam AI — call directly via their OpenAI-compatible API
      const sarvamKey = process.env.SARVAM_API_KEY;
      if (!sarvamKey) throw new Error("SARVAM_API_KEY not configured");

      const sarvamRes = await fetch("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sarvamKey}` },
        body: JSON.stringify({
          model: "sarvam-m",
          messages: [
            { role: "system", content: systemPrompt },
            ...recentMessages.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: message + selectionContext },
          ],
          temperature: 0.4,
          max_tokens: 2048,
        }),
      });

      if (!sarvamRes.ok) {
        const errText = await sarvamRes.text().catch(() => "");
        throw new Error(`Sarvam API error ${sarvamRes.status}: ${errText.slice(0, 200)}`);
      }

      const sarvamData = await sarvamRes.json();
      const choice = sarvamData.choices?.[0];
      aiResult = {
        content: choice?.message?.content ?? "",
        model: "sarvam-m",
        provider: "sarvam",
        inputTokens: sarvamData.usage?.prompt_tokens ?? 0,
        outputTokens: sarvamData.usage?.completion_tokens ?? 0,
        costUsd: 0, // Sarvam pricing TBD
      };
    } else {
      // Standard providers via aiChat
      const model = (requestedProvider ? (providerModelMap[requestedProvider] ?? AI_MODELS.PRIMARY) : AI_MODELS.PRIMARY) as AIModel;
      aiResult = await aiChat(aiPrompt, {
        model,
        systemPrompt,
        temperature: 0.4,
        maxTokens: 2048,
      });
    }

    // Parse out suggestions from [[suggest: ...]] markers
    const suggestionRegex = /\[\[suggest:\s*(.+?)\]\]/g;
    const suggestions: string[] = [];
    let match;
    while ((match = suggestionRegex.exec(aiResult.content)) !== null) {
      suggestions.push(match[1].trim());
    }
    const cleanContent = aiResult.content.replace(suggestionRegex, "").trim();

    const assistantMsg = { role: "assistant" as const, content: cleanContent, timestamp: new Date().toISOString(), suggestions };
    conversation.messages.push(assistantMsg);

    // Update conversation in DB
    await db
      .update(topicConversations)
      .set({
        messages: conversation.messages,
        messageCount: conversation.messages.length,
        totalTokens: conversation.totalTokens + aiResult.inputTokens + aiResult.outputTokens,
        aiProvider: aiResult.provider,
        updatedAt: new Date(),
      })
      .where(eq(topicConversations.id, conversation.id));

    return NextResponse.json({
      success: true,
      data: {
        conversationId: conversation.id,
        message: cleanContent,
        suggestions,
        model: aiResult.model,
        tokens: aiResult.inputTokens + aiResult.outputTokens,
      },
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: { code: "AI_ERROR", message: err instanceof Error ? err.message : "AI call failed" },
    }, { status: 500 });
  }
}
