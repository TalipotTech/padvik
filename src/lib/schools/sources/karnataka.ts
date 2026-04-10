/**
 * Karnataka State Board Schools importer
 * Source: schooleducation.kar.nic.in / kseab.karnataka.gov.in
 * ~60,000+ schools across 31 districts
 */

import * as cheerio from "cheerio";
import { importSchools } from "../importer";
import type { RawSchoolRecord, ImportResult } from "../types";

const BASE_URL = "https://schooleducation.kar.nic.in";
const RATE_LIMIT_MS = 3000;

const KARNATAKA_DISTRICTS = [
  "Bagalkot", "Ballari", "Belagavi", "Bengaluru Rural", "Bengaluru Urban",
  "Bidar", "Chamarajanagar", "Chikkaballapur", "Chikkamagaluru", "Chitradurga",
  "Dakshina Kannada", "Davanagere", "Dharwad", "Gadag", "Hassan",
  "Haveri", "Kalaburagi", "Kodagu", "Kolar", "Koppal",
  "Mandya", "Mysuru", "Raichur", "Ramanagara", "Shivamogga",
  "Tumakuru", "Udupi", "Uttara Kannada", "Vijayapura", "Yadgir",
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function importFromKarnataka(
  onProgress?: (msg: string) => void
): Promise<ImportResult> {
  const log = (msg: string) => { console.log(`[karnataka] ${msg}`); onProgress?.(msg); };
  log("Starting Karnataka schools import...");

  const records: RawSchoolRecord[] = [];
  const errors: string[] = [];

  // Try to find school listing from Karnataka education portal
  const searchUrls = [
    `${BASE_URL}/school-list`,
    `${BASE_URL}/schoolList`,
    `https://kseab.karnataka.gov.in/schools`,
    `https://ssp.karnataka.gov.in/schoolList`,
  ];

  for (const district of KARNATAKA_DISTRICTS) {
    log(`Fetching ${district}...`);

    for (const baseUrl of searchUrls) {
      try {
        const url = `${baseUrl}?district=${encodeURIComponent(district)}`;
        const res = await fetch(url, {
          headers: { "User-Agent": "Padvik-Bot/1.0 (educational platform, contact@ensate.in)" },
        });
        if (!res.ok) continue;

        const html = await res.text();
        const $ = cheerio.load(html);

        $("table tbody tr, .school-row").each((_, el) => {
          const cells = $(el).find("td");
          const name = cells.eq(1)?.text()?.trim() || cells.eq(0)?.text()?.trim() || $(el).find(".school-name").text().trim();
          if (!name || name.length < 3) return;

          records.push({
            name,
            stateBoardCode: cells.eq(0)?.text()?.trim() || undefined,
            boardCode: "KA_SSLC",
            district,
            state: "Karnataka",
            medium: ["kannada"],
            source: "manual",
            sourceUrl: url,
            rawData: { name, district },
          });
        });

        if (records.filter(r => r.district === district).length > 0) break;
      } catch { /* try next URL */ }
      await sleep(RATE_LIMIT_MS);
    }

    const count = records.filter(r => r.district === district).length;
    if (count > 0) log(`${district}: ${count} schools`);
    else errors.push(`${district}: no data found`);
  }

  if (records.length === 0) {
    log("No schools found. Karnataka portal may require different approach. Use UDISE data instead.");
    return { source: "manual", totalRecords: 0, inserted: 0, updated: 0, skipped: 0, errors, durationMs: 0 };
  }

  log(`Total: ${records.length} Karnataka schools`);
  return importSchools(records, onProgress);
}
