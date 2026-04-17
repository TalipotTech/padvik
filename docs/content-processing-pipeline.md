# Creator Content Processing Pipeline — Technical Documentation

## Overview

When a creator uploads content (video, audio, PDF, image, note, or question set), the system processes it through a **content-type-specific pipeline** of ordered stages. Each content type has its own sequence of stages — thumbnail generation, text extraction, AI analysis, quality scoring — that run asynchronously via BullMQ after upload.

The pipeline is designed for **local development first with a clean AWS migration path**. All file storage goes through `src/lib/s3.ts` which transparently switches between local filesystem and S3.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Creator Dashboard (Next.js)                      │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────────────────┐ │
│  │ Upload Page   │  │ Content List  │  │ Content Detail           │ │
│  │ /creator/     │  │ /creator/     │  │ /creator/content/[id]    │ │
│  │ content/upload│  │ content       │  │ (status polling)         │ │
│  └──────┬────────┘  └───────────────┘  └──────────────────────────┘ │
│         │                                                            │
│         ▼                                                            │
│  POST /api/creators/content/upload                                   │
│    1. Validate files                                                 │
│    2. Upload to S3/local storage                                     │
│    3. OCR handwritten images (if flagged)                            │
│    4. Create creatorContent row (uploadStatus = "processing")        │
│    5. Queue job to BullMQ                                            │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐ │
│  │   BullMQ     │────>│   Redis      │<────│ creator-content      │ │
│  │   Queue      │     │   (ioredis)  │     │ -worker              │ │
│  │  "creator-   │     └──────────────┘     │ (concurrency: 2)     │ │
│  │   content-   │                          │ (rate: 10/min)       │ │
│  │   process"   │                          └──────────┬───────────┘ │
│  └──────────────┘                                     │             │
│                                                       ▼             │
│                                          processCreatorContent()    │
│                                          (stage runner/dispatcher)  │
│                                                       │             │
│                                                       ▼             │
│                                          ┌────────────────────────┐ │
│                                          │ Pipeline by content    │ │
│                                          │ type (see below)       │ │
│                                          └────────────────────────┘ │
│                                                       │             │
│                                                       ▼             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  PostgreSQL                                                   │   │
│  │  ┌─────────────────┐  ┌──────────────────────┐               │   │
│  │  │ creator_content  │  │ content_pipeline_logs │              │   │
│  │  │ (results)        │  │ (stage audit trail)   │              │   │
│  │  └─────────────────┘  └──────────────────────┘               │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

## Pipelines by Content Type

Each content type maps to an ordered list of stages. The runner executes them sequentially, persisting results after each stage.

```
VIDEO
  ┌──────────────────┐    ┌───────────────────┐    ┌──────────────┐
  │ generate_        │───>│ set_processed_url │───>│ ai_summarize │
  │ thumbnail        │    │ (pass-through)    │    │              │
  │ (purple gradient │    │ processedUrl =    │    │ title + desc │
  │  placeholder)    │    │ mediaUrl          │    │ -> 2-3 lines │
  └──────────────────┘    └───────────────────┘    └──────┬───────┘
                                                          │
       ┌──────────────────────────────────────────────────┘
       ▼
  ┌──────────┐    ┌──────────────────┐    ┌──────────┐
  │ ai_tag   │───>│ ai_quality_check │───>│ complete  │
  │ 5-8 tags │    │ score 0.0-1.0    │    │ set ready │
  └──────────┘    └──────────────────┘    └──────────┘


AUDIO
  ┌───────────────────┐    ┌──────────────┐    ┌──────────┐
  │ set_processed_url │───>│ ai_summarize │───>│ ai_tag   │──>
  │ (pass-through)    │    │              │    │          │
  └───────────────────┘    └──────────────┘    └──────────┘
  ──> ┌──────────────────┐    ┌──────────┐
      │ ai_quality_check │───>│ complete  │
      └──────────────────┘    └──────────┘


DOCUMENT (PDF/DOCX)
  ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
  │ extract_text │───>│ generate_        │───>│ ai_summarize │──>
  │ pdf-parse /  │    │ thumbnail        │    │ uses         │
  │ mammoth      │    │ (page 1 render   │    │ extracted    │
  │ -> 10K chars │    │  via sharp)      │    │ text         │
  └──────────────┘    └──────────────────┘    └──────────────┘
  ──> ┌──────────┐    ┌──────────────────┐    ┌──────────┐
      │ ai_tag   │───>│ ai_quality_check │───>│ complete  │
      └──────────┘    └──────────────────┘    └──────────┘


IMAGE
  ┌──────────────────┐    ┌─────────────────┐    ┌──────────────────┐
  │ generate_        │───>│ ai_tag          │───>│ ai_quality_check │──>
  │ thumbnail        │    │ (AI VISION -    │    │                  │
  │ (400px resize)   │    │  sends image to │    └──────────────────┘
  └──────────────────┘    │  Claude/Gemini) │
                          └─────────────────┘
  ──> ┌──────────┐
      │ complete  │
      └──────────┘


NOTE (text/markdown)
  ┌──────────────┐    ┌──────────┐    ┌──────────────────┐    ┌──────────┐
  │ ai_summarize │───>│ ai_tag   │───>│ ai_quality_check │───>│ complete  │
  │ (body text)  │    │          │    │                  │    │          │
  └──────────────┘    └──────────┘    └──────────────────┘    └──────────┘


QUESTION_SET
  ┌──────────────────┐    ┌──────────┐
  │ ai_quality_check │───>│ complete  │
  │ (validate Qs)    │    │          │
  └──────────────────┘    └──────────┘
```

## Stage Descriptions

### `generate_thumbnail`

Produces a thumbnail image based on content type:

| Content Type | Method | Output |
|---|---|---|
| **video** | SVG with purple gradient (#7C3AED → #4F46E5) + play icon, rendered to PNG via `sharp` | 400x225 PNG |
| **document** | Renders page 1 with `pdf-renderer.renderSinglePage()`, resizes via `sharp`. Falls back to purple placeholder if rendering fails | 400px wide PNG |
| **image** | Resizes original via `sharp({ width: 400, withoutEnlargement: true })` | 400px wide PNG |

Thumbnails are uploaded to storage at: `creators/{creatorId}/thumbs/{contentId}-{type}.png`

Sets `ctx.result.thumbnailUrl` which is persisted to the `thumbnail_url` DB column.

### `set_processed_url`

MVP pass-through — sets `processedUrl = mediaUrl` (serve original file directly).

For video content, sets metadata flags for future transcoding:
```json
{
  "transcodingTodo": true,
  "transcodingConfig": {
    "pending": true,
    "profiles": ["360p_500kbps", "480p_1mbps", "720p_2.5mbps"],
    "format": "hls"
  }
}
```

**Phase 2 (AWS):** Replace with AWS MediaConvert for HLS adaptive bitrate streaming.

### `extract_text`

Extracts raw text from document files for AI analysis and search indexing:

| Format | Library | Notes |
|---|---|---|
| PDF | `pdf-parse` | Extracts all text content |
| DOCX/DOC | `mammoth` | Extracts raw text from Word documents |

Stores first 10,000 characters in `metadata.extractedText`. This extracted text is then used by `ai_summarize` and `ai_tag` instead of just the title/description, giving much richer AI outputs for document content.

### `ai_summarize`

Generates a 2-3 sentence summary for student dashboard cards.

**Content-type awareness:**
- **document**: Uses extracted text (from `extract_text` stage) — up to 3000 chars
- **note**: Uses body text directly
- **video/audio**: Uses title + description only (no transcript yet — Phase 2)
- **image**: Skipped (images don't get text summaries)

Model: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — ~$0.008/call

### `ai_tag`

Extracts 5-8 educational topic tags.

**Content-type awareness:**
- **image**: Uses **AI Vision** — sends the actual image to Claude/Gemini for visual topic extraction. Falls back to text-based tagging from title if vision fails.
- **All others**: Text-based tagging from title + description + body/extracted text.

Returns JSON array of strings, with fallback comma-split parsing.

### `ai_quality_check`

Rates content quality on a 0.0-1.0 scale:

| Content Type | Criteria |
|---|---|
| **Standard content** | Curriculum relevance, clarity, accuracy, completeness |
| **question_set** | Question clarity, answer correctness, difficulty appropriateness, curriculum alignment |

Returns `{ "score": 0.85, "reason": "brief explanation" }`. Defaults to 0.5 if parsing fails.

### `ai_detect_language`

Detects primary language (ISO 639-1 code: en, hi, ml, ta, te, kn).

**Not included in default pipelines** — kept for backward compatibility and can be added to any pipeline definition if needed.

### `complete`

Finalization stage that determines the content's final status:

```
                        ┌─────────────────────────┐
                        │   ai_quality_score       │
                        └────────────┬────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                  ▼
              score < 0.3     0.3 <= score < 0.7    score >= 0.7
                    │                │                  │
                    ▼                ▼                  ▼
           reviewStatus =    reviewStatus =     ┌──────────────┐
            "flagged"          "pending"        │ Is creator    │
                                                │ verified?     │
                                                └──────┬───────┘
                                                  yes  │  no
                                                ┌──────┴──────┐
                                                ▼             ▼
                                         Auto-publish    "pending"
                                         isPublished=    (manual
                                          true           review)
                                         reviewStatus=
                                          "approved"
```

Always sets `uploadStatus = "completed"`.

## Stage Tracking & Resume

Pipeline progress is tracked in the `metadata` JSONB column:

```json
{
  "pipelineStage": "ai_tag",
  "pipelineCompletedStages": ["extract_text", "generate_thumbnail", "ai_summarize", "ai_tag"],
  "pipelineStartedAt": "2026-04-11T10:30:00.000Z",
  "pipelineError": null,
  "extractedText": "Chapter 1: Introduction to Physics...",
  "transcodingTodo": false
}
```

### Resume on Retry

When a stage fails, the runner:
1. Sets `uploadStatus = "failed"`
2. Records `pipelineError` with the error message
3. Does **not** add the failed stage to `pipelineCompletedStages`

When the creator clicks **Retry** (`POST /api/creators/content/{id}/retry`):
1. Clears `pipelineError`
2. Resets `uploadStatus = "processing"`
3. Re-queues the job

The stage runner reads `pipelineCompletedStages` and **resumes from the first incomplete stage** — it does not re-run stages that already succeeded.

```
Example: Document pipeline, ai_tag fails

Pipeline stages:  extract_text → generate_thumbnail → ai_summarize → ai_tag → ai_quality_check → complete
Completed:       [extract_text,  generate_thumbnail,   ai_summarize]
                                                                  ^
                                                           retry starts here
```

Every stage is **idempotent** — re-running a completed stage would simply overwrite previous results without side effects.

## Error Handling

### Stage Failure
- Each stage runs in a try/catch
- On failure: `uploadStatus = "failed"`, error stored in `metadata.pipelineError`
- Previous successful stage results are preserved in DB
- Pipeline halts — no subsequent stages run

### AI Provider Failover
- AI calls go through `src/lib/ai/provider.ts` which auto-rotates providers on transient errors (429, 500, 503)
- Provider order: Claude (primary) → Gemini → OpenAI (fallback)
- Rate limiting: per-provider limits enforced via Redis

### S3/Storage Failure
- `uploadToStorage()` in `src/lib/s3.ts` handles dual-mode transparently
- Local dev: writes to `data/uploads/{key}`
- S3 prod: writes to configured AWS bucket
- Failures bubble up as stage errors → content marked "failed" → retryable

### Stale Processing Timeout
- Content stuck in `uploadStatus = "processing"` for > 30 minutes is auto-marked as `"failed"`
- Error: `"Processing timed out after 30 minutes"`
- Triggered via: `GET /api/admin/pipeline/cleanup`
- Can be called manually, via external cron, or integrated with BullMQ repeatable jobs

### Queue Unavailable (Redis down)
- Upload route catches queue errors gracefully
- Content is saved to DB with `uploadStatus = "completed"` (skips async processing)
- AI enrichment is skipped but content remains accessible

## File Map

```
src/lib/content-pipeline/
  ├── processor.ts           # Stage runner — loads content, dispatches stages, tracks progress
  ├── pipelines.ts           # Pipeline definitions per content type
  ├── types.ts               # PipelineContext, StageHandler, ProcessingResult, PipelineMetadata
  ├── stale-checker.ts       # 30-min timeout checker
  ├── auto-tagger.ts         # Curriculum auto-suggestion (board/class/subject/chapter)
  ├── track-view.ts          # Content engagement tracking
  └── stages/
      ├── index.ts           # Stage registry (name → handler map)
      ├── helpers.ts          # getFileBuffer(), buildAnalysisText()
      ├── generate-thumbnail.ts  # Video placeholder, document page-1, image resize
      ├── extract-text.ts     # PDF/DOCX text extraction
      ├── ai-stages.ts        # ai_summarize, ai_tag, ai_quality_check, ai_detect_language
      ├── set-processed-url.ts   # MVP pass-through + transcoding flags
      └── complete.ts         # Status finalization + auto-publish

src/lib/queue/
  ├── index.ts               # Queue definitions, addCreatorContentJob()
  └── creator-content-worker.ts  # BullMQ worker (concurrency: 2, rate: 10/min)

src/lib/s3.ts                # Dual-mode storage (local/S3)
src/lib/ai/provider.ts       # Multi-provider AI router

src/app/api/
  ├── creators/content/
  │   ├── upload/route.ts     # POST — file upload + queue job
  │   └── [id]/
  │       ├── status/route.ts # GET — poll processing status
  │       └── retry/route.ts  # POST — retry failed processing
  └── admin/pipeline/
      └── cleanup/route.ts    # GET — mark stale processing as failed
```

## Database Columns

The `creator_content` table stores all pipeline outputs:

| Column | Type | Set By |
|---|---|---|
| `upload_status` | varchar(20) | Runner: "processing" / "completed" / "failed" |
| `review_status` | varchar(20) | complete stage: "pending" / "approved" / "flagged" |
| `thumbnail_url` | text | generate_thumbnail stage |
| `processed_url` | text | set_processed_url stage |
| `ai_summary` | text | ai_summarize stage |
| `ai_tags` | text[] | ai_tag stage |
| `ai_quality_score` | decimal(3,2) | ai_quality_check stage |
| `ai_language` | varchar(10) | ai_detect_language stage (when used) |
| `ai_transcript` | text | Phase 2 (Whisper/speech-to-text) |
| `is_published` | boolean | complete stage (auto-publish for verified creators) |
| `published_at` | timestamptz | complete stage |
| `metadata` | jsonb | Pipeline tracking, extracted text, transcoding flags |

Pipeline audit trail is logged to `content_pipeline_logs` table with stage names prefixed as `creator_{stageName}`.

## Queue Configuration

| Setting | Value |
|---|---|
| Queue name | `creator-content-process` |
| Concurrency | 2 parallel jobs |
| Rate limit | 10 jobs per 60 seconds |
| Max retries | 2 attempts (exponential backoff, 5s base) |
| Priority | 3 (medium) |
| Job cleanup | Remove after 200 completed / 200 failed |

## API Endpoints

### Upload Content
```
POST /api/creators/content/upload
Content-Type: multipart/form-data
Auth: Creator required

Body: title, description?, body?, files[], handwritten?, boardId?, standardId?,
      subjectId?, chapterId?, topicId?, language?, isPremium?

Response 201: { success: true, data: { id, uploadStatus: "processing", ... } }
```

### Check Processing Status
```
GET /api/creators/content/{id}/status
Auth: Session required

Response 200: {
  success: true,
  data: { uploadStatus, reviewStatus, aiSummary, aiTags, aiQualityScore, aiLanguage }
}
```

### Retry Failed Processing
```
POST /api/creators/content/{id}/retry
Auth: Creator (must own content)
Precondition: uploadStatus must be "failed"

Response 200: { success: true, data: { retried: true, uploadStatus: "processing" } }
```

### Cleanup Stale Processing
```
GET /api/admin/pipeline/cleanup

Response 200: { success: true, data: { markedAsFailed: 3, checkedAt: "2026-04-11T..." } }
```

## Cost Estimation

| Stage | Model | Cost per Call |
|---|---|---|
| ai_summarize | Claude Haiku 4.5 | ~$0.008 |
| ai_tag (text) | Claude Haiku 4.5 | ~$0.005 |
| ai_tag (vision/image) | Claude Haiku 4.5 | ~$0.01-0.02 |
| ai_quality_check | Claude Haiku 4.5 | ~$0.005 |
| ai_detect_language | Claude Haiku 4.5 | ~$0.002 |

**Total per upload (typical):** $0.02-0.04 for text/document, $0.03-0.05 for images (vision)

OCR for handwritten images (done at upload time, not in pipeline): ~$0.01-0.50 depending on complexity.

## Phase 2 Roadmap

Features deferred from MVP, with infrastructure already in place:

| Feature | Current State | Phase 2 |
|---|---|---|
| **Video transcription** | `ai_transcript` column exists, unused | Add Whisper API / Gemini audio input. Extract audio track (requires ffmpeg). Store transcript, use for ai_summarize |
| **Video transcoding** | `transcodingTodo` flag set in metadata | AWS MediaConvert → HLS adaptive (360p, 480p, 720p). Update `processed_url` to HLS manifest URL |
| **Video thumbnails** | Purple gradient placeholder | ffmpeg frame extraction at 10% mark, or AI-generated description |
| **Audio duration** | `duration_seconds` column exists, unused | ffprobe or Web Audio API at upload time |
| **Sarvam Vision** | Provider stub exists, returns 501 | Integrate sarvam.ai API for Indic OCR (Hindi, Tamil, Malayalam handwriting) |
| **Auto-curriculum tagging** | `auto-tagger.ts` exists, not in pipeline | Add as optional stage after ai_tag to suggest board/class/subject/chapter |

## Adding a New Stage

1. Create handler in `src/lib/content-pipeline/stages/my-stage.ts`:
   ```typescript
   import type { PipelineContext } from "../types";
   
   export async function handleMyStage(ctx: PipelineContext): Promise<void> {
     // Access content: ctx.content.mediaUrl, ctx.content.title, etc.
     // Access metadata: ctx.metadata.extractedText, etc.
     // Write results: ctx.result.aiSummary = "...";
     // Write metadata: ctx.metadata.myField = "...";
   }
   ```

2. Add stage name to `PipelineStage` union in `types.ts`:
   ```typescript
   export type PipelineStage = "..." | "my_stage";
   ```

3. Register handler in `stages/index.ts`:
   ```typescript
   import { handleMyStage } from "./my-stage";
   const STAGE_HANDLERS: Record<PipelineStage, StageHandler> = {
     // ...existing...
     my_stage: handleMyStage,
   };
   ```

4. Add to pipeline definition(s) in `pipelines.ts`:
   ```typescript
   const VIDEO_PIPELINE: PipelineStage[] = [
     "generate_thumbnail",
     "set_processed_url",
     "my_stage",           // <-- insert at desired position
     "ai_summarize",
     // ...
   ];
   ```

No changes needed to the worker, queue, or processor — they dynamically look up the pipeline for each content type.

## Adding a New Content Type

1. Add type to `ContentType` union in `types.ts`
2. Define pipeline stages in `pipelines.ts` using `PIPELINE_MAP`
3. Add MIME type to `ALLOWED_MIMES` in `src/lib/media-items.ts`
4. Add detection logic in `dominantContentType()` if needed
5. Add `contentType` column value to any UI dropdowns/filters
