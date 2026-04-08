/**
 * NCERT Board Mappings
 *
 * Several Indian state boards follow the NCERT curriculum directly:
 * UP (UPMSP), Bihar (BSEB), MP (MPBSE), Rajasthan (RBSE), Gujarat (GSEB).
 *
 * Instead of duplicating content for these boards, we create topic_mappings
 * entries that link their curriculum hierarchy to existing NCERT/CBSE topics.
 *
 * This means: when a student from UP selects "Class 10 Science", they get
 * the same content as a CBSE student, via the topic_mappings table.
 */
import { eq, and, ilike } from "drizzle-orm";
import { db } from "@/db";
import {
  boards,
  standards,
  subjects,
  chapters,
  topics,
  topicMappings,
} from "@/db/schema/curriculum";

// ---------------------------------------------------------------------------
// NCERT-aligned boards
// ---------------------------------------------------------------------------

export const NCERT_ALIGNED_BOARDS = [
  { code: "UP_UPMSP",  name: "Uttar Pradesh (UPMSP)",    state: "Uttar Pradesh" },
  { code: "BR_BSEB",   name: "Bihar (BSEB)",             state: "Bihar" },
  { code: "MP_MPBSE",   name: "Madhya Pradesh (MPBSE)",   state: "Madhya Pradesh" },
  { code: "RJ_RBSE",   name: "Rajasthan (RBSE)",         state: "Rajasthan" },
  { code: "GJ_GSEB",   name: "Gujarat (GSEB)",           state: "Gujarat" },
  { code: "CG_CGBSE",  name: "Chhattisgarh (CGBSE)",     state: "Chhattisgarh" },
  { code: "UK_UBSE",   name: "Uttarakhand (UBSE)",       state: "Uttarakhand" },
  { code: "JH_JAC",    name: "Jharkhand (JAC)",          state: "Jharkhand" },
  { code: "HR_BSEH",   name: "Haryana (BSEH)",           state: "Haryana" },
] as const;

export type NCERTAlignedBoardCode = (typeof NCERT_ALIGNED_BOARDS)[number]["code"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MappingResult {
  boardCode: string;
  standardsCreated: number;
  subjectsMapped: number;
  chaptersMapped: number;
  topicsMapped: number;
  mappingsCreated: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Create topic_mappings entries linking a state board's curriculum
 * to existing NCERT/CBSE topics.
 *
 * Steps:
 * 1. Ensure the target board exists in our DB
 * 2. Find CBSE board and its full curriculum hierarchy
 * 3. Mirror the CBSE structure (standards, subjects, chapters, topics)
 *    into the target board
 * 4. Create topic_mappings (target board topic → CBSE topic) with
 *    mapping_type='ncert_aligned'
 *
 * This is idempotent — running it again won't create duplicate mappings.
 */
export async function addNCERTMappings(
  boardCode: NCERTAlignedBoardCode | string,
  options?: { grades?: number[]; log?: (msg: string) => void }
): Promise<MappingResult> {
  const log = options?.log ?? ((msg: string) => console.log(`[NCERT Mapping] ${msg}`));

  const result: MappingResult = {
    boardCode,
    standardsCreated: 0,
    subjectsMapped: 0,
    chaptersMapped: 0,
    topicsMapped: 0,
    mappingsCreated: 0,
    errors: [],
  };

  // 1. Find CBSE board
  const [cbseBoard] = await db
    .select()
    .from(boards)
    .where(eq(boards.code, "CBSE"))
    .limit(1);

  if (!cbseBoard) {
    throw new Error("CBSE board not found. Run seed and NCERT scraper first.");
  }

  // 2. Find or create target board
  let [targetBoard] = await db
    .select()
    .from(boards)
    .where(eq(boards.code, boardCode))
    .limit(1);

  if (!targetBoard) {
    const boardInfo = NCERT_ALIGNED_BOARDS.find((b) => b.code === boardCode);
    if (!boardInfo) {
      throw new Error(`Unknown board code: ${boardCode}. Known NCERT-aligned boards: ${NCERT_ALIGNED_BOARDS.map((b) => b.code).join(", ")}`);
    }

    log(`Creating board: ${boardInfo.name}`);
    const [created] = await db
      .insert(boards)
      .values({
        code: boardInfo.code,
        name: boardInfo.name,
        state: boardInfo.state,
        isActive: true,
        metadata: { ncertAligned: true, mirroredFrom: "CBSE" },
      })
      .returning();
    targetBoard = created;
  }

  log(`Mapping ${boardCode} to CBSE (board ids: ${targetBoard.id} → ${cbseBoard.id})`);

  // 3. Get all CBSE standards
  const cbseStandards = await db
    .select()
    .from(standards)
    .where(eq(standards.boardId, cbseBoard.id));

  const gradesToMap = options?.grades ?? cbseStandards.map((s) => s.grade);

  for (const cbseStandard of cbseStandards) {
    if (!gradesToMap.includes(cbseStandard.grade)) continue;

    log(`  Class ${cbseStandard.grade}...`);

    // Mirror standard
    const targetStandard = await findOrCreateStandard(
      targetBoard.id,
      cbseStandard.grade,
      cbseStandard.academicYear,
      cbseStandard.stream
    );
    if (!targetStandard) {
      result.errors.push(`Failed to create standard for Class ${cbseStandard.grade}`);
      continue;
    }
    result.standardsCreated++;

    // Get CBSE subjects for this standard
    const cbseSubjects = await db
      .select()
      .from(subjects)
      .where(eq(subjects.standardId, cbseStandard.id));

    for (const cbseSubject of cbseSubjects) {
      // Mirror subject
      const targetSubject = await findOrCreateSubject(
        targetStandard.id,
        cbseSubject.code,
        cbseSubject.name,
        cbseSubject
      );
      result.subjectsMapped++;

      // Get chapters
      const cbseChapters = await db
        .select()
        .from(chapters)
        .where(eq(chapters.subjectId, cbseSubject.id));

      for (const cbseChapter of cbseChapters) {
        // Mirror chapter
        const targetChapter = await findOrCreateChapter(
          targetSubject.id,
          cbseChapter
        );
        result.chaptersMapped++;

        // Get topics
        const cbseTopics = await db
          .select()
          .from(topics)
          .where(eq(topics.chapterId, cbseChapter.id));

        for (const cbseTopic of cbseTopics) {
          // Mirror topic
          const targetTopic = await findOrCreateTopic(
            targetChapter.id,
            cbseTopic
          );
          result.topicsMapped++;

          // Create mapping: target → CBSE (source = target board, target = CBSE)
          const created = await createMappingIfNotExists(
            targetTopic.id,
            cbseTopic.id
          );
          if (created) result.mappingsCreated++;
        }
      }
    }
  }

  log(`\nMapping complete for ${boardCode}:`);
  log(`  Standards: ${result.standardsCreated} | Subjects: ${result.subjectsMapped}`);
  log(`  Chapters: ${result.chaptersMapped} | Topics: ${result.topicsMapped}`);
  log(`  Mappings created: ${result.mappingsCreated}`);
  if (result.errors.length > 0) {
    log(`  Errors: ${result.errors.length}`);
  }

  return result;
}

/**
 * Create NCERT mappings for ALL aligned boards at once.
 */
export async function addAllNCERTMappings(
  options?: { grades?: number[]; log?: (msg: string) => void }
): Promise<MappingResult[]> {
  const results: MappingResult[] = [];

  for (const board of NCERT_ALIGNED_BOARDS) {
    try {
      const result = await addNCERTMappings(board.code, options);
      results.push(result);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      (options?.log ?? console.error)(`Failed to map ${board.code}: ${errMsg}`);
      results.push({
        boardCode: board.code,
        standardsCreated: 0,
        subjectsMapped: 0,
        chaptersMapped: 0,
        topicsMapped: 0,
        mappingsCreated: 0,
        errors: [errMsg],
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function findOrCreateStandard(
  boardId: number,
  grade: number,
  academicYear: string,
  stream: string | null
): Promise<{ id: number } | null> {
  const [existing] = await db
    .select({ id: standards.id })
    .from(standards)
    .where(
      and(
        eq(standards.boardId, boardId),
        eq(standards.grade, grade),
        eq(standards.academicYear, academicYear)
      )
    )
    .limit(1);

  if (existing) return existing;

  try {
    const [created] = await db
      .insert(standards)
      .values({
        boardId,
        grade,
        academicYear,
        stream,
        isActive: true,
        metadata: { source: "ncert_mapping", mirroredFrom: "CBSE" },
      })
      .returning({ id: standards.id });
    return created ?? null;
  } catch {
    const [refetched] = await db
      .select({ id: standards.id })
      .from(standards)
      .where(
        and(
          eq(standards.boardId, boardId),
          eq(standards.grade, grade),
          eq(standards.academicYear, academicYear)
        )
      )
      .limit(1);
    return refetched ?? null;
  }
}

async function findOrCreateSubject(
  standardId: number,
  code: string,
  name: string,
  cbseSubject: { maxMarks: number | null; subjectType: string; isElective: boolean }
): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.standardId, standardId), eq(subjects.code, code)))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(subjects)
    .values({
      standardId,
      code,
      name,
      maxMarks: cbseSubject.maxMarks,
      subjectType: cbseSubject.subjectType,
      isElective: cbseSubject.isElective,
      metadata: { source: "ncert_mapping", mirroredFrom: "CBSE" },
    })
    .returning({ id: subjects.id });

  return created;
}

async function findOrCreateChapter(
  subjectId: number,
  cbseChapter: {
    chapterNumber: number;
    title: string;
    description: string | null;
    estimatedHours: string | null;
    weightagePct: string | null;
    sortOrder: number;
  }
): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(
      and(
        eq(chapters.subjectId, subjectId),
        eq(chapters.chapterNumber, cbseChapter.chapterNumber)
      )
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(chapters)
    .values({
      subjectId,
      chapterNumber: cbseChapter.chapterNumber,
      title: cbseChapter.title,
      description: cbseChapter.description,
      estimatedHours: cbseChapter.estimatedHours,
      weightagePct: cbseChapter.weightagePct,
      sortOrder: cbseChapter.sortOrder,
      metadata: { source: "ncert_mapping", mirroredFrom: "CBSE" },
    })
    .returning({ id: chapters.id });

  return created;
}

async function findOrCreateTopic(
  chapterId: number,
  cbseTopic: {
    title: string;
    description: string | null;
    learningObjectives: unknown;
    bloomLevel: string | null;
    estimatedMinutes: number | null;
    sortOrder: number;
  }
): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(
      and(
        eq(topics.chapterId, chapterId),
        eq(topics.title, cbseTopic.title)
      )
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(topics)
    .values({
      chapterId,
      title: cbseTopic.title,
      description: cbseTopic.description,
      learningObjectives: cbseTopic.learningObjectives ?? [],
      bloomLevel: cbseTopic.bloomLevel,
      estimatedMinutes: cbseTopic.estimatedMinutes,
      sortOrder: cbseTopic.sortOrder,
      metadata: { source: "ncert_mapping", mirroredFrom: "CBSE" },
    })
    .returning({ id: topics.id });

  return created;
}

async function createMappingIfNotExists(
  sourceTopicId: number,
  targetTopicId: number
): Promise<boolean> {
  // Check if mapping already exists
  const [existing] = await db
    .select({ id: topicMappings.id })
    .from(topicMappings)
    .where(
      and(
        eq(topicMappings.sourceTopicId, sourceTopicId),
        eq(topicMappings.targetTopicId, targetTopicId)
      )
    )
    .limit(1);

  if (existing) return false;

  await db.insert(topicMappings).values({
    sourceTopicId,
    targetTopicId,
    similarityScore: "1.00", // Exact NCERT curriculum alignment
    mappingType: "ncert_aligned",
  });

  return true;
}
