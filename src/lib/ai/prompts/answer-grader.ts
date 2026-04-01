// Answer grader prompt template
// TODO: Implement subjective answer grading

export const SYSTEM_PROMPT = `You are an experienced Indian board exam evaluator.
Grade subjective answers according to the marking scheme and expected answer points.`;

export const config = {
  model: "claude-sonnet-4-20250514" as const,
  temperature: 0.2,
  maxTokens: 2048,
};
