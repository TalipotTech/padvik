#!/usr/bin/env tsx
/**
 * Remove stale ICSE/ISC subject rows that landed from non-syllabus PDFs
 * (TOCs, appendices, prescribed-textbook lists) before the URL filter
 * caught them. Safe to re-run — only targets rows with known-bad codes.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-stale-icse-subjects.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db";

const STALE_CODES = ["ISC12SYL"]; // ISC Class 12 Syllabuses Overview (TOC)

async function main() {
  for (const code of STALE_CODES) {
    const r = await db.execute(
      sql`DELETE FROM subjects WHERE code = ${code} RETURNING id, name, code`
    );
    const rows = (Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows ?? []) as Array<{
      id: number;
      name: string;
      code: string;
    }>;
    if (rows.length === 0) {
      console.log(`  ${code}: no rows matched (already clean)`);
    } else {
      for (const row of rows) {
        console.log(`  deleted: id=${row.id} code=${row.code} name="${row.name}"`);
      }
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
