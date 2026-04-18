#!/usr/bin/env tsx
/**
 * Some AI-parsed ICSE/ISC syllabi emitted the ISC paper number (e.g. 869, 879)
 * as the subject code instead of a proper letter code. Rename them to
 * conventional uppercase letter codes so the catalog is consistent.
 *
 * Idempotent: skips if the new code already exists for the same (standard_id).
 *
 * Usage:
 *   pnpm tsx scripts/fix-numeric-subject-codes.ts --dry-run
 *   pnpm tsx scripts/fix-numeric-subject-codes.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db";

/** Known fixes — map from (current code, expected name-prefix) → new code. */
const FIXES: Array<{ oldCode: string; namePrefix: string; newCode: string }> = [
  { oldCode: "68", namePrefix: "Home Science", newCode: "HOMESCI" },
  { oldCode: "869", namePrefix: "Geometrical and Mechanical Drawing", newCode: "GMD" },
  { oldCode: "879", namePrefix: "Mass Media", newCode: "MMC" },
  { oldCode: "884", namePrefix: "Robotics", newCode: "ROBOTICS" },
];

function parseArgs(argv: string[]) {
  return { dryRun: argv.includes("--dry-run") };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n=== Fix numeric ICSE/ISC subject codes (${args.dryRun ? "DRY RUN" : "LIVE"}) ===\n`);

  for (const fix of FIXES) {
    // Find candidate rows
    const r = await db.execute(sql`
      SELECT sb.id, sb.name, sb.code, sb.standard_id, st.grade
      FROM subjects sb
      JOIN standards st ON st.id = sb.standard_id
      JOIN boards b ON b.id = st.board_id
      WHERE b.code = 'ICSE' AND sb.code = ${fix.oldCode}
    `);
    const rows = (Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows ?? []) as Array<{
      id: number; name: string; code: string; standard_id: number; grade: number;
    }>;
    if (rows.length === 0) {
      console.log(`  [${fix.oldCode}] no match — skip`);
      continue;
    }

    for (const row of rows) {
      if (!row.name.startsWith(fix.namePrefix)) {
        console.log(`  [${fix.oldCode}] unexpected name "${row.name}" (expected "${fix.namePrefix}...") — skip for safety`);
        continue;
      }
      // Check collision at same standard
      const collide = await db.execute(sql`
        SELECT id FROM subjects
        WHERE standard_id = ${row.standard_id} AND code = ${fix.newCode}
      `);
      const collRows = (Array.isArray(collide) ? collide : (collide as { rows?: unknown[] }).rows ?? []) as Array<{ id: number }>;
      if (collRows.length > 0) {
        console.log(`  [${fix.oldCode}→${fix.newCode}] collision at standard_id=${row.standard_id} (existing id=${collRows[0].id}) — skip`);
        continue;
      }

      console.log(`  ${args.dryRun ? "WOULD UPDATE" : "UPDATE"}: id=${row.id} grade=${row.grade} name="${row.name}" code: "${row.code}" → "${fix.newCode}"`);
      if (!args.dryRun) {
        await db.execute(sql`UPDATE subjects SET code = ${fix.newCode} WHERE id = ${row.id}`);
      }
    }
  }

  process.exit(0);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
