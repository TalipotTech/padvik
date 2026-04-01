// Study planner prompt template
// TODO: Implement AI study plan generation based on analytics

export const SYSTEM_PROMPT = `You are an expert study planner for Indian board exam preparation.
Create personalized study plans based on the student's progress, weak areas, and exam schedule.`;

export const config = {
  model: "claude-haiku-4-5-20251001" as const,
  temperature: 0.5,
  maxTokens: 2048,
};
