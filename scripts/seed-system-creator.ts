import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { users } from "../src/db/schema/auth";
import { creatorProfiles } from "../src/db/schema/creators";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client);

const SYSTEM_EMAIL = "content@padvik.com";

// ---------------------------------------------------------------------------
// Seeds the "Padvik Official" system user that owns AI-generated content.
// Idempotent — safe to re-run.
// ---------------------------------------------------------------------------
async function seed() {
  console.log("=== Padvik System Creator Seed ===\n");

  // ---- 1. Check for existing user ----
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, SYSTEM_EMAIL))
    .limit(1);

  let userId: number;

  if (existing) {
    userId = existing.id;
    console.log(`User '${SYSTEM_EMAIL}' already exists (id: ${userId}). Skipping user insert.`);
  } else {
    // ---- 2. Insert system user ----
    const [created] = await db
      .insert(users)
      .values({
        fullName: "Padvik Official",
        email: SYSTEM_EMAIL,
        isCreator: true,
        creatorTier: "pro",
        isVerified: true,
        emailVerified: true,
        creatorVerified: true,
      })
      .returning({ id: users.id });

    userId = created.id;
    console.log(`Created system user '${SYSTEM_EMAIL}' (id: ${userId}).`);
  }

  // ---- 3. Insert creator profile (if missing) ----
  const [existingProfile] = await db
    .select({ id: creatorProfiles.id })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId))
    .limit(1);

  if (existingProfile) {
    await db
      .update(creatorProfiles)
      .set({ creatorTier: "pro", verificationStatus: "verified" })
      .where(eq(creatorProfiles.id, existingProfile.id));
    console.log(`Creator profile already exists (id: ${existingProfile.id}). Ensured tier=pro.`);
  } else {
    const [profile] = await db
      .insert(creatorProfiles)
      .values({
        userId,
        displayName: "Padvik Official",
        bio: "AI-crafted study materials for your board and syllabus",
        institutionType: "publisher",
        verificationStatus: "verified",
        creatorTier: "pro",
        isFeatured: true,
      })
      .returning({ id: creatorProfiles.id });

    console.log(`Created creator profile (id: ${profile.id}).`);
  }

  // ---- 4. Print the user id for PADVIK_SYSTEM_CREATOR_ID ----
  console.log("\n=== Done ===");
  console.log(`PADVIK_SYSTEM_CREATOR_ID=${userId}`);
  console.log(`\nSet this in your .env.local: PADVIK_SYSTEM_CREATOR_ID=${userId}`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
