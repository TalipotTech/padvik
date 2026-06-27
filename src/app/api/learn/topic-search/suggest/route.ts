import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { searchTopics } from "@/lib/search/topic-search";

/**
 * GET /api/learn/topic-search/suggest?q=...&boardId=...&grade=...
 *
 * Lightweight autocomplete for the topic search box. Reuses the shared
 * searchTopics() query — and ONLY that. No scope guard, no history insert, no
 * demand signal, so it's safe to call on every keystroke (read-only).
 */

const querySchema = z.object({
  q: z.string().trim().min(2),
  boardId: z.number().int().positive().nullable().optional(),
  grade: z.number().int().min(1).max(12).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    q: sp.get("q") ?? "",
    boardId: sp.get("boardId") ? Number(sp.get("boardId")) : undefined,
    grade: sp.get("grade") ? Number(sp.get("grade")) : undefined,
  });

  // Too short / invalid → empty list (not an error; the box just shows nothing).
  if (!parsed.success) {
    return NextResponse.json({ success: true, data: { suggestions: [] } });
  }

  const { q, boardId, grade } = parsed.data;

  try {
    const hits = await searchTopics(q, { boardId, grade, limit: 8 });
    return NextResponse.json({
      success: true,
      data: {
        suggestions: hits.map((t) => ({
          topicId: t.topicId,
          title: t.title,
          chapterTitle: t.chapterTitle,
          subjectName: t.subjectName,
          grade: t.grade,
          boardCode: t.boardCode,
        })),
      },
    });
  } catch {
    return NextResponse.json({ success: true, data: { suggestions: [] } });
  }
}
