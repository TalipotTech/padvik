# Padvik Scraping Pipeline — Technical Documentation

## Overview

The Padvik Scraping Pipeline automatically downloads syllabus PDFs from Indian education board websites, extracts text, parses the content using AI into structured curriculum data (subjects, chapters, topics), and stores it in PostgreSQL. The system supports CBSE, ICSE, and Kerala SCERT boards.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Admin UI (Next.js)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ Scrape       │  │ Curriculum   │  │ Syllabus Viewer       │ │
│  │ Pipeline     │  │ Explorer     │  │ (Raw Text + TOC)      │ │
│  │ /scrape-jobs │  │ /curriculum  │  │ /syllabus-viewer      │ │
│  └──────┬───────┘  └──────────────┘  └───────────────────────┘ │
│         │                                                       │
│         ▼                                                       │
│  POST /api/admin/scrape-jobs                                    │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │   BullMQ     │────▶│   Redis      │◀────│   Workers    │   │
│  │   Queue      │     │   (ioredis)  │     │  (pnpm       │   │
│  │   (scrape)   │     └──────────────┘     │   workers)   │   │
│  └──────────────┘                          └──────┬───────┘   │
│                                                    │           │
└────────────────────────────────────────────────────┼───────────┘
                                                     │
                                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Scrape Worker Pipeline                       │
│                                                                 │
│  1. Fetch Board Index Page (HTTP GET)                           │
│     ├── CBSE: cbseacademic.nic.in/curriculum_2026.html          │
│     ├── ICSE: cisce.org/regulations-syllabi                     │
│     └── Kerala: scert.kerala.gov.in/curriculum                  │
│                                                                 │
│  2. Extract PDF Links (regex on HTML hrefs)                     │
│     └── Filter: skip overview PDFs, filter by grade             │
│                                                                 │
│  3. For Each PDF:                                               │
│     ├── Download PDF (retry 3x, 30s timeout)                    │
│     ├── Save PDF locally → data/pdfs/{board}/{grade}/           │
│     ├── Extract text (pdf-parse)                                │
│     ├── Save text → data/pdfs/{board}/{grade}/*.txt             │
│     ├── Infer grade from URL (/Sec/ → 9,10 | /SrSec/ → 11,12) │
│     ├── AI Parse (multi-provider with fallback):                │
│     │   ├── Try Gemini Flash (cheapest)                         │
│     │   ├── Try GPT-4o-mini                                     │
│     │   ├── Try Mistral Large                                   │
│     │   └── Try Claude Sonnet (fallback)                        │
│     ├── Validate with Zod schema                                │
│     └── Insert into DB:                                         │
│         ├── standards → subjects → chapters → topics            │
│         ├── Set metadata: sourcePdf, aiModel, parsedAt          │
│         └── Set reviewStatus: "pending"                         │
│                                                                 │
│  4. Log every step to contentPipelineLogs                       │
│  5. Save scrapeResult to job metadata (for resume)              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL Database                         │
│                                                                 │
│  boards → standards → subjects → chapters → topics              │
│                                                                 │
│  scrape_jobs (status, items, metadata with scrapeResult)        │
│  content_pipeline_logs (stage, model, tokens, cost, status)     │
│  file_uploads (PDF storage tracking)                            │
└─────────────────────────────────────────────────────────────────┘
```

## Dependencies Added

```
ioredis          — Redis client (lazy singleton, maxRetriesPerRequest: null for BullMQ)
bullmq           — Job queue (3 queues: scrape, content, file)
```

## Files Created/Modified

### Scraper Infrastructure (src/lib/scraper/)
| File | Purpose |
|------|---------|
| `base-scraper.ts` | Abstract base with retry, rate limiting, backoff, `updateJob()`, `updateJobMetadata()` |
| `cbse-scraper.ts` | CBSE: fetches cbseacademic.nic.in, extracts PDFs, AI parses, inserts DB. Resume support, failure tracking |
| `icse-scraper.ts` | ICSE: fetches cisce.org, same pipeline |
| `kerala-scraper.ts` | Kerala SCERT: fetches scert.kerala.gov.in, supports Malayalam medium filter |
| `parser.ts` | `extractTextFromPdf()` (pdf-parse), `extractLinks()` (regex), `resolveUrl()` |
| `syllabus-inserter.ts` | `insertParsedSyllabus()` — inserts subjects/chapters/topics with provenance metadata |
| `pdf-storage.ts` | `savePdfLocally()`, `saveExtractedText()`, `readExtractedText()` — local filesystem storage |
| `ai-model-resolver.ts` | `resolveModelWithFallbacks()` — multi-provider rotation (Gemini → GPT-mini → Mistral → Claude) |

### Queue System (src/lib/queue/)
| File | Purpose |
|------|---------|
| `index.ts` | BullMQ queue definitions (scrape/content/file), job data types, control helpers |
| `scrape-worker.ts` | Worker: resolves scraper by board, runs pipeline, updates progress, logs results |
| `content-worker.ts` | Worker: quality scoring + AI tagging (bloom level via Haiku) |
| `file-worker.ts` | Worker: stub for future file upload pipeline |
| `start-workers.ts` | Entry point: starts all workers, handles SIGTERM/SIGINT graceful shutdown |

### Redis Client (src/lib/redis.ts)
Lazy-initialized ioredis singleton with retry strategy, `closeRedis()` for shutdown.

### Database (src/db/index.ts)
Rewritten with Proxy-based lazy initialization — DB connection only on first query, works in both Next.js and CLI/worker contexts.

### AI Provider (src/lib/ai/provider.ts)
Added `AIProviderError`, `isAuthError()`, `isQuotaError()` for better error classification.

### AI Prompts (src/lib/ai/prompts/syllabus-parser.ts)
Updated SYSTEM_PROMPT for multi-board support. Fixed Zod schemas to allow `null` for optional fields.

### Admin API Routes (src/app/api/admin/)
| Route | Method | Purpose |
|-------|--------|---------|
| `/scrape-jobs` | GET | List last 50 scrape jobs |
| `/scrape-jobs` | POST | Create job + enqueue (duplicate prevention) |
| `/scrape-jobs/[id]` | GET | Single job details |
| `/scrape-jobs/[id]/progress` | GET | BullMQ job progress (polled every 2s) |
| `/scrape-jobs/[id]/control` | POST | Pause/resume/cancel/restart/delete |
| `/queue-status` | GET | Queue job counts (waiting/active/completed/failed) |
| `/ai-usage` | GET | AI token/cost/model stats from pipeline logs |
| `/scraped-content` | GET | Content summary (boards/grades/subjects/chapters/topics) |
| `/curriculum-explorer` | GET | Full nested hierarchy with provenance metadata |
| `/curriculum-explorer/[subjectId]/verify` | GET | Raw text + parsed content for side-by-side comparison |
| `/curriculum-explorer/[subjectId]/review` | POST | Approve/reject/flag content |

### Admin UI Pages (src/app/(admin)/)
| Page | Route | Purpose |
|------|-------|---------|
| Scrape Pipeline | `/scrape-jobs` | Trigger, monitor, control scrape jobs. 4 tabs: Jobs, Queue Status, AI Usage, Scraped Content |
| Curriculum Explorer | `/curriculum` | Browse all content: tree/grid view, search, filter, completeness %, inline scrape buttons |
| Verify | `/curriculum/verify/[subjectId]` | Side-by-side: raw PDF text vs parsed content, approve/reject |
| Syllabus Viewer | `/syllabus-viewer` | Read raw syllabus text with TOC sidebar, click-to-highlight, topic links |

### Landing Page + Auth (src/app/page.tsx, src/components/auth/)
| File | Purpose |
|------|---------|
| `page.tsx` | Full marketing landing page: hero, features, boards, stats, CTA, footer |
| `auth-dialog.tsx` | Sign-in popup dialog (Google, email/password, demo logins) |
| `signup-dialog.tsx` | Sign-up popup dialog (Google, registration form) |

### Navigation Updates
| File | Change |
|------|--------|
| `sidebar.tsx` | Added: Scrape Pipeline, Curriculum, Syllabus Viewer for admin role |
| `dashboard-home.tsx` | Admin quick actions: 6 cards linking to all admin features |
| `(admin)/layout.tsx` | Header nav tabs: Scrape Pipeline, Curriculum, Syllabus Viewer |

### CLI Scripts
| Script | Command | Purpose |
|--------|---------|---------|
| `scripts/run-scraper.ts` | `pnpm scrape --board cbse --grades 9,10 --max-pdfs 5` | CLI scraper with job tracking |
| — | `pnpm workers` | Start all BullMQ workers |

## Scraping Workflow

### Step 1: Trigger
- **UI**: Admin → Scrape Pipeline → Select board/grade/provider → Start Scrape
- **CLI**: `pnpm scrape --board cbse --max-pdfs 5 --grades 10`
- **Inline**: Curriculum Explorer → "Scrape Class X" button

### Step 2: Queue
- Creates `scrape_jobs` DB record (status: queued, metadata: boardCode, aiProvider, grades, triggeredBy)
- Enqueues to BullMQ scrape queue with priority (CBSE = 1, others = 2)
- Returns queueJobId for frontend polling

### Step 3: Worker Processing
- Worker picks up job, resolves scraper by boardCode
- Checks for resume state (previously processed URLs)
- Fetches board index page, extracts PDF links
- Filters: skip overview PDFs, filter by grade, limit by maxPdfs

### Step 4: Per-PDF Pipeline
1. **Download**: HTTP GET with retry 3x, 30s timeout, rate limited (3s between requests)
2. **Save**: PDF → `data/pdfs/{board}/{grade}/filename.pdf`
3. **Extract**: pdf-parse → text string → save `.txt` alongside
4. **Grade**: Infer from URL path (/Sec/ = 9,10, /SrSec/ = 11,12)
5. **AI Parse**: Send text to AI with syllabus parser prompt, try providers in order with fallback
6. **Validate**: Zod schema (subjectName, subjectCode, grade, chapters[], topics[])
7. **Insert**: subjects → chapters → topics with provenance metadata (sourcePdf, aiModel, parsedAt, scrapeJobId)
8. **Log**: Each step logged to contentPipelineLogs (stage, tokens, cost, model, status)

### Step 5: Error Handling
- Individual PDF failure → logged, skipped, batch continues
- 3 consecutive auth/quota failures → stops early, saves progress for resume
- Worker crash → BullMQ retries, resumes from saved processedUrls
- All inserts idempotent (onConflictDoNothing)

### Step 6: Verification
- Admin opens Curriculum Explorer → sees subjects with completion %
- Clicks "Verify" → side-by-side comparison (raw text vs parsed tree)
- Clicks chapter title → highlights in raw text
- Approves/rejects → reviewStatus updated

### Step 7: Student Access
- Approved content (reviewStatus: "approved") visible to students
- Full provenance chain: PDF URL → local file → AI model → chapters → topics
- Student syllabus explorer shows chapters/topics from approved subjects

## Running the System

```bash
# 1. Start Redis (required for queue mode)
redis-server

# 2. Start Next.js dev server
pnpm dev

# 3. Start BullMQ workers (separate terminal)
pnpm workers

# 4. Trigger scrape from admin UI or CLI
pnpm scrape --board cbse --max-pdfs 5 --grades 10
```

## Cost Tracking

All AI calls logged to `contentPipelineLogs` with:
- `aiModelUsed`: Which model processed this content
- `aiTokensUsed`: Input + output token count
- `processingTimeMs`: Duration
- `outputData.costUsd`: Estimated cost

Admin → AI Usage tab shows per-provider breakdown, total cost, and recent activity.

## Data Provenance

Every scraped subject has in `metadata` JSONB:
```json
{
  "sourcePdf": "data/pdfs/CBSE/10/Arabic_Sec_2025-26.pdf",
  "sourceText": "data/pdfs/CBSE/10/Arabic_Sec_2025-26.txt",
  "sourceUrl": "https://cbseacademic.nic.in/web_material/...",
  "aiModel": "gpt-4o-mini",
  "parsedAt": "2026-04-02T...",
  "scrapeJobId": 5,
  "boardCode": "CBSE",
  "reviewStatus": "pending"
}
```
