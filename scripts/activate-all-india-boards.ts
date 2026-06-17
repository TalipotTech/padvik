/**
 * Flip every seeded Indian board's `is_active` flag to true so the entire
 * board list surfaces in every admin dropdown (Curriculum, Coverage, Scrape
 * Jobs). Safe to re-run — uses an UPDATE that only touches rows already set
 * to false.
 *
 * Why: Padvik targets CBSE, ICSE, Kerala SCERT, plus five major state boards
 * (Karnataka, Tamil Nadu, Maharashtra, Andhra Pradesh, Telangana). The seed
 * script marks only the Phase 1 boards active; this flips the rest so the UI
 * treats them as first-class citizens even while their syllabus ingestion is
 * in progress.
 *
 * Run:  pnpm tsx scripts/activate-all-india-boards.ts
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { boards } from "@/db/schema/curriculum";

const PHASE_2_CODES = [
  "KA_KSEAB",
  "TN_DGE",
  "MH_MSBSHSE",
  "AP_BSEAP",
  "TS_BSETS",
];

async function main() {
  const before = await db.execute(sql`
    SELECT code, name, is_active FROM boards ORDER BY code
  `);
  const beforeRows =
    (Array.isArray(before) ? before : (before as { rows?: unknown[] }).rows ?? []) as Array<{
      code: string;
      name: string;
      is_active: boolean;
    }>;
  console.log("Before:");
  console.table(beforeRows);

  const touched = await db
    .update(boards)
    .set({ isActive: true })
    .where(and(inArray(boards.code, PHASE_2_CODES), eq(boards.isActive, false)))
    .returning({ code: boards.code, name: boards.name });

  if (touched.length === 0) {
    console.log("\nNothing to activate — all Phase 2 boards already active.");
  } else {
    console.log(`\nActivated ${touched.length} board(s):`);
    for (const r of touched) console.log(`  - ${r.code}  ${r.name}`);
  }

  const after = await db.execute(sql`
    SELECT code, name, is_active FROM boards ORDER BY code
  `);
  const afterRows =
    (Array.isArray(after) ? after : (after as { rows?: unknown[] }).rows ?? []) as Array<{
      code: string;
      name: string;
      is_active: boolean;
    }>;
  console.log("\nAfter:");
  console.table(afterRows);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
