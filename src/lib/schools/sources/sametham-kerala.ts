/**
 * Kerala Schools importer — from sametham.kite.kerala.gov.in
 * ~15,436 schools across 14 districts.
 *
 * Note: Sametham may use JavaScript-heavy rendering or change structure.
 * This importer attempts to fetch data via API endpoints. If it fails,
 * falls back to instructions for manual data download.
 */

import * as cheerio from "cheerio";
import { importSchools } from "../importer";
import type { RawSchoolRecord, ImportResult } from "../types";

const BASE_URL = "https://sametham.kite.kerala.gov.in";
const RATE_LIMIT_MS = 3000;

const KERALA_DISTRICTS = [
  "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha",
  "Kottayam", "Idukki", "Ernakulam", "Thrissur",
  "Palakkad", "Malappuram", "Kozhikode", "Wayanad",
  "Kannur", "Kasaragod",
];

/** Map Kerala school type to class range */
function mapSchoolType(type: string): { from: number; to: number } {
  const t = type.toUpperCase();
  if (t.includes("LP") || t.includes("LOWER PRIMARY")) return { from: 1, to: 4 };
  if (t.includes("UP") || t.includes("UPPER PRIMARY")) return { from: 5, to: 7 };
  if (t.includes("HSS") || t.includes("HIGHER SECONDARY")) return { from: 8, to: 12 };
  if (t.includes("HS") || t.includes("HIGH SCHOOL")) return { from: 8, to: 10 };
  if (t.includes("VHSE")) return { from: 11, to: 12 };
  return { from: 1, to: 10 };
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function importFromSametham(stateFilter?: string): Promise<ImportResult> {
  console.log("[sametham] Starting Kerala schools import from Sametham...");

  const records: RawSchoolRecord[] = [];
  const errors: string[] = [];

  for (const district of KERALA_DISTRICTS) {
    if (stateFilter && !district.toLowerCase().includes(stateFilter.toLowerCase())) continue;

    console.log(`[sametham] Fetching ${district}...`);

    try {
      // Attempt to find and fetch the district school listing
      // Sametham may use different URL patterns — try common ones
      const urls = [
        `${BASE_URL}/api/schools?district=${encodeURIComponent(district)}`,
        `${BASE_URL}/schools/${encodeURIComponent(district.toLowerCase())}`,
        `${BASE_URL}/SchoolList?district=${encodeURIComponent(district)}`,
      ];

      let html = "";
      let fetchedUrl = "";
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "Padvik-Bot/1.0 (educational platform, contact@ensate.in)" },
          });
          if (res.ok) {
            const contentType = res.headers.get("content-type") || "";
            const text = await res.text();

            // If JSON API response
            if (contentType.includes("json")) {
              try {
                const data = JSON.parse(text);
                const schoolList = Array.isArray(data) ? data : data.schools || data.data || [];
                for (const s of schoolList) {
                  records.push({
                    name: s.name || s.school_name || s.schoolName || "",
                    stateBoardCode: s.code || s.school_code || undefined,
                    boardCode: "KL_SCERT",
                    district,
                    state: "Kerala",
                    managementType: s.management || s.managementType || undefined,
                    ...mapSchoolType(s.type || s.schoolType || "HS"),
                    studentCount: s.students || s.studentCount || undefined,
                    teacherCount: s.teachers || s.teacherCount || undefined,
                    source: "sametham",
                    sourceUrl: url,
                    rawData: s,
                  });
                }
                fetchedUrl = url;
                break;
              } catch { /* not valid JSON, try HTML parse */ }
            }

            html = text;
            fetchedUrl = url;
            break;
          }
        } catch { /* try next URL */ }
        await sleep(RATE_LIMIT_MS);
      }

      // Parse HTML if we got it and didn't get JSON
      if (html && records.filter(r => r.district === district).length === 0) {
        const $ = cheerio.load(html);
        // Try common table patterns
        $("table tr, .school-item, .school-card").each((_, el) => {
          const cells = $(el).find("td");
          const name = cells.eq(1)?.text()?.trim() || $(el).find(".school-name, .name, h3, h4").first().text().trim();
          if (name && name.length > 3) {
            const type = cells.eq(2)?.text()?.trim() || $(el).find(".type").text().trim() || "HS";
            const mgmt = cells.eq(3)?.text()?.trim() || $(el).find(".management").text().trim();
            const code = cells.eq(0)?.text()?.trim() || $(el).find(".code").text().trim();

            records.push({
              name,
              stateBoardCode: code || undefined,
              boardCode: "KL_SCERT",
              district,
              state: "Kerala",
              managementType: mgmt || undefined,
              ...mapSchoolType(type),
              source: "sametham",
              sourceUrl: fetchedUrl,
              rawData: { name, type, management: mgmt, code, district },
            });
          }
        });
      }

      console.log(`[sametham] ${district}: ${records.filter(r => r.district === district).length} schools`);
    } catch (err) {
      errors.push(`${district}: ${err instanceof Error ? err.message : "failed"}`);
      console.warn(`[sametham] ${district} failed: ${err instanceof Error ? err.message : "unknown"}`);
    }

    await sleep(RATE_LIMIT_MS);
  }

  if (records.length === 0) {
    console.warn("[sametham] No schools found. The website may have changed structure.");
    console.warn("[sametham] Manual alternative: Visit sametham.kite.kerala.gov.in, download school data,");
    console.warn("[sametham] save as CSV at data/kerala-schools.csv, then use the UDISE importer.");
    return {
      source: "sametham", totalRecords: 0, inserted: 0, updated: 0, skipped: 0,
      errors: ["No data fetched. Site may require JavaScript rendering or has changed structure.", ...errors],
      durationMs: 0,
    };
  }

  console.log(`[sametham] Total: ${records.length} schools from ${KERALA_DISTRICTS.length} districts`);
  return importSchools(records);
}
