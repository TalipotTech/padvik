/**
 * UDISE+ bulk data importer — from locally downloaded CSV.
 * Up to 1.47 million schools. User must download CSV manually.
 * Processes in streaming chunks to avoid memory issues.
 */

import Papa from "papaparse";
import { createReadStream } from "fs";
import { existsSync } from "fs";
import { importSchools } from "../importer";
import type { RawSchoolRecord, ImportResult } from "../types";

const CHUNK_SIZE = 1000;

export async function importFromUdiseDataset(
  csvPath: string,
  stateFilter?: string,
  onProgress?: (msg: string) => void
): Promise<ImportResult> {
  const log = (msg: string) => { console.log(`[udise] ${msg}`); onProgress?.(msg); };
  log(`Starting UDISE import from ${csvPath}...`);

  if (!existsSync(csvPath)) {
    return {
      source: "udise", totalRecords: 0, inserted: 0, updated: 0, skipped: 0,
      errors: [`File not found: ${csvPath}. Download UDISE data and place at this path.`],
      durationMs: 0,
    };
  }

  const start = Date.now();
  const combinedResult: ImportResult = {
    source: "udise", totalRecords: 0, inserted: 0, updated: 0, skipped: 0, errors: [], durationMs: 0,
  };

  let chunk: RawSchoolRecord[] = [];
  let totalParsed = 0;

  return new Promise<ImportResult>((resolve) => {
    const stream = createReadStream(csvPath, { encoding: "utf-8" });

    Papa.parse(stream, {
      header: true,
      skipEmptyLines: true,
      step: async (result) => {
        const row = result.data as Record<string, string>;
        const name = (row["School Name"] || row.school_name || row.SCHOOL_NAME || "").trim();
        if (!name) return;

        const state = (row["State"] || row.state || row.STATE_NAME || "").trim();
        if (stateFilter && state && !state.toLowerCase().includes(stateFilter.toLowerCase())) return;

        totalParsed++;
        chunk.push({
          name,
          udiseCode: (row["UDISE Code"] || row.udise_code || row.UDISE_CODE || "").trim() || undefined,
          boardCode: undefined, // UDISE doesn't specify board
          state: state || undefined,
          district: (row["District"] || row.district || row.DISTRICT_NAME || "").trim() || undefined,
          city: (row["Block"] || row.block || row.BLOCK_NAME || "").trim() || undefined,
          pincode: (row["Pincode"] || row.pincode || row.PINCODE || "").trim() || undefined,
          managementType: (row["School Management"] || row.management || row.SCHOOL_MGMT || "").trim() || undefined,
          classesFrom: parseInt(row["Lowest Class"] || row.lowest_class || "1") || 1,
          classesTo: parseInt(row["Highest Class"] || row.highest_class || "10") || undefined,
          medium: (row["Medium of Instruction"] || row.medium || "").split(",").map(s => s.trim()).filter(Boolean),
          genderType: (row["School Type"] || row.school_type || "").toLowerCase().includes("boys") ? "boys" : (row["School Type"] || "").toLowerCase().includes("girls") ? "girls" : "co_ed",
          studentCount: parseInt(row["Total Students"] || row.total_students || "0") || undefined,
          teacherCount: parseInt(row["Total Teachers"] || row.total_teachers || "0") || undefined,
          source: "udise",
          sourceUrl: csvPath,
          rawData: row,
        });

        if (chunk.length >= CHUNK_SIZE) {
          const batch = [...chunk];
          chunk = [];
          try {
            const r = await importSchools(batch);
            combinedResult.inserted += r.inserted;
            combinedResult.updated += r.updated;
            combinedResult.errors.push(...r.errors.slice(0, 10));
            if (totalParsed % 5000 === 0) {
              log(`${totalParsed.toLocaleString()} parsed, ${combinedResult.inserted.toLocaleString()} new, ${combinedResult.updated.toLocaleString()} updated`);
            }
          } catch (err) {
            combinedResult.errors.push(`Batch failed: ${err instanceof Error ? err.message : "unknown"}`);
          }
        }
      },
      complete: async () => {
        // Process remaining chunk
        if (chunk.length > 0) {
          try {
            const r = await importSchools(chunk);
            combinedResult.inserted += r.inserted;
            combinedResult.updated += r.updated;
            combinedResult.errors.push(...r.errors.slice(0, 10));
          } catch { /* ignore */ }
        }
        combinedResult.totalRecords = totalParsed;
        combinedResult.skipped = totalParsed - combinedResult.inserted - combinedResult.updated;
        combinedResult.durationMs = Date.now() - start;
        log(`Complete: ${totalParsed.toLocaleString()} parsed, ${combinedResult.inserted.toLocaleString()} inserted, ${combinedResult.updated.toLocaleString()} updated`);
        resolve(combinedResult);
      },
      error: (err) => {
        combinedResult.errors.push(`Parse error: ${err.message}`);
        combinedResult.durationMs = Date.now() - start;
        resolve(combinedResult);
      },
    });
  });
}
