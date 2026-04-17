/**
 * Andhra Pradesh + Telangana State Board Schools importer
 * Source: schooledu.ap.gov.in / bse.telangana.gov.in
 */

import * as cheerio from "cheerio";
import { importSchools } from "../importer";
import type { RawSchoolRecord, ImportResult } from "../types";

const RATE_LIMIT_MS = 3000;

const AP_DISTRICTS = [
  "Anantapur", "Chittoor", "East Godavari", "Guntur", "Krishna",
  "Kurnool", "Nellore", "Prakasam", "Srikakulam", "Visakhapatnam",
  "Vizianagaram", "West Godavari", "YSR Kadapa",
  // New districts post-2022 reorganization
  "Alluri Sitharama Raju", "Anakapalli", "Annamayya", "Bapatla",
  "Eluru", "Kakinada", "Konaseema", "Nandyal", "NTR",
  "Palnadu", "Parvathipuram Manyam", "Sri Sathya Sai", "Tirupati",
];

const TS_DISTRICTS = [
  "Adilabad", "Bhadradri Kothagudem", "Hyderabad", "Jagtial", "Jangaon",
  "Jayashankar Bhupalpally", "Jogulamba Gadwal", "Kamareddy", "Karimnagar",
  "Khammam", "Kumuram Bheem", "Mahabubabad", "Mahabubnagar", "Mancherial",
  "Medak", "Medchal-Malkajgiri", "Mulugu", "Nagarkurnool", "Nalgonda",
  "Narayanpet", "Nirmal", "Nizamabad", "Peddapalli", "Rajanna Sircilla",
  "Rangareddy", "Sangareddy", "Siddipet", "Suryapet", "Vikarabad",
  "Wanaparthy", "Warangal Rural", "Warangal Urban", "Yadadri Bhuvanagiri",
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function scrapeState(
  stateName: string,
  boardCode: string,
  districts: string[],
  baseUrls: string[],
  onProgress?: (msg: string) => void
): Promise<RawSchoolRecord[]> {
  const log = (msg: string) => { console.log(`[${stateName.toLowerCase()}] ${msg}`); onProgress?.(msg); };
  const records: RawSchoolRecord[] = [];

  for (const district of districts) {
    log(`Fetching ${district}...`);

    for (const baseUrl of baseUrls) {
      try {
        const url = `${baseUrl}?district=${encodeURIComponent(district)}`;
        const res = await fetch(url, {
          headers: { "User-Agent": "Padvik-Bot/1.0 (educational platform, contact@ensate.in)" },
        });
        if (!res.ok) continue;

        const $ = cheerio.load(await res.text());
        $("table tbody tr").each((_, el) => {
          const cells = $(el).find("td");
          const name = cells.eq(1)?.text()?.trim() || cells.eq(0)?.text()?.trim();
          if (!name || name.length < 3) return;
          records.push({
            name, boardCode, district, state: stateName,
            medium: [stateName === "Andhra Pradesh" ? "telugu" : "telugu"],
            source: "manual", sourceUrl: url,
            rawData: { name, district },
          });
        });

        if (records.filter(r => r.district === district).length > 0) break;
      } catch { /* try next */ }
      await sleep(RATE_LIMIT_MS);
    }
  }

  return records;
}

export async function importFromAP(onProgress?: (msg: string) => void): Promise<ImportResult> {
  const log = (msg: string) => { console.log(`[ap] ${msg}`); onProgress?.(msg); };
  log("Starting Andhra Pradesh schools import...");

  const records = await scrapeState(
    "Andhra Pradesh", "AP_BSEAP", AP_DISTRICTS,
    ["https://schooledu.ap.gov.in/school-list", "https://cse.ap.gov.in/schools"],
    onProgress
  );

  if (records.length === 0) {
    log("No AP schools found. Use UDISE data for AP coverage.");
    return { source: "manual", totalRecords: 0, inserted: 0, updated: 0, skipped: 0, errors: ["No data from AP portal"], durationMs: 0 };
  }

  log(`Total: ${records.length} AP schools`);
  return importSchools(records, onProgress);
}

export async function importFromTelangana(onProgress?: (msg: string) => void): Promise<ImportResult> {
  const log = (msg: string) => { console.log(`[telangana] ${msg}`); onProgress?.(msg); };
  log("Starting Telangana schools import...");

  const records = await scrapeState(
    "Telangana", "TS_BSETS", TS_DISTRICTS,
    ["https://bse.telangana.gov.in/schools", "https://schooledu.telangana.gov.in/school-list"],
    onProgress
  );

  if (records.length === 0) {
    log("No Telangana schools found. Use UDISE data for TS coverage.");
    return { source: "manual", totalRecords: 0, inserted: 0, updated: 0, skipped: 0, errors: ["No data from TS portal"], durationMs: 0 };
  }

  log(`Total: ${records.length} Telangana schools`);
  return importSchools(records, onProgress);
}
