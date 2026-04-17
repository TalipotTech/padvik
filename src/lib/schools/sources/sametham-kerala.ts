/**
 * Kerala Schools importer — from sametham.kite.kerala.gov.in
 * The actual URL pattern: /search/districtWiseSchools/{1-14}
 * Each district page has a table with school code, name, sub-district, district.
 * Total: ~15,000 schools across 14 districts.
 */

import * as cheerio from "cheerio";
import { importSchools } from "../importer";
import type { RawSchoolRecord, ImportResult } from "../types";

const BASE_URL = "https://sametham.kite.kerala.gov.in";
const RATE_LIMIT_MS = 2000;

// District IDs 1-14 matching the Sametham URL pattern
const DISTRICTS: { id: number; name: string }[] = [
  { id: 1, name: "Thiruvananthapuram" },
  { id: 2, name: "Kollam" },
  { id: 3, name: "Pathanamthitta" },
  { id: 4, name: "Alappuzha" },
  { id: 5, name: "Kottayam" },
  { id: 6, name: "Idukki" },
  { id: 7, name: "Ernakulam" },
  { id: 8, name: "Thrissur" },
  { id: 9, name: "Palakkad" },
  { id: 10, name: "Malappuram" },
  { id: 11, name: "Kozhikode" },
  { id: 12, name: "Wayanad" },
  { id: 13, name: "Kannur" },
  { id: 14, name: "Kasaragod" },
];

/** Parse school code to determine type and class range */
function parseSchoolCode(code: string): { type: string; classesFrom: number; classesTo: number } {
  const prefix = code.split(":")[0]?.toUpperCase() || "";
  if (prefix === "LP" || prefix.includes("LP")) return { type: "LP", classesFrom: 1, classesTo: 4 };
  if (prefix === "UP" || prefix.includes("UP")) return { type: "UP", classesFrom: 5, classesTo: 7 };
  if (prefix === "HSS" || prefix.includes("HSS")) return { type: "HSS", classesFrom: 1, classesTo: 12 };
  if (prefix === "HS" || prefix.includes("HS")) return { type: "HS", classesFrom: 1, classesTo: 10 };
  if (prefix === "VHSE" || prefix.includes("VHSE")) return { type: "VHSE", classesFrom: 11, classesTo: 12 };
  if (prefix === "TTI") return { type: "TTI", classesFrom: 1, classesTo: 12 };
  return { type: prefix || "HS", classesFrom: 1, classesTo: 10 };
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function importFromSametham(
  stateFilter?: string,
  onProgress?: (msg: string) => void
): Promise<ImportResult> {
  const log = (msg: string) => { console.log(`[sametham] ${msg}`); onProgress?.(msg); };
  log("Starting Kerala schools import from Sametham...");

  const allRecords: RawSchoolRecord[] = [];
  const errors: string[] = [];

  for (const district of DISTRICTS) {
    if (stateFilter && !district.name.toLowerCase().includes(stateFilter.toLowerCase())) continue;

    log(`Fetching ${district.name} (${district.id}/14)...`);

    try {
      const url = `${BASE_URL}/search/districtWiseSchools/${district.id}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Padvik-Bot/1.0 (educational platform, contact@ensate.in)" },
      });

      if (!res.ok) {
        errors.push(`${district.name}: HTTP ${res.status}`);
        log(`${district.name}: HTTP ${res.status} — skipped`);
        continue;
      }

      const html = await res.text();
      const $ = cheerio.load(html);
      let districtCount = 0;

      $("table tbody tr").each((_, el) => {
        const cells = $(el).find("td");
        if (cells.length < 4) return;

        const schoolCode = cells.eq(1)?.text()?.trim() || "";
        const name = cells.eq(2)?.text()?.trim() || "";
        const subDistrict = cells.eq(3)?.text()?.trim() || "";
        const districtName = cells.eq(4)?.text()?.trim() || district.name;
        const eduDistrict = cells.eq(5)?.text()?.trim() || "";

        if (!name || name.length < 3) return;

        const { type, classesFrom, classesTo } = parseSchoolCode(schoolCode);

        // Determine management type from name patterns
        let managementType: string | undefined;
        const nameLower = name.toLowerCase();
        if (nameLower.includes("govt.") || nameLower.includes("government")) managementType = "government";
        else if (nameLower.includes("aided")) managementType = "aided";
        else managementType = "private";

        allRecords.push({
          name,
          stateBoardCode: schoolCode || undefined,
          boardCode: "KL_SCERT",
          district: district.name,
          city: subDistrict || undefined,
          state: "Kerala",
          managementType,
          schoolCategory: type === "LP" ? "primary" : type === "UP" ? "upper_primary" : type === "HS" ? "secondary" : "sr_secondary",
          classesFrom,
          classesTo,
          medium: ["malayalam"],
          source: "sametham",
          sourceUrl: url,
          rawData: { schoolCode, name, subDistrict, district: districtName, eduDistrict, type },
        });
        districtCount++;
      });

      log(`${district.name}: ${districtCount} schools found`);
    } catch (err) {
      const msg = `${district.name}: ${err instanceof Error ? err.message : "failed"}`;
      errors.push(msg);
      log(msg);
    }

    await sleep(RATE_LIMIT_MS);
  }

  if (allRecords.length === 0) {
    log("No schools found. Sametham site may have changed.");
    return {
      source: "sametham", totalRecords: 0, inserted: 0, updated: 0, skipped: 0,
      errors: ["No data fetched from Sametham.", ...errors], durationMs: 0,
    };
  }

  log(`Total: ${allRecords.length} Kerala schools. Importing into database...`);
  return importSchools(allRecords, onProgress);
}
