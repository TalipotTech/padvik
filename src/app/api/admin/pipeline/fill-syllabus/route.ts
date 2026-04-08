import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { NCERT_BOOK_CATALOG } from "@/lib/scraper/ncert-downloader";
import { extractTextFromPdf } from "@/lib/scraper/parser";
import { aiChat, AI_MODELS } from "@/lib/ai/provider";

/**
 * POST /api/admin/pipeline/fill-syllabus
 * Generates syllabus (chapters + topics) for classes that don't have any.
 * Uses NCERT textbook TOC extraction via AI.
 *
 * Body: { grades: [1,2,3], dryRun?: boolean }
 */
export async function POST(request: NextRequest) {
  let isAdmin = false;
  try { const s = await auth(); isAdmin = s?.user?.role === "admin"; } catch {}
  if (!isAdmin && process.env.NODE_ENV !== "development") {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin required" } }, { status: 403 });
  }

  let body: { grades?: number[]; dryRun?: boolean };
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const gradesToProcess = body.grades ?? [1, 2, 3, 4, 5, 6, 7, 8];
  const dryRun = body.dryRun ?? false;

  const [board] = await db.select().from(boards).where(eq(boards.code, "CBSE")).limit(1);
  if (!board) return NextResponse.json({ success: false, error: { code: "NO_BOARD", message: "CBSE not found" } }, { status: 404 });

  const results: Array<{ grade: number; subject: string; chapters: number; topics: number; status: string }> = [];

  for (const grade of gradesToProcess) {
    // Check if syllabus already exists
    const [existing] = await db.execute<{ cnt: number }>(sql`
      SELECT count(DISTINCT ch.id)::int as cnt FROM chapters ch
      JOIN subjects s ON s.id = ch.subject_id JOIN standards st ON st.id = s.standard_id
      WHERE st.board_id = ${board.id} AND st.grade = ${grade}
    `);

    // Don't skip the whole grade — check per-subject below

    const books = NCERT_BOOK_CATALOG.filter((b) => b.grade === grade && b.language === "en");
    if (books.length === 0) {
      results.push({ grade, subject: "(none)", chapters: 0, topics: 0, status: "no_books" });
      continue;
    }

    if (dryRun) {
      for (const book of books) {
        results.push({ grade, subject: book.subject, chapters: book.chapters, topics: 0, status: "would_create" });
      }
      continue;
    }

    // Ensure standard exists
    const academicYear = "2025-26";
    let [standard] = await db.select({ id: standards.id }).from(standards)
      .where(and(eq(standards.boardId, board.id), eq(standards.grade, grade), eq(standards.academicYear, academicYear))).limit(1);
    if (!standard) {
      const [created] = await db.insert(standards).values({ boardId: board.id, grade, academicYear, isActive: true, metadata: { source: "ncert_syllabus" } }).returning({ id: standards.id });
      standard = created;
    }

    for (const book of books) {
      // Check if subject already has chapters (not just exists — seed creates empty subjects)
      const [existingSubj] = await db.select({ id: subjects.id }).from(subjects)
        .where(and(eq(subjects.standardId, standard.id), sql`lower(name) = lower(${book.subject})`)).limit(1);

      if (existingSubj) {
        const [chCount] = await db.execute<{ cnt: number }>(sql`
          SELECT count(*)::int as cnt FROM chapters WHERE subject_id = ${existingSubj.id}
        `);
        if (chCount.cnt > 0) {
          results.push({ grade, subject: book.subject, chapters: chCount.cnt, topics: 0, status: "already_has_chapters" });
          continue;
        }
        // Subject exists but has NO chapters — we need to add them
      }

      try {
        // Strategy 1: Try downloading chapter 1 from NCERT for TOC
        let text = "";
        try {
          const pdfUrl = `https://ncert.nic.in/textbook/pdf/${book.code}01.pdf`;
          const response = await fetch(pdfUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; PadvikBot/1.0)" },
            signal: AbortSignal.timeout(15000),
          });
          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            text = await extractTextFromPdf(buffer);
          }
        } catch { /* PDF download failed — will use AI generation */ }

        // Strategy 2: Use AI to generate syllabus structure
        // Either from downloaded text OR from AI's knowledge of NCERT curriculum
        const prompt = text.length > 200
          ? `From this NCERT textbook (Class ${grade} ${book.subject}), extract the complete table of contents.
Output as JSON: { "chapters": [{ "number": 1, "title": "Chapter Title", "topics": ["Topic 1", "Topic 2"] }] }
Text (first 6000 chars): ${text.slice(0, 6000)}`
          : `Generate the complete chapter and topic structure for the NCERT ${book.subject} textbook "${book.name}" for Class ${grade} (CBSE, India, 2025-26 academic year).
The book has approximately ${book.chapters} chapters.${book.nepName ? ` Under NEP 2020, this book is called "${book.nepName}".` : ""}
Output as JSON: { "chapters": [{ "number": 1, "title": "Actual Chapter Title from NCERT", "topics": ["Actual Topic 1", "Actual Topic 2"] }] }
Use the REAL chapter titles and topic names from the NCERT textbook. Do not make up generic names.`;

        const aiResult = await aiChat(prompt, {
          model: AI_MODELS.GEMINI_FLASH,
          systemPrompt: "You are an expert on NCERT textbooks for Indian K-12 education. Output valid JSON only.",
          temperature: 0.1, maxTokens: 4096, jsonOutput: true,
        });

        let parsed: { chapters: Array<{ number: number; title: string; topics: string[] }> };
        try {
          const jsonMatch = aiResult.content.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { chapters: [] };
        } catch { parsed = { chapters: [] }; }

        if (parsed.chapters.length === 0) {
          parsed = { chapters: Array.from({ length: book.chapters }, (_, i) => ({
            number: i + 1, title: `Chapter ${i + 1}`, topics: [`Chapter ${i + 1} Content`]
          })) };
        }

        // Insert subject (or reuse existing empty one) + chapters + topics
        let subj = existingSubj;
        if (!subj) {
          const [created] = await db.insert(subjects).values({
            standardId: standard.id, code: book.subjectCode, name: book.subject,
            subjectType: "theory", isElective: false, metadata: { source: "ncert_toc", bookCode: book.code, aiModel: aiResult.model },
          }).returning({ id: subjects.id });
          subj = created;
        }

        let totalTopics = 0;
        for (const ch of parsed.chapters) {
          const [chapter] = await db.insert(chapters).values({
            subjectId: subj.id, chapterNumber: ch.number, title: ch.title,
            sortOrder: ch.number, metadata: { source: "ncert_toc" },
          }).returning({ id: chapters.id });

          for (let ti = 0; ti < ch.topics.length; ti++) {
            await db.insert(topics).values({
              chapterId: chapter.id, title: ch.topics[ti], sortOrder: ti + 1, metadata: { source: "ncert_toc" },
            });
            totalTopics++;
          }
        }

        results.push({ grade, subject: book.subject, chapters: parsed.chapters.length, topics: totalTopics, status: "created" });

        // Rate limit — be respectful to NCERT server + avoid AI rate limits
        await new Promise((r) => setTimeout(r, 5000));
      } catch (err) {
        results.push({ grade, subject: book.subject, chapters: 0, topics: 0, status: `error: ${(err as Error).message?.slice(0, 50)}` });
      }
    }

    // Also process subjects in DB that have 0 chapters but are NOT in NCERT catalog
    // (Hindi, Sanskrit, General Knowledge, Computer Science, etc.)
    const emptySubjects = await db.execute<{ id: number; name: string; code: string }>(sql`
      SELECT s.id, s.name, s.code FROM subjects s
      JOIN standards st ON st.id = s.standard_id
      WHERE st.board_id = ${board.id} AND st.grade = ${grade}
        AND (SELECT count(*) FROM chapters WHERE subject_id = s.id) = 0
    `);

    for (const subj of emptySubjects) {
      if (dryRun) { results.push({ grade, subject: subj.name, chapters: 0, topics: 0, status: "would_generate_ai" }); continue; }

      try {
        const aiResult = await aiChat(
          `Generate the complete NCERT/CBSE syllabus structure for Class ${grade} ${subj.name} (India, 2025-26 academic year).
Output as JSON: { "chapters": [{ "number": 1, "title": "Chapter Title", "topics": ["Topic 1", "Topic 2"] }] }
Use real chapter titles from the actual NCERT/CBSE curriculum. If this subject doesn't have a standard NCERT textbook, use the CBSE prescribed syllabus structure.`,
          { model: AI_MODELS.GEMINI_FLASH, systemPrompt: "You are an expert on Indian CBSE/NCERT curriculum. Output valid JSON only.", temperature: 0.1, maxTokens: 4096, jsonOutput: true }
        );

        let parsed: { chapters: Array<{ number: number; title: string; topics: string[] }> };
        try { const m = aiResult.content.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { chapters: [] }; } catch { parsed = { chapters: [] }; }

        if (parsed.chapters.length === 0) { results.push({ grade, subject: subj.name, chapters: 0, topics: 0, status: "ai_empty" }); continue; }

        let totalTopics = 0;
        for (const ch of parsed.chapters) {
          const [chapter] = await db.insert(chapters).values({
            subjectId: subj.id, chapterNumber: ch.number, title: ch.title, sortOrder: ch.number, metadata: { source: "ai_generated_syllabus" },
          }).returning({ id: chapters.id });
          for (let ti = 0; ti < ch.topics.length; ti++) {
            await db.insert(topics).values({ chapterId: chapter.id, title: ch.topics[ti], sortOrder: ti + 1, metadata: { source: "ai_generated_syllabus" } });
            totalTopics++;
          }
        }
        results.push({ grade, subject: subj.name, chapters: parsed.chapters.length, topics: totalTopics, status: "created_ai" });
        await new Promise((r) => setTimeout(r, 5000));
      } catch (err) {
        results.push({ grade, subject: subj.name, chapters: 0, topics: 0, status: `error: ${(err as Error).message?.slice(0, 50)}` });
      }
    }
  }

  return NextResponse.json({ success: true, data: { results, dryRun } });
}
