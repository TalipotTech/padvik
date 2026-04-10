/**
 * ICSE/ISC Schools importer — from github.com/deedy/cisce_schools_data
 * Pre-scraped CSV with ~2,341 CISCE schools.
 */

import Papa from "papaparse";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { importSchools } from "../importer";
import type { RawSchoolRecord, ImportResult } from "../types";

const GITHUB_CSV_URL = "https://raw.githubusercontent.com/deedy/cisce_schools_data/master/schools.csv";
const LOCAL_FALLBACK = "data/icse-schools.csv";

export async function importFromCisce(
  stateFilter?: string,
  onProgress?: (msg: string) => void
): Promise<ImportResult> {
  const log = (msg: string) => { console.log(`[icse-cisce] ${msg}`); onProgress?.(msg); };
  log("Starting ICSE/ISC schools import from GitHub...");

  let csvText: string;

  try {
    log("Downloading CSV from GitHub (~500KB)...");
    const response = await fetch(GITHUB_CSV_URL, {
      headers: { "User-Agent": "Padvik-Bot/1.0 (educational platform)" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    csvText = await response.text();
    log(`Downloaded ${(csvText.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    log(`GitHub download failed: ${err instanceof Error ? err.message : "unknown"}`);
    const localPath = join(process.cwd(), LOCAL_FALLBACK);
    if (!existsSync(localPath)) {
      return {
        source: "icse_scrape", totalRecords: 0, inserted: 0, updated: 0, skipped: 0,
        errors: [`GitHub download failed and local file not found at ${LOCAL_FALLBACK}`],
        durationMs: 0,
      };
    }
    log("Using local fallback file...");
    csvText = readFileSync(localPath, "utf-8");
  }

  log("Parsing CSV...");
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  log(`Parsed ${parsed.data.length} rows`);

  const records: RawSchoolRecord[] = [];

  for (const row of parsed.data as Record<string, string>[]) {
    const name = (row.name || "").trim();
    if (!name || name.length < 3) continue;

    const state = (row.state || "").trim();
    if (stateFilter && state && !state.toLowerCase().includes(stateFilter.toLowerCase())) continue;

    // Parse address for city/district/pincode
    const address = (row.address || "").trim();
    const pincodeMatch = address.match(/(\d{6})/);
    const pincode = pincodeMatch ? pincodeMatch[1] : undefined;

    // Determine class range from ICSE/ISC flags
    const isIcse = row.is_icse === "True";
    const isIsc = row.is_isc === "True";
    let classesFrom = 1;
    let classesTo = 10;
    if (isIsc) classesTo = 12;
    if (!isIcse && isIsc) classesFrom = 11;

    // Gender type
    const gender = (row.gender || "").toLowerCase();
    const genderType = gender.includes("boys") ? "boys" : gender.includes("girls") ? "girls" : "co_ed";

    records.push({
      name,
      icseCode: (row.code || "").trim() || undefined,
      boardCode: "ICSE",
      address: address || undefined,
      state: state || undefined,
      pincode,
      phone: (row.off_ph_no || "").trim() || undefined,
      email: (row.email || "").trim() || undefined,
      website: (row.website || "").trim() || undefined,
      principalName: (row.princi_name || "").trim() || undefined,
      genderType,
      classesFrom,
      classesTo,
      isResidential: (row.res_type || "").toLowerCase().includes("r"),
      source: "icse_scrape",
      sourceUrl: GITHUB_CSV_URL,
      rawData: row,
    });
  }

  if (records.length === 0) {
    return {
      source: "icse_scrape", totalRecords: 0, inserted: 0, updated: 0, skipped: 0,
      errors: ["CSV parsed but no valid records found"], durationMs: 0,
    };
  }

  log(`Prepared ${records.length} ICSE/ISC schools for import`);
  return importSchools(records, onProgress);
}
