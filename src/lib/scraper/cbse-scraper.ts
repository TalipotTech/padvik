/**
 * CBSE Syllabus Scraper
 *
 * Pipeline: Fetch curriculum page → Find PDF links → Download PDFs →
 *           Extract text → Send to Claude for parsing → Validate →
 *           Insert into boards/standards/subjects/chapters/topics
 */
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { scrapeJobs } from "@/db/schema/system";
import { BaseScraper } from "./base-scraper";
import { extractTextFromPdf, extractLinks, resolveUrl } from "./parser";
import { aiChat, AI_MODELS } from "../ai/provider";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseResponse,
  config as promptConfig,
  type SyllabusParseResult,
} from "../ai/prompts/syllabus-parser";

const CBSE_CURRICULUM_BASE = "https://cbseacademic.nic.in";
const CBSE_CURRICULUM_PAGE = `${CBSE_CURRICULUM_BASE}/curriculum_2026.html`;

// PDF link patterns on the CBSE academic site
const PDF_LINK_PATTERN = /\.pdf$/i;

export interface CbseScrapeOptions {
  /** Specific grades to scrape (default: all 1-12) */
  grades?: number[];
  /** Specific subject hint to filter PDFs */
  subjectFilter?: string;
  /** Scrape job ID to update progress */
  jobId?: number;
  /** Max PDFs to process (for testing) */
  maxPdfs?: number;
}

export class CbseScraper extends BaseScraper {
  name = "CBSE Scraper";
  boardCode = "CBSE";

  async scrape(options?: CbseScrapeOptions): Promise<number> {
    const jobId = options?.jobId;
    let itemsProcessed = 0;

    try {
      // 1. Get the CBSE board from DB
      const [board] = await db
        .select()
        .from(boards)
        .where(eq(boards.code, "CBSE"))
        .limit(1);

      if (!board) {
        throw new Error("CBSE board not found in database. Run seed first.");
      }

      this.log(`Starting CBSE syllabus scrape (board id: ${board.id})`);

      // 2. Fetch the curriculum index page
      this.log(`Fetching curriculum page: ${CBSE_CURRICULUM_PAGE}`);
      const pageResult = await this.fetchText(CBSE_CURRICULUM_PAGE);

      if (!pageResult.success || !pageResult.data) {
        throw new Error(`Failed to fetch curriculum page: ${pageResult.error}`);
      }

      // 3. Extract PDF links
      const pdfLinks = extractLinks(pageResult.data, PDF_LINK_PATTERN).map((link) =>
        resolveUrl(CBSE_CURRICULUM_BASE, link)
      );
      this.log(`Found ${pdfLinks.length} PDF links`);

      if (pdfLinks.length === 0) {
        this.log("No PDF links found. The page structure may have changed.");
        return 0;
      }

      // 4. Filter and limit
      const maxPdfs = options?.maxPdfs ?? pdfLinks.length;
      const toProcess = pdfLinks.slice(0, maxPdfs);

      // Update job progress
      if (jobId) {
        await this.updateJob(jobId, {
          status: "running",
          itemsFound: toProcess.length,
        });
      }

      // 5. Process each PDF
      for (let i = 0; i < toProcess.length; i++) {
        const pdfUrl = toProcess[i];
        this.log(`\n[${i + 1}/${toProcess.length}] Processing: ${pdfUrl}`);

        try {
          const result = await this.processPdf(pdfUrl, board.id, options);
          if (result) {
            itemsProcessed++;
          }
        } catch (err) {
          this.logError(`Failed to process PDF: ${pdfUrl}`, err);
        }

        // Update job progress
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

  /**
   * Process a single syllabus PDF:
   * Download → Extract text → Parse with AI → Validate → Insert into DB
   */
  private async processPdf(
    pdfUrl: string,
    boardId: number,
    options?: CbseScrapeOptions
  ): Promise<boolean> {
    // Step 1: Download PDF
    this.log("  Downloading PDF...");
    const pdfResult = await this.fetchPdf(pdfUrl);
    if (!pdfResult.success || !pdfResult.data) {
      this.logError(`  Download failed: ${pdfResult.error}`);
      return false;
    }
    this.log(`  Downloaded (${(pdfResult.data.length / 1024).toFixed(1)} KB)`);

    // Step 2: Extract text from PDF
    this.log("  Extracting text...");
    let pdfText: string;
    try {
      pdfText = await extractTextFromPdf(pdfResult.data);
    } catch (err) {
      this.logError("  PDF text extraction failed", err);
      return false;
    }

    if (pdfText.trim().length < 100) {
      this.log("  Skipping — PDF text too short (likely image-only or empty)");
      return false;
    }
    this.log(`  Extracted ${pdfText.length} chars`);

    // Step 3: Try to infer grade from the PDF URL or text
    const grade = this.inferGrade(pdfUrl, pdfText);
    if (!grade) {
      this.log("  Skipping — could not determine grade/class from PDF");
      return false;
    }

    // Filter by requested grades
    if (options?.grades && !options.grades.includes(grade)) {
      this.log(`  Skipping — grade ${grade} not in requested grades`);
      return false;
    }

    this.log(`  Detected grade: Class ${grade}`);

    // Step 4: Send to Claude for structured parsing
    this.log("  Sending to Claude for parsing...");
    const userPrompt = buildUserPrompt({
      pdfText,
      boardCode: "CBSE",
      grade,
      subjectHint: options?.subjectFilter,
    });

    const aiResult = await aiChat(userPrompt, {
      model: promptConfig.model as typeof AI_MODELS.PRIMARY,
      systemPrompt: SYSTEM_PROMPT,
      temperature: promptConfig.temperature,
      maxTokens: promptConfig.maxTokens,
    });

    this.log(
      `  AI response: ${aiResult.inputTokens} in / ${aiResult.outputTokens} out ($${aiResult.costUsd.toFixed(4)})`
    );

    // Step 5: Parse and validate AI response
    let parsed: SyllabusParseResult;
    try {
      parsed = parseResponse(aiResult.content);
    } catch (err) {
      this.logError("  AI response validation failed", err);
      return false;
    }

    this.log(
      `  Parsed: ${parsed.subjectName} (${parsed.subjectCode}) — ${parsed.chapters.length} chapters`
    );

    // Step 6: Insert into database
    this.log("  Inserting into database...");
    await this.insertParsedSyllabus(boardId, grade, parsed);
    this.log("  Done.");

    return true;
  }

  /**
   * Insert parsed syllabus data into the DB hierarchy.
   */
  private async insertParsedSyllabus(
    boardId: number,
    grade: number,
    parsed: SyllabusParseResult
  ): Promise<void> {
    const academicYear = parsed.academicYear ?? "2025-26";
    const stream = parsed.stream ?? null;

    // Find or verify the standard exists
    const [standard] = await db
      .select()
      .from(standards)
      .where(
        and(
          eq(standards.boardId, boardId),
          eq(standards.grade, grade),
          eq(standards.academicYear, academicYear),
          stream ? eq(standards.stream, stream) : undefined
        )
      )
      .limit(1);

    if (!standard) {
      this.log(`  Warning: Standard Class ${grade} not found for CBSE. Skipping insert.`);
      return;
    }

    // Upsert subject
    const [subject] = await db
      .insert(subjects)
      .values({
        standardId: standard.id,
        code: parsed.subjectCode,
        name: parsed.subjectName,
        maxMarks: parsed.totalMarks ?? null,
        subjectType: "theory",
        isElective: false,
      })
      .onConflictDoNothing()
      .returning({ id: subjects.id });

    // If conflict, fetch existing
    let subjectId: number;
    if (subject) {
      subjectId = subject.id;
    } else {
      const [existing] = await db
        .select()
        .from(subjects)
        .where(
          and(eq(subjects.standardId, standard.id), eq(subjects.code, parsed.subjectCode))
        )
        .limit(1);
      if (!existing) throw new Error("Subject insert/lookup failed");
      subjectId = existing.id;
    }

    // Insert chapters and topics
    for (const ch of parsed.chapters) {
      const [chapter] = await db
        .insert(chapters)
        .values({
          subjectId,
          chapterNumber: ch.chapterNumber,
          title: ch.title,
          description: ch.description ?? null,
          estimatedHours: ch.estimatedHours?.toString() ?? null,
          weightagePct: ch.weightagePct?.toString() ?? null,
          sortOrder: ch.chapterNumber,
        })
        .onConflictDoNothing()
        .returning({ id: chapters.id });

      if (!chapter) {
        // Chapter already exists — skip topics (idempotent)
        continue;
      }

      // Insert topics for this chapter
      if (ch.topics.length > 0) {
        await db.insert(topics).values(
          ch.topics.map((t) => ({
            chapterId: chapter.id,
            title: t.title,
            description: t.description ?? null,
            sortOrder: t.sortOrder,
          }))
        );
      }
    }

    const topicCount = parsed.chapters.reduce((sum, ch) => sum + ch.topics.length, 0);
    this.log(
      `  Inserted: ${parsed.chapters.length} chapters, ${topicCount} topics for ${parsed.subjectName} Class ${grade}`
    );
  }

  /**
   * Try to infer the grade (class number) from the PDF URL or text content.
   */
  private inferGrade(url: string, text: string): number | null {
    // Try URL patterns like "class-10", "class_10", "classX", "Class-X"
    const urlPatterns = [
      /class[_-]?(\d{1,2})/i,
      /grade[_-]?(\d{1,2})/i,
      /std[_-]?(\d{1,2})/i,
      /(\d{1,2})th/i,
    ];
    for (const pattern of urlPatterns) {
      const match = url.match(pattern);
      if (match) {
        const grade = parseInt(match[1], 10);
        if (grade >= 1 && grade <= 12) return grade;
      }
    }

    // Try Roman numerals in URL (XI, XII, IX, X)
    const romanMap: Record<string, number> = {
      XII: 12, XI: 11, X: 10, IX: 9, VIII: 8, VII: 7, VI: 6, V: 5, IV: 4,
    };
    for (const [roman, num] of Object.entries(romanMap)) {
      if (url.toUpperCase().includes(roman)) return num;
    }

    // Try first 2000 chars of text
    const head = text.slice(0, 2000);
    const textMatch = head.match(/class[:\s-]*(\d{1,2})/i);
    if (textMatch) {
      const grade = parseInt(textMatch[1], 10);
      if (grade >= 1 && grade <= 12) return grade;
    }

    return null;
  }

  /**
   * Update a scrape job in the database.
   */
  private async updateJob(
    jobId: number,
    updates: Partial<{
      status: string;
      itemsFound: number;
      itemsProcessed: number;
      errorLog: string;
    }>
  ): Promise<void> {
    const values: Record<string, unknown> = {};
    if (updates.status) values.status = updates.status;
    if (updates.itemsFound !== undefined) values.itemsFound = updates.itemsFound;
    if (updates.itemsProcessed !== undefined) values.itemsProcessed = updates.itemsProcessed;
    if (updates.errorLog) values.errorLog = updates.errorLog;
    if (updates.status === "running") values.startedAt = new Date();
    if (updates.status === "completed" || updates.status === "failed") {
      values.completedAt = new Date();
    }

    await db
      .update(scrapeJobs)
      .set(values)
      .where(eq(scrapeJobs.id, jobId));
  }
}
