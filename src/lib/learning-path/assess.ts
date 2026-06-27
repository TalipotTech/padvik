/**
 * Self-assessing learning path.
 *
 * Reads the student's MEASURED progress signals (topic_understanding,
 * reading_progress, search-miss history, optional exam-weak topics), ranks
 * what to improve DETERMINISTICALLY, then asks a cheap Haiku-class model to
 * write only the human-friendly phrasing. The AI never invents topics or
 * scores — if it fails we fall back to templated text, and overallScore is
 * always computed in code.
 *
 * Pure data + AI layer (only @/db + @/lib/ai) so ExamForge can reuse it.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { aiChat, AI_MODELS } from "@/lib/ai/provider";

export interface LearningPathInput {
  userId: number;
  boardId: number;
  grade: number;
  subjectId?: number;
}

export interface ImprovementItem {
  topicId: number;
  title: string;
  reason: string;
  priority: "high" | "medium" | "low";
  /** "Re-read notes", "Watch the video", "Practice 5 MCQs" */
  suggestedAction: string;
  /** A concrete piece of content to open, if one exists */
  contentItemId?: number;
}

export interface StrengthItem {
  topicId: number;
  title: string;
  reason: string;
}

export interface LearningPathResult {
  summary: string;
  strengths: StrengthItem[];
  improvements: ImprovementItem[];
  overallScore: number;
  signals: Record<string, unknown>;
  model: string;
  costUsd: number;
}

// ---------------------------------------------------------------------------
// Internal signal types
// ---------------------------------------------------------------------------

interface TopicSignal {
  topicId: number;
  title: string;
  subjectName: string;
  understanding: "red" | "orange" | "green" | null;
  completion: number; // 0-100, 0 if unknown
  searchMiss: boolean;
  examWeak: boolean;
  contentItemId: number | null;
}

// ---------------------------------------------------------------------------
// Step A — gather signals (SQL only)
// ---------------------------------------------------------------------------

async function gatherSignals(input: LearningPathInput): Promise<Map<number, TopicSignal>> {
  const { userId, boardId, grade, subjectId } = input;
  const scope = subjectId
    ? sql`c.subject_id = ${subjectId}`
    : sql`st.board_id = ${boardId} AND st.grade = ${grade}`;

  const byId = new Map<number, TopicSignal>();
  const ensure = (topicId: number, title: string, subjectName: string): TopicSignal => {
    let s = byId.get(topicId);
    if (!s) {
      s = {
        topicId,
        title,
        subjectName,
        understanding: null,
        completion: 0,
        searchMiss: false,
        examWeak: false,
        contentItemId: null,
      };
      byId.set(topicId, s);
    }
    return s;
  };

  // Understanding levels (red/orange/green) with titles.
  const understanding = await db.execute<{
    topic_id: number; title: string; subject_name: string; understanding_level: string;
  }>(sql`
    SELECT tu.topic_id, t.title, s.name AS subject_name, tu.understanding_level
    FROM topic_understanding tu
    JOIN topics t ON t.id = tu.topic_id
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    WHERE tu.user_id = ${userId} AND ${scope}
  `);
  for (const row of understanding) {
    const s = ensure(row.topic_id, row.title, row.subject_name);
    if (row.understanding_level === "red" || row.understanding_level === "orange" || row.understanding_level === "green") {
      s.understanding = row.understanding_level;
    }
  }

  // Reading completion per topic (max across its content items).
  const progress = await db.execute<{
    topic_id: number; title: string; subject_name: string; completion: number;
  }>(sql`
    SELECT ci.topic_id, t.title, s.name AS subject_name,
      MAX(rp.completion_percent) AS completion
    FROM reading_progress rp
    JOIN content_items ci ON ci.id = rp.content_item_id
    JOIN topics t ON t.id = ci.topic_id
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    WHERE rp.user_id = ${userId} AND ${scope}
    GROUP BY ci.topic_id, t.title, s.name
  `);
  for (const row of progress) {
    const s = ensure(row.topic_id, row.title, row.subject_name);
    s.completion = row.completion ?? 0;
  }

  // Search-miss topics — recent searches that returned no content.
  const searchMiss = await db.execute<{
    topic_id: number; title: string; subject_name: string;
  }>(sql`
    SELECT DISTINCT h.matched_topic_id AS topic_id, t.title, s.name AS subject_name
    FROM topic_search_history h
    JOIN topics t ON t.id = h.matched_topic_id
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    WHERE h.user_id = ${userId}
      AND h.matched_topic_id IS NOT NULL
      AND h.result_count = 0
      AND h.was_rejected = false
      AND h.created_at > NOW() - INTERVAL '30 days'
      AND ${scope}
  `);
  for (const row of searchMiss) {
    const s = ensure(row.topic_id, row.title, row.subject_name);
    s.searchMiss = true;
  }

  // Optional — exam-weak topics. exam_attempts → exams.topic_ids is a loose
  // array link; treat as best-effort and skip silently on any error.
  try {
    const examWeak = await db.execute<{ topic_id: number; title: string; subject_name: string }>(sql`
      SELECT DISTINCT t.id AS topic_id, t.title, s.name AS subject_name
      FROM exam_attempts ea
      JOIN exams e ON e.id = ea.exam_id
      JOIN LATERAL unnest(e.topic_ids) AS tid(topic_id) ON true
      JOIN topics t ON t.id = tid.topic_id
      JOIN chapters c ON c.id = t.chapter_id
      JOIN subjects s ON s.id = c.subject_id
      JOIN standards st ON st.id = s.standard_id
      WHERE ea.user_id = ${userId}
        AND ea.percentage IS NOT NULL
        AND ea.percentage < 50
        AND ${scope}
    `);
    for (const row of examWeak) {
      const s = ensure(row.topic_id, row.title, row.subject_name);
      s.examWeak = true;
    }
  } catch {
    /* exam tables/columns absent or shaped differently — skip */
  }

  // Attach a concrete published content item per weak topic (for deep-links).
  const topicIds = [...byId.keys()];
  if (topicIds.length > 0) {
    const contentRows = await db.execute<{ topic_id: number; content_item_id: number }>(sql`
      SELECT DISTINCT ON (topic_id) topic_id, id AS content_item_id
      FROM content_items
      WHERE is_published = true
        AND topic_id = ANY(${sql`ARRAY[${sql.join(topicIds, sql`, `)}]::bigint[]`})
      ORDER BY topic_id, quality_score DESC NULLS LAST, created_at DESC
    `);
    for (const row of contentRows) {
      const s = byId.get(row.topic_id);
      if (s) s.contentItemId = row.content_item_id;
    }
  }

  return byId;
}

// ---------------------------------------------------------------------------
// Step B — deterministic ranking
// ---------------------------------------------------------------------------

const LOW_COMPLETION_THRESHOLD = 40;

function priorityFor(s: TopicSignal): "high" | "medium" | "low" {
  if (s.understanding === "red" || s.examWeak) return "high";
  if (s.understanding === "orange" || s.completion < LOW_COMPLETION_THRESHOLD) return "medium";
  return "low";
}

function rankWeight(s: TopicSignal): number {
  // red > orange > low-completion; tie-break: exam-weak then search-miss.
  let w = 0;
  if (s.understanding === "red") w += 1000;
  else if (s.understanding === "orange") w += 600;
  if (s.completion > 0 && s.completion < LOW_COMPLETION_THRESHOLD) w += 300;
  if (s.examWeak) w += 50;
  if (s.searchMiss) w += 20;
  return w;
}

function defaultAction(s: TopicSignal): string {
  if (s.searchMiss && !s.contentItemId) return "Request notes — content is being added";
  if (s.understanding === "red") return "Re-read the notes and try the practice set";
  if (s.examWeak) return "Practice 5 MCQs to fix exam gaps";
  if (s.completion < LOW_COMPLETION_THRESHOLD) return "Finish reading the notes";
  return "Revise the notes";
}

function templateReason(s: TopicSignal): string {
  if (s.understanding === "red") return "You marked this topic as tough.";
  if (s.examWeak) return "Recent exam results show this is a weak spot.";
  if (s.understanding === "orange") return "You're almost there — a bit more revision will help.";
  if (s.completion > 0 && s.completion < LOW_COMPLETION_THRESHOLD) return "You started but haven't finished this topic.";
  if (s.searchMiss) return "You searched this but found little content.";
  return "Worth a quick revision.";
}

// ---------------------------------------------------------------------------
// Step C — AI narration (one cheap call), defensive parse, deterministic fallback
// ---------------------------------------------------------------------------

function stripJsonFences(text: string): string {
  return text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
}

interface NarrationOutput {
  summary?: string;
  improvements?: Array<{ topicId: number; reason?: string; suggestedAction?: string }>;
}

async function narrate(
  scopeLabel: string,
  board: string,
  grade: number,
  ranked: TopicSignal[],
  language?: string
): Promise<{ output: NarrationOutput; model: string; costUsd: number }> {
  const compact = ranked.slice(0, 12).map((s) => ({
    topicId: s.topicId,
    title: s.title,
    understanding: s.understanding,
    completion: s.completion,
    examWeak: s.examWeak,
    searchMiss: s.searchMiss,
  }));

  const systemPrompt = `You are a supportive Indian K-12 study coach. You are given a student's measured progress signals for ${scopeLabel}, ${board} Class ${grade}. Write encouraging, concrete guidance. Rules: only reference the topics provided — never invent topics. Keep the summary to 2-3 sentences. For each improvement topic give a one-line reason and one concrete action (re-read, watch, practise). No medical or personal advice. Return ONLY valid JSON matching the given shape.`;

  const userPrompt = `Signals (ranked, weakest first):
${JSON.stringify(compact, null, 2)}

Return ONLY this JSON shape:
{
  "summary": "2-3 sentence plain-language status",
  "improvements": [
    { "topicId": <number from the list>, "reason": "<=18 words", "suggestedAction": "<=8 words, concrete>" }
  ]
}`;

  // Model is a Claude (Haiku-class) id, so it routes to Anthropic via
  // getProvider — no `provider` override (that would force the model back to
  // the provider default and defeat the cost-cap).
  const result = await aiChat(userPrompt, {
    model: AI_MODELS.BULK,
    systemPrompt,
    temperature: 0.3,
    maxTokens: 700,
    language,
  });

  const output = JSON.parse(stripJsonFences(result.content)) as NarrationOutput;
  return { output, model: result.model, costUsd: result.costUsd };
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function assessLearningPath(input: LearningPathInput): Promise<LearningPathResult> {
  const signalsMap = await gatherSignals(input);
  const all = [...signalsMap.values()];

  // Buckets.
  const red = all.filter((s) => s.understanding === "red");
  const orange = all.filter((s) => s.understanding === "orange");
  const green = all.filter((s) => s.understanding === "green");
  const lowCompletion = all.filter(
    (s) => s.understanding !== "red" && s.understanding !== "orange" &&
      s.completion > 0 && s.completion < LOW_COMPLETION_THRESHOLD
  );
  const examWeak = all.filter((s) => s.examWeak);
  const stuck = all.filter((s) => s.searchMiss);

  // Weak set = anything worth improving (deduped).
  const weakSet = new Map<number, TopicSignal>();
  for (const s of [...red, ...orange, ...lowCompletion, ...examWeak, ...stuck]) {
    weakSet.set(s.topicId, s);
  }
  const ranked = [...weakSet.values()].sort((a, b) => rankWeight(b) - rankWeight(a));

  const coverage = red.length + orange.length + green.length;
  const avgCompletion = all.length
    ? Math.round(all.reduce((sum, s) => sum + s.completion, 0) / all.length)
    : 0;

  // Deterministic overall readiness (0-100) — never AI-dependent.
  let overallScore: number;
  if (coverage > 0) {
    overallScore = Math.round(((green.length + 0.5 * orange.length) / coverage) * 100);
  } else {
    overallScore = avgCompletion;
  }

  const signals: Record<string, unknown> = {
    redTopics: red.map((s) => ({ topicId: s.topicId, title: s.title })),
    orangeTopics: orange.map((s) => ({ topicId: s.topicId, title: s.title })),
    greenTopics: green.map((s) => ({ topicId: s.topicId, title: s.title })),
    avgCompletion,
    examWeakTopics: examWeak.map((s) => ({ topicId: s.topicId, title: s.title })),
    stuckTopics: stuck.map((s) => ({ topicId: s.topicId, title: s.title })),
  };

  // Strengths — green topics (compact).
  const strengths: StrengthItem[] = green.slice(0, 8).map((s) => ({
    topicId: s.topicId,
    title: s.title,
    reason: "You've understood this well.",
  }));

  // Build the deterministic improvement list first (correct even if AI fails).
  const improvements: ImprovementItem[] = ranked.slice(0, 12).map((s) => ({
    topicId: s.topicId,
    title: s.title,
    reason: templateReason(s),
    priority: priorityFor(s),
    suggestedAction: defaultAction(s),
    contentItemId: s.contentItemId ?? undefined,
  }));

  // No weak topics & no coverage → empty path (new student).
  const scopeLabel = ranked[0]?.subjectName ?? all[0]?.subjectName ?? "your subjects";
  const [boardRow] = await db.execute<{ code: string }>(sql`
    SELECT code FROM boards WHERE id = ${input.boardId} LIMIT 1
  `);
  const board = boardRow?.code ?? "your board";
  let summary =
    coverage === 0 && all.length === 0
      ? "Start learning a few topics and I'll map out what to focus on."
      : improvements.length === 0
        ? "Great work — no weak topics right now. Keep revising to stay sharp."
        : "Here's where to focus next based on your recent progress.";

  let model = "deterministic";
  let costUsd = 0;

  // AI narration only if there's something to narrate.
  if (improvements.length > 0) {
    try {
      const { output, model: m, costUsd: c } = await narrate(
        scopeLabel,
        board,
        input.grade,
        ranked
      );
      model = m;
      costUsd = c;
      if (output.summary && output.summary.trim()) summary = output.summary.trim();
      if (Array.isArray(output.improvements)) {
        const byTopic = new Map(output.improvements.map((o) => [o.topicId, o]));
        for (const item of improvements) {
          const o = byTopic.get(item.topicId);
          if (o?.reason && o.reason.trim()) item.reason = o.reason.trim();
          if (o?.suggestedAction && o.suggestedAction.trim()) item.suggestedAction = o.suggestedAction.trim();
        }
      }
    } catch {
      /* keep deterministic reasons/actions */
    }
  }

  return { summary, strengths, improvements, overallScore, signals, model, costUsd };
}
