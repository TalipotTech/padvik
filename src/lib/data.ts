/**
 * Unified data source — checks USE_MOCK and delegates to mock data or real API.
 * All functions are async for a consistent interface.
 */

import { USE_MOCK } from "@/lib/mock-data";
import type { Board, Standard, SubjectWithChapters, TopicWithContext } from "@/types/curriculum";
import type { ContentItem } from "@/types/content";

import {
  getMockBoards,
  getMockStandards,
  getMockSubjects,
  getMockTopic,
  getMockContentForTopic,
} from "@/lib/mock-data";
import { apiFetch } from "@/lib/api-client";

export async function getBoards(): Promise<Board[]> {
  if (USE_MOCK) return getMockBoards();
  return apiFetch<Board[]>("/api/boards");
}

export async function getStandards(boardId: number): Promise<Standard[]> {
  if (USE_MOCK) return getMockStandards(boardId);
  return apiFetch<Standard[]>(`/api/boards/${boardId}/standards`);
}

export async function getSubjects(
  boardId: number,
  grade: number,
  stream?: string | null,
): Promise<SubjectWithChapters[]> {
  if (USE_MOCK) return getMockSubjects(boardId, grade, stream);
  const params = new URLSearchParams({ grade: String(grade) });
  if (stream) params.set("stream", stream);
  return apiFetch<SubjectWithChapters[]>(`/api/boards/${boardId}/subjects?${params}`);
}

export async function getTopicWithContent(
  topicId: number,
): Promise<{ topic: TopicWithContext; contentItems: ContentItem[] }> {
  if (USE_MOCK) {
    const topic = getMockTopic(topicId);
    const content = getMockContentForTopic(topicId);
    if (!topic) throw new Error("Topic not found");
    return { topic, contentItems: content };
  }
  return apiFetch<{ topic: TopicWithContext; contentItems: ContentItem[] }>(
    `/api/syllabus/topics/${topicId}`,
  );
}
