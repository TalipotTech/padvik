#!/usr/bin/env tsx
/**
 * Regenerate body for content_items whose body was cleared during remap-topic-pdfs
 * (refusal patterns or low-quality).
 *
 * Only targets items whose topic is NOT under the "Unmapped Topics (review)"
 * parking chapter — those need manual curation, not auto-regeneration.
 *
 * Reads the local NCERT PDF, runs AI vision extraction, and UPDATES the existing
 * content_items row (sets body, qualityScore, metadata, resets reviewStatus).
 *
 * Usage:
 *   pnpm tsx scripts/regenerate-cleared-content.ts                    # all
 *   pnpm tsx scripts/regenerate-cleared-content.ts --dry-run
 *   pnpm tsx scripts/regenerate-cleared-content.ts --id 4             # single item
 *   pnpm tsx scripts/regenerate-cleared-content.ts --max 5
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { contentItems } from "../src/db/schema/content";
import { aiPdfVision, aiChat, AI_MODELS } from "../src/lib/ai/provider";

interface Row {
  id: string;
  topic_id: string;
  source_url: string;
  topic_title: string;
  chapter_title: string;
  chapter_number: number;
  subject_name: string;
  grade: number;
  board_code: string;
}

function parseArgs(argv: string[]) {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    dryRun: argv.includes("--dry-run"),
    id: val("--id"),
    max: val("--max"),
  };
}

function fileUrlToAbsolute(fileUrl: string): string {
  const rel = fileUrl.replace(/^file:\/\//, "");
  return join(process.cwd(), rel);
}

function computeQualityScore(body: string, pdfTextLen: number): number {
  if (!body || body.length < 200) return 0.1;
  if (/I cannot|I'm unable|not covered in|does not appear/i.test(body)) return 0.2;
  const hasHeadings = /^#{1,3}\s/m.test(body);
  const hasBold = /\*\*[^*]+\*\*/.test(body);
  const lengthRatio = Math.min(body.length / Math.max(pdfTextLen, 1), 1);
  let score = 0.4;
  if (hasHeadings) score += 0.2;
  if (hasBold) score += 0.15;
  if (body.length > 2000) score += 0.15;
  if (lengthRatio > 0.05) score += 0.1;
  return Math.min(score, 1);
}

async function regenerate(row: Row, dryRun: boolean) {
  const pdfPath = fileUrlToAbsolute(row.source_url);
  if (!existsSync(pdfPath)) {
    console.log(`  ✗ [${row.id}] PDF not found: ${pdfPath}`);
    return { ok: false, reason: "pdf-missing" };
  }

  const pdfBuffer = readFileSync(pdfPath);
  console.log(`  → [${row.id}] ${row.board_code} Gr${row.grade} ${row.subject_name} / ch${row.chapter_number} "${row.chapter_title}" / "${row.topic_title}" (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);

  if (dryRun) {
    console.log(`    DRY RUN — would extract and update`);
    return { ok: true, reason: "dry-run" };
  }

  const systemPrompt = `You are an expert NCERT textbook content extractor. Extract COMPREHENSIVE study notes from this PDF chapter in Markdown format.

Requirements:
- Use proper Markdown: H1 for chapter title, H2 for sections, H3 for subsections
- Preserve ALL mathematical formulas using LaTeX notation ($...$ inline, $$...$$ block)
- Include ALL definitions with bold key terms: **Term**: definition
- Include ALL examples with step-by-step solutions
- Describe ALL diagrams: [Figure: description]
- Include ALL tables as Markdown tables
- Add a "## Key Points" or "## Summary" section at the end
- Target: Class ${row.grade} students studying for board exams
- Subject focus: ${row.subject_name}`;

  const userPrompt = `Extract complete structured study notes from this NCERT textbook chapter PDF.

Class: ${row.grade}
Subject: ${row.subject_name}
Chapter ${row.chapter_number}: ${row.chapter_title}

Extract everything: text, formulas, diagrams (describe them), tables, examples, exercises.
Output comprehensive Markdown. The output MUST be about "${row.chapter_title}" — if the PDF does not match, still extract what is there faithfully.`;

  let body = "";
  let modelUsed = "";
  let inTok = 0, outTok = 0, cost = 0;

  if (pdfBuffer.length < 10 * 1024 * 1024) {
    try {
      const result = await aiPdfVision(userPrompt, pdfBuffer.toString("base64"), {
        model: AI_MODELS.GEMINI_FLASH,
        systemPrompt,
        temperature: 0.1,
        maxTokens: 16384,
      });
      body = result.content;
      modelUsed = result.model;
      inTok = result.inputTokens;
      outTok = result.outputTokens;
      cost = result.costUsd;
      console.log(`    PDF Vision OK (${modelUsed}): ${inTok}in/${outTok}out ($${cost.toFixed(4)}), body=${body.length} chars`);
    } catch (err) {
      console.log(`    PDF Vision failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!body || body.length < 200) {
    console.log(`    ✗ Insufficient body after extraction (${body.length} chars), skipping update`);
    return { ok: false, reason: "insufficient-body" };
  }

  if (/I cannot|I'm unable|not covered in|does not appear/i.test(body)) {
    console.log(`    ✗ Refusal detected in new body, skipping update`);
    return { ok: false, reason: "refusal" };
  }

  const qualityScore = computeQualityScore(body, pdfBuffer.length);

  await db.update(contentItems)
    .set({
      body,
      qualityScore: qualityScore.toFixed(2),
      reviewStatus: qualityScore >= 0.7 ? "auto_approved" : "pending",
      isPublished: qualityScore >= 0.7,
      bodyFormat: "markdown",
      metadata: sql`coalesce(${contentItems.metadata}, '{}'::jsonb) || ${JSON.stringify({
        regeneratedAt: new Date().toISOString(),
        aiModel: modelUsed,
        aiTokens: inTok + outTok,
        aiCostUsd: cost,
      })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(contentItems.id, Number(row.id)));

  console.log(`    ✓ Updated content ${row.id} — quality=${qualityScore.toFixed(2)}, status=${qualityScore >= 0.7 ? "auto_approved" : "pending"}`);
  return { ok: true, reason: "updated" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const idFilter = args.id ? sql`AND ci.id = ${Number(args.id)}` : sql``;
  const maxFilter = args.max ? sql`LIMIT ${Number(args.max)}` : sql``;

  const q = sql`
    SELECT ci.id, ci.topic_id, ci.source_url,
           t.title AS topic_title,
           c.title AS chapter_title, c.chapter_number,
           s.name AS subject_name, st.grade, b.code AS board_code
    FROM content_items ci
    JOIN topics t ON t.id = ci.topic_id
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    WHERE LENGTH(ci.body) = 0
      AND ci.source_url LIKE 'file://data/ncert-pdfs/%'
      AND c.title NOT ILIKE '%Unmapped Topics%'
      ${idFilter}
    ORDER BY st.grade, s.name, c.chapter_number, ci.id
    ${maxFilter}
  `;
  const r = await db.execute(q);
  const rows = (Array.isArray(r) ? r : (r as { rows?: Row[] }).rows ?? []) as Row[];

  console.log(`\n=== Regenerate cleared content — ${rows.length} items (${args.dryRun ? "DRY RUN" : "LIVE"}) ===\n`);

  let ok = 0, fail = 0;
  for (const row of rows) {
    try {
      const res = await regenerate(row, args.dryRun);
      if (res.ok) ok++; else fail++;
    } catch (err) {
      console.log(`  ✗ [${row.id}] Error: ${err instanceof Error ? err.message : String(err)}`);
      fail++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  ok:   ${ok}`);
  console.log(`  fail: ${fail}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
