/**
 * Test-harness helper for the Adaptive Visual Explainer.
 *
 * 1. Ensures a real student account exists (teststudent@gmail.com) with a
 *    NUMERIC db id — required because demo-* sessions have non-numeric ids.
 * 2. Lists CBSE Class 10 topics you can open at /topics/<id>/learn, showing
 *    which levels already have a pre-generated deck.
 *
 * Run:  pnpm tsx scripts/setup-explainer-test.ts
 *       pnpm tsx scripts/setup-explainer-test.ts --subject "Mathematics"
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { users } from "../src/db/schema/auth";

const TEST_EMAIL = "teststudent@gmail.com";
const TEST_PASSWORD = "Test1234"; // 8+ chars to satisfy login validation
const TEST_NAME = "Test Student";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client);

// Optional --subject "Mathematics" filter
const subjectArgIdx = process.argv.indexOf("--subject");
const subjectFilter =
  subjectArgIdx !== -1 ? process.argv[subjectArgIdx + 1] : undefined;

async function ensureTestStudent(): Promise<number> {
  const [existing] = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.email, TEST_EMAIL))
    .limit(1);

  if (existing) {
    // Make sure the account is usable (active) and reset the password so the
    // documented credentials always work.
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
    await db
      .update(users)
      .set({ passwordHash, isActive: true, role: "student" })
      .where(eq(users.id, existing.id));
    console.log(`✓ Test student already exists (id=${existing.id}) — password reset.`);
    return existing.id;
  }

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  const [created] = await db
    .insert(users)
    .values({
      fullName: TEST_NAME,
      email: TEST_EMAIL,
      passwordHash,
      role: "student",
      isActive: true,
      isVerified: true,
    })
    .returning({ id: users.id });

  console.log(`✓ Created test student (id=${created.id}).`);
  return created.id;
}

async function listCbseClass10Topics() {
  // boards(code=CBSE) → standards(grade=10) → subjects → chapters → topics,
  // with deck level coverage aggregated per topic.
  const rows = await db.execute<{
    topic_id: number;
    topic_title: string;
    subject_name: string;
    chapter_title: string;
    deck_levels: string | null;
  }>(sql`
    SELECT
      t.id            AS topic_id,
      t.title         AS topic_title,
      s.name          AS subject_name,
      c.title         AS chapter_title,
      (
        SELECT string_agg(DISTINCT d.level::text, ',' ORDER BY d.level::text)
        FROM topic_explainer_decks d
        WHERE d.topic_id = t.id AND d.language = 'en'
      )               AS deck_levels
    FROM topics t
    JOIN chapters c   ON c.id = t.chapter_id
    JOIN subjects s   ON s.id = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b     ON b.id = st.board_id
    WHERE b.code = 'CBSE'
      AND st.grade = 10
      ${subjectFilter ? sql`AND s.name ILIKE ${"%" + subjectFilter + "%"}` : sql``}
    ORDER BY s.name, c.sort_order, t.sort_order
    LIMIT 40
  `);

  if (rows.length === 0) {
    console.log("\n⚠ No CBSE Class 10 topics found in the database.");
    console.log("  Seed curriculum first (pnpm db:seed / db:seed:curriculum or your scraper),");
    console.log("  then re-run this script.");
    return;
  }

  console.log(`\nCBSE Class 10 topics${subjectFilter ? ` (subject ~ "${subjectFilter}")` : ""}:`);
  console.log("  deck = levels already pre-generated (1=Foundation 2=Standard 3=Advanced).");
  console.log("  No deck? The page generates Level 2 on the fly on first open.\n");

  let lastSubject = "";
  for (const r of rows) {
    if (r.subject_name !== lastSubject) {
      console.log(`\n── ${r.subject_name} ─────────────────────────────`);
      lastSubject = r.subject_name;
    }
    const deck = r.deck_levels ? `deck[${r.deck_levels}]` : "no deck";
    console.log(
      `  /topics/${r.topic_id}/learn  ${deck.padEnd(10)}  ${r.topic_title}`
    );
  }

  const firstWithDeck = rows.find((r) => r.deck_levels);
  const suggested = firstWithDeck ?? rows[0];
  console.log("\n──────────────────────────────────────────────");
  console.log(`Suggested first test:  http://localhost:3000/topics/${suggested.topic_id}/learn`);
  console.log("──────────────────────────────────────────────");
}

async function main() {
  console.log("Setting up explainer test harness...\n");
  await ensureTestStudent();
  console.log(`  Login:    ${TEST_EMAIL}`);
  console.log(`  Password: ${TEST_PASSWORD}`);
  await listCbseClass10Topics();
}

main()
  .then(() => client.end())
  .catch(async (err) => {
    console.error("Setup failed:", err);
    await client.end();
    process.exit(1);
  });
