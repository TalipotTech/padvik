/**
 * CBSE SARAS 6.0 importer — saras.cbse.gov.in
 * Official live directory, more up-to-date than GitHub dataset.
 * Very slow (~40 hours for full scrape) — run as background job.
 */

import * as cheerio from "cheerio";
import { importSchools } from "../importer";
import type { RawSchoolRecord, ImportResult } from "../types";

const BASE_URL = "https://saras.cbse.gov.in";
const RATE_LIMIT_MS = 5000;

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal",
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function importFromCbseSaras(stateFilter?: string): Promise<ImportResult> {
  console.log("[cbse-saras] Starting CBSE SARAS import (this may take hours)...");

  const records: RawSchoolRecord[] = [];
  const errors: string[] = [];
  const states = stateFilter
    ? INDIAN_STATES.filter(s => s.toLowerCase().includes(stateFilter.toLowerCase()))
    : INDIAN_STATES;

  for (const state of states) {
    console.log(`[cbse-saras] Fetching ${state}...`);

    try {
      // Try the SARAS school list page with state filter
      const listUrl = `${BASE_URL}/SARAS/AffiliatedList/ListOfSchdirReportNew?ID1=D&State=${encodeURIComponent(state)}`;
      const res = await fetch(listUrl, {
        headers: { "User-Agent": "Padvik-Bot/1.0 (educational platform, contact@ensate.in)" },
      });

      if (!res.ok) {
        errors.push(`${state}: HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      // Parse school rows from the HTML table
      $("table tbody tr, .school-row").each((_, el) => {
        const cells = $(el).find("td");
        if (cells.length < 3) return;

        const affNo = cells.eq(0)?.text()?.trim() || "";
        const name = cells.eq(1)?.text()?.trim() || "";
        const address = cells.eq(2)?.text()?.trim() || "";
        const phone = cells.eq(3)?.text()?.trim() || "";
        const email = cells.eq(4)?.text()?.trim() || "";

        if (!name || name.length < 3) return;

        records.push({
          name,
          cbseAffiliationNo: affNo || undefined,
          boardCode: "CBSE",
          address: address || undefined,
          state,
          phone: phone || undefined,
          email: email || undefined,
          source: "cbse_saras",
          sourceUrl: listUrl,
          rawData: { affNo, name, address, phone, email, state },
        });
      });

      console.log(`[cbse-saras] ${state}: ${records.filter(r => r.rawData?.state === state).length} schools`);
    } catch (err) {
      errors.push(`${state}: ${err instanceof Error ? err.message : "failed"}`);
    }

    await sleep(RATE_LIMIT_MS);
  }

  if (records.length === 0) {
    console.warn("[cbse-saras] No schools found. SARAS website may have changed.");
    return {
      source: "cbse_saras", totalRecords: 0, inserted: 0, updated: 0, skipped: 0,
      errors: ["No data fetched from SARAS.", ...errors], durationMs: 0,
    };
  }

  console.log(`[cbse-saras] Total: ${records.length} schools`);
  return importSchools(records);
}
