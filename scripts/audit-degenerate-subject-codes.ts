#!/usr/bin/env tsx
/**
 * Audit for subject codes that look like artifacts instead of proper letter codes:
 *   - purely numeric codes ("869", "68")
 *   - punctuation stubs ("-", "_")
 *   - N/A-like placeholders
 * Reports only; no writes. Use `fix-numeric-subject-codes.ts` to remediate.
 *
 * Usage:
 *   pnpm tsx scripts/audit-degenerate-subject-codes.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db";

(async () => {
  const r = await db.execute(sql`
    SELECT sb.id, sb.code, sb.name, st.grade, b.code AS board_code
    FROM subjects sb
    JOIN standards st ON st.id = sb.standard_id
    JOIN boards b ON b.id = st.board_id
    WHERE sb.code ~ '^[0-9]+$'
       OR sb.code ~ '^[-_[:space:]]+$'
       OR sb.code ~* '^n/?a$'
    ORDER BY b.code, st.grade, sb.name
  `);
  const rows = (Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows ?? []) as Array<{
    id: number; code: string; name: string; grade: number; board_code: string;
  }>;

  console.log("\n=== Degenerate subject codes across all boards ===");
  if (rows.length === 0) {
    console.log("  (none — catalog is clean)");
  } else {
    for (const row of rows) {
      console.log(`  [${row.board_code}] Gr${row.grade} id=${row.id} code="${row.code}" name="${row.name}"`);
    }
    console.log(`\n  Total: ${rows.length} row(s)`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
