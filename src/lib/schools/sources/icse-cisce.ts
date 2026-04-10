/**
 * ICSE/ISC Schools importer — from cisce.org
 * ~2,600 schools.
 */

import * as cheerio from "cheerio";
import { importSchools } from "../importer";
import type { RawSchoolRecord, ImportResult } from "../types";

const BASE_URL = "https://www.cisce.org";
const RATE_LIMIT_MS = 5000;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function importFromCisce(stateFilter?: string): Promise<ImportResult> {
  console.log("[icse-cisce] Starting ICSE schools import from CISCE...");

  const records: RawSchoolRecord[] = [];
  const errors: string[] = [];

  try {
    // CISCE has a school search page — try to find the data endpoint
    const searchUrls = [
      `${BASE_URL}/SchoolSearch`,
      `${BASE_URL}/school-search`,
      `${BASE_URL}/affiliatedSchools`,
    ];

    let html = "";
    for (const url of searchUrls) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Padvik-Bot/1.0 (educational platform, contact@ensate.in)" },
        });
        if (res.ok) {
          html = await res.text();
          break;
        }
      } catch { /* try next */ }
      await sleep(RATE_LIMIT_MS);
    }

    if (!html) {
      return {
        source: "icse_scrape", totalRecords: 0, inserted: 0, updated: 0, skipped: 0,
        errors: ["Could not access CISCE school directory. Website may block automated access."],
        durationMs: 0,
      };
    }

    const $ = cheerio.load(html);

    // Parse school listings from HTML
    $("table tbody tr, .school-item, .school-entry").each((_, el) => {
      const cells = $(el).find("td");
      const name = cells.eq(0)?.text()?.trim() || $(el).find(".school-name, h3, h4").text().trim();
      if (!name || name.length < 3) return;

      const code = cells.eq(1)?.text()?.trim() || $(el).find(".code").text().trim();
      const address = cells.eq(2)?.text()?.trim() || $(el).find(".address").text().trim();
      const state = cells.eq(3)?.text()?.trim() || $(el).find(".state").text().trim();
      const city = cells.eq(4)?.text()?.trim() || $(el).find(".city").text().trim();

      if (stateFilter && state && !state.toLowerCase().includes(stateFilter.toLowerCase())) return;

      records.push({
        name,
        icseCode: code || undefined,
        boardCode: "ICSE",
        address: address || undefined,
        city: city || undefined,
        state: state || undefined,
        source: "icse_scrape",
        sourceUrl: BASE_URL,
        rawData: { name, code, address, state, city },
      });
    });
  } catch (err) {
    errors.push(`CISCE scrape failed: ${err instanceof Error ? err.message : "unknown"}`);
  }

  if (records.length === 0) {
    console.warn("[icse-cisce] No schools found. CISCE site may require JavaScript or has changed.");
    return {
      source: "icse_scrape", totalRecords: 0, inserted: 0, updated: 0, skipped: 0,
      errors: ["No data parsed from CISCE.", ...errors], durationMs: 0,
    };
  }

  console.log(`[icse-cisce] Total: ${records.length} ICSE/ISC schools`);
  return importSchools(records);
}
