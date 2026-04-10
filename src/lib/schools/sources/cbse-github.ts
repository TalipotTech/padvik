/**
 * CBSE Schools importer — from github.com/deedy/cbse_schools_data
 * Pre-scraped CSV with ~20,367 CBSE schools (detailed version, 144 fields).
 */

import Papa from "papaparse";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { importSchools } from "../importer";
import type { RawSchoolRecord, ImportResult } from "../types";

const GITHUB_CSV_URL = "https://raw.githubusercontent.com/deedy/cbse_schools_data/master/detailed/schools_detailed.csv";
const LOCAL_FALLBACK = "data/cbse-schools-detailed.csv";

export async function importCbseFromGithub(
  onProgress?: (msg: string) => void
): Promise<ImportResult> {
  const log = (msg: string) => { console.log(`[cbse-github] ${msg}`); onProgress?.(msg); };

  log("Starting CBSE schools import from GitHub...");

  let csvText: string;

  // Try fetch from GitHub first
  try {
    log("Downloading CSV from GitHub (~12MB)...");
    const response = await fetch(GITHUB_CSV_URL, {
      headers: { "User-Agent": "Padvik-Bot/1.0 (educational platform)" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    csvText = await response.text();
    log(`Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)} MB`);
  } catch (err) {
    log(`GitHub download failed: ${err instanceof Error ? err.message : "unknown"}`);
    const localPath = join(process.cwd(), LOCAL_FALLBACK);
    if (!existsSync(localPath)) {
      return {
        source: "cbse_github", totalRecords: 0, inserted: 0, updated: 0, skipped: 0,
        errors: [`GitHub download failed and local file not found at ${LOCAL_FALLBACK}. Download from ${GITHUB_CSV_URL}`],
        durationMs: 0,
      };
    }
    log("Using local fallback file...");
    csvText = readFileSync(localPath, "utf-8");
  }

  // Parse CSV
  log("Parsing CSV...");
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  log(`Parsed ${parsed.data.length} rows (${parsed.errors.length} warnings)`);

  const records: RawSchoolRecord[] = [];

  for (const row of parsed.data as Record<string, string>[]) {
    const name = (row.name || "").trim();
    if (!name || name.length < 3) continue;

    // Derive class range from enrollment fields
    let classesFrom = 1;
    let classesTo = 12;
    const hasNursery = parseInt(row.e_nursery_students || "0") > 0;
    const hasIxX = parseInt(row.e_ix_x_students || "0") > 0;
    const hasXiXii = parseInt(row.e_xi_xii_students || "0") > 0;
    if (!hasXiXii && hasIxX) classesTo = 10;
    else if (!hasIxX && !hasXiXii) classesTo = 8;
    if (hasNursery) classesFrom = 0; // nursery

    // Calculate total students from enrollment fields
    const studentCount =
      (parseInt(row.e_nursery_students || "0") || 0) +
      (parseInt(row.e_i_v_students || "0") || 0) +
      (parseInt(row.e_vi_viii_students || "0") || 0) +
      (parseInt(row.e_ix_x_students || "0") || 0) +
      (parseInt(row.e_xi_xii_students || "0") || 0);

    // Calculate total teachers
    const teacherCount =
      (parseInt(row.t_total || "0") || 0) ||
      (parseInt(row.t_pgt || "0") || 0) + (parseInt(row.t_tgt || "0") || 0) + (parseInt(row.t_prt || "0") || 0);

    // Medium of instruction
    const medium = (row.n_medium || "").trim();
    const mediumArr = medium ? [medium.toLowerCase()] : [];

    records.push({
      name,
      cbseAffiliationNo: (row.aff_no || "").trim() || undefined,
      boardCode: "CBSE",
      state: (row.state || "").trim() || undefined,
      district: (row.district || "").trim() || undefined,
      address: (row.address || "").trim() || undefined,
      pincode: (row.pincode || "").trim() || undefined,
      phone: (row.ph_no || row.off_ph_no || "").trim() || undefined,
      email: (row.email || "").trim() || undefined,
      website: (row.website || "").trim() || undefined,
      principalName: (row.princi_name || "").trim() || undefined,
      managementType: (row.n_school_type || "").trim() || undefined,
      genderType: (row.n_category || "").toLowerCase().includes("boys") ? "boys"
        : (row.n_category || "").toLowerCase().includes("girls") ? "girls" : "co_ed",
      medium: mediumArr,
      studentCount: studentCount || undefined,
      teacherCount: teacherCount || undefined,
      classesFrom,
      classesTo,
      source: "cbse_github",
      sourceUrl: GITHUB_CSV_URL,
      rawData: row,
    });
  }

  log(`Prepared ${records.length} school records for import`);

  if (records.length === 0) {
    return {
      source: "cbse_github", totalRecords: 0, inserted: 0, updated: 0, skipped: 0,
      errors: ["CSV parsed but no valid school records found. Check column names."],
      durationMs: 0,
    };
  }

  log(`Importing ${records.length} schools into database...`);
  return importSchools(records, onProgress);
}
