# Padvik — Content Acquisition Implementation Prompts (Revised)
## Extends existing backend — does NOT replace current AI provider or scrapers

**IMPORTANT:** The backend scaffolding, database schemas, auth, AI provider (`src/lib/ai/provider.ts`), and scraping pipeline have already been implemented via Claude Code from the initial bootstrap prompts. The prompts below EXTEND the existing code. Every prompt starts with "Read the existing code first" to ensure Claude Code understands what is already built.

---

## CONTEXT: What Already Exists

Before feeding any prompt, verify your current state. The existing codebase should have: the AI provider at `src/lib/ai/provider.ts` (Claude primary, OpenAI fallback), prompt templates in `src/lib/ai/prompts/`, a base scraper class, a CBSE syllabus scraper, all 9 database schema files with BIGINT PKs, scrape job admin API, auth, middleware, and seed data.

What these prompts add: multi-provider support (Gemini, Sarvam) grafted onto the existing provider, DIKSHA/Sunbird API client, NCERT PDF bulk downloader with parser, Kerala SCERT scraper, question paper parser with language-aware provider routing, state board scrapers, AI content gap filler, and admin pipeline dashboard UI.

---

## PROMPT 0: Upgrade Existing AI Provider with Multi-Provider Rotation

Feed this to Claude Code:

> IMPORTANT: Do NOT rewrite or replace src/lib/ai/provider.ts from scratch. Read the existing file first, understand its current interface, and EXTEND it to support multiple providers while keeping all existing function signatures and call sites working.
>
> Read these files to understand current usage: src/lib/ai/provider.ts, src/lib/ai/types.ts (if exists), all files in src/lib/ai/prompts/, all files in src/lib/scraper/, and any API routes that call the provider.
>
> NOW EXTEND the provider with these changes:
>
> 1. KEEP the existing main function (callAI / generateCompletion / whatever it is called). Don't rename it, don't change its signature. Add an OPTIONAL 'provider' and 'language' parameter to it so existing callers with no args work identically.
>
> 2. ADD new provider SDKs alongside the existing Anthropic SDK. Install @google/genai for Gemini Pro. Keep the existing openai package. Add a placeholder interface for Sarvam Vision (REST-based, implement later).
>
> 3. ADD a type: type AIProviderName = 'claude' | 'gemini' | 'openai' | 'sarvam'
>
> 4. ADD language-based routing INSIDE the existing function: if language is 'hi','ml','ta','te','kn','mr','gu','bn' AND the task involves OCR or image parsing, route to Gemini. If language is 'en' or undefined, keep using Claude (existing behavior). If a specific provider is passed explicitly, use that provider (manual override). If no provider and no language hint, existing behavior unchanged.
>
> 5. ADD auto-failover: if selected provider returns 429/500/timeout, try next in chain. For English tasks: Claude → OpenAI → Gemini. For Indic tasks: Gemini → Claude → OpenAI → Sarvam.
>
> 6. ADD provider and language fields to whatever logging currently exists. If content_pipeline_logs is used, add columns via a new migration if needed.
>
> 7. ADD rate limit tracking per provider in Redis. Key: padvik:rate:{provider}:{minute}. Limits: Claude 60 rpm, Gemini 60 rpm, OpenAI 60 rpm. Check before each call, preemptively rotate if near limit.
>
> 8. ADD to .env.example (don't remove existing vars): GOOGLE_GEMINI_API_KEY= and SARVAM_API_KEY=
>
> 9. Run pnpm build and verify zero TypeScript errors. Verify existing scraper calls still work unchanged.
>
> The key principle: existing code that calls the provider with no provider/language params must behave EXACTLY as before. New code can pass provider='gemini' or language='ml' to get routing.

**After this prompt:** Test your existing CBSE scraper to verify it still works. If it does, commit: `feat(ai): add multi-provider rotation with Gemini support`

---

## PROMPT 1: DIKSHA / Sunbird API Client (New File)

> Read the existing scraper code at src/lib/scraper/ to understand the patterns (BaseScraper, rate limiting, error handling, logging).
>
> Create a NEW file: src/lib/scraper/diksha-client.ts — this does NOT replace any existing scraper.
>
> DIKSHA is India's national education platform (diksha.gov.in) with a public search API built on Sunbird. No API key needed.
>
> Implement a DikshClient class with methods: searchContent (POST to https://diksha.gov.in/api/composite/v1/search with filters for board, gradeLevel, subject, medium, contentType, limit, offset), getTextbookTOC (gets chapter/topic tree for a textbook ID), getContentDetails (single content by ID), downloadArtifact (downloads PDF/HTML from artifactUrl).
>
> Add mapping functions: dikshaBoardToOurCode ("State (Kerala)" → "KL_SCERT", "CBSE" → "CBSE") and dikshaGradeToNumber ("Class 10" → 10).
>
> Rate limit: max 10 req/sec. Store raw API responses in S3 under diksha-raw/ for audit. Log to scrape_jobs using existing patterns.

---

## PROMPT 2: DIKSHA Content Ingestion Pipeline (New File)

> Read src/lib/scraper/diksha-client.ts (just created) and existing schemas at src/db/schema/curriculum.ts and src/db/schema/content.ts.
>
> Create NEW file: src/lib/scraper/diksha-ingestion.ts
>
> Pipeline: for a given board and grade range, query DIKSHA for textbooks, get TOC, compare with existing chapters/topics in our DB (INSERT new, UPDATE existing with richer metadata), search for linked content per topic (ExplanationContent → content_items, PracticeQuestionSet → questions, LessonPlan → content_items), download PDFs to S3, queue for existing parser.
>
> Dedup: before inserting any content_item, check if source_url already exists. All DIKSHA content gets source_type='diksha'.
>
> Create BullMQ job 'diksha-ingest' using existing queue setup. Admin endpoint: POST /api/admin/diksha/ingest with body { boardCode, gradeStart, gradeEnd }. Add as new route file, don't modify existing routes.
>
> Test with: CBSE, Classes 8-12, Science and Maths.

---

## PROMPT 3: NCERT PDF Bulk Downloader (New File)

> Read existing src/lib/scraper/cbse-scraper.ts. The NCERT downloader is SEPARATE — it downloads actual textbook PDFs, not syllabus metadata.
>
> Create NEW file: src/lib/scraper/ncert-downloader.ts
>
> Source: https://ncert.nic.in/textbook.php. Also reference the GitHub gist with all URLs: gist.github.com/dufferzafar/b579a6ccbf3a2b321ff9a6e5d377757a
>
> Define a book catalog constant for Classes 1-12, all subjects, including NEP names (Class 6 Science = "Curiosity"). Download chapter PDFs to S3: ncert-pdfs/{class}/{subject}/ch{num}.pdf. Rate limit 1 per 3 seconds, retry 3x with 30s timeout.
>
> After download, queue for parsing using EXISTING AI provider. Pass language='en' for English medium, language='hi' for Hindi medium — the upgraded provider auto-routes Hindi to Gemini.
>
> BullMQ job: 'ncert-download'. Admin endpoint: POST /api/admin/ncert/download

---

## PROMPT 4: Kerala SCERT Scraper (New File)

> Create NEW file: src/lib/scraper/kerala-scraper.ts
>
> Source: samagra.kite.kerala.gov.in or aggregator hsslive.guru/scert-kerala-textbooks/
>
> Download Classes 1-12 in both English and Malayalam medium. Store in S3: kerala-scert/{class}/{medium}/{subject}.pdf
>
> Queue for parsing: English medium passes language='en' (routes to Claude, existing behavior). Malayalam medium passes language='ml' (routes to Gemini via the upgraded provider). The scraper doesn't need to know about Gemini — it just passes the language.
>
> Store with board_id = KL_SCERT. BullMQ job: 'kerala-scrape'. Admin endpoint: POST /api/admin/kerala/scrape with body { classStart, classEnd, medium: 'english' | 'malayalam' | 'both' }

---

## PROMPT 5: Question Paper Parser Upgrade (Extend Existing)

> Read the EXISTING question parsing code. Find it — check src/lib/scraper/, src/lib/ai/prompts/, and src/app/api/. DO NOT REWRITE it.
>
> EXTEND it with: (1) A detectLanguage() function that sends the first page/paragraph to AI with "What language is this? Return ISO 639-1 code." (2) Add optional { provider?, language? } parameters to the existing parsing function. If not provided, existing behavior (Claude primary). If language is Indic, provider.ts routes to Gemini automatically. (3) If an admin question paper upload UI exists, add language and provider dropdown selectors to it. If it doesn't exist, create it at src/app/(admin)/question-papers/upload/page.tsx with drag-drop upload, board/class/subject/year selectors, language dropdown (Auto-detect, English, Hindi, Malayalam, Tamil, Telugu, Kannada), provider dropdown (Auto, Claude, Gemini, OpenAI), parse preview, and save.
>
> VERIFY: Upload an English paper with no language/provider params — must work exactly as before.

---

## PROMPT 6: Previous Year Paper Scraper (New File)

> Create NEW file: src/lib/scraper/paper-scraper.ts
>
> Sources: CBSE (cbse.gov.in/cbsenew/question-paper.html), CBSE Sample (cbseacademic.nic.in), ICSE (cisce.org/SpecimenQuestionPaper.aspx), Kerala SSLC (keralapareekshabhavan.in), Kerala HSE (dhsekerala.gov.in).
>
> For each: scrape PDF links, download to S3 papers/{board}/{year}/{class}/{subject}.pdf, create question_papers entry, detect language from filename or first-page detection, queue for parsing via the question parser (Prompt 5) with detected language so English → Claude and Indic → Gemini automatically.
>
> Rate limit 1 req/3s. BullMQ job: 'paper-scrape'. Admin endpoint: POST /api/admin/papers/scrape

---

## PROMPT 7: State Board Scrapers (New Files)

> Create NEW scraper files following existing BaseScraper pattern:
>
> karnataka-scraper.ts (ktbs.kar.nic.in, language='kn'), tamilnadu-scraper.ts (textbooksonline.tn.nic.in, language='ta'), maharashtra-scraper.ts (ebalbharati.in, language='mr'), ap-telangana-scraper.ts (scert.ap.gov.in and scert.telangana.gov.in, language='te').
>
> Each downloads textbook PDFs, passes correct language to parser (provider handles routing), stores with correct board_id, logs to scrape_jobs.
>
> For boards that follow NCERT directly (UP, Bihar, MP, Rajasthan, Gujarat): create a function addNCERTMappings(boardId) that creates topic_mappings entries linking to existing NCERT topics instead of duplicating content.

---

## PROMPT 8: AI Content Gap Filler (New File)

> Create NEW file: src/lib/ai/content-generator.ts
>
> findContentGaps(): query topics with fewer than 2 published content_items, sorted by CBSE first, Classes 10/12 first, Science/Maths first. generateNotesForTopic(topicId): use existing provider with Claude Sonnet, store as content_item source_type='ai_generated'. generateFlashcards(topicId): use Claude Haiku. generateMCQs(topicId): use Claude Sonnet, store in questions table. bulkGenerateContent(): BullMQ job batches of 50.
>
> Admin: POST /api/admin/content/generate with dryRun mode for cost estimation.

---

## PROMPT 9: Admin Pipeline Dashboard UI (New Pages)

> Read existing admin pages. Create NEW pages without modifying existing ones:
>
> /admin/pipeline — overview cards (content count, questions count, source breakdown), coverage matrix (board × class), recent pipeline logs, active jobs. /admin/content-review — pending items table, rendered preview, quality score badges, approve/reject/flag. /admin/ai-providers — provider status cards, usage and cost per provider today, rate limit gauges, auto/manual mode toggle.
>
> All use shadcn/ui, purple theme, admin role check. Use existing admin layout if one exists.

---

## EXECUTION ORDER

Session 1: Prompt 0 — Upgrade provider (careful, test after). Session 2: Prompts 1+2 — DIKSHA client + ingestion. Session 3: Prompt 3 — NCERT downloader. Session 4: Prompt 4 — Kerala SCERT. Session 5: Prompt 5 — Question parser upgrade (careful, test after). Session 6: Prompt 6 — Paper scraper. Session 7: Prompt 7 — State board scrapers. Session 8: Prompt 8 — Content gap filler. Session 9: Prompt 9 — Admin dashboard.

## SAFETY RULES

1. Always start with "Read the existing code first" — this is in every prompt
2. Never rewrite existing files — extend or create new
3. After every prompt run pnpm build to verify no TypeScript errors
4. Test existing functionality works unchanged after Prompts 0 and 5
5. Use /clear in Claude Code between prompts for fresh context
6. Commit after each successful prompt with conventional commit message
