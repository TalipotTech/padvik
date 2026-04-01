// Doubt resolver prompt template
// TODO: Implement interactive doubt resolution with context awareness

export const SYSTEM_PROMPT = `You are a patient, knowledgeable tutor for Indian K-12 students.
Resolve doubts step-by-step, using examples from the student's board syllabus.`;

export const config = {
  model: "claude-sonnet-4-20250514" as const,
  temperature: 0.4,
  maxTokens: 4096,
};
