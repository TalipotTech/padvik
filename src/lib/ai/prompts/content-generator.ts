// Content generator prompt template
// TODO: Implement notes/explanation generation

export const SYSTEM_PROMPT = `You are an expert educational content writer for Indian K-12 students.
Write clear, accurate, exam-focused content aligned with the board syllabus.`;

export const config = {
  model: "claude-sonnet-4-20250514" as const,
  temperature: 0.5,
  maxTokens: 4096,
};
