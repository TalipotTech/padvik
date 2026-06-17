import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { chapters, topics, subjects, standards } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import {
  parseMarkdownStructure,
  isPlaceholderChapterTitle,
} from "@/lib/scraper/markdown-structure";

// ---------------------------------------------------------------------------
// POST /api/admin/coverage/backfill-titles
//
// Retro-fix for the NCERT ingestion's oldest bug: `findOrCreateChapter` and
// `findOrCreateTopic` in src/lib/scraper/ncert-downloader.ts hardcode title
// strings like "Mathematics — Chapter 1" and "Chapter 1 Content" when the DB
// rows are first created, and the AI parse pass writes its rich output only
// into `content_items.body` — the real textbook titles never make it to the
// chapter/topic rows.
//
// This endpoint reverses that by walking every chapter under a given subject,
// reading the AI-generated markdown from content_items.body, and using the H1
// (chapter title) + H2s (subsections) to:
//   1. UPDATE chapter.title from the H1
//   2. DELETE the old placeholder topic row and its lone "whole chapter"
//      content_item
//   3. INSERT one topic per H2 section, each with its own content_item
//      holding only that section's markdown — so the student's Book View
//      navigates at section granularity, not chapter-dump granularity.
//
// Scope: exactly one subject per call. `dryRun=true` by default, like the
// other purge endpoints — operator must explicitly opt into mutation.
//
// Body:
//   {
//     subjectId: number,         // required
//     dryRun?: boolean,          // default true
//     onlyPlaceholders?: boolean // default true — only touch chapters whose
//                                // title still matches the placeholder regex.
//                                // false lets you force-reshape even a
//                                // manually-edited chapter (rarely useful).
//   }
//
// Response (dry run):
//   {
//     success, data: {
//       dryRun: true, scope, chaptersPlanned: [
//         { chapterId, oldTitle, newTitle, sections: [{ title, bodyLength }],
//           willDeleteTopicIds, willDeleteContentItemIds }
//       ], chaptersSkipped: [{ chapterId, reason }]
//     }
//   }
// Response (real):
//   { success, data: { dryRun: false, scope, chaptersUpdated, topicsCreated,
//                      contentItemsCreated, rowsDeleted } }
//
// Dev-bypass on NODE_ENV=development with no session, matching the other
// admin/coverage/* routes.
// ---------------------------------------------------------------------------

const backfillSchema = z.object({
  subjectId: z.number().int().positive(),
  dryRun: z.boolean().default(true),
  onlyPlaceholders: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  const isAdmin =
    session?.user?.role === "admin" ||
    (!session && process.env.NODE_ENV === "development");
  if (!isAdmin) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }
  const parsed = backfillSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      },
      { status: 400 },
    );
  }
  const { subjectId, dryRun, onlyPlaceholders } = parsed.data;

  // Look up scope so the admin can eyeball what they're about to mutate.
  const [scope] = await db
    .select({
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      standardId: standards.id,
      grade: standards.grade,
      academicYear: standards.academicYear,
      boardId: standards.boardId,
    })
    .from(subjects)
    .innerJoin(standards, eq(subjects.standardId, standards.id))
    .where(eq(subjects.id, subjectId))
    .limit(1);

  if (!scope) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "SUBJECT_NOT_FOUND", message: `No subject with id ${subjectId}` },
      },
      { status: 404 },
    );
  }

  // Walk every chapter under the subject. We'll process each independently so
  // a failure in ch5 doesn't block ch6.
  const chapterRows = await db
    .select({
      id: chapters.id,
      chapterNumber: chapters.chapterNumber,
      title: chapters.title,
    })
    .from(chapters)
    .where(eq(chapters.subjectId, subjectId))
    .orderBy(chapters.sortOrder);

  if (chapterRows.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        dryRun,
        scope,
        message: "Subject has no chapters — nothing to backfill.",
        chaptersPlanned: [],
        chaptersSkipped: [],
      },
    });
  }

  interface PlannedChapter {
    chapterId: number;
    chapterNumber: number;
    oldTitle: string;
    newTitle: string;
    preSectionBodyChars: number;
    sections: Array<{ title: string; bodyLength: number }>;
    // These feed the destructive phase — list exactly what will die so the
    // operator can sanity-check scope before flipping dryRun=false.
    willDeleteTopicIds: number[];
    willDeleteContentItemIds: number[];
    sourceContentItemId: number;
  }
  const planned: PlannedChapter[] = [];
  const skipped: Array<{ chapterId: number; chapterNumber: number; reason: string }> = [];

  for (const ch of chapterRows) {
    if (onlyPlaceholders && !isPlaceholderChapterTitle(ch.title)) {
      skipped.push({
        chapterId: ch.id,
        chapterNumber: ch.chapterNumber,
        reason: `Chapter title "${ch.title}" is not a placeholder; skipped (pass onlyPlaceholders=false to force).`,
      });
      continue;
    }

    // Topics under this chapter (we'll delete them all and recreate from H2s)
    const topicRows = await db
      .select({ id: topics.id, title: topics.title })
      .from(topics)
      .where(eq(topics.chapterId, ch.id));

    if (topicRows.length === 0) {
      skipped.push({
        chapterId: ch.id,
        chapterNumber: ch.chapterNumber,
        reason: "No topics under this chapter — cannot locate source content_item.",
      });
      continue;
    }

    const topicIds = topicRows.map((t) => t.id);

    // Find the content_item(s) under these topics. We want an ncert row with
    // real markdown body to parse. If there are multiple, pick the one that
    // looks most structured (largest body as a proxy).
    const ciRows = await db
      .select({
        id: contentItems.id,
        topicId: contentItems.topicId,
        title: contentItems.title,
        body: contentItems.body,
        sourceType: contentItems.sourceType,
      })
      .from(contentItems)
      .where(
        and(
          inArray(contentItems.topicId, topicIds),
          eq(contentItems.sourceType, "ncert"),
        ),
      );

    if (ciRows.length === 0) {
      skipped.push({
        chapterId: ch.id,
        chapterNumber: ch.chapterNumber,
        reason: "No NCERT content_items under this chapter — nothing to parse.",
      });
      continue;
    }

    // Pick the richest row. NCERT bootstrap stores one row per chapter, but
    // be defensive against unexpected duplication.
    const sourceItem = ciRows.reduce((best, r) => (r.body.length > best.body.length ? r : best));

    const structure = parseMarkdownStructure(sourceItem.body);

    if (!structure.chapterTitle) {
      skipped.push({
        chapterId: ch.id,
        chapterNumber: ch.chapterNumber,
        reason: "Markdown has no H1 heading — cannot derive chapter title.",
      });
      continue;
    }
    if (structure.sections.length === 0) {
      skipped.push({
        chapterId: ch.id,
        chapterNumber: ch.chapterNumber,
        reason: "Markdown has no H2 sections — cannot derive topic breakdown.",
      });
      continue;
    }

    // All the topics + their content_items under this chapter go away once we
    // reshape. Gather their ids for the delete step.
    const allCiUnderChapter = await db
      .select({ id: contentItems.id, topicId: contentItems.topicId })
      .from(contentItems)
      .where(inArray(contentItems.topicId, topicIds));

    planned.push({
      chapterId: ch.id,
      chapterNumber: ch.chapterNumber,
      oldTitle: ch.title,
      newTitle: structure.chapterTitle,
      preSectionBodyChars: structure.preSectionBody.length,
      sections: structure.sections.map((s) => ({ title: s.title, bodyLength: s.body.length })),
      willDeleteTopicIds: topicIds,
      willDeleteContentItemIds: allCiUnderChapter.map((c) => c.id),
      sourceContentItemId: sourceItem.id,
    });
  }

  if (dryRun) {
    return NextResponse.json({
      success: true,
      data: {
        dryRun: true,
        scope,
        onlyPlaceholders,
        chaptersPlanned: planned,
        chaptersSkipped: skipped,
        note:
          planned.length === 0
            ? "Nothing to reshape. Check skipped[] for reasons."
            : "Re-send with { dryRun: false } to apply these changes.",
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Real execution. For each planned chapter:
  //   1. Fetch the source content_item fully (we need all fields to clone per
  //      section).
  //   2. INSERT new topic rows (one per section) + matching content_item rows
  //      (body = section markdown only; other fields copied from source).
  //   3. DELETE all old topic rows under this chapter (cascades content_items
  //      via FK ondelete).
  //   4. UPDATE chapter.title to the parsed H1.
  //
  // We do 2→3 in that order so we never end up with a chapter that has zero
  // topics (would break the syllabus renderer). If step 3 fails the new rows
  // will coexist with the old; the operator can re-run with onlyPlaceholders
  // off to finish the cleanup.
  // ---------------------------------------------------------------------------
  let chaptersUpdated = 0;
  let topicsCreated = 0;
  let contentItemsCreated = 0;
  let rowsDeleted = 0;
  const perChapterResults: Array<{
    chapterId: number;
    chapterNumber: number;
    newTitle: string;
    topicsCreated: number;
    contentItemsCreated: number;
    topicsDeleted: number;
    contentItemsDeleted: number;
  }> = [];

  for (const p of planned) {
    // Re-fetch the source item to get all its fields (metadata, qualityScore,
    // etc.) so the clones carry the same provenance.
    const [src] = await db
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, p.sourceContentItemId))
      .limit(1);

    if (!src) {
      // Source vanished between plan and apply — skip this chapter.
      perChapterResults.push({
        chapterId: p.chapterId,
        chapterNumber: p.chapterNumber,
        newTitle: p.newTitle,
        topicsCreated: 0,
        contentItemsCreated: 0,
        topicsDeleted: 0,
        contentItemsDeleted: 0,
      });
      continue;
    }

    // Re-parse (cheap) so we have the section bodies on hand for insertion.
    const structure = parseMarkdownStructure(src.body);

    let chapterTopicsCreated = 0;
    let chapterContentCreated = 0;

    for (const section of structure.sections) {
      const [newTopic] = await db
        .insert(topics)
        .values({
          chapterId: p.chapterId,
          title: section.title,
          sortOrder: section.sortOrder,
          metadata: {
            source: "ncert_backfill",
            parsedFromContentItemId: src.id,
            h2Heading: section.title,
          },
        })
        .returning({ id: topics.id });

      await db.insert(contentItems).values({
        topicId: newTopic.id,
        contentType: src.contentType,
        title: section.title,
        body: section.body,
        bodyFormat: src.bodyFormat,
        sourceType: src.sourceType,
        sourceUrl: src.sourceUrl,
        uploadedBy: src.uploadedBy,
        language: src.language,
        qualityScore: src.qualityScore,
        reviewStatus: src.reviewStatus,
        reviewedBy: src.reviewedBy,
        isPublished: src.isPublished,
        metadata: {
          ...((src.metadata as Record<string, unknown>) ?? {}),
          section: section.title,
          sectionSortOrder: section.sortOrder,
          parsedFromContentItemId: src.id,
        },
      });

      chapterTopicsCreated++;
      chapterContentCreated++;
    }

    // Delete old topics (cascades content_items). We target by id list
    // because recreated topics for this chapter now share the chapterId and
    // we don't want to delete them.
    const deletedTopics = await db
      .delete(topics)
      .where(inArray(topics.id, p.willDeleteTopicIds))
      .returning({ id: topics.id });

    // Content items were cascaded; our planning captured the exact id set so
    // the operator knows the count, even though the SQL delete is implicit.
    const deletedContentItems = p.willDeleteContentItemIds.length;

    await db
      .update(chapters)
      .set({ title: p.newTitle })
      .where(eq(chapters.id, p.chapterId));

    chaptersUpdated++;
    topicsCreated += chapterTopicsCreated;
    contentItemsCreated += chapterContentCreated;
    rowsDeleted += deletedTopics.length + deletedContentItems;

    perChapterResults.push({
      chapterId: p.chapterId,
      chapterNumber: p.chapterNumber,
      newTitle: p.newTitle,
      topicsCreated: chapterTopicsCreated,
      contentItemsCreated: chapterContentCreated,
      topicsDeleted: deletedTopics.length,
      contentItemsDeleted: deletedContentItems,
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      dryRun: false,
      scope,
      onlyPlaceholders,
      chaptersUpdated,
      topicsCreated,
      contentItemsCreated,
      rowsDeleted,
      perChapter: perChapterResults,
      skipped,
    },
  });
}
