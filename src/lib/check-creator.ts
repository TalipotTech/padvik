import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { eq } from "drizzle-orm";

/**
 * Check if the current session user is a creator.
 * Falls back to DB check when the JWT is stale (common right after registration).
 * Returns { isCreator, userId, session } or null if not authenticated.
 */
export async function checkCreator() {
  const session = await auth();
  if (!session?.user) return null;

  const userId = Number(session.user.id);
  if (isNaN(userId)) return null;

  let isCreator = (session.user as { isCreator?: boolean }).isCreator ?? false;

  // JWT may be stale after creator registration — check DB
  if (!isCreator) {
    const [dbUser] = await db
      .select({ isCreator: users.isCreator })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    isCreator = dbUser?.isCreator ?? false;
  }

  return { isCreator, userId, session };
}
