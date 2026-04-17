/**
 * Schools import orchestrator — runs all or selected sources.
 */

import type { SchoolSource, ImportResult } from "./types";
import { importCbseFromGithub } from "./sources/cbse-github";
import { importFromSametham } from "./sources/sametham-kerala";
import { importFromCbseSaras } from "./sources/cbse-saras";
import { importFromCisce } from "./sources/icse-cisce";
import { importFromUdiseDataset } from "./sources/udise-data";
import { importFromKarnataka } from "./sources/karnataka";
import { importFromTamilNadu } from "./sources/tamilnadu";
import { importFromMaharashtra } from "./sources/maharashtra";
import { importFromAP, importFromTelangana } from "./sources/ap-telangana";

interface ImportOptions {
  sources?: SchoolSource[];
  stateFilter?: string;
  udiseCsvPath?: string;
  onProgress?: (msg: string) => void;
}

export async function importAllSchools(options: ImportOptions = {}): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  const sources = options.sources || ["cbse_github", "sametham", "icse_scrape"];

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Schools Import — Sources: ${sources.join(", ")}`);
  if (options.stateFilter) console.log(`State filter: ${options.stateFilter}`);
  console.log(`${"=".repeat(60)}\n`);

  for (const source of sources) {
    console.log(`\n--- ${source.toUpperCase()} ---`);
    try {
      let result: ImportResult;

      switch (source) {
        case "cbse_github":
          result = await importCbseFromGithub(options.onProgress);
          break;
        case "sametham":
          result = await importFromSametham(options.stateFilter, options.onProgress);
          break;
        case "cbse_saras":
          result = await importFromCbseSaras(options.stateFilter);
          break;
        case "icse_scrape":
          result = await importFromCisce(options.stateFilter, options.onProgress);
          break;
        case "udise":
          result = await importFromUdiseDataset(
            options.udiseCsvPath || "data/udise-schools.csv",
            options.stateFilter,
            options.onProgress
          );
          break;
        case "karnataka":
          result = await importFromKarnataka(options.onProgress);
          break;
        case "tamilnadu":
          result = await importFromTamilNadu(options.onProgress);
          break;
        case "maharashtra":
          result = await importFromMaharashtra(options.onProgress);
          break;
        case "ap":
          result = await importFromAP(options.onProgress);
          break;
        case "telangana":
          result = await importFromTelangana(options.onProgress);
          break;
        default:
          console.warn(`Unknown source: ${source}`);
          continue;
      }

      results.push(result);
      console.log(`\n${source}: ${result.inserted} new, ${result.updated} updated, ${result.errors.length} errors (${(result.durationMs / 1000).toFixed(1)}s)`);
    } catch (err) {
      console.error(`${source} FAILED:`, err instanceof Error ? err.message : err);
      results.push({
        source,
        totalRecords: 0, inserted: 0, updated: 0, skipped: 0,
        errors: [err instanceof Error ? err.message : "Unknown error"],
        durationMs: 0,
      });
    }
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("IMPORT SUMMARY");
  console.log(`${"=".repeat(60)}`);
  let totalNew = 0, totalUpdated = 0, totalErrors = 0;
  for (const r of results) {
    totalNew += r.inserted;
    totalUpdated += r.updated;
    totalErrors += r.errors.length;
    console.log(`  ${r.source.padEnd(15)} ${r.inserted} new, ${r.updated} updated, ${r.errors.length} errors`);
  }
  console.log(`  ${"TOTAL".padEnd(15)} ${totalNew} new, ${totalUpdated} updated, ${totalErrors} errors`);
  console.log(`${"=".repeat(60)}\n`);

  return results;
}
