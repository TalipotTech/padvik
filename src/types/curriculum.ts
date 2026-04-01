import type { InferSelectModel } from "drizzle-orm";
import type {
  boards,
  standards,
  subjects,
  chapters,
  topics,
  topicMappings,
} from "@/db/schema/curriculum";

export type Board = InferSelectModel<typeof boards>;
export type Standard = InferSelectModel<typeof standards>;
export type Subject = InferSelectModel<typeof subjects>;
export type Chapter = InferSelectModel<typeof chapters>;
export type Topic = InferSelectModel<typeof topics>;
export type TopicMapping = InferSelectModel<typeof topicMappings>;

/** Subject with its chapters and topics nested */
export type SubjectWithChapters = Subject & {
  chapters: ChapterWithTopics[];
};

/** Chapter with nested topics */
export type ChapterWithTopics = Chapter & {
  topics: Topic[];
};

/** Board with available standards */
export type BoardWithStandards = Board & {
  standards: Standard[];
};

/** Topic with full hierarchy context */
export type TopicWithContext = Topic & {
  chapter: Chapter;
  subject: Subject;
  standard: Standard;
  board: Board;
};
