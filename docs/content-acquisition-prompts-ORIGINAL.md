# Padvik — Content Acquisition Implementation Prompts (Original Version)
## ⚠️ WARNING: This version replaces existing AI provider code. See revised version for safe approach.

---

## BEFORE YOU START: AI Provider Strategy for OCR & Parsing

### Claude Vision vs Gemini Pro for Indian Languages

Claude Vision handles English content well but **Gemini Pro is stronger for Indian language OCR** today. Anthropic has confirmed Indic language training is underway for Malayalam, Hindi, Tamil, Telugu, Kannada, Bengali, Marathi, Gujarati, Punjabi, and Urdu — but Gemini has a head start via Google's deep Indic investment. A third option, **Sarvam Vision** (Indian AI company), benchmarks at 91-95% word accuracy on Hindi, Tamil, Bengali, Marathi, and Malayalam — outperforming both Claude and Gemini on Indic OCR.

### Provider Rotation Architecture

```
┌─────────────────────────────────────────────────────┐
│              AI PROVIDER ROUTER                      │
│                                                      │
│  Mode: AUTO (rotate) | MANUAL (user-selected)        │
│                                                      │
│  ┌─────────────────────────────────────────────┐     │
│  │ Task Router (auto mode)                      │     │
│  │                                              │     │
│  │ English text/PDF    → Claude Sonnet (primary) │     │
│  │ Hindi/Devanagari    → Gemini Pro (primary)   │     │
│  │ Malayalam/Dravidian  → Gemini Pro (primary)   │     │
│  │ Tamil/Kannada/Telugu → Gemini Pro (primary)   │     │
│  │ Mixed lang content  → Gemini Pro (primary)   │     │
│  │ Math/formulas       → Claude Sonnet (best)    │     │
│  │ Structured parsing  → Claude Sonnet (best)    │     │
│  │ Bulk tagging        → Claude Haiku (cheapest) │     │
│  │ Chat/tutoring       → Claude Sonnet (primary) │     │
│  │                                              │     │
│  │ Fallback chain:                              │     │
│  │ Claude → Gemini → OpenAI → Sarvam           │     │
│  │ Gemini → Claude → Sarvam → OpenAI           │     │
│  └─────────────────────────────────────────────┘     │
│                                                      │
│  Rate limit tracking per provider                    │
│  Cost tracking per provider per call                 │
│  Auto-failover on 429/500 errors                     │
│  Manual override via admin UI dropdown               │
└─────────────────────────────────────────────────────┘
```

---

## PROMPT 0: AI Provider Router with Auto-Rotate

```
Read CLAUDE.md and understand the project. Now build the AI provider 
router at src/lib/ai/provider.ts with multi-provider support:

PROVIDERS TO SUPPORT:
1. Anthropic Claude (claude-sonnet-4-20250514, claude-haiku-4-5-20251001)
2. Google Gemini Pro (gemini-2.5-pro) — install @google/genai
3. OpenAI GPT-4o — install openai
4. Sarvam Vision (sarvam-vision) — REST API, install later

ARCHITECTURE:
- Create an enum AIProvider with values: CLAUDE, GEMINI, OPENAI, SARVAM
- Create an enum AITask with values: OCR_ENGLISH, OCR_INDIC, PARSE_SYLLABUS, 
  PARSE_QUESTIONS, GENERATE_CONTENT, GRADE_ANSWER, CHAT, TAG_CONTENT, 
  SCORE_QUALITY
- Create a provider config map that defines for each AITask:
  - primary provider (best for the job)
  - fallback chain (ordered list of alternatives)
  - model to use per provider
  - temperature, maxTokens defaults
- Create a ProviderMode type: 'auto' | AIProvider (manual selection)

TASK-TO-PROVIDER MAPPING (auto mode):
- OCR_ENGLISH → Claude Sonnet → Gemini → OpenAI
- OCR_INDIC → Gemini Pro → Sarvam → Claude → OpenAI
- PARSE_SYLLABUS → Claude Sonnet → Gemini → OpenAI
- PARSE_QUESTIONS → Gemini Pro (multilingual) → Claude → OpenAI
- GENERATE_CONTENT → Claude Sonnet → OpenAI → Gemini
- GRADE_ANSWER → Claude Sonnet → OpenAI → Gemini
- CHAT → Claude Sonnet → OpenAI → Gemini
- TAG_CONTENT → Claude Haiku → Gemini Flash → OpenAI Mini
- SCORE_QUALITY → Claude Haiku → Gemini Flash

CORE FUNCTION:
async function callAI(options: {
  task: AITask,
  mode: ProviderMode,       // 'auto' or specific provider
  prompt: string,
  systemPrompt?: string,
  images?: Buffer[],         // for vision tasks
  language?: string,         // 'en','hi','ml','ta','te','kn' etc.
  temperature?: number,
  maxTokens?: number,
  stream?: boolean,
}): Promise<AIResponse>

This function should:
1. Determine which provider to use (auto-select or manual)
2. If language is Indic and task is OCR, prefer Gemini in auto mode
3. Make the API call with proper SDK
4. If primary fails (429/500/timeout), auto-failover to next in chain
5. Log every call to content_pipeline_logs: provider, model, task, 
   tokens, cost, latency, language, success/failure
6. Return standardized AIResponse: { text, model, provider, tokens, cost }

RATE LIMITING:
- Track requests per minute per provider in Redis
- Claude: 60 rpm, Gemini: 60 rpm, OpenAI: 60 rpm
- If approaching limit, preemptively rotate to next provider

ENV VARS (add to .env.example):
- ANTHROPIC_API_KEY
- GOOGLE_GEMINI_API_KEY
- OPENAI_API_KEY
- SARVAM_API_KEY (optional, for later)

Also create src/lib/ai/types.ts with all the types.
Also update .env.example with the new keys.
```

---

## TIER 1: DIKSHA / Sunbird API Integration

### Prompt 1A: DIKSHA Client

```
Build the DIKSHA/Sunbird API client at src/lib/scraper/diksha-client.ts.

DIKSHA's Sunbird platform provides a Composite Search API for querying 
content. The API endpoint pattern is:
POST https://diksha.gov.in/api/composite/v1/search

The request body for searching textbook content:
{
  "request": {
    "filters": {
      "board": ["CBSE"],           // or "State (Kerala)", etc.
      "gradeLevel": ["Class 10"],
      "subject": ["Science"],
      "medium": ["English"],
      "contentType": ["TextBook", "TextBookUnit", "Resource", 
                      "ExplanationContent", "PracticeQuestionSet"],
      "status": ["Live"]
    },
    "limit": 100,
    "offset": 0,
    "fields": ["name", "identifier", "description", "board", 
               "gradeLevel", "subject", "medium", "contentType",
               "mimeType", "artifactUrl", "downloadUrl", 
               "previewUrl", "streamingUrl", "framework", 
               "topic", "learningOutcome"]
  }
}

Headers needed:
- Content-Type: application/json
- (No API key required for public search)

IMPLEMENT:
1. Create DikshClient class with methods:
   - searchContent(board, grade, subject, medium, contentType, limit, offset)
   - getContentDetails(contentId: string)
   - getTextbookTOC(textbookId: string) — gets chapter/topic tree
   - downloadContent(artifactUrl: string) — downloads PDF/ECML/HTML5
   - searchQuestionSets(board, grade, subject)

2. Create a mapping function that converts DIKSHA's board names to our 
   board codes (e.g., "State (Kerala)" → "KL_SCERT", "CBSE" → "CBSE")

3. Create a mapping function that converts DIKSHA grade strings 
   ("Class 1" through "Class 12") to our grade numbers (1-12)

4. Handle pagination — DIKSHA limits results to 100 per call

5. Store raw DIKSHA responses in S3 under diksha-raw/ prefix for audit

6. Rate limit: max 10 requests per second to DIKSHA

NOTE: DIKSHA API is publicly accessible but undocumented. The Sunbird 
Composite Search API docs are at: 
https://knowlg.sunbird.org/learn/product-and-developer-guide/assets-search-service/apis
The Postman collection is at:
https://documenter.getpostman.com/view/25463377/2s8ZDa3MP7
```

### Prompt 1B: DIKSHA Content Ingestion Pipeline

```
Build the DIKSHA content ingestion pipeline that pulls content from 
DIKSHA and maps it into our database schema.

Create src/lib/scraper/diksha-ingestion.ts:

PIPELINE:
1. For each board in our boards table:
   a. Query DIKSHA for all textbooks for that board
   b. For each textbook, get the TOC (table of contents)
   c. Map TOC structure to our chapters and topics tables
   d. For each chapter/topic, search for linked content:
      - ExplanationContent → content_items (type: 'note'/'explanation')
      - PracticeQuestionSet → questions table
      - LessonPlan → content_items (type: 'lesson_plan')
   e. Download artifact URLs (PDFs, videos, HTML5 content)
   f. If content is PDF, run through AI parser to extract text
   g. Store in content_items with source_type='diksha'

2. Map DIKSHA's taxonomy to our hierarchy:
   DIKSHA: framework → board → gradeLevel → subject → topic
   Padvik: boards → standards → subjects → chapters → topics

3. Handle DIKSHA content types:
   - application/pdf → download, parse text, store
   - application/vnd.ekstep.ecml-archive → extract HTML from ECML
   - video/mp4 or video/x-youtube → store URL as video_link content
   - application/vnd.ekstep.h5p-archive → store URL reference

4. Log everything to scrape_jobs and content_pipeline_logs

5. Create an admin API endpoint POST /api/admin/diksha/ingest 
   that accepts { boardCode, gradeStart, gradeEnd } and triggers 
   the ingestion as a BullMQ job.

Start with CBSE Classes 8-12 Science and Maths as the first run.
```

---

## TIER 2: NCERT Textbook PDF Pipeline

### Prompt 2A: NCERT PDF Scraper

```
Build the NCERT textbook PDF scraper at src/lib/scraper/ncert-scraper.ts.

SOURCE: https://ncert.nic.in/textbook.php
This page has dropdowns for Class, Subject, and Book. Selecting them 
reveals chapter-wise PDF download links.

Also use the pre-compiled GitHub gist with all NCERT PDF URLs:
https://gist.github.com/dufferzafar/b579a6ccbf3a2b321ff9a6e5d377757a

IMPLEMENT:
1. Create a mapping of all NCERT books by class and subject:
   - Classes 1-5: EVS, Maths, English, Hindi
   - Classes 6-8: Science, Maths, Social Science, English, Hindi
   - Classes 9-10: Science, Maths, Social Science, English
   - Classes 11-12: Physics, Chemistry, Biology, Maths (separate books)

2. For each book, download chapter-wise PDFs from ncert.nic.in
   URL pattern: https://ncert.nic.in/textbook/pdf/{bookcode}{chapter}.pdf
   
3. Store raw PDFs in S3: ncert-pdfs/{class}/{subject}/{chapter}.pdf

4. After download, trigger the PDF parsing pipeline (next prompt)

5. Handle the new NEP 2020 book names:
   - Class 6 Science → "Curiosity"
   - Class 6 Social Science → "Exploring Society"
   - Track both old and new names

6. Track download status in scrape_jobs table

7. Add retry logic — NCERT server is slow, timeout at 30s, retry 3x

8. Rate limit: 1 download per 3 seconds (be respectful to gov server)
```

### Prompt 2B: PDF-to-Content Parser

```
Build the PDF content extraction pipeline at src/lib/scraper/pdf-parser.ts.

This pipeline takes a downloaded PDF (NCERT or state board textbook) 
and extracts structured learning content using AI.

PIPELINE:
1. INPUT: PDF file path (from S3 or local)
2. Extract text using pdf.js (pdfjs-dist package):
   - If text extraction yields >100 chars per page → it's a digital PDF
   - If text extraction yields <100 chars per page → it's scanned, use Vision
3. For digital PDFs: extract text page by page
4. For scanned PDFs: convert pages to images, send to AI Vision
5. LANGUAGE DETECTION: detect if content is English, Hindi, or regional
6. AI PROVIDER SELECTION (via our provider router):
   - English content → Claude Sonnet (PARSE_SYLLABUS task)
   - Hindi/Indic content → Gemini Pro (OCR_INDIC task)
   - Math-heavy content → Claude Sonnet (better at LaTeX/formulas)
7. Send extracted text to AI with this prompt structure:

   System: "You are an education content parser. Extract structured 
   learning content from this textbook chapter."
   
   User: "Parse this textbook content for [Board] Class [X] [Subject] 
   Chapter [Y]. Extract:
   - Chapter title and number
   - List of topics and subtopics with descriptions
   - Key concepts and definitions (as note content)
   - Important formulas (if STEM subject)
   - Summary points
   - In-text questions and their answers
   Return as JSON matching this schema: {...}"

8. Validate AI output with Zod
9. Store parsed content:
   - Topic structure → update chapters and topics tables
   - Notes/explanations → content_items (source_type: 'textbook_parsed')
   - Formulas → content_items (content_type: 'formula')
   - In-text questions → questions table (source_type: 'textbook_exercise')
10. Log to content_pipeline_logs with stage='parse', tokens used, cost
```

### Prompt 2C: Kerala SCERT Scraper

```
Build the Kerala SCERT textbook scraper at src/lib/scraper/kerala-scraper.ts.

SOURCE: https://samagra.kite.kerala.gov.in
The Samagra portal provides textbook PDFs for Classes 1-12 in 
Malayalam and English medium.

IMPLEMENT:
1. Scrape the Samagra portal for textbook download links
   - Navigate to Textbooks section
   - For each class (1-12), medium (English, Malayalam), and subject:
     download the PDF
   
2. Alternative: use the aggregator sites that have direct links:
   - ncertbooks.guru/scert-kerala-textbooks/
   - hsslive.guru/scert-kerala-textbooks/
   These have organized class-wise, subject-wise PDF links

3. Download and store in S3: kerala-scert/{class}/{medium}/{subject}.pdf

4. CRITICAL: Kerala textbooks are in Malayalam medium too.
   For Malayalam PDFs:
   - Use Gemini Pro via our provider router (OCR_INDIC task, language='ml')
   - Gemini handles Malayalam script better than Claude currently
   - If Gemini fails, fallback to Sarvam Vision API

5. Parse using the same pdf-parser.ts pipeline from Prompt 2B
   but with language='ml' flag which routes to Gemini

6. Store with board_id pointing to KL_SCERT
```

---

## TIER 3: Question Paper Parsing Pipeline

### Prompt 3A: Question Paper Parser (Multi-Provider)

```
Build the question paper parsing pipeline at 
src/lib/scraper/question-parser.ts.

This is the most provider-sensitive component because question papers 
come in English, Hindi, Malayalam, Tamil, Telugu, Kannada and other 
Indian languages. The AI provider must be selected based on the 
detected language.

INPUT: PDF or image of a question paper (uploaded or scraped)

PIPELINE:
1. UPLOAD/RECEIVE: Accept PDF or image files
2. CONVERT: If PDF, convert each page to image (300 DPI)
3. LANGUAGE DETECT:
   - Look at the file metadata for language hints
   - Or send first page to AI with prompt "What language is this in?"
   - Set language code: en, hi, ml, ta, te, kn, mr, gu, bn, etc.

4. PROVIDER SELECTION (auto mode via provider router):
   - English papers → Claude Sonnet (OCR_ENGLISH)
   - Hindi papers → Gemini Pro (OCR_INDIC, language='hi')
   - Malayalam papers → Gemini Pro (OCR_INDIC, language='ml')
   - Tamil papers → Gemini Pro (OCR_INDIC, language='ta')
   - Telugu papers → Gemini Pro (OCR_INDIC, language='te')
   - Kannada papers → Gemini Pro (OCR_INDIC, language='kn')
   - Mixed (English + regional) → Gemini Pro (handles code-mixing)
   - Admin can override to manual provider selection

5. AI EXTRACTION PROMPT:
   Send each page image to the selected provider with:
   
   "Parse this question paper image. Extract each question with:
   - question_number (as it appears on paper)
   - section (Section A, Part I, etc.)
   - question_text (full text, preserve formatting)
   - question_type (mcq/short_answer/long_answer/fill_blank/
     true_false/match/assertion_reason/case_study)
   - marks (if printed on paper)
   - sub_questions (if the question has parts a, b, c)
   - has_image (true if question references a diagram/figure)
   - language (detected language of this specific question)
   
   Return as JSON array."

6. VALIDATE with Zod schema
7. For each extracted question:
   - AI-generate the solution (use Claude Sonnet — best at reasoning)
   - AI-determine difficulty (easy/medium/hard)
   - AI-determine bloom_level
   - AI-map to topic_id by matching question content to our topics table
8. Store in questions table with:
   - source_type = 'previous_year'
   - source_year = extracted year
   - source_paper_id = link to question_papers table
   - language = detected language

ADMIN UI INTEGRATION:
- Add provider selector dropdown in the question paper upload form
- Options: Auto (recommended), Claude, Gemini, OpenAI, Sarvam
- Show detected language after upload
- Allow manual language override
- Show parsing progress and per-question preview before final save
```

### Prompt 3B: Previous Year Paper Scraper

```
Build scrapers to automatically find and download previous year 
question papers for major boards.

Create src/lib/scraper/paper-scraper.ts:

SOURCES BY BOARD:

1. CBSE Previous Year Papers:
   - Official: cbse.gov.in/cbsenew/question-paper.html
   - Available for Classes 10 and 12, years 2019-2025
   - PDF format, mostly English (some Hindi medium)
   
2. CBSE Sample/Model Papers:
   - cbseacademic.nic.in (sample papers section)
   - Available for current academic year

3. ICSE Specimen Papers:
   - cisce.org/SpecimenQuestionPaper.aspx
   - Available for Classes 10 (ICSE) and 12 (ISC)

4. Kerala SSLC Papers:
   - keralapareekshabhavan.in
   - Classes 10 SSLC papers, Malayalam and English medium

5. Kerala HSE Papers:
   - dhsekerala.gov.in (Plus One, Plus Two)
   - Multiple mediums

FOR EACH SOURCE:
a. Scrape the page for PDF download links
b. Download PDFs to S3: papers/{board}/{year}/{class}/{subject}.pdf
c. Create entry in question_papers table
d. Queue the PDF for parsing via question-parser.ts (Prompt 3A)
e. Log in scrape_jobs

Rate limit all scrapers: 1 request per 3 seconds.
Retry on failure: 3 attempts with exponential backoff.
User-Agent: "Padvik-Bot/1.0 (educational content indexing)"
```

---

## TIER 4: State Board Textbook Scrapers

### Prompt 4: Major State Board Scrapers

```
Build state board textbook scrapers. Each state SCERT publishes 
textbooks online as PDFs. Create individual scraper modules.

Create these files, each following BaseScraper pattern:

1. src/lib/scraper/karnataka-scraper.ts
   SOURCE: ktbs.kar.nic.in (Karnataka Textbook Society)
   - Classes 1-12, Kannada and English medium
   - Download PDFs chapter-wise
   - Language: Kannada → use Gemini (OCR_INDIC, language='kn')

2. src/lib/scraper/tamilnadu-scraper.ts
   SOURCE: textbooksonline.tn.nic.in
   - Classes 1-12, Tamil and English medium
   - Language: Tamil → use Gemini (OCR_INDIC, language='ta')

3. src/lib/scraper/maharashtra-scraper.ts
   SOURCE: ebalbharati.in (Balbharati digital textbooks)
   - Classes 1-12, Marathi and English medium
   - Very well organized site with direct PDF links
   - Language: Marathi → use Gemini (OCR_INDIC, language='mr')

4. src/lib/scraper/ap-scraper.ts
   SOURCE: scert.ap.gov.in
   - Andhra Pradesh, Telugu and English medium
   - Language: Telugu → use Gemini (OCR_INDIC, language='te')

5. src/lib/scraper/telangana-scraper.ts
   SOURCE: scert.telangana.gov.in
   - Similar to AP but separate board
   - Telugu and English medium

COMMON PATTERN for all scrapers:
a. Extend BaseScraper class
b. Implement discoverContent() → finds all PDF links
c. Implement downloadContent() → downloads to S3
d. Implement parseContent() → sends to pdf-parser.ts with correct language
e. The language parameter determines AI provider (auto mode routes to Gemini for Indic)
f. Store with correct board_id from our boards table
g. Track in scrape_jobs

For state boards not listed above (UP, Bihar, Rajasthan, MP, Gujarat, 
etc.), many follow NCERT directly. Create a simple flag in the boards 
table: follows_ncert BOOLEAN. For these boards, we reuse NCERT content 
and just create topic_mappings entries.
```

---

## TIER 5: AI Content Generation (Gap Filler)

### Prompt 5: Bulk Content Generator

```
Build the AI content generation pipeline for filling gaps where 
scraped/API content is insufficient.

Create src/lib/ai/content-generator.ts:

PURPOSE: For any topic in our database that has zero or insufficient 
content_items, generate learning content using AI.

FUNCTIONS:

1. findContentGaps():
   - Query all topics that have fewer than 2 content_items
   - Prioritize by: board student count (CBSE first), class (10,12 first), 
     subject (Science, Maths first)
   - Return list of { topicId, boardCode, grade, subject, chapter, topic }

2. generateNotes(topicId):
   - Use Claude Sonnet (GENERATE_CONTENT task — best for structured content)
   - Prompt: "Generate comprehensive study notes for [Board] Class [X] 
     [Subject], Chapter: [chapter_title], Topic: [topic_title].
     Include: explanation, key concepts, definitions, examples, 
     important points to remember, common mistakes to avoid.
     Use markdown formatting. Target audience: Indian school students.
     Difficulty: appropriate for Class [X]."
   - Store as content_item with source_type='ai_generated', 
     content_type='note', quality_score from AI self-assessment

3. generateFlashcards(topicId):
   - Use Claude Haiku (TAG_CONTENT — cheaper for structured output)
   - Generate 10-15 flashcards per topic as Q&A pairs
   - Store as content_items with content_type='flashcard'

4. generateMCQs(topicId, count=10):
   - Use Claude Sonnet (GENERATE_CONTENT)
   - Generate MCQs with 4 options, correct answer, and explanation
   - Vary difficulty: 30% easy, 50% medium, 20% hard
   - Store in questions table with source_type='ai_generated'

5. generateSummary(topicId):
   - Use Claude Haiku (fast, cheap)
   - Generate a 5-7 point summary of the topic
   - Store as content_item with content_type='summary'

BULK RUNNER:
- Create a BullMQ job type 'generate-content'
- Process gaps in batches of 50 topics
- Track progress in scrape_jobs (use job_type='content_generation')
- Estimated cost: ~$0.01 per topic (Haiku) to ~$0.05 per topic (Sonnet)

Admin endpoint: POST /api/admin/generate-content
Body: { boardCode, gradeStart, gradeEnd, subjectCode?, dryRun? }
DryRun mode: show how many topics need content, estimated cost
```

---

## TIER 6: Admin UI for Content Pipeline

### Prompt 6: Pipeline Admin Dashboard

```
Build the admin dashboard for managing the content pipeline.

Create pages under src/app/(admin)/:

1. /admin/pipeline — Pipeline Overview Dashboard
   - Cards showing: total content items, total questions, 
     content by source_type (pie chart), content by board (bar chart)
   - Recent pipeline activity log (last 50 entries from content_pipeline_logs)
   - Active scrape jobs with progress bars

2. /admin/scrape-jobs — Scrape Job Manager
   - Table of all scrape_jobs with: id, type, source, board, status, 
     items_found, items_processed, created_at
   - Filter by status, board, type
   - Action buttons: Start New, Pause, Resume, Retry Failed
   - "New Scrape Job" form:
     - Source dropdown: DIKSHA API, NCERT PDFs, Kerala SCERT, 
       Karnataka, Tamil Nadu, Maharashtra, AP, Telangana, 
       CBSE Papers, ICSE Papers
     - Board selector
     - Grade range (from/to)
     - Subject filter (optional)
     - Start button

3. /admin/content-review — Content Review Queue
   - List of content_items with review_status='pending'
   - Preview panel showing rendered content
   - AI quality_score displayed as color-coded badge
   - Approve / Reject / Flag buttons
   - Bulk approve for items with quality_score > 0.8

4. /admin/ai-providers — AI Provider Dashboard
   - Current provider status (up/down) with last ping time
   - Usage stats per provider: calls today, tokens today, cost today
   - Rate limit status per provider
   - Provider mode toggle: Auto / Manual + provider selector
   - Cost comparison table: cost per 1000 calls by provider

5. /admin/question-papers — Question Paper Manager
   - Upload form with: PDF/image file, board, class, subject, year, 
     month, paper_type
   - AI Provider selector: Auto, Claude, Gemini, OpenAI, Sarvam
   - Language selector: Auto-detect, English, Hindi, Malayalam, 
     Tamil, Telugu, Kannada
   - After upload: show parsing progress, then preview extracted 
     questions with edit capability before final save
   - Bulk upload support (multiple files)

Use shadcn/ui components throughout. Purple theme. 
Protected by admin role check.
```

---

## EXECUTION ORDER

```
Week 1: Prompt 0 (AI Provider Router) — Foundation for everything
Week 1: Prompt 1A (DIKSHA Client) — Fastest content source
Week 2: Prompt 1B (DIKSHA Ingestion) — Bulk content pull
Week 2: Prompt 2A (NCERT Scraper) — Core textbook content
Week 3: Prompt 2B (PDF Parser) — Reusable across all tiers
Week 3: Prompt 2C (Kerala Scraper) — Your home market
Week 4: Prompt 3A (Question Parser) — Multi-provider OCR
Week 4: Prompt 3B (Paper Scraper) — Previous year papers
Week 5: Prompt 4 (State Board Scrapers) — Scale to all boards
Week 5: Prompt 5 (AI Content Generator) — Fill gaps
Week 6: Prompt 6 (Admin Dashboard) — Monitor and manage
```

---

## PROVIDER COST ESTIMATES

| Provider | Model | Input $/1M tokens | Output $/1M tokens | Best For |
|----------|-------|-------|--------|----------|
| Anthropic | Claude Sonnet 4 | $3 | $15 | English OCR, parsing, chat, grading |
| Anthropic | Claude Haiku 4.5 | $0.80 | $4 | Bulk tagging, scoring, flashcards |
| Google | Gemini 2.5 Pro | ~$1.25 | ~$10 | Indic language OCR, multilingual |
| Google | Gemini 2.5 Flash | ~$0.15 | ~$0.60 | Cheap Indic processing |
| OpenAI | GPT-4o | $2.50 | $10 | Fallback for everything |
| Sarvam | Vision 3B | TBD | TBD | Specialized Indic OCR (best accuracy) |

**Cost projection for full content acquisition:**
- DIKSHA API: Free (government API)
- NCERT PDFs (12 classes × ~8 subjects × ~15 chapters): ~2,000 AI calls ≈ $15-30
- Kerala SCERT (12 classes × ~6 subjects): ~1,500 AI calls ≈ $15-25
- Previous year papers (100 papers × ~30 questions): ~3,000 AI calls ≈ $20-40
- AI content generation (gap fill, ~5,000 topics): ~5,000 AI calls ≈ $25-50
- **Total estimated: $75-145 for complete content database**
