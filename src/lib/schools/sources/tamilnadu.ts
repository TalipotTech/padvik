/**
 * Tamil Nadu State Board Schools importer
 * Source: emis.tnschools.gov.in / dge.tn.gov.in
 * ~50,000+ schools across 38 districts
 */

import * as cheerio from "cheerio";
import { importSchools } from "../importer";
import type { RawSchoolRecord, ImportResult } from "../types";

const RATE_LIMIT_MS = 3000;

const TN_DISTRICTS = [
  "Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore",
  "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kancheepuram",
  "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam",
  "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai", "Ramanathapuram",
  "Ranipet", "Salem", "Sivaganga", "Tenkasi", "Thanjavur",
  "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli", "Tirupathur",
  "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore",
  "Viluppuram", "Virudhunagar",
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function importFromTamilNadu(
  onProgress?: (msg: string) => void
): Promise<ImportResult> {
  const log = (msg: string) => { console.log(`[tamilnadu] ${msg}`); onProgress?.(msg); };
  log("Starting Tamil Nadu schools import...");

  const records: RawSchoolRecord[] = [];
  const errors: string[] = [];

  const searchUrls = [
    "https://emis.tnschools.gov.in/schoollist",
    "https://emis.tnschools.gov.in/api/schools",
    "https://dge.tn.gov.in/schools",
  ];

  for (const district of TN_DISTRICTS) {
    log(`Fetching ${district}...`);

    for (const baseUrl of searchUrls) {
      try {
        const url = `${baseUrl}?district=${encodeURIComponent(district)}`;
        const res = await fetch(url, {
          headers: { "User-Agent": "Padvik-Bot/1.0 (educational platform, contact@ensate.in)" },
        });
        if (!res.ok) continue;

        const contentType = res.headers.get("content-type") || "";
        const text = await res.text();

        if (contentType.includes("json")) {
          try {
            const data = JSON.parse(text);
            const list = Array.isArray(data) ? data : data.schools || data.data || [];
            for (const s of list) {
              records.push({
                name: s.name || s.school_name || "",
                udiseCode: s.udise || s.udise_code || undefined,
                boardCode: "TN_DGE",
                district,
                state: "Tamil Nadu",
                medium: ["tamil"],
                source: "manual",
                sourceUrl: url,
                rawData: s,
              });
            }
            break;
          } catch { /* not JSON */ }
        }

        const $ = cheerio.load(text);
        $("table tbody tr").each((_, el) => {
          const cells = $(el).find("td");
          const name = cells.eq(1)?.text()?.trim() || cells.eq(0)?.text()?.trim();
          if (!name || name.length < 3) return;
          records.push({
            name, boardCode: "TN_DGE", district, state: "Tamil Nadu",
            medium: ["tamil"], source: "manual", sourceUrl: url,
            rawData: { name, district },
          });
        });

        if (records.filter(r => r.district === district).length > 0) break;
      } catch { /* try next */ }
      await sleep(RATE_LIMIT_MS);
    }

    const count = records.filter(r => r.district === district).length;
    if (count > 0) log(`${district}: ${count} schools`);
    else errors.push(`${district}: no data found`);
  }

  if (records.length === 0) {
    log("No schools found. TN portal may require different approach. Use UDISE data instead.");
    return { source: "manual", totalRecords: 0, inserted: 0, updated: 0, skipped: 0, errors, durationMs: 0 };
  }

  log(`Total: ${records.length} Tamil Nadu schools`);
  return importSchools(records, onProgress);
}
