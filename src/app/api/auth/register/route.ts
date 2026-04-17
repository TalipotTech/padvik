import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod/v4";

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["student", "teacher", "parent"]),
});

// ---------------------------------------------------------------------------
// POST /api/auth/register — Create a new user account
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
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

  const { name, email, password, role } = parsed.data;

  // Check if email already exists
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    return NextResponse.json(
      { success: false, error: { code: "EMAIL_EXISTS", message: "An account with this email already exists" } },
      { status: 409 }
    );
  }

  // Hash password and create user
  const passwordHash = await bcrypt.hash(password, 12);
  const [newUser] = await db
    .insert(users)
    .values({
      fullName: name,
      email,
      passwordHash,
      role,
      isActive: true,
      isVerified: false,
    })
    .returning({ id: users.id, role: users.role });

  return NextResponse.json(
    { success: true, data: { id: newUser.id, role: newUser.role } },
    { status: 201 }
  );
}
