import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms, classroomInvites } from "@/db/schema/classrooms";
import { users } from "@/db/schema/auth";
import { boards, standards, subjects } from "@/db/schema/curriculum";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { randomBytes } from "crypto";
import { sendInvite, getInviteLink, type MessageChannel } from "@/lib/messaging";

const recipientSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().optional(),
  phone: z.string().min(8).max(20).optional(),
  channels: z.array(z.enum(["email", "sms", "whatsapp"])).min(1),
});

const sendSchema = z.object({
  recipients: z.array(recipientSchema).min(1).max(50),
});

// ---------------------------------------------------------------------------
// POST /api/classrooms/[id]/invite — Send invite(s) to students
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const { id } = await params;
  const classroomId = Number(id);
  const userId = Number(session.user.id);

  // Verify teacher owns this classroom
  const [classroom] = await db
    .select({
      id: classrooms.id,
      teacherId: classrooms.teacherId,
      name: classrooms.name,
      joinCode: classrooms.joinCode,
      boardId: classrooms.boardId,
      standardId: classrooms.standardId,
      subjectId: classrooms.subjectId,
    })
    .from(classrooms)
    .where(eq(classrooms.id, classroomId))
    .limit(1);

  if (!classroom || classroom.teacherId !== userId) {
    return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Not your classroom" } }, { status: 403 });
  }

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  // Get creator name
  const [creator] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
  const creatorName = creator?.fullName || "A teacher";

  // Get curriculum info
  let boardName: string | undefined;
  let grade: number | undefined;
  let subjectName: string | undefined;
  if (classroom.boardId) {
    const [b] = await db.select({ name: boards.name }).from(boards).where(eq(boards.id, classroom.boardId)).limit(1);
    boardName = b?.name;
  }
  if (classroom.standardId) {
    const [s] = await db.select({ grade: standards.grade }).from(standards).where(eq(standards.id, classroom.standardId)).limit(1);
    grade = s?.grade;
  }
  if (classroom.subjectId) {
    const [s] = await db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, classroom.subjectId)).limit(1);
    subjectName = s?.name;
  }

  const results: Array<{ recipient: string; channel: string; status: string; error?: string }> = [];
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  for (const recipient of parsed.data.recipients) {
    for (const channel of recipient.channels) {
      // Validate channel has the required contact info
      if (channel === "email" && !recipient.email) {
        results.push({ recipient: recipient.name, channel, status: "failed", error: "No email provided" });
        continue;
      }
      if ((channel === "sms" || channel === "whatsapp") && !recipient.phone) {
        results.push({ recipient: recipient.name, channel, status: "failed", error: "No phone provided" });
        continue;
      }

      // Generate unique token
      const inviteToken = randomBytes(16).toString("hex");
      const inviteLink = getInviteLink(inviteToken);

      // Create invite record
      const [invite] = await db.insert(classroomInvites).values({
        classroomId,
        creatorId: userId,
        recipientName: recipient.name,
        recipientEmail: recipient.email ?? null,
        recipientPhone: recipient.phone ?? null,
        channel,
        inviteToken,
        status: "pending",
        expiresAt,
      }).returning();

      // Send via messaging service
      const sendResult = await sendInvite(channel as MessageChannel, {
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        recipientPhone: recipient.phone,
        creatorName,
        classroomName: classroom.name,
        boardName,
        grade,
        subjectName,
        joinCode: classroom.joinCode,
        inviteToken,
        inviteLink,
      });

      // Update invite status
      await db.update(classroomInvites).set({
        status: sendResult.success ? "sent" : "failed",
        sentAt: sendResult.success ? new Date() : null,
        metadata: { messageId: sendResult.messageId, error: sendResult.error },
      }).where(eq(classroomInvites.id, invite.id));

      results.push({
        recipient: recipient.name,
        channel,
        status: sendResult.success ? "sent" : "failed",
        error: sendResult.error,
      });
    }
  }

  const sentCount = results.filter(r => r.status === "sent").length;
  const failedCount = results.filter(r => r.status === "failed").length;

  return NextResponse.json({
    success: true,
    data: {
      results,
      summary: { sent: sentCount, failed: failedCount, total: results.length },
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/classrooms/[id]/invite — List sent invites (creator only)
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const { id } = await params;
  const classroomId = Number(id);
  const userId = Number(session.user.id);

  // Verify teacher
  const [classroom] = await db.select({ teacherId: classrooms.teacherId }).from(classrooms).where(eq(classrooms.id, classroomId)).limit(1);
  if (!classroom || classroom.teacherId !== userId) {
    return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Not your classroom" } }, { status: 403 });
  }

  const invites = await db
    .select()
    .from(classroomInvites)
    .where(eq(classroomInvites.classroomId, classroomId))
    .orderBy(desc(classroomInvites.createdAt));

  return NextResponse.json({ success: true, data: invites });
}
