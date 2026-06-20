# Auto-Content Generation Pipeline — Implementation Summary

Status of the work driven by [`auto-content-generation-prompts.md`](./auto-content-generation-prompts.md).

**All 10 prompts are implemented, and the Prompt 10 smoke test is done** — the full pipeline has been exercised end-to-end (demand → generate → review → publish under "Padvik Official", with live cost/budget tracking). Beyond the prompts, a substantial round of hardening, observability, model upgrades, and admin UX was added.

System creator: **"Padvik Official"**, user id **6** (`PADVIK_SYSTEM_CREATOR_ID=6`).

---

## 1. Prompts 1–10 — delivered

| # | Prompt | Delivered | Key files |
|---|---|---|---|
| 1 | Schema & system creator | `auto_content_jobs` + `content_demand_signals` tables; seed script; env vars | `src/db/schema/auto-content.ts`, `scripts/seed-system-creator.ts`, `drizzle/0015_*`, `drizzle/0017_*` |
| 2 | Demand-signal tracking | `trackDemandSignal`, `calculateDemandScores`, `getTopDemandTopics`, `cleanupOldSignals` + shared types | `src/lib/auto-content/demand-tracker.ts`, `types.ts`, `index.ts` |
| 3 | Text-note generator | `ContentBlock[]` notes with Zod validation + retry; reuses explainer block schema | `generators/text-note.ts`, `generators/validate-blocks.ts` |
| 4 | Question-set generator | Board-pattern set (5 MCQ / 2 short / 1 long) with composition validation + retry | `generators/question-set.ts` |
| 5 | Audio-explainer generator | Spoken script + TTS (ElevenLabs → Google → Sarvam) | `generators/audio-explainer.ts` |
| 6 | Publisher | Writes `creator_content` under the system creator; links job; auto-approve rules | `publisher.ts` |
| 7 | Orchestrator & budget | Demand-driven generation cycle, per-type daily caps, `DAILY_CONTENT_BUDGET` guard, BullMQ queues/crons | `orchestrator.ts`, `jobs.ts`, wired into `queue/start-workers.ts` |
| 8 | API endpoints | request-content (student), dashboard GET, generate, `[jobId]` GET/PUT (approve/reject), costs | `src/app/api/topics/[topicId]/request-content/`, `src/app/api/admin/auto-content/*` |
| 9 | Demand integration points | `search`, `view` (24h Redis debounce), `ask_ai`, `doubt_posted`; **Request-Content button placed** | `content/browse`, `learn/topic/[id]`, `learn/chat`, `doubts` routes; `components/topics/RequestContentButton.tsx` (in `learn-view.tsx`) |
| 10 | Admin dashboard | Stat cards, top-demand table, pending review, recent activity, cost tracker | `src/app/(admin)/auto-content/page.tsx` + `_components/auto-content-dashboard.tsx` |

**Cron schedule** (in `jobs.ts`): demand scoring `0 2 * * *`, generation cycle `0 4 * * *`, signal cleanup `0 3 1 * *`. Process queue retries 3× (1m/5m/15m backoff).

---

## 2. Enhancements beyond the prompts

**Reliability & correctness**
- **Idempotent publisher** — re-running a job updates its existing content row in place; **no orphaned `creator_content`**.
- **Fail-fast + retry** — generation errors rethrow so BullMQ retries; auth/credit/validation (400/401/402) raise `TerminalGenerationError` → no wasted retries. Generate endpoint revives stranded/queued/failed jobs.
- **JSON robustness** — text-note SVGs use single-quoted attributes (JSON-safe) + trailing-comma repair; question-set enforces exact field keys (`solution`, etc.).
- Env-ordering fixes for worker (`YOUTUBE_API_KEY`, model config read lazily).

**Audio**
- Sarvam 500-char input limit fixed (chunking) + **WAV re-mux** so multi-chunk Indic audio plays end-to-end; correct MIME (`audio/wav` vs `audio/mpeg`) threaded through to storage.

**Model strategy (current)**
- **Opus 4.8** for text notes & question sets, **Sonnet 4.6** for audio script, **Haiku 4.5** for video re-rank. Provider made Opus-safe (strips `temperature`/`top_p`, uses adaptive thinking + `effort`). Per-generator models are env-overridable (`AUTO_CONTENT_*_MODEL`, `AUTO_CONTENT_EFFORT`).
- **Manual provider/model selection** in the dashboard: Default rotation + Claude Opus/Sonnet, Gemini, **GPT-4o**, **Perplexity Sonar**, Mistral. Keyed by `requested_model` with unique `(topic, content_type, requested_model)` — **same model replaces, a different model adds another version**. GPT JSON reliability via OpenAI JSON mode.

**Video** (Prompt 1's `video_lesson`, deferred in the prompt doc)
- Implemented as **curated YouTube** — `searchYouTubeVideos` shortlist + Haiku re-rank, always-review, near-zero cost. Embedded in the review card and student viewer. `generators/video-lesson.ts`.

**Admin dashboard UX**
- **"Generate for any topic"** syllabus search box (manual generation for promo content).
- Live auto-poll + "live" indicator; **whole row locks while generating**, then enables with **Regenerate**.
- "Already generated" indicator (type + model + status); **audio-pending** badge; inline **error viewer** + **Retry** on failed jobs.
- Recent Activity shows **board · class · subject · chapter** + **provider · model**; Cost Tracker has a **per provider/model** cost & usage table.

**Content rendering**
- Student content viewer renders `ContentBlock[]` notes (headings, KaTeX formulas, SVG diagrams, callouts) and question sets (options + show-answer) instead of raw JSON. YouTube iframe embed for video.

**Help & discoverability**
- `/help` + `/help/auto-content` guides; Help entry in the admin header dropdown, the `/dashboard` sidebar, and an Auto-Content card on the admin dashboard.

**Observability**
- TTS attempts logged to `content_pipeline_logs` (`auto_content:tts`, surfaced at `/api/admin/ai-usage`).
- **Sentry** (server `instrumentation.ts` + client `instrumentation-client.ts` + `reportError`), inert without a DSN. Per-job `last_error` and audio degradation reasons persisted and shown in the UI.

---

## 3. Smoke test (Prompt 10) — verified

- Manual generation via dashboard for multiple topics (Quadratic Equations chapter).
- Text notes & question sets generated (Opus 4.8 and GPT-4o), auto-published.
- Audio: transcript-only fallback observed, then real audio after TTS configured.
- 2 videos curated (YouTube) → Pending Review → approve.
- Approve/reject flow, published under "Padvik Official", cost tracking + budget bar all working.
- Retry-on-validation-failure confirmed (GPT-4o `solution` field — now fixed to pass first attempt).

---

## 4. Future additions

**Content**
- **True generated video** (beyond curation): slideshow assembly (notes → slides + audio narration via ffmpeg) and/or AI avatar / text-to-video. Gate behind the demand-100 threshold + budget.
- **TTS engine selector** for audio (ElevenLabs / Sarvam / Google) per generation, like the LLM model picker.
- Proper single-file MP3 transcode for multi-chunk Sarvam audio (currently re-muxed WAV).

**Quality & ops**
- **Token-level usage** in the cost-by-model table (join `content_pipeline_logs`).
- **Alerting** beyond Sentry (e.g., Slack/email when budget exhausted or failure rate spikes).
- Cleanup script for any legacy duplicate `creator_content` predating the idempotent publisher.
- Apply the live in-flight **row lock to the demand-table rows** too (currently search rows only).
- Confirm the current **Gemini** model id (project is on `gemini-2.5-pro`).

**Product**
- Public-site surfacing/curation of multiple model-variants per topic (A/B the best official content).
- Per-board/standard generation campaigns + coverage dashboard tie-in.
- Production verification of the nightly crons (demand scoring → generation cycle) under real traffic.

---

## 5. Operating notes

- Run workers: `pnpm workers` (processes jobs + registers crons). Restart after changing `src/lib/auto-content/*` or `provider.ts` (tsx, no hot-reload).
- Env: `PADVIK_SYSTEM_CREATOR_ID`, `DAILY_CONTENT_BUDGET`, `AUTO_CONTENT_ENABLED`, TTS keys, optional `AUTO_CONTENT_*_MODEL` / `AUTO_CONTENT_EFFORT`, optional `SENTRY_DSN`.
- Dashboard: `/auto-content` (admin only).
