#!/usr/bin/env tsx
/**
 * Seed ICSE standards (Classes 9-12) so the ICSE scraper's
 * `insertParsedSyllabus` can find a matching standard row.
 *
 * CISCE publishes syllabi as per-subject PDFs that cover two grades
 * at once (ICSE → Gr9+10, ISC → Gr11+12). We create one standard per
 * grade with `stream = null` so the inserter's partial match works
 * regardless of whether the AI parser reports a stream value.
 *
 * Idempotent — uses `onConflictDoNothing()` against the unique
 * (board_id, grade, stream, academic_year) constraint.
 *
 * Usage:
 *   pnpm tsx scripts/seed-icse-standards.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { boards, standards } from "../src/db/schema/curriculum";

const ACADEMIC_YEAR = "2025-26";

async function main() {
  console.log("\n=== Seeding ICSE standards (Classes 9-12) ===\n");

  const [icse] = await db.select().from(boards).where(eq(boards.code, "ICSE")).limit(1);
  if (!icse) {
    console.error("ERROR: ICSE board not found. Run `pnpm tsx scripts/seed-boards.ts` first.");
    process.exit(1);
  }
  console.log(`ICSE board id: ${icse.id}`);

  let inserted = 0;
  let existed = 0;

  for (let grade = 9; grade <= 12; grade++) {
    const [row] = await db
      .insert(standards)
      .values({
        boardId: icse.id,
        grade,
        stream: null,
        academicYear: ACADEMIC_YEAR,
        metadata: {
          examName: grade <= 10 ? "ICSE" : "ISC",
          note: grade <= 10
            ? "Indian Certificate of Secondary Education (Classes 9-10)"
            : "Indian School Certificate (Classes 11-12)",
        },
      })
      .onConflictDoNothing()
      .returning({ id: standards.id, grade: standards.grade });

    if (row) {
      console.log(`   ✓ Class ${grade} (id: ${row.id}) — ${grade <= 10 ? "ICSE" : "ISC"}`);
      inserted++;
    } else {
      console.log(`   = Class ${grade} (already existed)`);
      existed++;
    }
  }

  console.log(`\nSummary: ${inserted} inserted, ${existed} already existed`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
