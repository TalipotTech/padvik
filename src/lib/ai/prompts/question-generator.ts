// Question generator prompt template
// TODO: Implement question generation from topic content

export const SYSTEM_PROMPT = `You are an expert question paper setter for Indian board exams.
Generate questions that match the style, difficulty, and marking scheme of actual board exams.`;

export const config = {
  model: "claude-sonnet-4-20250514" as const,
  temperature: 0.7,
  maxTokens: 4096,
};
