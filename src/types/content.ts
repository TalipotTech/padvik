import type { InferSelectModel } from "drizzle-orm";
import type { contentItems, userNotes, fileUploads } from "@/db/schema/content";

export type ContentItem = InferSelectModel<typeof contentItems>;
export type UserNote = InferSelectModel<typeof userNotes>;
export type FileUpload = InferSelectModel<typeof fileUploads>;

/** Content item with topic context for display */
export type ContentItemWithTopic = ContentItem & {
  topicTitle: string;
  chapterTitle: string;
  subjectName: string;
};
