/**
 * AI-powered curriculum auto-tagger.
 * Suggests board, class, subject, chapter mappings for content.
 */

import { db } from "@/db";
import { boards, standards, subjects, chapters } from "@/db/schema/curriculum";
import { eq, ilike } from "drizzle-orm";
import { aiChat, AI_MODELS } from "@/lib/ai/provider";

interface CurriculumSuggestion {
  boardId?: number;
  standardId?: number;
  subjectId?: number;
  chapterId?: number;
  confidence: number;
  displayText?: string;
}

/**
 * Auto-suggest curriculum tags for content that isn't fully tagged.
 * Returns suggestions — does NOT auto-apply.
 */
export async function autoTagCurriculum(
  text: string,
  creatorBoards: string[]
): Promise<CurriculumSuggestion> {
  if (text.length < 20) return { confidence: 0 };

  try {
    const result = await aiChat(
      `Given this educational content from India, identify the curriculum it belongs to.
The creator teaches these boards: ${creatorBoards.join(", ") || "unknown"}.

Content: ${text.substring(0, 1500)}

Return ONLY a JSON object:
{
  "board": "CBSE" or "ICSE" or board code,
  "class": number (1-12),
  "subject": "Mathematics" or "Physics" etc,
  "chapter": "chapter name if identifiable" or null,
  "confidence": 0.0-1.0
}

Only suggest if confidence > 0.5. If unsure, set confidence to 0.`,
      { model: AI_MODELS.BULK, temperature: 0.1, maxTokens: 200 }
    );

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { confidence: 0 };

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.confidence < 0.5) return { confidence: parsed.confidence };

    const suggestion: CurriculumSuggestion = {
      confidence: parsed.confidence,
      displayText: `${parsed.board} > Class ${parsed.class} > ${parsed.subject}${parsed.chapter ? ` > ${parsed.chapter}` : ""}`,
    };

    // Look up board ID
    if (parsed.board) {
      const [board] = await db
        .select({ id: boards.id })
        .from(boards)
        .where(ilike(boards.code, parsed.board))
        .limit(1);
      if (board) suggestion.boardId = board.id;
    }

    // Look up standard (grade)
    if (suggestion.boardId && parsed.class) {
      const [standard] = await db
        .select({ id: standards.id })
        .from(standards)
        .where(eq(standards.boardId, suggestion.boardId))
        .limit(1);
      // Find by grade number
      const allStandards = await db
        .select({ id: standards.id, grade: standards.grade })
        .from(standards)
        .where(eq(standards.boardId, suggestion.boardId));
      const match = allStandards.find(s => s.grade === Number(parsed.class));
      if (match) suggestion.standardId = match.id;
    }

    // Look up subject
    if (suggestion.standardId && parsed.subject) {
      const allSubjects = await db
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .where(eq(subjects.standardId, suggestion.standardId));
      const match = allSubjects.find(s =>
        s.name.toLowerCase().includes(parsed.subject.toLowerCase())
      );
      if (match) suggestion.subjectId = match.id;
    }

    // Look up chapter
    if (suggestion.subjectId && parsed.chapter) {
      const allChapters = await db
        .select({ id: chapters.id, title: chapters.title })
        .from(chapters)
        .where(eq(chapters.subjectId, suggestion.subjectId));
      const match = allChapters.find(c =>
        c.title.toLowerCase().includes(parsed.chapter.toLowerCase())
      );
      if (match) suggestion.chapterId = match.id;
    }

    return suggestion;
  } catch {
    return { confidence: 0 };
  }
}
