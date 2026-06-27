import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { creatorContent } from "@/db/schema/creators";
import { userVideos } from "@/db/schema/learn";
import { auth } from "@/lib/auth";
import {
  type MediaItem,
  detectMediaType,
  synthesizeFromLegacy,
} from "@/lib/media-items";

/**
 * GET /api/learn/topic/[id]/bundle
 *
 * Unified content bundle for one topic. Merges BOTH content systems so the
 * search page shows everything without bouncing through other pages:
 *   - content_items  → markdown notes/articles (what the Playground renders)
 *   - creator_content → Padvik-official auto-content + creator uploads. Notes
 *     are stored as ContentBlock[] JSON; videos/audio use the mediaUrl COLUMN
 *     (auto-content) and/or metadata.mediaItems[] (uploads). The old bundle
 *     only read mediaItems, so all Padvik-official notes/video/audio were
 *     missing — this version surfaces them.
 *
 * Returns FULL bodies so the client can render content inline (reusing
 * MarkdownRenderer + the explainer BlockView), keeping deep-link buttons.
 */

function systemCreatorId(): number | null {
  const raw = process.env.PADVIK_SYSTEM_CREATOR_ID;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Parse a body string into a JSON array (ContentBlock[] / question[]), else null. */
function parseJsonArray(body: string | null): Record<string, unknown>[] | null {
  if (!body || !body.trimStart().startsWith("[")) return null;
  try {
    const v = JSON.parse(body);
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const topicId = parseInt(id, 10);
  if (Number.isNaN(topicId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid topic ID" } },
      { status: 400 }
    );
  }

  const officialId = systemCreatorId();

  // Topic header with hierarchy context.
  const [topic] = await db
    .select({
      id: topics.id,
      title: topics.title,
      chapterTitle: chapters.title,
      subjectName: subjects.name,
      grade: standards.grade,
      boardCode: boards.code,
    })
    .from(topics)
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .innerJoin(standards, eq(standards.id, subjects.standardId))
    .innerJoin(boards, eq(boards.id, standards.boardId))
    .where(eq(topics.id, topicId))
    .limit(1);

  if (!topic) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Topic not found" } },
      { status: 404 }
    );
  }

  // --- Article model (full inline content) --------------------------------
  interface Article {
    key: string;
    id: number;
    source: "content_item" | "creator";
    contentType: string;
    title: string;
    language: string;
    isOfficial: boolean;
    format: "markdown" | "blocks";
    markdown?: string;
    blocks?: unknown[];
    /** Where the "Open" / "Open in Playground" button links. */
    viewerHref: string;
  }
  const articles: Article[] = [];

  const media = {
    videos: [] as Array<{ contentId: number; url: string; title: string; durationSeconds: number | null; thumbnailUrl: string | null; isOfficial: boolean }>,
    audios: [] as Array<{ contentId: number; url: string; title: string; durationSeconds: number | null; isOfficial: boolean }>,
    documents: [] as Array<{ contentId: number; url: string; title: string; fileName: string; isOfficial: boolean }>,
    images: [] as Array<{ contentId: number; url: string; title: string; isOfficial: boolean }>,
  };

  interface QuestionSet {
    contentId: number;
    title: string;
    isOfficial: boolean;
    questions: Record<string, unknown>[];
  }
  const questionSets: QuestionSet[] = [];

  // 1) Published content_items (markdown notes/articles).
  const contentRows = await db
    .select({
      id: contentItems.id,
      contentType: contentItems.contentType,
      title: contentItems.title,
      body: contentItems.body,
      language: contentItems.language,
    })
    .from(contentItems)
    .where(and(eq(contentItems.topicId, topicId), eq(contentItems.isPublished, true)))
    .orderBy(contentItems.contentType, contentItems.createdAt);

  for (const c of contentRows) {
    if (!c.body || c.body.trim().length === 0) continue;
    articles.push({
      key: `ci-${c.id}`,
      id: c.id,
      source: "content_item",
      contentType: c.contentType,
      title: c.title,
      language: c.language,
      isOfficial: false,
      format: "markdown",
      markdown: c.body,
      viewerHref: `/dashboard/learn/${topicId}`,
    });
  }

  // 2) Published creator_content (Padvik-official auto-content + uploads).
  const creatorRows = await db
    .select({
      id: creatorContent.id,
      creatorId: creatorContent.creatorId,
      contentType: creatorContent.contentType,
      title: creatorContent.title,
      body: creatorContent.body,
      mediaUrl: creatorContent.mediaUrl,
      processedUrl: creatorContent.processedUrl,
      thumbnailUrl: creatorContent.thumbnailUrl,
      durationSeconds: creatorContent.durationSeconds,
      language: creatorContent.language,
      metadata: creatorContent.metadata,
    })
    .from(creatorContent)
    .where(and(eq(creatorContent.topicId, topicId), eq(creatorContent.isPublished, true)));

  for (const cc of creatorRows) {
    const isOfficial = officialId != null && cc.creatorId === officialId;
    const meta = (cc.metadata as Record<string, unknown>) ?? {};
    let items = (meta.mediaItems as MediaItem[]) || [];
    if (items.length === 0 && (meta.imageUrls as string[])?.length) {
      items = synthesizeFromLegacy(meta);
    }

    // 2a) Uploaded media items (creator uploads with files).
    let hadMediaItems = false;
    for (const item of items) {
      const type = item.type ?? detectMediaType(item.mimeType);
      if (!item.url) continue;
      hadMediaItems = true;
      switch (type) {
        case "video":
          media.videos.push({ contentId: cc.id, url: item.url, title: item.fileName || cc.title, durationSeconds: item.duration ?? cc.durationSeconds ?? null, thumbnailUrl: cc.thumbnailUrl ?? null, isOfficial });
          break;
        case "audio":
          media.audios.push({ contentId: cc.id, url: item.url, title: item.fileName || cc.title, durationSeconds: item.duration ?? cc.durationSeconds ?? null, isOfficial });
          break;
        case "document":
          media.documents.push({ contentId: cc.id, url: item.url, title: cc.title, fileName: item.fileName || cc.title, isOfficial });
          break;
        case "image":
          media.images.push({ contentId: cc.id, url: item.url, title: item.fileName || cc.title, isOfficial });
          break;
      }
    }

    // 2b) Column-based content (auto-content: video URL, audio file, note blocks, question set).
    const viewerHref = `/dashboard/content/${cc.id}`;
    const colUrl = cc.mediaUrl || cc.processedUrl || null;

    switch (cc.contentType) {
      case "video":
        if (colUrl) {
          media.videos.push({ contentId: cc.id, url: colUrl, title: cc.title, durationSeconds: cc.durationSeconds ?? null, thumbnailUrl: cc.thumbnailUrl ?? null, isOfficial });
        }
        break;
      case "audio":
        if (colUrl && !hadMediaItems) {
          media.audios.push({ contentId: cc.id, url: colUrl, title: cc.title, durationSeconds: cc.durationSeconds ?? null, isOfficial });
        }
        break;
      case "question_set": {
        const qs = parseJsonArray(cc.body);
        if (qs && qs.length > 0) {
          questionSets.push({ contentId: cc.id, title: cc.title, isOfficial, questions: qs });
        }
        break;
      }
      case "document":
        if (colUrl && !hadMediaItems) {
          media.documents.push({ contentId: cc.id, url: colUrl, title: cc.title, fileName: cc.title, isOfficial });
        }
        break;
      case "note":
      default: {
        // Notes: ContentBlock[] JSON → blocks; otherwise treat body as markdown.
        if (!hadMediaItems && cc.body && cc.body.trim().length > 0) {
          const blocks = parseJsonArray(cc.body);
          if (blocks && blocks.length > 0 && typeof blocks[0]?.type === "string") {
            articles.push({ key: `cc-${cc.id}`, id: cc.id, source: "creator", contentType: "note", title: cc.title, language: cc.language, isOfficial, format: "blocks", blocks, viewerHref });
          } else {
            articles.push({ key: `cc-${cc.id}`, id: cc.id, source: "creator", contentType: cc.contentType, title: cc.title, language: cc.language, isOfficial, format: "markdown", markdown: cc.body, viewerHref });
          }
        }
        break;
      }
    }
  }

  // Official content first within articles (helps surface Padvik notes).
  articles.sort((a, b) => Number(b.isOfficial) - Number(a.isOfficial));

  // Student's own saved YouTube links for this topic.
  let savedVideos: Array<{ id: number; youtubeUrl: string; title: string | null; thumbnailUrl: string | null; durationSeconds: number | null }> = [];
  const session = await auth().catch(() => null);
  const sessionUserId = session?.user?.id ? Number(session.user.id) : NaN;
  const userId = Number.isFinite(sessionUserId)
    ? sessionUserId
    : process.env.NODE_ENV === "development"
      ? 1
      : null;
  if (userId) {
    savedVideos = await db
      .select({
        id: userVideos.id,
        youtubeUrl: userVideos.youtubeUrl,
        title: userVideos.title,
        thumbnailUrl: userVideos.thumbnailUrl,
        durationSeconds: userVideos.durationSeconds,
      })
      .from(userVideos)
      .where(and(eq(userVideos.userId, userId), eq(userVideos.topicId, topicId)))
      .orderBy(userVideos.sortOrder);
  }

  // Related topics — prefer semantic links from topic_mappings; if a topic has
  // none (most don't yet), fall back to its same-chapter siblings, which is
  // what the Playground shows as "Related Topics".
  let relatedRows = await db.execute<{ topic_id: number; title: string; similarity_score: string | null }>(sql`
    SELECT t.id AS topic_id, t.title, tm.similarity_score
    FROM topic_mappings tm
    JOIN topics t ON t.id = tm.target_topic_id
    WHERE tm.source_topic_id = ${topicId}
    ORDER BY tm.similarity_score DESC NULLS LAST
    LIMIT 12
  `);

  if ([...relatedRows].length === 0) {
    relatedRows = await db.execute<{ topic_id: number; title: string; similarity_score: string | null }>(sql`
      SELECT t.id AS topic_id, t.title, NULL::text AS similarity_score
      FROM topics t
      WHERE t.chapter_id = (SELECT chapter_id FROM topics WHERE id = ${topicId})
        AND t.id <> ${topicId}
      ORDER BY t.sort_order
      LIMIT 12
    `);
  }

  return NextResponse.json({
    success: true,
    data: {
      topic: {
        id: topic.id,
        title: topic.title,
        chapterTitle: topic.chapterTitle,
        subjectName: topic.subjectName,
        grade: topic.grade,
        boardCode: topic.boardCode,
      },
      articles,
      media,
      questionSets,
      userVideos: savedVideos,
      related: [...relatedRows].map((r) => ({
        topicId: r.topic_id,
        title: r.title,
        similarityScore: r.similarity_score ? Number(r.similarity_score) : null,
      })),
    },
  });
}
