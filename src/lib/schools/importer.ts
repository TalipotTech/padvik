/**
 * Core school import logic — dedup, normalize, batch insert/update.
 */

import { db } from "@/db";
import { schools } from "@/db/schema/schools";
import { boards } from "@/db/schema/curriculum";
import { eq, or, and, ilike, sql } from "drizzle-orm";
import type { RawSchoolRecord, ImportResult, SchoolSource } from "./types";

// Board code → DB board ID cache
let boardIdCache: Map<string, number> | null = null;
async function getBoardIdMap(): Promise<Map<string, number>> {
  if (boardIdCache) return boardIdCache;
  const allBoards = await db.select({ id: boards.id, code: boards.code }).from(boards);
  boardIdCache = new Map(allBoards.map(b => [b.code.toUpperCase(), b.id]));
  return boardIdCache;
}

/** Normalize management type strings to standard values */
function normalizeManagement(raw?: string): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase().trim();
  if (lower.includes("kendriya") || lower.includes("kvs")) return "kvs";
  if (lower.includes("navodaya") || lower.includes("jnv")) return "jnv";
  if (lower.includes("central govt") || lower.includes("central government")) return "central_govt";
  if (lower.includes("private unaided") || lower.includes("pvt unaided") || lower.includes("un-aided") || lower === "private") return "private";
  if (lower.includes("aided") || lower.includes("govt. aided") || lower.includes("pvt aided")) return "aided";
  if (lower.includes("govt") || lower.includes("government")) return "government";
  return raw.toLowerCase().replace(/[^a-z_]/g, "_").substring(0, 30);
}

/** Derive school category from class range */
function deriveCategory(from?: number, to?: number): string | undefined {
  if (!to) return undefined;
  if (to <= 5) return "primary";
  if (to <= 8) return "upper_primary";
  if (to <= 10) return "secondary";
  return "sr_secondary";
}

/** Normalize to title case: "KERALA" → "Kerala", "andhra pradesh" → "Andhra Pradesh" */
function titleCase(str?: string): string | undefined {
  if (!str) return undefined;
  return str.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

/** Generate URL-safe slug */
function slugify(name: string, district?: string, state?: string): string {
  const parts = [name, district, state].filter(Boolean).join("-");
  return parts.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 500);
}

/**
 * Import an array of school records. Handles dedup, normalization, and batch insert.
 */
export async function importSchools(
  records: RawSchoolRecord[],
  onProgress?: (msg: string) => void
): Promise<ImportResult> {
  const start = Date.now();
  const result: ImportResult = {
    source: records[0]?.source || "manual",
    totalRecords: records.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    durationMs: 0,
  };

  if (records.length === 0) {
    result.durationMs = Date.now() - start;
    return result;
  }

  const boardMap = await getBoardIdMap();
  const BATCH_SIZE = 500;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    for (const record of batch) {
      try {
        const boardId = record.boardCode ? boardMap.get(record.boardCode.toUpperCase()) ?? null : null;
        const mgmt = normalizeManagement(record.managementType);
        const category = record.schoolCategory || deriveCategory(record.classesFrom, record.classesTo);
        const slug = slugify(record.name, record.district, record.state);

        // Dedup check: by external code first, then name+district+state
        let existing: { id: number } | undefined;

        if (record.udiseCode) {
          [existing] = await db.select({ id: schools.id }).from(schools).where(eq(schools.udiseCode, record.udiseCode)).limit(1);
        }
        if (!existing && record.cbseAffiliationNo) {
          [existing] = await db.select({ id: schools.id }).from(schools).where(eq(schools.cbseAffiliationNo, record.cbseAffiliationNo)).limit(1);
        }
        if (!existing && record.icseCode) {
          [existing] = await db.select({ id: schools.id }).from(schools).where(eq(schools.icseCode, record.icseCode)).limit(1);
        }
        if (!existing && record.district && record.state) {
          [existing] = await db.select({ id: schools.id }).from(schools)
            .where(and(
              ilike(schools.name, record.name),
              ilike(schools.district, record.district),
              ilike(schools.state, record.state)
            )).limit(1);
        }

        const values = {
          name: record.name,
          slug,
          udiseCode: record.udiseCode ?? null,
          cbseAffiliationNo: record.cbseAffiliationNo ?? null,
          icseCode: record.icseCode ?? null,
          stateBoardCode: record.stateBoardCode ?? null,
          boardId,
          boardCode: record.boardCode ?? null,
          address: record.address ?? null,
          city: titleCase(record.city) ?? null,
          district: titleCase(record.district) ?? null,
          state: titleCase(record.state) ?? null,
          pincode: record.pincode ?? null,
          latitude: record.latitude ? String(record.latitude) : null,
          longitude: record.longitude ? String(record.longitude) : null,
          managementType: mgmt ?? null,
          schoolCategory: category ?? null,
          medium: record.medium ?? [],
          classesFrom: record.classesFrom ?? null,
          classesTo: record.classesTo ?? null,
          genderType: record.genderType ?? null,
          isResidential: record.isResidential ?? false,
          phone: record.phone ?? null,
          email: record.email ?? null,
          website: record.website ?? null,
          principalName: record.principalName ?? null,
          studentCount: record.studentCount ?? null,
          teacherCount: record.teacherCount ?? null,
          source: record.source,
          sourceUrl: record.sourceUrl ?? null,
          rawData: record.rawData,
          lastRefreshedAt: new Date(),
        };

        if (existing) {
          await db.update(schools).set({ ...values, updatedAt: new Date() }).where(eq(schools.id, existing.id));
          result.updated++;
        } else {
          await db.insert(schools).values(values);
          result.inserted++;
        }
      } catch (err) {
        const msg = `Failed: ${record.name} — ${err instanceof Error ? err.message : "unknown"}`;
        result.errors.push(msg);
        if (result.errors.length >= 100) {
          result.errors.push(`...truncated (${records.length - i} remaining)`);
          break;
        }
      }
    }

    // Progress log
    if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= records.length) {
      const msg = `${Math.min(i + BATCH_SIZE, records.length)} / ${records.length} (${result.inserted} new, ${result.updated} updated)`;
      console.log(`[schools-import] ${msg}`);
      onProgress?.(msg);
    }
  }

  result.skipped = result.totalRecords - result.inserted - result.updated - result.errors.length;
  result.durationMs = Date.now() - start;
  return result;
}
