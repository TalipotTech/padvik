/**
 * BullMQ worker for content post-processing.
 * Handles quality scoring and AI tagging of scraped content.
 */
import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { createRedisConnection } from "../redis";
import { db } from "@/db";
import { subjects, chapters, topics } from "@/db/schema/curriculum";
import { contentPipelineLogs } from "@/db/schema/system";
import { aiChat, AI_MODELS } from "../ai/provider";
import type { ContentJobData } from "./index";

let worker: Worker<ContentJobData> | null = null;

async function processQualityScore(data: ContentJobData): Promise<void> {
  const startTime = Date.now();

  if (data.entityType !== "subject") {
    console.log(`[ContentWorker] quality_score only supports entityType=subject, got ${data.entityType}`);
    return;
  }

  // Fetch the subject and its chapters/topics
  const subjectRows = await db
    .select()
    .from(subjects)
    .where(eq(subjects.id, data.entityId))
    .limit(1);

  if (subjectRows.length === 0) {
    console.log(`[ContentWorker] Subject ${data.entityId} not found`);
    return;
  }

  const chapterRows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.subjectId, data.entityId));

  let totalTopics = 0;
  let topicsWithDescriptions = 0;
  let chaptersWithHours = 0;
  let chaptersWithWeightage = 0;

  for (const ch of chapterRows) {
    if (ch.estimatedHours) chaptersWithHours++;
    if (ch.weightagePct) chaptersWithWeightage++;

    const topicRows = await db
      .select()
      .from(topics)
      .where(eq(topics.chapterId, ch.id));

    totalTopics += topicRows.length;
    topicsWithDescriptions += topicRows.filter((t) => t.description).length;
  }

  // Compute a completeness score (0.00 - 1.00)
  const chapterCount = chapterRows.length;
  const scores: number[] = [];

  // Has chapters? (weight: 0.3)
  scores.push(chapterCount > 0 ? 0.3 : 0);
  // Has topics? (weight: 0.3)
  scores.push(totalTopics > 0 ? 0.3 * Math.min(totalTopics / (chapterCount * 3), 1) : 0);
  // Topics have descriptions? (weight: 0.15)
  scores.push(totalTopics > 0 ? 0.15 * (topicsWithDescriptions / totalTopics) : 0);
  // Chapters have hours? (weight: 0.1)
  scores.push(chapterCount > 0 ? 0.1 * (chaptersWithHours / chapterCount) : 0);
  // Chapters have weightage? (weight: 0.15)
  scores.push(chapterCount > 0 ? 0.15 * (chaptersWithWeightage / chapterCount) : 0);

  const qualityScore = parseFloat(scores.reduce((a, b) => a + b, 0).toFixed(2));

  // Update subject metadata with quality score
  const currentMetadata = (subjectRows[0].metadata as Record<string, unknown>) ?? {};
  await db
    .update(subjects)
    .set({
      metadata: {
        ...currentMetadata,
        qualityScore,
        qualityScoredAt: new Date().toISOString(),
        chapterCount,
        totalTopics,
      },
    })
    .where(eq(subjects.id, data.entityId));

  // Log to pipeline
  await db.insert(contentPipelineLogs).values({
    pipelineStage: "quality_score",
    entityType: "subject",
    entityId: data.entityId,
    status: "completed",
    outputData: { qualityScore, chapterCount, totalTopics },
    processingTimeMs: Date.now() - startTime,
  });

  console.log(
    `[ContentWorker] Quality scored subject ${data.entityId}: ${qualityScore} (${chapterCount} chapters, ${totalTopics} topics)`
  );
}

async function processAiTag(data: ContentJobData): Promise<void> {
  const startTime = Date.now();

  if (data.entityType !== "topic") {
    console.log(`[ContentWorker] ai_tag only supports entityType=topic, got ${data.entityType}`);
    return;
  }

  const topicRows = await db
    .select()
    .from(topics)
    .where(eq(topics.id, data.entityId))
    .limit(1);

  if (topicRows.length === 0) {
    console.log(`[ContentWorker] Topic ${data.entityId} not found`);
    return;
  }

  const topic = topicRows[0];

  const prompt = `Given this educational topic, classify it:

Topic: "${topic.title}"
${topic.description ? `Description: "${topic.description}"` : ""}

Return JSON with:
- bloomLevel: one of "remember", "understand", "apply", "analyze", "evaluate", "create"
- estimatedMinutes: number (estimated time to learn this topic, between 15-120)
- difficulty: one of "easy", "medium", "hard"

Return ONLY valid JSON, no extra text.`;

  const aiResult = await aiChat(prompt, {
    model: AI_MODELS.BULK,
    temperature: 0.1,
    maxTokens: 200,
  });

  try {
    const cleaned = aiResult.content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned) as {
      bloomLevel?: string;
      estimatedMinutes?: number;
      difficulty?: string;
    };

    const updates: Record<string, unknown> = {};
    if (parsed.bloomLevel) updates.bloomLevel = parsed.bloomLevel;
    if (parsed.estimatedMinutes) updates.estimatedMinutes = parsed.estimatedMinutes;

    const currentMetadata = (topic.metadata as Record<string, unknown>) ?? {};
    updates.metadata = {
      ...currentMetadata,
      difficulty: parsed.difficulty,
      aiTaggedAt: new Date().toISOString(),
    };

    await db.update(topics).set(updates).where(eq(topics.id, data.entityId));

    await db.insert(contentPipelineLogs).values({
      pipelineStage: "ai_tag",
      entityType: "topic",
      entityId: data.entityId,
      status: "completed",
      outputData: parsed,
      processingTimeMs: Date.now() - startTime,
      aiModelUsed: AI_MODELS.BULK,
      aiTokensUsed: aiResult.inputTokens + aiResult.outputTokens,
    });

    console.log(
      `[ContentWorker] Tagged topic ${data.entityId}: bloom=${parsed.bloomLevel}, mins=${parsed.estimatedMinutes}`
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[ContentWorker] Failed to parse AI tag response for topic ${data.entityId}:`, errorMessage);

    await db.insert(contentPipelineLogs).values({
      pipelineStage: "ai_tag",
      entityType: "topic",
      entityId: data.entityId,
      status: "failed",
      errorMessage,
      processingTimeMs: Date.now() - startTime,
      aiModelUsed: AI_MODELS.BULK,
    });
  }
}

export function startContentWorker(): Worker<ContentJobData> {
  if (worker) return worker;

  worker = new Worker<ContentJobData>(
    "content",
    async (job: Job<ContentJobData>) => {
      const { action } = job.data;

      switch (action) {
        case "quality_score":
          await processQualityScore(job.data);
          break;
        case "ai_tag":
          await processAiTag(job.data);
          break;
        default:
          console.warn(`[ContentWorker] Unknown action: ${action}`);
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 5,
    }
  );

  worker.on("error", (err) => {
    console.error("[ContentWorker] Worker error:", err.message);
  });

  console.log("[ContentWorker] Started and waiting for jobs...");
  return worker;
}

export async function stopContentWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.log("[ContentWorker] Stopped.");
  }
}
