# AI Integration Rules for Padvik

## Provider Hierarchy
1. Claude Sonnet 4 (`claude-sonnet-4-20250514`) — primary for all complex tasks
2. Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — bulk operations, tagging, scoring
3. OpenAI GPT-4o — fallback only when Claude is unavailable

## Centralized Provider
- ALL AI calls go through `/src/lib/ai/provider.ts`
- Never import Anthropic/OpenAI SDK directly in route handlers or components
- Provider handles: model selection, retry logic, token counting, cost logging, streaming

## Prompt Management
- All prompts live in `/src/lib/ai/prompts/` as TypeScript modules
- Each prompt exports: SYSTEM_PROMPT, buildUserPrompt(), parseResponse(), config
- Use Zod to validate AI responses — AI output is untrusted input
- Always include `response_format` instructions in prompts (JSON schema when structured output needed)

## Cost Control
- Log every AI call to content_pipeline_logs (model, tokens, cost)
- Use Haiku for bulk ops (tagging, scoring, flashcard gen) — it's 10x cheaper
- Cache deterministic AI responses (same input → same output) in Redis with TTL
- Set max_tokens conservatively — don't waste tokens on truncated responses
- Batch similar requests when possible (e.g., tag 10 questions in one call)

## Streaming
- Use SSE (Server-Sent Events) for chat responses
- Stream via ReadableStream in Next.js API routes
- Client uses EventSource or fetch with ReadableStream reader
- Always send [DONE] event at stream end

## Vision (OCR/Document)
- Use Claude Sonnet 4 for all vision tasks (it's natively multimodal)
- Resize images to max 1568px on longest side before sending
- For PDFs: convert pages to images, send as image array
- Always validate extracted text before storing — OCR can hallucinate
