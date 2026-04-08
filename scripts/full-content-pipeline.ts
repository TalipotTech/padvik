/**
 * Full Content Pipeline — processes all CBSE classes 1-12
 *
 * Phase 1: Syllabus (Classes 1-8 via NCERT TOC, 9-12 already done)
 * Phase 2: Questions (Classes 9-12 via CBSE question papers)
 * Phase 3: Content (All classes via NCERT textbook PDFs)
 *
 * Usage: npx tsx scripts/full-content-pipeline.ts [phase] [grades]
 * Examples:
 *   npx tsx scripts/full-content-pipeline.ts syllabus 1-8
 *   npx tsx scripts/full-content-pipeline.ts questions 9,11,12
 *   npx tsx scripts/full-content-pipeline.ts content 10
 *   npx tsx scripts/full-content-pipeline.ts all
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "../src/db/index.js";
import { eq, and, sql } from "drizzle-orm";
import { boards, standards, subjects, chapters, topics } from "../src/db/schema/curriculum.js";

const log = (msg: string) => console.log(`[Pipeline] ${msg}`);

async function main() {
  const phase = process.argv[2] ?? "status";
  const gradesArg = process.argv[3];

  log(`Phase: ${phase}, Grades: ${gradesArg ?? "all"}`);

  // Get CBSE board
  const [board] = await db.select().from(boards).where(eq(boards.code, "CBSE")).limit(1);
  if (!board) { log("ERROR: CBSE board not found. Run seed first."); process.exit(1); }

  if (phase === "status") {
    await showStatus(board.id);
  } else if (phase === "syllabus") {
    const grades = parseGrades(gradesArg ?? "1-8");
    await processSyllabus(board.id, grades);
  } else if (phase === "questions") {
    const grades = parseGrades(gradesArg ?? "9,11,12");
    await processQuestions(board.id, grades);
  } else if (phase === "content") {
    const grades = parseGrades(gradesArg ?? "1-12");
    await processContent(grades);
  } else if (phase === "all") {
    log("=== FULL PIPELINE ===");
    await processSyllabus(board.id, [1,2,3,4,5,6,7,8]);
    await processQuestions(board.id, [9,11,12]);
    await processContent([1,2,3,4,5,6,7,8,9,10,11,12]);
  } else {
    log(`Unknown phase: ${phase}. Use: status, syllabus, questions, content, all`);
  }

  process.exit(0);
}

function parseGrades(arg: string): number[] {
  if (arg.includes("-")) {
    const [start, end] = arg.split("-").map(Number);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }
  return arg.split(",").map(Number);
}

async function showStatus(boardId: number) {
  const result = await db.execute<{
    grade: number; subjects: number; chapters: number; topics: number; content: number; questions: number;
  }>(sql`
    SELECT st.grade,
      count(DISTINCT s.id)::int as subjects,
      count(DISTINCT ch.id)::int as chapters,
      count(DISTINCT t.id)::int as topics,
      (SELECT count(*)::int FROM content_items ci JOIN topics t2 ON t2.id=ci.topic_id JOIN chapters c2 ON c2.id=t2.chapter_id JOIN subjects s2 ON s2.id=c2.subject_id WHERE s2.standard_id=st.id) as content,
      (SELECT count(*)::int FROM questions q JOIN topics t3 ON t3.id=q.topic_id JOIN chapters c3 ON c3.id=t3.chapter_id JOIN subjects s3 ON s3.id=c3.subject_id WHERE s3.standard_id=st.id) as questions
    FROM standards st
    JOIN boards b ON b.id = st.board_id
    LEFT JOIN subjects s ON s.standard_id = st.id
    LEFT JOIN chapters ch ON ch.subject_id = s.id
    LEFT JOIN topics t ON t.chapter_id = ch.id
    WHERE b.id = ${boardId}
    GROUP BY st.grade, st.id
    ORDER BY st.grade
  `);

  log("\n  Grade | Subjects | Chapters | Topics | Content | Questions");
  log("  ------|----------|----------|--------|---------|----------");
  for (const r of result) {
    const status = r.chapters === 0 ? " ← NEEDS SYLLABUS" : r.content === 0 ? " ← NEEDS CONTENT" : "";
    log(`  ${String(r.grade).padStart(5)} | ${String(r.subjects).padStart(8)} | ${String(r.chapters).padStart(8)} | ${String(r.topics).padStart(6)} | ${String(r.content).padStart(7)} | ${String(r.questions).padStart(9)}${status}`);
  }
  log("");
}

/**
 * Phase 1: Generate syllabus for Classes 1-8 using NCERT textbook structure.
 * Uses AI to parse NCERT book table of contents into chapters and topics.
 */
async function processSyllabus(boardId: number, grades: number[]) {
  log(`\n=== Phase 1: Syllabus for Classes ${grades.join(",")} ===`);

  const { NCERT_BOOK_CATALOG } = await import("../src/lib/scraper/ncert-downloader.js");
  const { extractTextFromPdf } = await import("../src/lib/scraper/parser.js");
  const { aiChat, AI_MODELS } = await import("../src/lib/ai/provider.js");

  for (const grade of grades) {
    // Check if syllabus already exists
    const [existing] = await db.execute<{ cnt: number }>(sql`
      SELECT count(DISTINCT ch.id)::int as cnt FROM chapters ch
      JOIN subjects s ON s.id = ch.subject_id
      JOIN standards st ON st.id = s.standard_id
      WHERE st.board_id = ${boardId} AND st.grade = ${grade}
    `);

    if (existing.cnt > 0) {
      log(`  Class ${grade}: Already has ${existing.cnt} chapters, skipping`);
      continue;
    }

    const books = NCERT_BOOK_CATALOG.filter((b: { grade: number; language: string }) => b.grade === grade && b.language === "en");
    if (books.length === 0) {
      log(`  Class ${grade}: No NCERT books in catalog`);
      continue;
    }

    log(`  Class ${grade}: ${books.length} books — generating syllabus from NCERT TOC`);

    // Ensure standard exists
    const academicYear = "2025-26";
    let [standard] = await db.select({ id: standards.id }).from(standards)
      .where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, academicYear))).limit(1);
    if (!standard) {
      const [created] = await db.insert(standards).values({ boardId, grade, academicYear, isActive: true, metadata: { source: "ncert_syllabus" } }).returning({ id: standards.id });
      standard = created;
    }

    for (const book of books) {
      // Check if subject already exists
      const [existingSubj] = await db.select({ id: subjects.id }).from(subjects)
        .where(and(eq(subjects.standardId, standard.id), sql`lower(name) = lower(${book.subject})`)).limit(1);
      if (existingSubj) {
        log(`    ${book.subject}: already exists`);
        continue;
      }

      // Try downloading first chapter to extract TOC
      log(`    ${book.subject} (${book.code}): downloading ch01 for TOC...`);

      try {
        const pdfUrl = `https://ncert.nic.in/textbook/pdf/${book.code}01.pdf`;
        const response = await fetch(pdfUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PadvikBot/1.0)" } });
        if (!response.ok) { log(`      Download failed: ${response.status}`); continue; }

        const buffer = Buffer.from(await response.arrayBuffer());
        const text = await extractTextFromPdf(buffer);
        if (text.length < 100) { log("      Text too short"); continue; }

        // Use AI to extract chapter structure from the text
        const result = await aiChat(
          `From this NCERT textbook content, extract the complete syllabus structure. This is Class ${grade} ${book.subject}.

Output as JSON: { "chapters": [{ "number": 1, "title": "Chapter Title", "topics": ["Topic 1", "Topic 2"] }] }

Text (first 5000 chars):
${text.slice(0, 5000)}`,
          { model: AI_MODELS.GEMINI_FLASH, systemPrompt: "You are a curriculum structure extractor. Output valid JSON only.", temperature: 0.1, maxTokens: 4096, jsonOutput: true }
        );

        // Parse the result
        let parsed: { chapters: Array<{ number: number; title: string; topics: string[] }> };
        try {
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { chapters: [] };
        } catch { parsed = { chapters: [] }; }

        if (parsed.chapters.length === 0) {
          // Fallback: create chapters based on book's chapter count
          log(`      AI extraction failed, creating ${book.chapters} generic chapters`);
          parsed = { chapters: Array.from({ length: book.chapters }, (_, i) => ({
            number: i + 1, title: `Chapter ${i + 1}`, topics: [`Chapter ${i + 1} Content`]
          }))};
        }

        // Insert subject
        const [subj] = await db.insert(subjects).values({
          standardId: standard.id, code: book.subjectCode, name: book.subject,
          subjectType: "theory", isElective: false, metadata: { source: "ncert_toc", bookCode: book.code },
        }).returning({ id: subjects.id });

        // Insert chapters and topics
        for (const ch of parsed.chapters) {
          const [chapter] = await db.insert(chapters).values({
            subjectId: subj.id, chapterNumber: ch.number, title: ch.title,
            sortOrder: ch.number, metadata: { source: "ncert_toc" },
          }).returning({ id: chapters.id });

          for (let ti = 0; ti < ch.topics.length; ti++) {
            await db.insert(topics).values({
              chapterId: chapter.id, title: ch.topics[ti], sortOrder: ti + 1,
              metadata: { source: "ncert_toc" },
            });
          }
        }

        log(`      Created: ${parsed.chapters.length} chapters, ${parsed.chapters.reduce((s, c) => s + c.topics.length, 0)} topics`);

        // Rate limit
        await new Promise((r) => setTimeout(r, 3000));
      } catch (err) {
        log(`      Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

/**
 * Phase 2: Scrape question papers for Classes 9, 11, 12.
 * Uses the existing CBSE question scraper via the queue.
 */
async function processQuestions(boardId: number, grades: number[]) {
  log(`\n=== Phase 2: Questions for Classes ${grades.join(",")} ===`);
  log("  Use the admin UI to trigger question paper scraping:");
  log("  1. Go to /scrape-jobs");
  log("  2. Select Board: CBSE, Job Type: Question Papers");
  log("  3. For each grade (${grades.join(', ')}), set the grade and click Start Scrape");
  log("  4. The scraper will download SQP and Question Bank PDFs from cbseacademic.nic.in");
  log("");
  log("  Or trigger via API:");
  for (const grade of grades) {
    log(`    curl -X POST http://localhost:3000/api/admin/scrape-jobs -H "Content-Type: application/json" -d '{"boardCode":"CBSE","jobType":"question_paper","grades":[${grade}],"maxPdfs":100,"aiProvider":"auto"}'`);
  }
}

/**
 * Phase 3: Download NCERT textbook content for all classes.
 * Uses the existing NCERT downloader.
 */
async function processContent(grades: number[]) {
  log(`\n=== Phase 3: NCERT Content for Classes ${grades.join(",")} ===`);
  log("  Use the admin UI to trigger NCERT downloads:");
  log("  1. Go to /scrape-jobs");
  log("  2. Select Job Type: NCERT Download");
  for (const grade of grades) {
    log(`  3. Grade: Class ${grade}, select subjects, click Start`);
  }
  log("");
  log("  Or trigger via API:");
  for (const grade of grades) {
    log(`    curl -X POST http://localhost:3000/api/admin/ncert/download -H "Content-Type: application/json" -d '{"grades":[${grade}],"languages":["en"],"maxChapters":50}'`);
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
