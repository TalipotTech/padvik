# Auto Content Generation Pipeline — Claude Code Prompts
## Feed these prompts SEQUENTIALLY to Claude Code (Prompt 1 → 2 → 3 → ...)
## Wait for each to complete and verify before moving to the next.

---

## PROMPT 1: Database Schema & System Creator

```
Read all existing files in src/db/schema/ to understand current table 
patterns, naming conventions, and how Drizzle is configured.

Create NEW file: src/db/schema/auto-content.ts

Define two tables using the same Drizzle patterns as existing schemas.
All PKs: BIGINT GENERATED ALWAYS AS IDENTITY.

TABLE 1: auto_content_jobs
Tracks every AI content generation job.

Columns:
- id: bigint pk
- topic_id: bigint references topics(id) not null
- board_id: bigint references boards(id)
- standard_id: bigint references standards(id)
- subject_id: bigint references subjects(id)
- content_type: varchar(30) not null 
  enum: 'text_note', 'audio_explainer', 'video_lesson', 'question_set'
- priority: int default 50 (0=highest, 100=lowest)
- demand_score: decimal(5,2) default 0
- status: varchar(20) default 'queued'
  enum: 'queued', 'generating', 'reviewing', 'published', 'failed', 'rejected'
- content_id: bigint references creator_content(id) nullable
  (links to the published content after approval)
- generation_prompt: text (the AI prompt used, for audit)
- generation_model: varchar(50)
- generation_cost_usd: decimal(8,4)
- generation_time_secs: int
- raw_output: jsonb
- auto_approved: boolean default false
- reviewed_by: bigint references users(id) nullable
- review_notes: text
- attempts: smallint default 0
- last_error: text
- created_at: timestamptz default now
- updated_at: timestamptz default now
- UNIQUE constraint on (topic_id, content_type)

Indexes: (status, priority, demand_score DESC), (content_type, status), (topic_id)

TABLE 2: content_demand_signals
Tracks student behavior signals that indicate demand for content on a topic.

Columns:
- id: bigint pk
- topic_id: bigint references topics(id) not null
- signal_type: varchar(30) not null
  enum: 'search', 'view', 'ask_ai', 'explainer_stuck', 
  'exam_weak', 'doubt_posted', 'direct_request'
- student_id: bigint references users(id) nullable
- weight: decimal(3,1) default 1.0
- created_at: timestamptz default now

Indexes: (topic_id, created_at DESC), (signal_type)

Export both tables from src/db/schema/index.ts.
Generate migration. Run it.

THEN: Insert a system user for Padvik Official content.
Create a seed script at scripts/seed-system-creator.ts:

1. Check if user with email 'content@padvik.com' already exists
2. If not, insert into users: 
   name='Padvik Official', email='content@padvik.com', 
   is_creator=true, creator_tier='pro'
3. Insert into creator_profiles:
   display_name='Padvik Official',
   bio='AI-crafted study materials for your board and syllabus',
   institution_type='publisher',
   verification_status='verified',
   creator_tier='pro'
4. Print the created user ID

Add to .env.example:
PADVIK_SYSTEM_CREATOR_ID=
DAILY_CONTENT_BUDGET=5.00
AUTO_CONTENT_ENABLED=true

Run the seed script and note the user ID.
Verify: pnpm build succeeds, migration ran, seed completed.
```

---

## PROMPT 2: Demand Signal Tracking

```
Read src/db/schema/auto-content.ts (the schema you just created) 
and src/lib/ai/ to understand the existing provider setup.

Create NEW file: src/lib/auto-content/demand-tracker.ts

This module tracks student behavior signals that indicate demand 
for content on specific topics. Other parts of the app will call 
these functions when relevant events happen.

Implement:

1. trackDemandSignal(topicId, signalType, studentId?, weight?) 
   → inserts a row into content_demand_signals
   
   Signal types and their default weights:
   - 'search': 2.0 (student searched for a topic with no/little content)
   - 'view': 0.5 (student viewed a topic page)
   - 'ask_ai': 1.5 (student asked AI about this topic)
   - 'explainer_stuck': 3.0 (student tapped "explain more" 3+ times)
   - 'exam_weak': 2.5 (exam results showed this as a weak topic)
   - 'doubt_posted': 2.0 (student posted a doubt on a topic with no creator content)
   - 'direct_request': 5.0 (student explicitly requested content)
   
   If weight param is provided, use it. Otherwise use the default for the signal type.
   This function should be lightweight — just an INSERT, no heavy processing.

2. calculateDemandScores()
   → queries content_demand_signals from the last 30 days
   → groups by topic_id
   → calculates: demand_score = SUM(weight) × LOG(COUNT(DISTINCT student_id) + 1)
   → returns array of { topicId, score, uniqueStudents, totalSignals, breakdown }
   → breakdown = count per signal_type for this topic

3. getTopDemandTopics(limit = 20, minScore = 5.0)
   → calls calculateDemandScores()
   → filters topics that DON'T already have Padvik content
     (LEFT JOIN creator_content WHERE creator_id = PADVIK_SYSTEM_CREATOR_ID 
      AND content_type matches AND is_published = true)
   → returns only topics that need content, sorted by score DESC

4. cleanupOldSignals(daysToKeep = 90)
   → deletes signals older than daysToKeep
   → returns count deleted

Create NEW file: src/lib/auto-content/types.ts

Define TypeScript types:
- DemandSignalType union
- ContentGenerationType union  
- AutoContentJobStatus union
- DemandScore type
- GenerationResult type
- ContentBudgetStatus type

Export all from src/lib/auto-content/index.ts

Verify: pnpm build succeeds.
```

---

## PROMPT 3: Text Note Generator

```
Read src/lib/auto-content/ (what you just created),
src/lib/ai/provider.ts (existing AI provider — DO NOT modify),
and src/db/schema/creator-content.ts (existing creator_content table).

Create NEW file: src/lib/auto-content/generators/text-note.ts

This generates structured study notes for a topic. The output is a 
ContentBlock JSON array that the frontend renders as a beautiful article 
with diagrams, formulas, and callouts.

Implement:

async function generateTextNote(params: {
  topicId: bigint,
  boardCode: string,
  standard: number,
  subject: string,
  chapter: string,
  topicName: string,
  language?: string,
}): Promise<{
  title: string,
  blocks: ContentBlock[],
  model: string,
  costUsd: number,
  timeMs: number,
}>

Implementation:

1. Call the EXISTING AI provider (callAI or whatever it's named) with:
   - task: 'generate_content'
   - provider: 'auto' (let the router pick)
   - temperature: 0.7
   - maxTokens: 3000

   System prompt:
   "You are a senior curriculum expert creating study notes for Indian 
   K-12 students on the Padvik Edutech platform.

   QUALITY STANDARDS:
   - Write for {boardCode} Class {standard} {subject} specifically.
   - Use NCERT terminology and examples where the board follows NCERT.
   - Every abstract concept MUST have a visual element: an SVG diagram,
     a LaTeX formula, a comparison layout, or an analogy visualization.
   - Use Indian context examples: cricket, monsoon, cooking, railways,
     markets, festivals, farming.
   - Keep it concise: 800-1200 words. Students want clarity, not essays.
   - Include 2-3 exam tips: 'This is frequently asked in board exams.'
   
   STRUCTURE your notes as:
   1. One-line introduction (what and why)
   2. Key concepts (one ContentBlock per concept, with visual)
   3. Important formulas (if any, as LaTeX)
   4. Common mistakes students make
   5. Quick revision points (5-7 bullet callout)

   OUTPUT FORMAT — return a JSON array of ContentBlock objects:
   - { type: 'heading', content: 'Section title' }
   - { type: 'text', content: 'Markdown text paragraph' }
   - { type: 'formula', latex: 'V = IR' }
   - { type: 'diagram', svg: '<svg viewBox=\"0 0 400 250\" ...>...</svg>' }
     SVG rules: use viewBox, purple theme (#7C3AED primary, #1E1033 bg, 
     #A78BFA accent, #C4B5FD labels), simple labeled diagrams, 
     minimum font-size 12px, all text as <text> elements not <foreignObject>
   - { type: 'callout', variant: 'tip'|'warning'|'remember'|'example', 
       content: 'text' }
   - { type: 'comparison', leftLabel: 'X', rightLabel: 'Y', 
       left: 'description', right: 'description' }
   - { type: 'steps', items: ['Step 1 text', 'Step 2 text'] }
   - { type: 'analogy', source: 'familiar thing', target: 'new concept',
       mapping: [{ from: 'water pressure', to: 'voltage' }] }

   Return ONLY the JSON array. No markdown fences, no explanation outside the array."

   User prompt:
   "Create study notes for:
   Topic: {topicName}
   Chapter: {chapter}
   Subject: {subject}
   Board: {boardCode}, Class: {standard}
   Language: {language || 'English'}
   
   Make sure to include at least ONE SVG diagram and ONE formula (if the 
   topic involves any math or science concept)."

2. Parse the AI response as JSON.

3. Validate with Zod:
   - Each block has a valid type
   - SVG blocks contain valid XML (basic check: starts with <svg, ends with </svg>)
   - Formula blocks have non-empty latex string
   - Text blocks have non-empty content
   - At least 3 blocks total
   - At least 1 visual block (diagram, formula, comparison, or analogy)

4. If validation fails:
   - Log the specific validation errors
   - Retry once with a follow-up prompt:
     "The previous output had these issues: {errors}. 
     Fix them and return the corrected JSON array."
   - If retry also fails, throw with details

5. Generate a title: "Study Notes: {topicName} — {boardCode} Class {standard}"

6. Return the blocks, title, model used, cost, and time taken.

Also create a helper: src/lib/auto-content/generators/validate-blocks.ts
  - validateContentBlocks(blocks: unknown[]): { valid: boolean, errors: string[] }
  - This validator is reused by all generators.

Verify: pnpm build succeeds.
```

---

## PROMPT 4: Question Set Generator

```
Read src/lib/auto-content/generators/text-note.ts (what you just created)
and src/lib/ai/provider.ts.

Create NEW file: src/lib/auto-content/generators/question-set.ts

This generates practice questions for a topic. Questions are formatted 
to match the exact pattern of the student's board exam.

Implement:

async function generateQuestionSet(params: {
  topicId: bigint,
  boardCode: string,
  standard: number,
  subject: string,
  chapter: string,
  topicName: string,
  language?: string,
}): Promise<{
  questions: GeneratedQuestion[],
  model: string,
  costUsd: number,
  timeMs: number,
}>

type GeneratedQuestion = {
  questionText: string,
  questionType: 'mcq' | 'fill_blank' | 'true_false' | 'short_answer' | 
    'long_answer' | 'numerical',
  options?: { id: string, text: string, isCorrect: boolean }[],
  correctAnswer?: string,
  solution: string,
  marks: number,
  difficulty: 'easy' | 'medium' | 'hard',
  markingRubric?: {
    criteria: { name: string, maxMarks: number, description: string }[],
    keywords: string[],
    acceptableVariations: string[],
    commonMistakes: string[],
  },
}

AI Prompt:

System:
"You are an expert question paper setter for {boardCode} board examinations.
Create practice questions for Class {standard} {subject} that EXACTLY 
match the pattern, difficulty, and marking scheme of actual board exam papers.

Generate this question set:
- 5 Multiple Choice Questions (1 mark each)
- 2 Short Answer Questions (2 marks each for science, 3 marks for maths)
- 1 Long Answer OR Numerical Problem (5 marks)

RULES:
- MCQ: 4 options (A-D), exactly one correct, plausible distractors
- Short answers: include marking rubric with criteria and keywords
- Long answers: include step-by-step solution and marking rubric
- At least 1 application-based question (not rote memorization)
- Difficulty: 3 easy, 3 medium, 2 hard
- Include common mistakes students make (for AI grading reference)
- For maths/physics: include numerical problems with actual numbers
- Specify acceptable answer variations for subjective questions

Return ONLY a JSON array of question objects. No markdown fences."

User:
"Create a practice question set for:
Topic: {topicName}, Chapter: {chapter}
Subject: {subject}, Board: {boardCode}, Class: {standard}"

After AI response:
1. Parse JSON
2. Validate with Zod:
   - Exactly 5 MCQs with 4 options each, exactly one isCorrect=true
   - 2 short answers with solution and marks
   - 1 long answer with solution, marks, and rubric
   - All questions have non-empty questionText
   - Marks are positive integers
3. Return validated questions

Verify: pnpm build succeeds.
```

---

## PROMPT 5: Audio Explainer Generator

```
Read src/lib/auto-content/generators/ and src/lib/ai/provider.ts.

Create NEW file: src/lib/auto-content/generators/audio-explainer.ts

This generates a 3-5 minute audio lesson for a topic.
Two steps: AI generates a spoken script, then TTS converts to audio.

Implement:

async function generateAudioExplainer(params: {
  topicId: bigint,
  boardCode: string,
  standard: number,
  subject: string,
  chapter: string,
  topicName: string,
  language?: string,
}): Promise<{
  audioBuffer: Buffer,
  transcript: string,
  durationSecs: number,
  model: string,
  costUsd: number,
  timeMs: number,
}>

STEP 1 — Generate script via existing AI provider:

System prompt:
"You are a warm, friendly Indian teacher recording an audio lesson 
for students preparing for {boardCode} Class {standard} exams.

Write a 500-750 word spoken script (3-5 minutes when spoken).

STYLE:
- Conversational tone, like talking to a student face-to-face
- Start: 'Hello students! Today let's understand {topicName}...'
- Use simple, short sentences
- Insert [PAUSE] markers for natural pauses
- Explain concepts with everyday Indian examples
- Say formulas verbally: 'V equals I multiplied by R'
- Include verbal cues: 'Now this is very important for your exams...'
- End with: 'Let me quickly revise what we covered today...'
- NO bullet points, NO markdown — this is pure spoken text
- Total word count: 500-750 words (aim for 600)"

User prompt:
"Write a spoken audio script for:
Topic: {topicName}, Chapter: {chapter}
Subject: {subject}, Board: {boardCode}, Class: {standard}"

Validate: script is 400-900 words, starts conversationally, 
no markdown formatting present.

STEP 2 — Convert to audio via TTS:

Try providers in this order (check which API key exists in env):

Option A — ElevenLabs (best quality):
  env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
  POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}
  Headers: xi-api-key: {apiKey}, Content-Type: application/json
  Body: { text: script, model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 } }
  Response: audio/mpeg stream → collect as Buffer

Option B — Google Cloud TTS (cheaper):
  env: GOOGLE_TTS_API_KEY
  POST https://texttospeech.googleapis.com/v1/text:synthesize?key={apiKey}
  Body: { input: { text: script }, 
          voice: { languageCode: 'en-IN', name: 'en-IN-Neural2-A' },
          audioConfig: { audioEncoding: 'MP3' } }
  Response: { audioContent: base64 } → decode to Buffer

Option C — Sarvam (for Indian languages):
  env: SARVAM_API_KEY
  Use for Malayalam, Hindi, Tamil scripts
  POST https://api.sarvam.ai/text-to-speech
  Follow Sarvam API docs for request format.

If NO TTS API key is configured:
  Return the script as transcript only (no audio Buffer).
  Set audioBuffer = null, log warning.
  The content can still be published as text with "Audio coming soon" badge.

Calculate approximate duration: word_count / 150 * 60 (150 WPM average)

Add to .env.example:
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
GOOGLE_TTS_API_KEY=

Verify: pnpm build succeeds.
```

---

## PROMPT 6: Content Publisher (Saves to creator_content)

```
Read src/lib/auto-content/generators/ (all generators),
src/db/schema/creator-content.ts, and src/lib/s3.ts.

Create NEW file: src/lib/auto-content/publisher.ts

This module takes generator output and creates a published content 
item under the "Padvik Official" creator account.

Implement:

async function publishAutoContent(params: {
  jobId: bigint,
  topicId: bigint,
  boardId: bigint,
  standardId: bigint,
  subjectId: bigint,
  chapterId?: bigint,
  contentType: 'text_note' | 'audio_explainer' | 'question_set',
  title: string,
  
  // For text notes
  blocks?: ContentBlock[],
  
  // For audio
  audioBuffer?: Buffer,
  transcript?: string,
  durationSecs?: number,
  
  // For question sets
  questions?: GeneratedQuestion[],
  
  // Generation metadata
  model: string,
  costUsd: number,
  autoApprove: boolean,
}): Promise<{ contentId: bigint }>

Logic:

1. Get PADVIK_SYSTEM_CREATOR_ID from env.
   If not set, throw: "PADVIK_SYSTEM_CREATOR_ID not configured"

2. For AUDIO content:
   - Upload audioBuffer to S3:
     key: auto-content/{topicId}/audio-{timestamp}.mp3
     contentType: 'audio/mpeg'
   - Store the S3 URL

3. For TEXT NOTES:
   - The body is JSON.stringify(blocks)
   - No file upload needed — stored directly in DB

4. For QUESTION SETS:
   - Store questions as JSON in body field
   - OR if question_bank table exists, insert each question there too

5. Create creator_content row:
   - creator_id: PADVIK_SYSTEM_CREATOR_ID
   - content_type: map to creator_content types ('note', 'audio', 'question_set')
   - title: provided title
   - body: JSON string of blocks/questions
   - original_file_url: S3 URL (for audio)
   - duration_seconds: for audio
   - ai_transcript: for audio
   - board_id, standard_id, subject_id, chapter_id, topic_id
   - is_premium: FALSE (all auto-content is free)
   - upload_status: 'ready'
   - review_status: autoApprove ? 'approved' : 'pending'
   - is_published: autoApprove
   - published_at: autoApprove ? now() : null
   - ai_summary: first 200 chars of text content
   - ai_quality_score: null (scored separately if needed)
   - ai_language: 'en' (or detected language)

6. Update auto_content_jobs row:
   - content_id: the new content ID
   - status: autoApprove ? 'published' : 'reviewing'
   - auto_approved: autoApprove

7. If autoApprove, increment creator_profiles.content_count 
   for the system creator.

8. Return { contentId }

AUTO-APPROVE RULES (implement as a function):

function shouldAutoApprove(contentType, blocks?, questions?): boolean
  - 'question_set' → always true (low risk, students validate by trying)
  - 'text_note' → true IF blocks.length >= 5 AND has at least 1 visual block
  - 'audio_explainer' → always false (TTS quality needs human ear check)
  - 'video_lesson' → always false (highest visibility, always review)

Verify: pnpm build succeeds.
```

---

## PROMPT 7: Orchestrator & Budget Control

```
Read src/lib/auto-content/ (everything created so far) and 
the existing BullMQ setup (look for queue configuration in 
src/lib/ or src/workers/ or wherever queues are defined).

Create NEW file: src/lib/auto-content/orchestrator.ts

This is the main brain that decides WHAT to generate and WHEN.
It runs as a scheduled job and respects a daily cost budget.

Implement:

1. getDailyBudgetStatus(): Promise<ContentBudgetStatus>
   Queries auto_content_jobs created today with status != 'failed'
   Sums generation_cost_usd
   Returns: { spentToday, budgetLimit, remaining, isExhausted }
   Budget limit from env: DAILY_CONTENT_BUDGET (default 5.00 USD)

2. async function runContentGenerationCycle(): Promise<{
     generated: number, failed: number, skipped: number, costUsd: number
   }>
   
   This is the main function called by the scheduled job.
   
   Logic:
   
   a. Check AUTO_CONTENT_ENABLED env var. If 'false', return immediately.
   
   b. Check daily budget. If exhausted, log "Daily budget exhausted" and return.
   
   c. Get top demand topics:
      Call getTopDemandTopics(limit=10, minScore=5.0)
      These are topics with high demand but no Padvik content yet.
   
   d. For each topic (stop if budget exhausted):
   
      DETERMINE what to generate based on existing content:
      
      - Query creator_content for this topic where 
        creator_id = PADVIK_SYSTEM_CREATOR_ID:
      
      - If NO content exists for this topic:
        → Queue text_note (priority 1) AND question_set (priority 2)
        Text notes are the fastest to generate and give immediate value.
        Question sets drive engagement (students do exercises).
      
      - If text_note exists but demand_score > 50:
        → Queue audio_explainer (priority 3)
        Topic has sustained demand, worth investing in audio.
      
      - If text_note + audio exist and demand_score > 100:
        → Log "Topic {id} eligible for video" (video generation 
          implemented separately due to external API complexity)
      
      - If content of this type already has a queued/generating job:
        → Skip (don't create duplicate jobs)
      
      DAILY LIMITS:
      - Max 15 text_notes per day
      - Max 5 audio_explainers per day  
      - Max 5 question_sets per day
      (prevents flooding even if demand is high)
   
   e. For each queued job, call processAutoContentJob(jobId)
   
   f. Return summary stats.

3. async function processAutoContentJob(jobId: bigint): Promise<void>
   
   Logic:
   a. Fetch the job from auto_content_jobs
   b. Set status = 'generating', increment attempts
   c. Check budget before starting (in case other jobs used it up)
   d. Call the appropriate generator based on content_type:
      - 'text_note' → generateTextNote()
      - 'question_set' → generateQuestionSet()
      - 'audio_explainer' → generateAudioExplainer()
   e. If generator succeeds:
      - Calculate cost from AI provider response
      - Call publishAutoContent() to create the content item
      - Update job: generation_cost_usd, generation_model, 
        generation_time_secs, status based on auto-approve
   f. If generator fails:
      - Update job: status = 'failed', last_error = error message
      - If attempts < 3: set status back to 'queued' for retry
      - If attempts >= 3: leave as 'failed', log error

Create NEW file: src/lib/auto-content/jobs.ts

Register BullMQ jobs. Follow the EXISTING queue patterns in the codebase.

Jobs to register:

1. 'calculate-demand-scores'
   Cron: '0 2 * * *' (daily 2 AM)
   Handler: calculateDemandScores() — just calculates, doesn't generate

2. 'content-generation-cycle'  
   Cron: '0 4 * * *' (daily 4 AM)
   Handler: runContentGenerationCycle()
   Timeout: 2 hours

3. 'process-auto-content'
   NOT a cron — triggered by orchestrator or admin API
   Data: { jobId: bigint }
   Handler: processAutoContentJob(jobId)
   Retry: 3 attempts, exponential backoff (1min, 5min, 15min)
   Timeout: 10 minutes

4. 'cleanup-demand-signals'
   Cron: '0 3 1 * *' (1st of month, 3 AM)
   Handler: cleanupOldSignals(90)

Verify: pnpm build succeeds.
```

---

## PROMPT 8: API Endpoints

```
Read src/lib/auto-content/ (everything) and existing API route 
patterns in src/app/api/.

Create these NEW API route files:

FILE 1: src/app/api/topics/[topicId]/request-content/route.ts

POST — Student requests content for a topic.
Auth required (student).
No body needed (topicId from URL param).

Logic:
1. Validate topicId exists in topics table
2. Call trackDemandSignal(topicId, 'direct_request', userId, 5.0)
3. Return: { success: true, message: "Your request has been noted. 
   Content will be created based on demand from students." }

Rate limit: max 5 requests per student per day (prevent spam).
Check: COUNT demand_signals WHERE student_id AND signal_type='direct_request' 
AND created_at > today. If >= 5, return 429.


FILE 2: src/app/api/admin/auto-content/route.ts

GET — Admin dashboard data.
Admin auth required.

Returns:
{
  todayStats: { generated, pending, published, failed, costUsd, budgetRemaining },
  topDemandTopics: top 20 by demand score with:
    { topicId, topicName, chapter, subject, board, class, 
      demandScore, uniqueStudents, hasExistingContent, signalBreakdown },
  recentJobs: last 20 auto_content_jobs with status, type, topic name, cost,
  budgetHistory: last 7 days of daily spend
}


FILE 3: src/app/api/admin/auto-content/generate/route.ts

POST — Manually trigger content generation for a specific topic.
Admin auth required.
Body: { topicId: bigint, contentType: 'text_note'|'audio_explainer'|'question_set' }

Logic:
1. Validate topic exists
2. Check if job already exists for this topic+type (if queued/generating, skip)
3. Create auto_content_jobs row with priority=0 (highest, manual trigger)
4. Queue 'process-auto-content' BullMQ job immediately
5. Return: { jobId, status: 'queued' }


FILE 4: src/app/api/admin/auto-content/[jobId]/route.ts

GET — Get single job status with details.
Admin auth.
Returns: full auto_content_jobs row + related topic and content info.

PUT — Approve or reject pending content.
Admin auth.
Body: { action: 'approve' | 'reject', reviewNotes?: string }

Logic for 'approve':
1. Update auto_content_jobs: status = 'published', reviewed_by = adminId
2. Update linked creator_content: 
   review_status = 'approved', is_published = true, published_at = now()
3. Return: { success: true }

Logic for 'reject':
1. Update auto_content_jobs: status = 'rejected', review_notes
2. Update linked creator_content: review_status = 'rejected'
3. Return: { success: true }


FILE 5: src/app/api/admin/auto-content/costs/route.ts

GET — Cost analytics.
Admin auth.
Query: startDate?, endDate? (defaults to last 30 days)

Returns:
{
  totalCost: sum,
  byDay: [{ date, cost, count }],
  byType: [{ contentType, cost, count }],
  byProvider: [{ provider, cost, count }],
  averageCostPerItem: { text_note, audio_explainer, question_set }
}

Verify: pnpm build succeeds. All routes return proper error responses 
for missing auth, invalid params, etc.
```

---

## PROMPT 9: Demand Signal Integration Points

```
Read the trackDemandSignal function at src/lib/auto-content/demand-tracker.ts.
Read the existing app code to find where these events happen.

Add demand signal tracking calls to EXISTING code at these points.
Make MINIMAL changes — just add one function call at each point.
Do NOT restructure or refactor existing code.

1. SEARCH WITH NO RESULTS:
   Find where the student search/browse API returns empty results
   for a topic. Add: 
   trackDemandSignal(topicId, 'search', userId, 2.0)
   Only fire if the search was for a specific topic and returned 
   0 creator content items.

2. TOPIC PAGE VIEW:
   Find where student views a topic page or topic content.
   Add:
   trackDemandSignal(topicId, 'view', userId, 0.5)
   Debounce: only fire once per student per topic per 24 hours.
   (Check with a simple Redis key: demand:view:{userId}:{topicId} 
   with 24h TTL. If key exists, skip.)

3. AI CHAT ABOUT A TOPIC:
   Find where the student's Ask AI / chat feature processes a message.
   If the chat context includes a topicId, add:
   trackDemandSignal(topicId, 'ask_ai', userId, 1.5)

4. DOUBT POSTED ON TOPIC WITHOUT CONTENT:
   Find where doubts are created.
   If the topic has no Padvik content (quick check), add:
   trackDemandSignal(topicId, 'doubt_posted', userId, 2.0)

5. Add a "Request Content" button component:
   Create NEW file: src/components/topics/RequestContentButton.tsx
   
   A simple button: "📚 Request study material for this topic"
   On click: calls POST /api/topics/{topicId}/request-content
   After success: shows "Noted! We'll create content based on demand."
   Disable for 24 hours after clicking (localStorage flag).
   
   This component should be added to topic pages where no Padvik 
   content exists. Don't add it now — just create the component.
   Tell me which page files to add it to and I'll place it.

If any of the above integration points don't exist in the current code
(e.g., no search endpoint yet, no doubt system yet), skip that point 
and add a TODO comment in demand-tracker.ts listing where to add it 
when the feature is built.

Verify: pnpm build succeeds. Existing features still work.
```

---

## PROMPT 10: Admin Dashboard Page

```
Read src/app/api/admin/auto-content/ (all the API routes) and 
existing admin pages for patterns.

Create NEW file: src/app/(admin)/auto-content/page.tsx

Admin dashboard for the auto content generation pipeline.
Purple theme. shadcn/ui components.

Layout:

TOP ROW — 5 stat cards (shadcn Card):
  - "Generated Today" — count and cost
  - "Pending Review" — count with badge
  - "Published" — total count
  - "Daily Budget" — progress bar: $X.XX / $5.00
  - "Total Topics with Content" — count

SECTION 1 — "Top Demand Topics" 
  Table (shadcn Table) showing top 20 topics by demand score:
  Columns: Topic Name, Chapter, Subject, Board, Class, 
           Demand Score, Unique Students, Has Content (badge)
  Row action: "Generate" button → calls POST /api/admin/auto-content/generate
  with a dropdown to select content type (text_note, audio, question_set)

SECTION 2 — "Pending Review"
  Cards for each job with status='reviewing':
  - Topic name, content type badge, generated date
  - If text_note: render first 3 ContentBlocks as preview
  - If question_set: show first 2 questions as preview
  - If audio: audio player element
  - Two buttons: "Approve & Publish" (green), "Reject" (red outline)
  - Approve/reject calls PUT /api/admin/auto-content/[jobId]
  - Refresh list after action

SECTION 3 — "Recent Activity" 
  Table of last 20 jobs with:
  Columns: Topic, Type, Status (color badge), Cost, Model, Time, Date
  Status colors: queued=gray, generating=amber, reviewing=purple, 
  published=green, failed=red, rejected=muted

SECTION 4 — "Cost Tracker"
  Simple bar chart (use recharts or just styled divs) showing 
  daily cost for the last 7 days.

Fetch data from GET /api/admin/auto-content on page load.
Use React Server Component for initial load.
Use client components for interactive parts (approve/reject/generate buttons).

Verify: pnpm build succeeds. Page renders without errors.
```

---

## RUNNING ORDER

After all 10 prompts are completed:

```bash
# 1. Run the system creator seed
pnpm tsx scripts/seed-system-creator.ts
# Note the user ID and set PADVIK_SYSTEM_CREATOR_ID in .env

# 2. Manually generate content for 5 test topics
# Use the admin API or admin dashboard

# 3. Verify the full pipeline:
# - Demand signals track correctly
# - Daily cron calculates scores
# - Generation cycle picks top topics
# - Text notes generate with valid ContentBlocks
# - Question sets generate with correct format
# - Audio generates with TTS (if API key configured)
# - Auto-approve works for question sets
# - Admin can approve/reject pending content
# - Published content appears under "Padvik Official" creator
# - Daily budget cap stops generation when limit hit
```
