/**
 * ICSE/ISC Syllabus Scraper
 *
 * Pipeline: Fetch CISCE regulations-and-syllabus page -> Find PDF links ->
 *           Download PDFs -> Extract text -> Send to Claude for parsing ->
 *           Validate -> Insert into boards/standards/subjects/chapters/topics
 *
 * CISCE publishes two-year syllabi per subject (one PDF covers both Gr9+10 for ICSE,
 * or both Gr11+12 for ISC). We file each PDF under the exam grade (Gr10 for ICSE,
 * Gr12 for ISC) — the Gr9/Gr11 preparatory years share the same curriculum and the
 * standards for those grades exist for per-student tracking, not per-syllabus entries.
 *
 * CISCE's Elementor-based pages embed PDF links in three distinct ways, only one of
 * which is a plain `<a href>`. A naïve `extractLinks(html, /\.pdf$/)` hits < 5% of
 * the actual syllabus PDFs on these pages. Use `extractCiscePdfUrls` instead.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boards } from "@/db/schema/curriculum";
import { BaseScraper } from "./base-scraper";
import { extractTextFromPdf, resolveUrl } from "./parser";
import { insertParsedSyllabus } from "./syllabus-inserter";
import { resolveModelWithFallbacks } from "./ai-model-resolver";
import { aiChat } from "../ai/provider";
import type { AIProviderChoice } from "../queue";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseResponse,
  config as promptConfig,
  type SyllabusParseResult,
} from "../ai/prompts/syllabus-parser";

const ICSE_BASE = "https://www.cisce.org";

/**
 * Per-source seed pages. `defaultGrade` is used when URL/text grade inference fails
 * (which is common — CISCE syllabus PDFs don't embed "Class 10" in the filename).
 *
 * Update annually: the -2027 pages are the current-year syllabi as of this writing;
 * CISCE rotates them when a new two-year cycle begins.
 */
interface IcseSyllabusSource {
  url: string;
  defaultGrade: number;
  label: string;
}

const ICSE_SYLLABUS_SOURCES: IcseSyllabusSource[] = [
  { url: `${ICSE_BASE}/regulations-and-syllabus-icse-2027/`, defaultGrade: 10, label: "ICSE 2027" },
  { url: `${ICSE_BASE}/regulations-and-syllabus-isc-2027/`, defaultGrade: 12, label: "ISC 2027" },
  { url: `${ICSE_BASE}/regulations-and-syllabus-icse-2028/`, defaultGrade: 10, label: "ICSE 2028" },
  { url: `${ICSE_BASE}/regulations-and-syllabus-isc-2028/`, defaultGrade: 12, label: "ISC 2028" },
];

/**
 * URL substrings that mark a PDF as NOT a subject syllabus — CISCE's site-wide
 * header/footer sprinkles recruitment notices, tenders, vacancies etc. onto every
 * Elementor page. Reject before download to avoid wasting AI-parse cycles.
 */
const NON_SYLLABUS_URL_PATTERNS = [
  // Site-wide banner/footer PDFs (not subject syllabi)
  /accounts-?officer/i,
  /\brfp\b/i,
  /time-?table/i,
  /vacancy/i,
  /vacancies/i,
  /lab-?requirement/i,
  /recruitment/i,
  /advertisement/i,
  /\btender\b/i,
  /appointment/i,
  /\bnotice\b/i,
  /circular/i,
  /annual-?report/i,
  /newsletter/i,
  // Regulations-and-syllabus page boilerplate — these PDFs are real and hosted
  // on the syllabus pages but are meta (cover, regulations, preface, index,
  // marking scheme blurbs). They parse to ~200 chars and confuse the AI.
  /\/\d+\.?-?(cover|cover-?page|index|preface|regulations?|table-?of-?contents|toc)-?/i,
  /-(cover|cover-?page|index|preface|regulations?)\.pdf/i,
  // Appendix PDFs (prescribed textbook lists etc.) and Syllabus-Contents TOCs
  /syllabus-?contents?\b/i,
  /-appendix(-[ivxlcdm]+|-\d+)?\b/i,
  /prescribed-?textbooks?/i,
];

/**
 * Extract PDF URLs from a CISCE (Elementor) page. Plain `<a href>` covers < 5% of
 * links on these pages — the rest are rendered as `<div onClick="window.open(...)">`
 * or as data attributes for Elementor's JS link handler. Try all three patterns.
 */
export function extractCiscePdfUrls(html: string): string[] {
  const out = new Set<string>();

  // 1. <a href="...pdf">
  const aRe = /<a\s+[^>]*href=["']([^"']+\.pdf[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(html)) !== null) {
    out.add(m[1].trim());
  }

  // 2. onClick="window.open('URL', ...)" with HTML-encoded single quotes
  const clickRe = /onClick=["']window\.open\(&#0?39;([^&]+?\.pdf[^&]*)&#0?39;/gi;
  while ((m = clickRe.exec(html)) !== null) {
    out.add(m[1].trim());
  }

  // 3. data-ra-element-link='{"url":"..."}'
  const dataRe = /data-ra-element-link=["']\{[^}]*&quot;url&quot;:&quot;([^&]+?\.pdf[^&]*)&quot;/gi;
  while ((m = dataRe.exec(html)) !== null) {
    out.add(m[1].replace(/\\\//g, "/").trim());
  }

  return Array.from(out);
}

export interface IcseScrapeOptions {
  grades?: number[];
  subjectFilter?: string;
  jobId?: number;
  maxPdfs?: number;
  aiProvider?: AIProviderChoice;
  /** Restrict to sources whose label includes this substring, e.g., "ICSE 2027" or just "ISC". */
  sourceLabelFilter?: string;
  /**
   * Academic year ("YYYY-YY") to pin inserted rows to. When omitted, falls
   * back to syllabus-inserter's default ("2025-26"). CISCE publishes each
   * subject on exam-year pages (e.g. ICSE-2027 = Class X 2025-26 session),
   * so admins may want to run this scraper once per year and pin the right
   * session explicitly.
   */
  academicYear?: string;
}

export class IcseScraper extends BaseScraper {
  name = "ICSE Scraper";
  boardCode = "ICSE";

  async scrape(options?: IcseScrapeOptions): Promise<number> {
    const jobId = options?.jobId;
    let itemsProcessed = 0;

    try {
      const [board] = await db
        .select()
        .from(boards)
        .where(eq(boards.code, "ICSE"))
        .limit(1);

      if (!board) {
        throw new Error("ICSE board not found in database. Run seed first.");
      }

      this.log(`Starting ICSE syllabus scrape (board id: ${board.id})`);

      // Collect PDF links across all seed pages, carrying the per-source defaultGrade
      // forward so inferGrade() can fall back to it when the PDF itself is silent.
      interface PdfCandidate {
        url: string;
        defaultGrade: number;
        sourceLabel: string;
      }
      const candidates: PdfCandidate[] = [];
      const seen = new Set<string>();

      const sources = options?.sourceLabelFilter
        ? ICSE_SYLLABUS_SOURCES.filter((s) =>
            s.label.toLowerCase().includes(options.sourceLabelFilter!.toLowerCase())
          )
        : ICSE_SYLLABUS_SOURCES;

      for (const src of sources) {
        this.log(`Fetching seed page: ${src.url} (defaultGrade=${src.defaultGrade})`);
        const pageResult = await this.fetchText(src.url);

        if (!pageResult.success || !pageResult.data) {
          this.log(`  Failed to fetch: ${pageResult.error}. Trying next page...`);
          continue;
        }

        const raw = extractCiscePdfUrls(pageResult.data);
        const resolved = raw
          .map((u) => resolveUrl(src.url, u))
          .filter((u) => /^https?:\/\//i.test(u))
          .filter((u) => !NON_SYLLABUS_URL_PATTERNS.some((re) => re.test(u)));

        let added = 0;
        for (const url of resolved) {
          if (seen.has(url)) continue;
          seen.add(url);
          candidates.push({ url, defaultGrade: src.defaultGrade, sourceLabel: src.label });
          added++;
        }
        this.log(
          `  Extracted ${raw.length} raw URLs → ${resolved.length} after filter → ${added} new`
        );
      }

      this.log(`Total unique syllabus PDF candidates: ${candidates.length}`);

      if (candidates.length === 0) {
        this.log("No PDF links found. Check CISCE page structure / URL rotation.");
        return 0;
      }

      const maxPdfs = options?.maxPdfs ?? candidates.length;
      const toProcess = candidates.slice(0, maxPdfs);

      if (jobId) {
        await this.updateJob(jobId, {
          status: "running",
          itemsFound: toProcess.length,
        });
      }

      for (let i = 0; i < toProcess.length; i++) {
        const { url, defaultGrade, sourceLabel } = toProcess[i];
        this.log(`\n[${i + 1}/${toProcess.length}] [${sourceLabel}] ${url}`);

        try {
          const ok = await this.processPdf(url, board.id, defaultGrade, options);
          if (ok) itemsProcessed++;
        } catch (err) {
          this.logError(`Failed to process PDF: ${url}`, err);
        }

        if (jobId) {
          await this.updateJob(jobId, { itemsProcessed: i + 1 });
        }
      }

      this.log(`\nScrape complete. Processed ${itemsProcessed}/${toProcess.length} PDFs.`);
      return itemsProcessed;
    } catch (err) {
      this.logError("Scrape failed", err);
      if (jobId) {
        await this.updateJob(jobId, {
          status: "failed",
          errorLog: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  }

  private async processPdf(
    pdfUrl: string,
    boardId: number,
    defaultGrade: number,
    options?: IcseScrapeOptions
  ): Promise<boolean> {
    this.log("  Downloading PDF...");
    const pdfResult = await this.fetchPdf(pdfUrl);
    if (!pdfResult.success || !pdfResult.data) {
      this.logError(`  Download failed: ${pdfResult.error}`);
      return false;
    }
    this.log(`  Downloaded (${(pdfResult.data.length / 1024).toFixed(1)} KB)`);

    this.log("  Extracting text...");
    let pdfText: string;
    try {
      pdfText = await extractTextFromPdf(pdfResult.data);
    } catch (err) {
      this.logError("  PDF text extraction failed", err);
      return false;
    }

    // Real CISCE syllabus PDFs are several thousand chars of extracted text.
    // Anything under ~1.5k is almost certainly a cover/regulations/TOC page
    // (or an image-only PDF we can't handle without OCR).
    if (pdfText.trim().length < 1500) {
      this.log(
        `  Skipping — PDF text too short (${pdfText.trim().length} chars; likely cover/boilerplate or image-only)`
      );
      return false;
    }
    this.log(`  Extracted ${pdfText.length} chars`);

    // Grade: prefer URL/text inference, fall back to the seed page's defaultGrade.
    const inferred = this.inferGrade(pdfUrl, pdfText);
    const grade = inferred ?? defaultGrade;
    if (inferred) {
      this.log(`  Detected grade from PDF: Class ${grade}`);
    } else {
      this.log(`  Using defaultGrade from seed page: Class ${grade}`);
    }

    if (options?.grades && !options.grades.includes(grade)) {
      this.log(`  Skipping — grade ${grade} not in requested grades`);
      return false;
    }

    const models = resolveModelWithFallbacks(options?.aiProvider);
    this.log(`  Sending to AI for parsing (trying: ${models.join(", ")})...`);
    const userPrompt = buildUserPrompt({
      pdfText,
      boardCode: "ICSE",
      grade,
      subjectHint: options?.subjectFilter,
    });

    // Retry loop: on both network-level aiChat failures AND JSON-validation
    // failures (Gemini regularly emits malformed JSON on long syllabi — trailing
    // commas, unquoted property names, unterminated strings), we fall back to the
    // next model. Previously a parseResponse failure short-circuited the whole PDF
    // after the first model, wasting the fallback models configured by the caller.
    let parsed: SyllabusParseResult | null = null;
    let usedModel: string | undefined;
    let lastErr: unknown = null;
    for (const model of models) {
      try {
        const aiResult = await aiChat(userPrompt, {
          model,
          systemPrompt: SYSTEM_PROMPT,
          temperature: promptConfig.temperature,
          maxTokens: promptConfig.maxTokens,
        });
        this.log(
          `  AI response (${model}): ${aiResult.inputTokens} in / ${aiResult.outputTokens} out ($${aiResult.costUsd.toFixed(4)})`
        );
        try {
          parsed = parseResponse(aiResult.content);
          usedModel = model;
          break;
        } catch (parseErr) {
          lastErr = parseErr;
          this.logError(
            `  AI response validation failed for ${model} — trying next model`,
            parseErr
          );
          continue;
        }
      } catch (err) {
        lastErr = err;
        this.logError(`  AI call failed with model ${model}`, err);
        continue;
      }
    }
    if (!parsed) {
      this.logError(`  All AI models failed for ${pdfUrl}`, lastErr);
      return false;
    }

    this.log(
      `  Parsed: ${parsed.subjectName} (${parsed.subjectCode}) — ${parsed.chapters.length} chapters` +
        (parsed.academicYear ? ` (AI-inferred ay=${parsed.academicYear})` : "")
    );

    // CISCE publishes syllabi on exam-year pages (ICSE-2027, ISC-2028 etc.), so the
    // AI tends to infer `academicYear = "2027"` or "2026-27". That breaks the
    // standards lookup — we seed ICSE standards with academicYear = "2025-26" and
    // treat each PDF as the canonical syllabus for the current academic year. Drop
    // the inferred value so insertParsedSyllabus falls back to its "2025-26" default.
    //
    // Preserve the AI's inference as provenance metadata on the subject so we can
    // surface "syllabus edition: ICSE 2027" to admins later.
    const aiInferredAcademicYear = parsed.academicYear ?? null;
    parsed.academicYear = null;
    // Likewise drop stream — CISCE doesn't use CBSE-style Science/Commerce/Humanities
    // streams, and our standards rows are seeded with stream = null.
    parsed.stream = null;

    // CISCE publishes regional variants (Thailand, UAE, Singapore etc.) under the
    // same subject name → same AI-inferred subjectCode. Without a suffix they
    // collide on the (standardId, code) unique constraint and silently merge —
    // earliest PDF wins, later variants graft only their non-overlapping chapters
    // onto the wrong subject. Append a region suffix so variants stay separate.
    const regionSuffix = this.inferRegionSuffix(pdfUrl);
    if (regionSuffix) {
      const origCode = parsed.subjectCode;
      const origName = parsed.subjectName;
      parsed.subjectCode = `${origCode}_${regionSuffix}`.slice(0, 50);
      parsed.subjectName = `${origName} (${regionSuffix})`;
      this.log(
        `  Region variant detected — code="${origCode}"→"${parsed.subjectCode}", name="${origName}"→"${parsed.subjectName}"`
      );
    }

    this.log("  Inserting into database...");
    await insertParsedSyllabus(boardId, grade, parsed, (msg) => this.log(msg), {
      pdfUrl,
      aiModel: usedModel,
      scrapeJobId: options?.jobId,
      boardCode: "ICSE",
      // Scraper-supplied year wins over syllabus-inserter's default. When
      // unset, inserter falls through to "2025-26" and legacy behavior is
      // preserved. Logged below so the admin can see which year was used.
      academicYear: options?.academicYear,
    });
    if (aiInferredAcademicYear) {
      this.log(
        `  (AI inferred academicYear=${aiInferredAcademicYear}; filed under ${options?.academicYear ?? "2025-26"})`
      );
    }
    this.log("  Done.");

    return true;
  }

  /**
   * Extract a region suffix from the URL for CISCE's regional syllabus variants
   * (Thailand, UAE, Singapore etc. — published for Indian students at select
   * overseas CISCE-affiliated schools). Without this suffix, the regional
   * variants collide on subjectCode with the main ICSE syllabi.
   */
  private inferRegionSuffix(url: string): string | null {
    // Match "-<Region>." or "-<Region>-" case-insensitively
    const regions = ["Thailand", "UAE", "Singapore", "Dubai", "Malaysia", "Oman", "Qatar"];
    for (const region of regions) {
      const re = new RegExp(`[-_]${region}[-_.]`, "i");
      if (re.test(url)) return region.toUpperCase().slice(0, 10); // TH, UAE, SG, DUBAI, MY, OM, QA
    }
    return null;
  }

  /**
   * Infer grade from URL or PDF text. Returns null if nothing matches —
   * caller should then fall back to the seed page's defaultGrade.
   *
   * ICSE/ISC syllabus PDFs rarely carry the grade in the filename; most
   * will return null here and rely on the seed-page default.
   */
  private inferGrade(url: string, text: string): number | null {
    const urlPatterns = [
      /class[_-]?(\d{1,2})/i,
      /grade[_-]?(\d{1,2})/i,
      /std[_-]?(\d{1,2})/i,
      /\b(\d{1,2})th\b/i,
    ];
    for (const pattern of urlPatterns) {
      const match = url.match(pattern);
      if (match) {
        const grade = parseInt(match[1], 10);
        if (grade >= 1 && grade <= 12) return grade;
      }
    }

    const romanMap: Record<string, number> = {
      XII: 12, XI: 11, X: 10, IX: 9, VIII: 8, VII: 7, VI: 6, V: 5, IV: 4,
    };
    for (const [roman, num] of Object.entries(romanMap)) {
      // Look for Roman numerals only in path segments / token boundaries, not as
      // random substrings of longer filenames. Put the `-` at the end of each
      // char class to keep it literal (otherwise `[/_-.]` parses as a range).
      const re = new RegExp(`[/_.-]${roman}[/_.-]`, "i");
      if (re.test(url)) return num;
    }

    const head = text.slice(0, 2000);
    const textMatch = head.match(/class[:\s-]*(\d{1,2})/i);
    if (textMatch) {
      const grade = parseInt(textMatch[1], 10);
      if (grade >= 1 && grade <= 12) return grade;
    }

    return null;
  }
}
