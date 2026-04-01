// Shared TypeScript type definitions

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export type UserRole = "student" | "teacher" | "admin" | "parent";

export type ReviewStatus = "pending" | "approved" | "rejected" | "flagged";

export type ContentType = "notes" | "summary" | "explanation" | "flashcard" | "mindmap";

export type SourceType = "scraped" | "ai_generated" | "user_uploaded" | "official";

export type QuestionType = "mcq" | "short_answer" | "long_answer" | "fill_blank" | "true_false";

export type DifficultyLevel = "easy" | "medium" | "hard";

export type MasteryLevel = "not_started" | "learning" | "practicing" | "mastered";

export type Language = "en" | "hi" | "ml" | "ta" | "te" | "kn";

export type { Board, Standard, Subject, Chapter, Topic, TopicMapping, SubjectWithChapters, ChapterWithTopics, BoardWithStandards, TopicWithContext } from "./curriculum";
export type { ContentItem, UserNote, FileUpload, ContentItemWithTopic } from "./content";
