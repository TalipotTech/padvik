import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { creatorProfiles } from "@/db/schema/creators";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { checkCreator } from "@/lib/check-creator";

const registerSchema = z.object({
  displayName: z.string().min(2).max(255),
  bio: z.string().max(2000).optional(),
  institution: z.string().max(255).optional(),
  institutionType: z.enum(["school", "tuition", "independent", "publisher", "student"]).optional(),
  boards: z.array(z.string()).optional(),
  subjects: z.array(z.string()).optional(),
  classesFrom: z.number().min(1).max(12).optional(),
  classesTo: z.number().min(1).max(12).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/creators/register — Upgrade user to creator
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const creator = await checkCreator();
  if (!creator) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const userId = creator.userId;

  // Check if already a creator
  if (creator.isCreator) {
    return NextResponse.json(
      { success: false, error: { code: "ALREADY_CREATOR", message: "You are already registered as a creator" } },
      { status: 400 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { displayName, bio, institution, institutionType, boards: boardsList, subjects: subjectsList, classesFrom, classesTo } = parsed.data;

  // Transaction: update user + create profile
  const [profile] = await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isCreator: true, creatorTier: "free", updatedAt: new Date() })
      .where(eq(users.id, userId));

    return tx
      .insert(creatorProfiles)
      .values({
        userId,
        displayName,
        bio: bio ?? null,
        institution: institution ?? null,
        institutionType: institutionType ?? null,
        boards: boardsList ?? [],
        subjects: subjectsList ?? [],
        classesFrom: classesFrom ?? null,
        classesTo: classesTo ?? null,
      })
      .returning();
  });

  return NextResponse.json({ success: true, data: profile }, { status: 201 });
}
