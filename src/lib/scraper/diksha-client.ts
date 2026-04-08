/**
 * DIKSHA / Sunbird API Client
 *
 * DIKSHA is India's national education platform (diksha.gov.in) built on
 * the Sunbird platform. It provides a public Composite Search API for
 * querying textbooks, lesson plans, practice sets, and other educational
 * content across all Indian boards.
 *
 * No API key needed — the search API is public.
 *
 * Rate limit: max 10 req/sec to be respectful.
 * Raw responses are stored locally under data/diksha-raw/ for audit
 * (will migrate to S3 diksha-raw/ prefix in production).
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { db } from "@/db";
import { contentPipelineLogs } from "@/db/schema/system";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIKSHA_BASE = "https://diksha.gov.in";
const COMPOSITE_SEARCH_URL = `${DIKSHA_BASE}/api/composite/v1/search`;
const CONTENT_READ_URL = `${DIKSHA_BASE}/api/content/v1/read`;
const CONTENT_HIERARCHY_URL = `${DIKSHA_BASE}/api/course/v1/hierarchy`;

const MAX_PAGE_SIZE = 100;
const RATE_LIMIT_MS = 100; // 10 req/sec = 100ms between requests
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; PadvikBot/1.0; +https://padvik.in/bot; educational-content)";

const DATA_DIR = join(process.cwd(), "data", "diksha-raw");

// ---------------------------------------------------------------------------
// Types — DIKSHA API response shapes
// ---------------------------------------------------------------------------

/** A single content item from DIKSHA search results */
export interface DikshaContent {
  identifier: string;
  name: string;
  description?: string;
  board?: string;
  gradeLevel?: string[];
  subject?: string[];
  medium?: string[];
  contentType?: string;
  mimeType?: string;
  artifactUrl?: string;
  downloadUrl?: string;
  previewUrl?: string;
  streamingUrl?: string;
  framework?: string;
  topic?: string[];
  learningOutcome?: string[];
  resourceType?: string;
  status?: string;
  posterImage?: string;
  /** Nested children for textbook TOC */
  children?: DikshaContent[];
  /** Additional DIKSHA fields we preserve in raw storage */
  [key: string]: unknown;
}

/** DIKSHA Composite Search API response */
export interface DikshaSearchResponse {
  id: string;
  ver: string;
  ts: string;
  params: {
    resmsgid: string;
    msgid: string;
    status: string;
    err: string | null;
    errmsg: string | null;
  };
  responseCode: string;
  result: {
    count: number;
    content?: DikshaContent[];
    facets?: Array<{
      name: string;
      values: Array<{ name: string; count: number }>;
    }>;
  };
}

/** DIKSHA Content Read API response */
export interface DikshaContentReadResponse {
  id: string;
  ver: string;
  ts: string;
  params: { resmsgid: string; status: string };
  responseCode: string;
  result: {
    content: DikshaContent;
  };
}

/** DIKSHA Hierarchy API response (for textbook TOC) */
export interface DikshaHierarchyResponse {
  id: string;
  ver: string;
  ts: string;
  params: { resmsgid: string; status: string };
  responseCode: string;
  result: {
    content: DikshaContent;
  };
}

/** Filters for DIKSHA search */
export interface DikshaSearchFilters {
  board?: string[];
  gradeLevel?: string[];
  subject?: string[];
  medium?: string[];
  contentType?: string[];
  status?: string[];
  topic?: string[];
  resourceType?: string[];
}

/** Padvik-friendly content type */
export type PadvikContentType =
  | "note"
  | "explanation"
  | "lesson_plan"
  | "question_set"
  | "textbook"
  | "video"
  | "interactive";

// ---------------------------------------------------------------------------
// Board mapping — DIKSHA board names → our board codes
// ---------------------------------------------------------------------------

const DIKSHA_BOARD_MAP: Record<string, string> = {
  "CBSE": "CBSE",
  "State (Kerala)": "KL_SCERT",
  "State (Karnataka)": "KA_KSEAB",
  "State (Tamil Nadu)": "TN_DGE",
  "State (Maharashtra)": "MH_MSBSHSE",
  "State (Andhra Pradesh)": "AP_BSEAP",
  "State (Telangana)": "TS_BSETS",
  "State (Rajasthan)": "RJ_RBSE",
  "State (Uttar Pradesh)": "UP_UPMSP",
  "State (Madhya Pradesh)": "MP_MPBSE",
  "State (Gujarat)": "GJ_GSEB",
  "State (Bihar)": "BR_BSEB",
  "State (West Bengal)": "WB_WBBSE",
  "State (Punjab)": "PB_PSEB",
  "State (Haryana)": "HR_BSEH",
  "State (Assam)": "AS_SEBA",
  "State (Odisha)": "OD_BSE",
  "State (Chhattisgarh)": "CG_CGBSE",
  "State (Jharkhand)": "JH_JAC",
  "State (Uttarakhand)": "UK_UBSE",
  "State (Himachal Pradesh)": "HP_HPBOSE",
  "State (Goa)": "GA_GBSHSE",
  "State (Jammu And Kashmir)": "JK_JKBOSE",
  "ICSE": "ICSE",
};

/** Reverse lookup: our board code → DIKSHA board name */
const OUR_CODE_TO_DIKSHA: Record<string, string> = {};
for (const [dName, ourCode] of Object.entries(DIKSHA_BOARD_MAP)) {
  OUR_CODE_TO_DIKSHA[ourCode] = dName;
}

/**
 * Convert a DIKSHA board name to our internal board code.
 * Returns the original string if no mapping exists.
 */
export function dikshaBoardToOurCode(dikshaBoard: string): string {
  return DIKSHA_BOARD_MAP[dikshaBoard] ?? dikshaBoard;
}

/**
 * Convert our board code to DIKSHA board name for API queries.
 * Returns the original string if no mapping exists.
 */
export function ourCodeToDikshaBoard(ourCode: string): string {
  return OUR_CODE_TO_DIKSHA[ourCode] ?? ourCode;
}

// ---------------------------------------------------------------------------
// Grade mapping — DIKSHA grade strings → numbers
// ---------------------------------------------------------------------------

/**
 * Convert DIKSHA grade string ("Class 10", "Class 1") to a number (10, 1).
 * Returns 0 if parsing fails.
 */
export function dikshaGradeToNumber(gradeStr: string): number {
  const match = gradeStr.match(/class\s+(\d+)/i);
  if (match) return parseInt(match[1], 10);

  // Try Roman numerals
  const romanMatch = gradeStr.match(/class\s+(xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b/i);
  if (romanMatch) {
    const romanMap: Record<string, number> = {
      i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6,
      vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12,
    };
    return romanMap[romanMatch[1].toLowerCase()] ?? 0;
  }

  return 0;
}

/**
 * Convert a grade number to DIKSHA grade string.
 */
export function numberToDikshaGrade(grade: number): string {
  return `Class ${grade}`;
}

// ---------------------------------------------------------------------------
// Content type mapping
// ---------------------------------------------------------------------------

/**
 * Map DIKSHA contentType to our internal content type.
 */
export function dikshaContentTypeToOurs(dikshaType: string): PadvikContentType {
  switch (dikshaType) {
    case "TextBook":
    case "TextBookUnit":
      return "textbook";
    case "ExplanationContent":
    case "ExplanationResource":
      return "explanation";
    case "LessonPlan":
    case "LessonPlanResource":
      return "lesson_plan";
    case "PracticeQuestionSet":
    case "PracticeResource":
      return "question_set";
    case "Resource":
      return "note";
    default:
      return "note";
  }
}

/**
 * Map DIKSHA mimeType to a general media category.
 */
export function dikshaMediaType(mimeType?: string): "pdf" | "video" | "html" | "interactive" | "unknown" {
  if (!mimeType) return "unknown";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("video/") || mimeType === "video/x-youtube") return "video";
  if (mimeType === "application/vnd.ekstep.ecml-archive") return "html";
  if (mimeType === "application/vnd.ekstep.h5p-archive") return "interactive";
  if (mimeType === "text/html" || mimeType === "application/html") return "html";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Raw response storage (local dev → S3 in production)
// ---------------------------------------------------------------------------

function saveRawResponse(category: string, identifier: string, data: unknown): string {
  const dir = join(DATA_DIR, category);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filename = `${identifier.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
  const filePath = join(dir, filename);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return `data/diksha-raw/${category}/${filename}`;
}

function saveArtifact(board: string, grade: number, filename: string, buffer: Buffer): string {
  const dir = join(DATA_DIR, "artifacts", board, String(grade));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = join(dir, sanitized);
  writeFileSync(filePath, buffer);
  return `data/diksha-raw/artifacts/${board}/${grade}/${sanitized}`;
}

// ---------------------------------------------------------------------------
// DIKSHA Client
// ---------------------------------------------------------------------------

export class DikshaClient {
  private lastRequestTime = 0;
  private requestCount = 0;

  constructor(
    private readonly logPrefix = "[DIKSHA]"
  ) {}

  // ---- Public API Methods ----

  /**
   * Search DIKSHA content using the Composite Search API.
   * Handles pagination automatically if limit > 100.
   */
  async searchContent(
    filters: DikshaSearchFilters,
    limit: number = 100,
    offset: number = 0,
    fields?: string[]
  ): Promise<{ count: number; content: DikshaContent[] }> {
    const pageSize = Math.min(limit, MAX_PAGE_SIZE);

    const body = {
      request: {
        filters: {
          ...filters,
          status: filters.status ?? ["Live"],
        },
        limit: pageSize,
        offset,
        ...(fields ? { fields } : {
          fields: [
            "name", "identifier", "description", "board", "gradeLevel",
            "subject", "medium", "contentType", "mimeType", "artifactUrl",
            "downloadUrl", "previewUrl", "streamingUrl", "framework",
            "topic", "learningOutcome", "resourceType", "status", "posterImage",
          ],
        }),
      },
    };

    const response = await this.postJson<DikshaSearchResponse>(
      COMPOSITE_SEARCH_URL,
      body
    );

    if (response.responseCode !== "OK") {
      throw new Error(
        `DIKSHA search failed: ${response.params?.errmsg ?? response.responseCode}`
      );
    }

    // Save raw response for audit
    const auditId = `search_${Date.now()}_${offset}`;
    saveRawResponse("search", auditId, response);

    return {
      count: response.result.count,
      content: response.result.content ?? [],
    };
  }

  /**
   * Search with automatic pagination — fetches all results up to `limit`.
   */
  async searchAll(
    filters: DikshaSearchFilters,
    limit: number = 500
  ): Promise<DikshaContent[]> {
    const allContent: DikshaContent[] = [];
    let offset = 0;
    let totalCount = Infinity;

    while (allContent.length < limit && offset < totalCount) {
      const pageSize = Math.min(MAX_PAGE_SIZE, limit - allContent.length);
      const result = await this.searchContent(filters, pageSize, offset);
      totalCount = result.count;
      allContent.push(...result.content);
      offset += result.content.length;

      if (result.content.length === 0) break; // No more results

      this.log(`  Fetched ${allContent.length}/${Math.min(totalCount, limit)} results`);
    }

    return allContent.slice(0, limit);
  }

  /**
   * Get the full hierarchy (TOC) of a textbook — chapters, units, topics.
   */
  async getTextbookTOC(textbookId: string): Promise<DikshaContent> {
    const url = `${CONTENT_HIERARCHY_URL}/${textbookId}`;
    const response = await this.getJson<DikshaHierarchyResponse>(url);

    if (response.responseCode !== "OK") {
      throw new Error(
        `DIKSHA hierarchy failed for ${textbookId}: ${response.params?.status ?? response.responseCode}`
      );
    }

    saveRawResponse("toc", textbookId, response);
    return response.result.content;
  }

  /**
   * Get detailed metadata for a single content item.
   */
  async getContentDetails(contentId: string): Promise<DikshaContent> {
    const url = `${CONTENT_READ_URL}/${contentId}`;
    const response = await this.getJson<DikshaContentReadResponse>(url);

    if (response.responseCode !== "OK") {
      throw new Error(
        `DIKSHA content read failed for ${contentId}: ${response.params?.status ?? response.responseCode}`
      );
    }

    saveRawResponse("content", contentId, response);
    return response.result.content;
  }

  /**
   * Download an artifact (PDF, HTML, ECML) from a DIKSHA URL.
   * Returns the raw buffer and the local storage path.
   */
  async downloadArtifact(
    artifactUrl: string,
    boardCode: string,
    grade: number,
    filename?: string
  ): Promise<{ buffer: Buffer; storagePath: string } | null> {
    if (!artifactUrl) return null;

    // Resolve relative URLs
    const fullUrl = artifactUrl.startsWith("http")
      ? artifactUrl
      : `${DIKSHA_BASE}${artifactUrl}`;

    const result = await this.fetchBuffer(fullUrl);
    if (!result) return null;

    const fname = filename ?? fullUrl.split("/").pop() ?? `artifact_${Date.now()}`;
    const storagePath = saveArtifact(boardCode, grade, fname, result);

    return { buffer: result, storagePath };
  }

  // ---- Convenience search methods ----

  /**
   * Search for textbooks for a given board and grade range.
   */
  async searchTextbooks(
    board: string,
    gradeStart: number,
    gradeEnd: number,
    subject?: string,
    medium?: string
  ): Promise<DikshaContent[]> {
    const dikshaBoard = OUR_CODE_TO_DIKSHA[board] ?? board;
    const gradeLevels = [];
    for (let g = gradeStart; g <= gradeEnd; g++) {
      gradeLevels.push(numberToDikshaGrade(g));
    }

    const filters: DikshaSearchFilters = {
      board: [dikshaBoard],
      gradeLevel: gradeLevels,
      contentType: ["TextBook"],
      ...(subject ? { subject: [subject] } : {}),
      ...(medium ? { medium: [medium] } : {}),
    };

    return this.searchAll(filters);
  }

  /**
   * Search for content linked to a specific topic.
   */
  async searchTopicContent(
    board: string,
    gradeLevel: string,
    subject: string,
    topic: string,
    contentTypes?: string[]
  ): Promise<DikshaContent[]> {
    const dikshaBoard = OUR_CODE_TO_DIKSHA[board] ?? board;
    const filters: DikshaSearchFilters = {
      board: [dikshaBoard],
      gradeLevel: [gradeLevel],
      subject: [subject],
      topic: [topic],
      contentType: contentTypes ?? [
        "ExplanationContent",
        "PracticeQuestionSet",
        "LessonPlan",
        "Resource",
      ],
    };

    return this.searchAll(filters, 50);
  }

  // ---- HTTP helpers with rate limiting and retry ----

  private async postJson<T>(url: string, body: unknown): Promise<T> {
    return this.requestJson<T>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  private async getJson<T>(url: string): Promise<T> {
    return this.requestJson<T>(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
  }

  private async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.rateLimit();

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await globalThis.fetch(url, {
          ...init,
          signal: controller.signal,
        });

        clearTimeout(timeout);
        this.requestCount++;

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          lastError = new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);

          if (response.status === 429 || response.status >= 500) {
            this.log(`  Retry ${attempt + 1}/${MAX_RETRIES} for ${url} (${response.status})`);
            await this.backoff(attempt);
            continue;
          }
          throw lastError;
        }

        return (await response.json()) as T;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          lastError = new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms: ${url}`);
        } else if (err instanceof Error) {
          lastError = err;
        } else {
          lastError = new Error(String(err));
        }

        if (attempt < MAX_RETRIES) {
          this.log(`  Retry ${attempt + 1}/${MAX_RETRIES}: ${lastError.message}`);
          await this.backoff(attempt);
        }
      }
    }

    throw lastError ?? new Error(`Failed after ${MAX_RETRIES + 1} attempts: ${url}`);
  }

  private async fetchBuffer(url: string): Promise<Buffer | null> {
    let lastError: string = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.rateLimit();

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await globalThis.fetch(url, {
          headers: { "User-Agent": USER_AGENT },
          signal: controller.signal,
        });

        clearTimeout(timeout);
        this.requestCount++;

        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          if (response.status === 429 || response.status >= 500) {
            await this.backoff(attempt);
            continue;
          }
          this.log(`  Download failed: ${lastError} for ${url}`);
          return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_RETRIES) {
          await this.backoff(attempt);
        }
      }
    }

    this.log(`  Download failed after retries: ${lastError}`);
    return null;
  }

  /**
   * Rate limiting — 10 req/sec max.
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < RATE_LIMIT_MS) {
      await sleep(RATE_LIMIT_MS - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  private async backoff(attempt: number): Promise<void> {
    const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.random() * base * 0.3;
    await sleep(base + jitter);
  }

  private log(message: string): void {
    console.log(`${this.logPrefix} ${message}`);
  }

  // ---- Pipeline logging ----

  /**
   * Log a DIKSHA pipeline event to contentPipelineLogs.
   */
  async logPipeline(
    stage: string,
    entityId: number,
    status: string,
    data: Record<string, unknown>,
    processingTimeMs?: number
  ): Promise<void> {
    try {
      await db.insert(contentPipelineLogs).values({
        pipelineStage: stage,
        entityType: "scrape_job",
        entityId,
        status,
        outputData: data,
        processingTimeMs: processingTimeMs ?? null,
        aiProvider: "diksha_api",
      });
    } catch {
      // Don't fail the operation if logging fails
    }
  }

  /** Get the total number of HTTP requests made by this client instance */
  get totalRequests(): number {
    return this.requestCount;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
