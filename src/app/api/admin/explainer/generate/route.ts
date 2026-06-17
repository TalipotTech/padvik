/**
 * POST /api/admin/explainer/generate
 *
 * Trigger a synchronous bulk generation of explainer decks for topics that
 * don't yet have one. Admin-only. Capped server-side so it can't blow the
 * AI budget accidentally.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { bulkGenerateDecks } from "@/lib/explainer/bulk-generate";

const BodySchema = z.object({
  boardId: z.number().int().positive().optional(),
  subjectId: z.number().int().positive().optional(),
  standardId: z.number().int().positive().optional(),
  grade: z.number().int().min(1).max(12).optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  language: z.string().max(10).optional(),
  limit: z.number().int().positive().max(50).optional(),
  rateLimitMs: z.number().int().min(1000).max(30000).optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Admin required" } },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "BAD_BODY", message: parsed.error.issues[0]?.message ?? "invalid" },
      },
      { status: 400 }
    );
  }

  const result = await bulkGenerateDecks({
    ...parsed.data,
    // Server-enforced upper bound — even if body asks for more
    limit: Math.min(parsed.data.limit ?? 10, 50),
  });

  return NextResponse.json({
    success: true,
    data: {
      generated: result.generated,
      failed: result.failed,
      totalCostUsd: Number(result.totalCostUsd.toFixed(4)),
      failures: result.failures.slice(0, 20),
    },
  });
}
