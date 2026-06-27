import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { learningPathAssessments } from "@/db/schema/learning-path";
import { assessLearningPath } from "@/lib/learning-path/assess";

/**
 * GET /api/learn/path?boardId=&grade=&subjectId=&refresh=0|1
 *
 * Returns the latest cached self-assessment for (user, subject). Regenerates
 * (one AI call) only when the cached snapshot is older than
 * LEARNING_PATH_TTL_HOURS or refresh=1.
 */

const querySchema = z.object({
  boardId: z.number().int().positive(),
  grade: z.number().int().min(1).max(12),
  subjectId: z.number().int().positive().nullable().optional(),
  refresh: z.boolean().optional(),
});

function ttlHours(): number {
  const raw = Number(process.env.LEARNING_PATH_TTL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
}

async function getUserId(): Promise<number | null> {
  try {
    const s = await auth();
    const n = s?.user?.id ? Number(s.user.id) : NaN;
    if (Number.isFinite(n)) return n;
  } catch {
    /* auth failed */
  }
  // Non-numeric (e.g. demo login) or no session → dev fallback.
  if (process.env.NODE_ENV === "development") return 1;
  return null;
}

export async function GET(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    boardId: sp.get("boardId") ? Number(sp.get("boardId")) : undefined,
    grade: sp.get("grade") ? Number(sp.get("grade")) : undefined,
    subjectId: sp.get("subjectId") ? Number(sp.get("subjectId")) : undefined,
    refresh: sp.get("refresh") === "1",
  });

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { boardId, grade, subjectId, refresh } = parsed.data;
  const subj = subjectId ?? null;

  // 1. Serve a fresh-enough cached snapshot unless refresh requested.
  if (!refresh) {
    const cached = await db.execute<{
      summary: string | null;
      strengths_json: unknown;
      improvements_json: unknown;
      overall_score: string | null;
      signals_json: unknown;
      generation_model: string | null;
      created_at: string;
    }>(sql`
      SELECT summary, strengths_json, improvements_json, overall_score, signals_json,
             generation_model, created_at
      FROM learning_path_assessments
      WHERE user_id = ${userId}
        AND ${subj === null ? sql`subject_id IS NULL` : sql`subject_id = ${subj}`}
        AND created_at > NOW() - (${ttlHours()} * INTERVAL '1 hour')
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = [...cached][0];
    if (row) {
      return NextResponse.json({
        success: true,
        data: {
          cached: true,
          summary: row.summary,
          strengths: row.strengths_json ?? [],
          improvements: row.improvements_json ?? [],
          overallScore: row.overall_score != null ? Number(row.overall_score) : 0,
          signals: row.signals_json ?? {},
          generatedAt: row.created_at,
        },
      });
    }
  }

  // 2. Generate, persist a snapshot, return it.
  const assessment = await assessLearningPath({ userId, boardId, grade, subjectId: subj ?? undefined });

  await db
    .insert(learningPathAssessments)
    .values({
      userId,
      boardId,
      grade,
      subjectId: subj,
      signalsJson: assessment.signals,
      summary: assessment.summary,
      strengthsJson: assessment.strengths,
      improvementsJson: assessment.improvements,
      overallScore: assessment.overallScore.toFixed(2),
      generationModel: assessment.model,
      generationCost: assessment.costUsd.toFixed(4),
    })
    .catch(() => {});

  return NextResponse.json({
    success: true,
    data: {
      cached: false,
      summary: assessment.summary,
      strengths: assessment.strengths,
      improvements: assessment.improvements,
      overallScore: assessment.overallScore,
      signals: assessment.signals,
      generatedAt: new Date().toISOString(),
    },
  });
}
