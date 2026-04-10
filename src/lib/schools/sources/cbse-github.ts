/**
 * CBSE Schools importer — from github.com/deedy/cbse_schools_data
 * Pre-scraped CSV with ~20,367 CBSE schools.
 */

import Papa from "papaparse";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { importSchools } from "../importer";
import type { RawSchoolRecord, ImportResult } from "../types";

const GITHUB_CSV_URL = "https://raw.githubusercontent.com/deedy/cbse_schools_data/master/basic/schools_basic.csv";
const LOCAL_FALLBACK = "data/cbse-schools-basic.csv";

export async function importCbseFromGithub(): Promise<ImportResult> {
  console.log("[cbse-github] Starting CBSE schools import from GitHub...");

  let csvText: string;

  // Try fetch from GitHub first
  try {
    console.log("[cbse-github] Downloading from GitHub...");
    const response = await fetch(GITHUB_CSV_URL, {
      headers: { "User-Agent": "Padvik-Bot/1.0 (educational platform)" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    csvText = await response.text();
    console.log(`[cbse-github] Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)} MB`);
  } catch (err) {
    console.log(`[cbse-github] GitHub download failed: ${err instanceof Error ? err.message : "unknown"}`);
    // Fallback to local file
    const localPath = join(process.cwd(), LOCAL_FALLBACK);
    if (!existsSync(localPath)) {
      return {
        source: "cbse_github", totalRecords: 0, inserted: 0, updated: 0, skipped: 0,
        errors: [`GitHub download failed and local file not found at ${LOCAL_FALLBACK}. Download manually from ${GITHUB_CSV_URL}`],
        durationMs: 0,
      };
    }
    console.log("[cbse-github] Using local fallback file...");
    csvText = readFileSync(localPath, "utf-8");
  }

  // Parse CSV
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    console.warn(`[cbse-github] CSV parse warnings: ${parsed.errors.length}`);
  }

  const records: RawSchoolRecord[] = [];

  for (const row of parsed.data as Record<string, string>[]) {
    const name = (row.name || row.School_Name || "").trim();
    if (!name) continue;

    // Determine class range from available fields
    let classesFrom = 1;
    let classesTo = 12;
    // Check if specific class fields exist
    const hasNursery = row.e_nursery_classes === "1" || row.e_nursery_classes === "Yes";
    const hasXiXii = row.e_xi_xii_classes === "1" || row.e_xi_xii_classes === "Yes";
    if (!hasXiXii) classesTo = 10;
    if (!hasNursery) classesFrom = 1;

    records.push({
      name,
      cbseAffiliationNo: (row.aff_no || row.Affiliation_No || "").trim() || undefined,
      boardCode: "CBSE",
      state: (row.state || row.State || "").trim() || undefined,
      district: (row.district || row.District || "").trim() || undefined,
      address: (row.address || row.Address || "").trim() || undefined,
      pincode: (row.pincode || row.Pin_Code || "").trim() || undefined,
      phone: (row.phone_no || row.Phone || "").trim() || undefined,
      email: (row.off_email || row.Email || "").trim() || undefined,
      website: (row.website || row.Website || "").trim() || undefined,
      principalName: (row.principal || row.Principal_Name || "").trim() || undefined,
      managementType: (row.n_school_type || row.School_Type || "").trim() || undefined,
      teacherCount: parseInt(row.n_tchr_total || row.Total_Teachers || "0") || undefined,
      classesFrom,
      classesTo,
      source: "cbse_github",
      sourceUrl: GITHUB_CSV_URL,
      rawData: row,
    });
  }

  console.log(`[cbse-github] Parsed ${records.length} schools from CSV`);
  return importSchools(records);
}
