/**
 * Board notification scraper — fetches exam dates, results, circulars, and news
 * from official Indian education board websites.
 *
 * Each board has a registered parser that knows how to extract notifications
 * from its specific HTML structure. The orchestrator fetches, parses, deduplicates,
 * and AI-categorizes new notifications before storing them.
 */
import * as cheerio from "cheerio";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { boards } from "@/db/schema/curriculum";
import { boardNotifications } from "@/db/schema/notifications";
import { aiChat, AI_MODELS } from "@/lib/ai/provider";
import type { AILogContext } from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface RawNotification {
  title: string;
  date: string;
  sourceUrl: string;
  pdfUrl?: string;
  rawHtml?: string;
}

export interface NotificationParser {
  boardCode: string;
  urls: string[];
  parse(html: string, baseUrl: string): RawNotification[];
}

interface ScrapeResult {
  scraped: number;
  new: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// AI categorization schema
// ---------------------------------------------------------------------------
const categorizationSchema = z.object({
  category: z.enum([
    "exam_date",
    "result",
    "syllabus",
    "circular",
    "admit_card",
    "policy",
    "general",
  ]),
  summary: z.string().max(500),
  affectedClasses: z.array(z.number().int().min(1).max(12)),
  priority: z.enum(["high", "medium", "low"]),
  isBreaking: z.boolean(),
});

type Categorization = z.infer<typeof categorizationSchema>;

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------
export function generateSlug(
  boardCode: string,
  title: string,
  date: string
): string {
  const year = date.match(/\d{4}/)?.[0] ?? new Date().getFullYear().toString();
  const base = `${boardCode}-${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const slug = `${base}-${year}`.slice(0, 100);
  return slug;
}

async function ensureUniqueSlug(slug: string): Promise<string> {
  let candidate = slug;
  let suffix = 1;
  while (true) {
    const existing = await db
      .select({ id: boardNotifications.id })
      .from(boardNotifications)
      .where(eq(boardNotifications.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
    suffix++;
    candidate = `${slug}-${suffix}`;
  }
}

// ---------------------------------------------------------------------------
// Date parsing helpers
// ---------------------------------------------------------------------------
function parseIndianDate(raw: string): string {
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // YYYY-MM-DD already
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  // Month DD, YYYY
  const monthNames: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
    jan: "01", feb: "02", mar: "03", apr: "04",
    jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const mdy = raw.match(
    /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i
  );
  if (mdy) {
    const month = monthNames[mdy[1].toLowerCase()];
    if (month) {
      return `${mdy[3]}-${month}-${mdy[2].padStart(2, "0")}`;
    }
  }
  // DD Month YYYY
  const dmy2 = raw.match(/(\d{1,2})\s+(\w+),?\s+(\d{4})/i);
  if (dmy2) {
    const month = monthNames[dmy2[2].toLowerCase()];
    if (month) {
      return `${dmy2[3]}-${month}-${dmy2[1].padStart(2, "0")}`;
    }
  }
  // Fallback: today
  return new Date().toISOString().slice(0, 10);
}

function resolveUrl(base: string, relative: string): string {
  if (relative.startsWith("http://") || relative.startsWith("https://")) {
    return relative;
  }
  try {
    return new URL(relative, base).href;
  } catch {
    return `${base.replace(/\/+$/, "")}/${relative.replace(/^\/+/, "")}`;
  }
}

// ---------------------------------------------------------------------------
// Board-specific parsers
// ---------------------------------------------------------------------------

const cbseParser: NotificationParser = {
  boardCode: "CBSE",
  urls: [
    "https://www.cbse.gov.in/cbsenew/cbse.html",
    "https://cbseacademic.nic.in/circulars.html",
  ],
  parse(html: string, baseUrl: string): RawNotification[] {
    const $ = cheerio.load(html);
    const results: RawNotification[] = [];

    // CBSE main page: notifications in <li> or <p> elements with date + link
    $("li, p, tr").each((_i, el) => {
      const text = $(el).text().trim();
      if (!text || text.length < 10) return;

      const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (!dateMatch && !$(el).find("a").length) return;

      const link = $(el).find("a").first();
      const href = link.attr("href");
      if (!href) return;

      const absUrl = resolveUrl(baseUrl, href);
      const title = link.text().trim() || text.replace(/\d{2}\/\d{2}\/\d{4}/, "").trim();
      if (!title || title.length < 5) return;

      const isPdf = absUrl.toLowerCase().endsWith(".pdf");

      results.push({
        title: title.slice(0, 1000),
        date: dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10),
        sourceUrl: absUrl,
        pdfUrl: isPdf ? absUrl : undefined,
        rawHtml: $(el).html() ?? undefined,
      });
    });

    return results;
  },
};

const icseParser: NotificationParser = {
  boardCode: "ICSE",
  urls: ["https://www.cisce.org"],
  parse(html: string, baseUrl: string): RawNotification[] {
    const $ = cheerio.load(html);
    const results: RawNotification[] = [];

    // CISCE: news/announcements section — cards or list items
    $(".news-item, .announcement, .notification-item, .card, article, .notice-board li, .marquee-content li, .ticker li").each(
      (_i, el) => {
        const link = $(el).find("a").first();
        const href = link.attr("href");
        const title =
          $(el).find("h3, h4, .title, .heading").first().text().trim() ||
          link.text().trim() ||
          $(el).text().trim();
        if (!title || title.length < 5) return;

        const dateText = $(el).find(".date, time, .posted-date").text().trim() || $(el).text();
        const dateMatch = dateText.match(
          /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}|\w+ \d{1,2},?\s+\d{4}|\d{1,2}\s+\w+\s+\d{4})/
        );

        const sourceUrl = href ? resolveUrl(baseUrl, href) : `${baseUrl}#${encodeURIComponent(title.slice(0, 80))}`;

        results.push({
          title: title.slice(0, 1000),
          date: dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10),
          sourceUrl,
          pdfUrl: sourceUrl.toLowerCase().endsWith(".pdf") ? sourceUrl : undefined,
          rawHtml: $(el).html() ?? undefined,
        });
      }
    );

    return results;
  },
};

const keralaParser: NotificationParser = {
  boardCode: "KL_SCERT",
  urls: [
    "https://www.dhsekerala.gov.in",
    "https://keralapareekshabhavan.in",
  ],
  parse(html: string, baseUrl: string): RawNotification[] {
    const $ = cheerio.load(html);
    const results: RawNotification[] = [];

    // Kerala: table rows or list items with date + title
    $("tr, li, .notification, .news-item, .circular-item").each((_i, el) => {
      const cells = $(el).find("td");
      let title = "";
      let dateRaw = "";
      let href = "";

      if (cells.length >= 2) {
        // Table format: date | title with link
        dateRaw = cells.first().text().trim();
        title = cells.eq(1).text().trim();
        href = cells.find("a").first().attr("href") ?? "";
      } else {
        const link = $(el).find("a").first();
        title = link.text().trim() || $(el).text().trim();
        href = link.attr("href") ?? "";
        const dateMatch = $(el).text().match(
          /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/
        );
        dateRaw = dateMatch ? dateMatch[1] : "";
      }

      if (!title || title.length < 5) return;
      if (!href) return;

      const sourceUrl = resolveUrl(baseUrl, href);

      results.push({
        title: title.slice(0, 1000),
        date: dateRaw || new Date().toISOString().slice(0, 10),
        sourceUrl,
        pdfUrl: sourceUrl.toLowerCase().endsWith(".pdf") ? sourceUrl : undefined,
        rawHtml: $(el).html() ?? undefined,
      });
    });

    return results;
  },
};

const karnatakaParser: NotificationParser = {
  boardCode: "KA_KSEAB",
  urls: ["https://kseab.karnataka.gov.in"],
  parse(html: string, baseUrl: string): RawNotification[] {
    const $ = cheerio.load(html);
    const results: RawNotification[] = [];

    $(".notification, .news, .circular, li, tr").each((_i, el) => {
      const link = $(el).find("a").first();
      const href = link.attr("href");
      if (!href) return;

      const title = link.text().trim() || $(el).text().trim();
      if (!title || title.length < 5) return;

      const dateMatch = $(el).text().match(
        /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}|\d{1,2}\s+\w+\s+\d{4})/
      );

      const sourceUrl = resolveUrl(baseUrl, href);

      results.push({
        title: title.slice(0, 1000),
        date: dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10),
        sourceUrl,
        pdfUrl: sourceUrl.toLowerCase().endsWith(".pdf") ? sourceUrl : undefined,
        rawHtml: $(el).html() ?? undefined,
      });
    });

    return results;
  },
};

const tamilNaduParser: NotificationParser = {
  boardCode: "TN_DGE",
  urls: ["https://dge.tn.gov.in"],
  parse(html: string, baseUrl: string): RawNotification[] {
    const $ = cheerio.load(html);
    const results: RawNotification[] = [];

    // Tamil Nadu DGE: news ticker or notification list
    $(".news-ticker li, .notification li, .marquee li, .notice li, tr, .list-group-item").each(
      (_i, el) => {
        const link = $(el).find("a").first();
        const href = link.attr("href");
        if (!href) return;

        const title = link.text().trim() || $(el).text().trim();
        if (!title || title.length < 5) return;

        const dateMatch = $(el).text().match(
          /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/
        );

        const sourceUrl = resolveUrl(baseUrl, href);

        results.push({
          title: title.slice(0, 1000),
          date: dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10),
          sourceUrl,
          pdfUrl: sourceUrl.toLowerCase().endsWith(".pdf") ? sourceUrl : undefined,
          rawHtml: $(el).html() ?? undefined,
        });
      }
    );

    return results;
  },
};

const maharashtraParser: NotificationParser = {
  boardCode: "MH_MSBSHSE",
  urls: ["https://mahahsscboard.in"],
  parse(html: string, baseUrl: string): RawNotification[] {
    const $ = cheerio.load(html);
    const results: RawNotification[] = [];

    $(".news li, .circular li, .notification li, tr, .card, article").each(
      (_i, el) => {
        const link = $(el).find("a").first();
        const href = link.attr("href");
        if (!href) return;

        const title = link.text().trim() || $(el).text().trim();
        if (!title || title.length < 5) return;

        const dateMatch = $(el).text().match(
          /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/
        );

        const sourceUrl = resolveUrl(baseUrl, href);

        results.push({
          title: title.slice(0, 1000),
          date: dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10),
          sourceUrl,
          pdfUrl: sourceUrl.toLowerCase().endsWith(".pdf") ? sourceUrl : undefined,
          rawHtml: $(el).html() ?? undefined,
        });
      }
    );

    return results;
  },
};

// ---------------------------------------------------------------------------
// Parser registry
// ---------------------------------------------------------------------------
const parserRegistry = new Map<string, NotificationParser>([
  ["CBSE", cbseParser],
  ["ICSE", icseParser],
  ["KL_SCERT", keralaParser],
  ["KA_KSEAB", karnatakaParser],
  ["TN_DGE", tamilNaduParser],
  ["MH_MSBSHSE", maharashtraParser],
]);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const lastFetchTime = new Map<string, number>();
const RATE_LIMIT_MS = 5000; // 1 request per 5 seconds per domain

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function rateLimitedFetch(url: string): Promise<string | null> {
  const domain = getDomain(url);
  const lastTime = lastFetchTime.get(domain) ?? 0;
  const elapsed = Date.now() - lastTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastFetchTime.set(domain, Date.now());

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Padvik-Bot/1.0 (educational notification service)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(
        `[NotificationScraper] HTTP ${response.status} for ${url}`
      );
      return null;
    }

    return await response.text();
  } catch (err) {
    console.warn(
      `[NotificationScraper] Fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI categorization
// ---------------------------------------------------------------------------
async function categorizeNotification(
  boardName: string,
  title: string,
  date: string,
  sourceUrl: string
): Promise<Categorization | null> {
  const prompt = `Classify this Indian education board notification.

Board: ${boardName}
Title: ${title}
Date: ${date}
URL: ${sourceUrl}

Return ONLY this JSON (no markdown, no explanation):
{
  "category": one of "exam_date","result","syllabus","circular","admit_card","policy","general",
  "summary": "1-2 sentence student-friendly summary",
  "affectedClasses": [array of class numbers like 10,12 or empty [] if general],
  "priority": "high" or "medium" or "low",
  "isBreaking": true or false (true ONLY for: exam date changes, cancellations, result declarations, admit card releases)
}`;

  try {
    const result = await aiChat(prompt, {
      model: AI_MODELS.BULK,
      temperature: 0.1,
      maxTokens: 300,
      systemPrompt:
        "You classify Indian education board notifications into categories. Respond with valid JSON only.",
    });

    // Strip any markdown code fences
    const cleaned = result.content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);
    const validated = categorizationSchema.safeParse(parsed);

    if (validated.success) {
      return validated.data;
    }

    console.warn(
      "[NotificationScraper] AI response failed Zod validation:",
      validated.error.issues
    );
    return null;
  } catch (err) {
    console.warn(
      `[NotificationScraper] AI categorization failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Board ID resolution
// ---------------------------------------------------------------------------
async function getBoardIdByCode(
  code: string
): Promise<{ id: number; name: string } | null> {
  const result = await db
    .select({ id: boards.id, name: boards.name })
    .from(boards)
    .where(eq(boards.code, code))
    .limit(1);
  return result[0] ?? null;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------
export async function scrapeNotifications(
  boardCode?: string
): Promise<ScrapeResult> {
  const errors: string[] = [];
  let totalScraped = 0;
  let totalNew = 0;

  const parsersToRun: NotificationParser[] = boardCode
    ? parserRegistry.has(boardCode)
      ? [parserRegistry.get(boardCode)!]
      : []
    : Array.from(parserRegistry.values());

  if (parsersToRun.length === 0) {
    return {
      scraped: 0,
      new: 0,
      errors: boardCode
        ? [`No parser registered for board: ${boardCode}`]
        : ["No parsers available"],
    };
  }

  for (const parser of parsersToRun) {
    const board = await getBoardIdByCode(parser.boardCode);
    if (!board) {
      errors.push(
        `Board not found in DB for code: ${parser.boardCode}`
      );
      continue;
    }

    console.log(
      `[NotificationScraper] Scraping ${parser.boardCode} (${parser.urls.length} URLs)`
    );

    const allRaw: RawNotification[] = [];

    for (const url of parser.urls) {
      const html = await rateLimitedFetch(url);
      if (!html) {
        errors.push(`Failed to fetch ${url}`);
        continue;
      }

      try {
        const parsed = parser.parse(html, url);
        allRaw.push(...parsed);
        totalScraped += parsed.length;
        console.log(
          `[NotificationScraper] Parsed ${parsed.length} notifications from ${url}`
        );
      } catch (err) {
        errors.push(
          `Parse error for ${url}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Deduplicate within this batch by sourceUrl
    const seen = new Set<string>();
    const unique = allRaw.filter((n) => {
      if (seen.has(n.sourceUrl)) return false;
      seen.add(n.sourceUrl);
      return true;
    });

    for (const raw of unique) {
      // Check if already in DB
      const existing = await db
        .select({ id: boardNotifications.id })
        .from(boardNotifications)
        .where(eq(boardNotifications.sourceUrl, raw.sourceUrl))
        .limit(1);

      if (existing.length > 0) continue;

      // AI categorization
      const categorization = await categorizeNotification(
        board.name,
        raw.title,
        raw.date,
        raw.sourceUrl
      );

      const publishedAt = parseIndianDate(raw.date);
      const slug = await ensureUniqueSlug(
        generateSlug(parser.boardCode, raw.title, publishedAt)
      );

      try {
        await db.insert(boardNotifications).values({
          boardId: board.id,
          title: raw.title,
          slug,
          category: categorization?.category ?? "general",
          summary: categorization?.summary ?? null,
          sourceUrl: raw.sourceUrl,
          pdfUrl: raw.pdfUrl ?? null,
          affectedClasses: categorization?.affectedClasses?.map((c) => c) ?? [],
          affectedSubjects: [],
          priority: categorization?.priority ?? "medium",
          isBreaking: categorization?.isBreaking ?? false,
          publishedAt,
          aiProcessed: !!categorization,
          rawHtml: raw.rawHtml ?? null,
        });

        totalNew++;
      } catch (err) {
        // Unique constraint violation = already exists, skip
        const msg =
          err instanceof Error ? err.message : String(err);
        if (msg.includes("unique") || msg.includes("duplicate")) {
          continue;
        }
        errors.push(
          `Insert failed for "${raw.title}": ${msg}`
        );
      }
    }

    console.log(
      `[NotificationScraper] ${parser.boardCode}: ${totalNew} new notifications inserted`
    );
  }

  return { scraped: totalScraped, new: totalNew, errors };
}
