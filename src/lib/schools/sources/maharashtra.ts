/**
 * Maharashtra State Board Schools importer
 * Source: education.maharashtra.gov.in / mahahsscboard.in
 * ~100,000+ schools across 36 districts
 */

import * as cheerio from "cheerio";
import { importSchools } from "../importer";
import type { RawSchoolRecord, ImportResult } from "../types";

const RATE_LIMIT_MS = 3000;

const MH_DISTRICTS = [
  "Ahmednagar", "Akola", "Amravati", "Aurangabad", "Beed",
  "Bhandara", "Buldhana", "Chandrapur", "Dhule", "Gadchiroli",
  "Gondia", "Hingoli", "Jalgaon", "Jalna", "Kolhapur",
  "Latur", "Mumbai City", "Mumbai Suburban", "Nagpur", "Nanded",
  "Nandurbar", "Nashik", "Osmanabad", "Palghar", "Parbhani",
  "Pune", "Raigad", "Ratnagiri", "Sangli", "Satara",
  "Sindhudurg", "Solapur", "Thane", "Wardha", "Washim", "Yavatmal",
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function importFromMaharashtra(
  onProgress?: (msg: string) => void
): Promise<ImportResult> {
  const log = (msg: string) => { console.log(`[maharashtra] ${msg}`); onProgress?.(msg); };
  log("Starting Maharashtra schools import...");

  const records: RawSchoolRecord[] = [];
  const errors: string[] = [];

  const searchUrls = [
    "https://education.maharashtra.gov.in/school-search",
    "https://education.maharashtra.gov.in/api/schools",
  ];

  for (const district of MH_DISTRICTS) {
    log(`Fetching ${district}...`);

    for (const baseUrl of searchUrls) {
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
            name, boardCode: "MH_SSC", district, state: "Maharashtra",
            medium: ["marathi"], source: "manual", sourceUrl: url,
            rawData: { name, district },
          });
        });

        if (records.filter(r => r.district === district).length > 0) break;
      } catch { /* try next */ }
      await sleep(RATE_LIMIT_MS);
    }
  }

  if (records.length === 0) {
    log("No schools found. MH portal may need different approach. Use UDISE data.");
    return { source: "manual", totalRecords: 0, inserted: 0, updated: 0, skipped: 0, errors, durationMs: 0 };
  }

  log(`Total: ${records.length} Maharashtra schools`);
  return importSchools(records, onProgress);
}
