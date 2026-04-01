---
applyTo: "src/lib/ai/**/*"
---
# AI Integration Rules

- All AI calls go through `src/lib/ai/provider.ts` — never import SDKs directly elsewhere
- Primary: `claude-sonnet-4-20250514`. Bulk: `claude-haiku-4-5-20251001`. Fallback: `gpt-4o`
- Prompt templates in `src/lib/ai/prompts/` export: SYSTEM_PROMPT, buildUserPrompt(), parseResponse(), config
- Always validate AI output with Zod — treat AI responses as untrusted input
- Log every call: model, tokens, cost, latency to content_pipeline_logs
- Stream chat responses via SSE using ReadableStream
- Cache deterministic responses in Redis (24h TTL)
- Rate limit AI endpoints: 10 req/min free, 60 req/min premium
- Set maxTokens conservatively — avoid truncation waste
