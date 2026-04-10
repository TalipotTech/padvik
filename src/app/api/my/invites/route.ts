import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { classrooms, classroomInvites } from "@/db/schema/classrooms";
import { eq, and, or, desc } from "drizzle-orm";

/**
 * GET /api/my/invites — Get pending classroom invites for the current student
 * Matches by email or phone from the user's profile
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }

  const userId = Number(session.user.id);

  // Get user's email and phone
  const [user] = await db
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return NextResponse.json({ success: true, data: [] });
  }

  // Find pending invites matching this user's email or phone
  const emailConditions = [];
  if (user.email) emailConditions.push(eq(classroomInvites.recipientEmail, user.email));
  if (user.phone) emailConditions.push(eq(classroomInvites.recipientPhone, user.phone));

  if (emailConditions.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const invites = await db
    .select({
      id: classroomInvites.id,
      inviteToken: classroomInvites.inviteToken,
      recipientName: classroomInvites.recipientName,
      channel: classroomInvites.channel,
      status: classroomInvites.status,
      createdAt: classroomInvites.createdAt,
      classroomId: classroomInvites.classroomId,
      classroomName: classrooms.name,
      creatorName: users.fullName,
      creatorAvatar: users.avatarUrl,
    })
    .from(classroomInvites)
    .innerJoin(classrooms, eq(classrooms.id, classroomInvites.classroomId))
    .innerJoin(users, eq(users.id, classroomInvites.creatorId))
    .where(and(
      or(...emailConditions),
      eq(classroomInvites.status, "sent") // only pending/sent invites
    ))
    .orderBy(desc(classroomInvites.createdAt));

  return NextResponse.json({ success: true, data: invites });
}
