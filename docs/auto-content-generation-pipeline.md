# Padvik — AI Content Generation Pipeline
## Background workers that auto-generate video, text, and audio content
## Claude Code Implementation Prompt

---

## CONTEXT

Read existing code first:
- `src/db/schema/` — all current tables including creator_content
- `src/lib/ai/provider.ts` — existing 6-provider AI router (DO NOT modify)
- `src/lib/content-pipeline/` — existing creator upload pipeline
- `src/lib/s3.ts` — existing S3 utilities

DO NOT modify existing files unless explicitly stated.
BIGINT PKs, Drizzle ORM, Zod validation. Purple theme.

---

## THE PRINCIPLE: Quality Over Quantity

The #1 mistake edtech platforms make is flooding the app with
thousands of AI-generated articles nobody reads. This kills trust.

Padvik's approach:
- Generate SMALL amounts of HIGH-QUALITY content
- Publish under the "Padvik" official creator account
- Start with only the most searched/needed topics
- Scale content production ONLY based on real user demand signals
- Every piece looks hand-crafted, not mass-produced

---

## CONTENT TYPES TO GENERATE

### 1. Text Notes (Instant — cheapest, start here)
AI generates structured study notes for a topic.
Format: ContentBlock JSON (same as explainer cards).
Rendered as a beautiful article with diagrams, formulas, callouts.
Cost: ~$0.02-0.05 per topic note (Claude Sonnet/Haiku)

### 2. Audio Explainers (Fast — good for commute learning)
AI generates a 3-5 minute audio explanation of a topic.
Uses TTS APIs: ElevenLabs ($0.30/1000 chars), Google TTS (free tier),
or Sarvam TTS for Indian languages.
Cost: ~$0.10-0.30 per topic audio

### 3. Video Lessons (Slow — highest value, highest cost)
AI generates a 3-7 minute explainer video with:
- AI avatar presenting (HeyGen API — $29/month for unlimited standard)
- Animated diagrams/slides alongside the presenter
- OR slide-based video with voiceover (cheaper, no avatar needed)
Cost: ~$0.50-2.00 per topic video

### 4. Question Sets (Instant — drives engagement)
AI generates practice questions per topic: 5 MCQs + 2 short answers.
These are free for all students — the engagement hook.
Cost: ~$0.01-0.03 per question set

---

## STEP 1: Database Schema

Create NEW file: `src/db/schema/auto-content.ts`

```
auto_content_jobs
  id                BIGINT PK GENERATED ALWAYS AS IDENTITY
  topic_id          BIGINT REFERENCES topics(id) NOT NULL
  board_id          BIGINT REFERENCES boards(id)
  standard_id       BIGINT REFERENCES standards(id)
  subject_id        BIGINT REFERENCES subjects(id)
  content_type      VARCHAR(30) NOT NULL
                    -- 'text_note' | 'audio_explainer' | 'video_lesson' | 'question_set'
  
  -- Generation control
  priority          INT DEFAULT 50              -- 0=highest, 100=lowest
  demand_score      DECIMAL(5,2) DEFAULT 0      -- calculated from user signals
  status            VARCHAR(20) DEFAULT 'queued'
                    -- 'queued' | 'generating' | 'reviewing' | 'published' | 'failed' | 'rejected'
  
  -- Generation result
  content_id        BIGINT REFERENCES creator_content(id)  -- links to published content
  generation_prompt TEXT                        -- the prompt used (for audit)
  generation_model  VARCHAR(50)
  generation_cost   DECIMAL(8,4)               -- USD
  generation_time   INT                        -- seconds
  raw_output        JSONB                      -- AI's raw response
  
  -- Review
  auto_approved     BOOLEAN DEFAULT FALSE
  reviewed_by       BIGINT REFERENCES users(id) -- admin who reviewed
  review_notes      TEXT
  
  -- Retry
  attempts          SMALLINT DEFAULT 0
  last_error        TEXT
  
  created_at        TIMESTAMPTZ DEFAULT NOW()
  updated_at        TIMESTAMPTZ DEFAULT NOW()
  
  UNIQUE(topic_id, content_type)  -- one job per topic per type

Indexes:
  - (status, priority, demand_score DESC) — job queue ordering
  - (content_type, status)
  - (topic_id)

content_demand_signals
  id                BIGINT PK GENERATED ALWAYS AS IDENTITY
  topic_id          BIGINT REFERENCES topics(id) NOT NULL
  signal_type       VARCHAR(30) NOT NULL
                    -- 'search' | 'view' | 'ask_ai' | 'explainer_stuck' | 
                    -- 'exam_weak' | 'doubt_posted' | 'direct_request'
  student_id        BIGINT REFERENCES users(id)
  weight            DECIMAL(3,1) DEFAULT 1.0    -- signal strength
  created_at        TIMESTAMPTZ DEFAULT NOW()

Indexes:
  - (topic_id, created_at DESC)
  - (signal_type)
```

Generate and run migration.

Also add to existing users table or create a system user:
Insert a "Padvik Official" creator account:
```sql
-- Run once: create the Padvik system creator account
INSERT INTO users (name, email, is_creator, creator_tier)
VALUES ('Padvik Official', 'content@padvik.com', true, 'pro');

INSERT INTO creator_profiles (user_id, display_name, bio, 
  institution_type, verification_status, creator_tier)
VALUES ((SELECT id FROM users WHERE email='content@padvik.com'),
  'Padvik Official', 
  'AI-powered study materials crafted for your board and syllabus',
  'publisher', 'verified', 'pro');
```

Store the Padvik system creator user ID in env:
`PADVIK_SYSTEM_CREATOR_ID=1`  (or whatever ID is assigned)


---

## STEP 2: Demand Signal Collector

Create NEW file: `src/lib/auto-content/demand-tracker.ts`

```typescript
async function trackDemandSignal(
  topicId: bigint,
  signalType: DemandSignalType,
  studentId?: bigint,
  weight?: number
): Promise<void>
```

This function is called from various places across the app.
It inserts a row into content_demand_signals.

CALL THIS FROM (add to existing code — minimal changes):

1. When student searches and finds no content for a topic:
   signal = 'search', weight = 2.0
   
2. When student views a topic page (any existing content view):
   signal = 'view', weight = 0.5

3. When student asks AI about a topic in chat:
   signal = 'ask_ai', weight = 1.5

4. When student taps "Explain more" 3+ times on explainer:
   signal = 'explainer_stuck', weight = 3.0 (high — student is struggling)

5. When exam results show a topic as weak area:
   signal = 'exam_weak', weight = 2.5

6. When student posts a doubt on a topic with no creator content:
   signal = 'doubt_posted', weight = 2.0

7. When student explicitly taps "Request content for this topic":
   signal = 'direct_request', weight = 5.0 (highest — explicit ask)


Create NEW file: `src/lib/auto-content/demand-scorer.ts`

```typescript
async function calculateDemandScores(): Promise<{
  topicId: bigint, score: number, signalBreakdown: Record<string, number>
}[]>
```

Runs daily. For each topic, calculate a demand score:

```sql
SELECT topic_id, 
  SUM(weight) as raw_score,
  COUNT(DISTINCT student_id) as unique_students,
  COUNT(*) as total_signals
FROM content_demand_signals
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY topic_id
ORDER BY raw_score DESC
```

Demand score = raw_score × log(unique_students + 1)
(Signals from many different students matter more than one
student hitting refresh 50 times)

Topics with demand_score > threshold AND no existing Padvik content
→ queue auto_content_jobs for that topic.


---

## STEP 3: Content Generators

### File: `src/lib/auto-content/generators/text-note.ts`

```typescript
async function generateTextNote(
  topicId: bigint, board: string, standard: number, 
  subject: string, chapter: string, topicName: string
): Promise<{ blocks: ContentBlock[], title: string }>
```

AI PROMPT (use existing provider, task = 'generate_content'):

SYSTEM:
"You are a senior curriculum expert creating study notes for
Indian K-12 students. Your notes are used by Padvik Edutech,
a digital learning platform.

QUALITY RULES:
- Write for the SPECIFIC board and class level. CBSE Class 10 Physics
  is different from ICSE Class 10 Physics.
- Use NCERT terminology and examples where applicable.
- Every concept must have a visual: SVG diagram, formula, comparison,
  or analogy visualization.
- Use Indian examples: cricket, monsoon, cooking, railways, markets.
- Structure: Introduction → Key Concepts (one per block) → 
  Important Formulas → Common Mistakes → Quick Revision Points.
- Keep it concise: 800-1200 words max. Students want clarity, not length.
- Include 2-3 exam-relevant tips ('This is frequently asked in boards').

OUTPUT: JSON array of ContentBlock objects. Types available:
text, heading, formula, diagram (SVG), callout (tip/warning/remember/example),
comparison, steps, analogy, quick_check.

Return ONLY valid JSON."

USER:
"Create study notes for:
Topic: {topicName}
Chapter: {chapter}
Subject: {subject}
Board: {board}, Class: {standard}

Focus on what's examinable. Include at least one SVG diagram
and one numerical example if applicable."

After generation:
1. Validate JSON with Zod
2. Validate SVGs are well-formed
3. Create a creator_content row:
   - creator_id = PADVIK_SYSTEM_CREATOR_ID
   - content_type = 'note'
   - title = "Study Notes: {topicName}"
   - body = JSON.stringify(blocks) 
   - board_id, standard_id, subject_id, chapter_id, topic_id
   - is_premium = false (FREE for all students)
   - review_status = 'pending' (admin reviews before publish)
4. Update auto_content_jobs with content_id and status


### File: `src/lib/auto-content/generators/audio-explainer.ts`

```typescript
async function generateAudioExplainer(
  topicId: bigint, board: string, standard: number,
  subject: string, chapter: string, topicName: string
): Promise<{ audioUrl: string, transcript: string, durationSecs: number }>
```

TWO-STEP PROCESS:

Step 1 — Generate script via AI:

SYSTEM: 
"You are a friendly Indian teacher recording an audio lesson.
Write a 3-5 minute spoken script (500-750 words) explaining
a topic to a student. 

STYLE:
- Conversational, warm, encouraging. Like talking to a student face-to-face.
- Start with 'Hello students, today let's understand...'
- Use simple sentences. Pause indicators with [pause].
- Explain one concept at a time. Say 'Let me explain this with an example...'
- Include verbal cues: 'Now this is important for your exams...'
- End with 'Let's quickly revise what we learned today...'
- NO markdown formatting, NO bullet points — this is spoken text.
- Pronounce formulas verbally: 'V equals I times R' not 'V = IR'."

USER:
"Write a spoken script for: {topicName}, {board} Class {standard} {subject}"

Step 2 — Convert to audio via TTS API:

Option A — ElevenLabs API (best quality, ~$0.30 per 1000 chars):
  POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
  Use a warm, Indian-accented English voice.
  Set env: ELEVENLABS_API_KEY=

Option B — Google Cloud TTS (cheaper, decent quality):
  POST https://texttospeech.googleapis.com/v1/text:synthesize
  Use en-IN voice (Indian English).
  Set env: GOOGLE_TTS_API_KEY=

Option C — Sarvam TTS (for Indian languages):
  POST https://api.sarvam.ai/v1/tts
  For Malayalam, Hindi, Tamil audio content.
  Set env: SARVAM_API_KEY= (already configured)

Priority: ElevenLabs → Google TTS → Sarvam (check which API key exists)

After TTS:
1. Save audio as MP3 to S3: auto-content/{topicId}/audio-explainer.mp3
2. Create creator_content row:
   - content_type = 'audio'
   - original_file_url = S3 URL
   - duration_seconds = calculated from audio
   - ai_transcript = the generated script
3. Update auto_content_jobs


### File: `src/lib/auto-content/generators/video-lesson.ts`

```typescript
async function generateVideoLesson(
  topicId: bigint, board: string, standard: number,
  subject: string, chapter: string, topicName: string
): Promise<{ videoUrl: string, durationSecs: number }>
```

THREE-STEP PROCESS:

Step 1 — Generate script + slide descriptions via AI:

SYSTEM:
"You are creating a 3-5 minute educational video script.
The video will have an AI presenter alongside animated slides.
Write the script AND describe what each slide should show.

FORMAT — return JSON:
{
  "title": "Ohm's Law Explained",
  "slides": [
    {
      "slideNumber": 1,
      "narration": "Hello students! Today we'll learn about Ohm's Law...",
      "visual": "Title slide: 'Ohm's Law' with a circuit icon",
      "duration": 15
    },
    {
      "slideNumber": 2,
      "narration": "Imagine water flowing through a pipe...",
      "visual": "Split screen: water pipe on left, electric circuit on right, with labels showing Pressure=Voltage, Flow=Current, Pipe width=Resistance",
      "duration": 30
    }
  ]
}"

Step 2 — Generate video:

Option A — HeyGen API (avatar + slides, best quality):
  - Use HeyGen's create video API
  - Select an Indian male/female avatar
  - Pass script as narration text
  - Upload slide images as background visuals
  - API: POST https://api.heygen.com/v2/video/generate
  - Cost: uses credits from $29/month Creator plan
  - Set env: HEYGEN_API_KEY=

Option B — Slide-based video with TTS (cheaper, no avatar):
  - Generate slides as images using the AI (SVG → PNG via sharp)
  - Generate audio narration via TTS (same as audio explainer)
  - Stitch together using ffmpeg:
    ffmpeg -i slide%d.png -i narration.mp3 -c:v libx264 output.mp4
  - This creates a "Khan Academy style" video without a face
  - Cost: ~$0.30-0.50 per video

Option C — Text-to-video API (InVideo, Pictory — backup):
  - Send script to InVideo API
  - Auto-generates stock footage + text overlays + narration
  - Less educational, more generic — use as last resort

Priority: HeyGen (if HEYGEN_API_KEY exists) → Slide+TTS → InVideo

Step 3 — Post-process:
1. Upload to S3: auto-content/{topicId}/video-lesson.mp4
2. Generate thumbnail from first slide (or frame at 5 seconds)
3. Create creator_content row
4. Update auto_content_jobs

NOTE: Video generation is SLOW (2-10 minutes per video via API).
Run as async BullMQ job. Don't block.


### File: `src/lib/auto-content/generators/question-set.ts`

```typescript
async function generateQuestionSet(
  topicId: bigint, board: string, standard: number,
  subject: string, chapter: string, topicName: string
): Promise<{ questions: Question[] }>
```

AI PROMPT:

SYSTEM:
"You are an expert exam question setter for Indian board exams.
Create practice questions exactly matching the difficulty and
style of {board} Class {standard} board exam papers.

Generate:
- 5 Multiple Choice Questions (1 mark each)
- 2 Short Answer Questions (2-3 marks each)
- 1 Long Answer / Numerical Problem (5 marks)

For each MCQ: { question, options: [A,B,C,D], correctIndex, explanation }
For each SA/LA: { question, expectedAnswer, marks, rubric }

Match the exact format students see in their board exams.
Include at least one question that tests diagram/visual understanding.
Include at least one application-based question (not rote learning).

Return ONLY valid JSON."

After generation:
1. Store questions in the existing questions table (if it exists)
   OR create as creator_content with content_type = 'question_set'
2. These are FREE for all students — the engagement hook
3. Auto-approve question sets (lower risk than articles)


---

## STEP 4: Content Generation Orchestrator

Create NEW file: `src/lib/auto-content/orchestrator.ts`

```typescript
async function runContentGenerationCycle(): Promise<{
  generated: number, failed: number, skipped: number
}>
```

This is the main brain. Runs as a scheduled BullMQ job.

Logic:

1. CALCULATE DEMAND SCORES:
   Call calculateDemandScores() to get ranked topics.

2. DETERMINE WHAT TO GENERATE:
   For top 10 highest-demand topics that don't have Padvik content:
   
   a. If topic has NO content at all → generate text_note first
      (fastest, gives immediate value)
   b. If topic has text_note but demand_score > 50 → generate audio_explainer
   c. If topic has text+audio and demand_score > 100 → generate video_lesson
   d. Always generate question_set alongside text_note
   
   This creates a natural content ladder:
   Low demand → text only
   Medium demand → text + audio
   High demand → text + audio + video
   
   NEVER generate more than 20 pieces of content per day.
   Quality > quantity. Always.

3. CREATE JOBS:
   Insert auto_content_jobs for each topic/type pair.
   Set priority based on demand_score.

4. PROCESS JOBS:
   Process jobs in priority order (highest demand first).
   For each job:
   a. Set status = 'generating'
   b. Call the appropriate generator
   c. If success: status = 'reviewing' (pending admin review)
   d. If fail: status = 'failed', increment attempts
   e. If attempts >= 3: give up, log error

5. DAILY BUDGET CAP:
   Track total generation cost today.
   If cost > DAILY_CONTENT_BUDGET (env var, default $5):
   Stop generating for today.
   This prevents runaway AI costs.

6. AUTO-APPROVE RULES:
   - question_set → auto-approve (low risk)
   - text_note with quality_score > 0.8 → auto-approve
   - audio_explainer → always review (TTS quality varies)
   - video_lesson → always review (highest visibility)
   
   Auto-approved content gets published immediately under
   the "Padvik Official" creator account.


---

## STEP 5: BullMQ Jobs

```
Job: 'calculate-demand-scores'
  Cron: '0 2 * * *' (daily at 2 AM)
  Handler: calculateDemandScores() → update demand_score on topics

Job: 'content-generation-cycle'
  Cron: '0 4 * * *' (daily at 4 AM, after demand scores are fresh)
  Handler: runContentGenerationCycle()
  Timeout: 2 hours

Job: 'generate-single-content'
  Data: { jobId: bigint }
  Handler: process one auto_content_job
  Retry: 3 attempts, exponential backoff
  Timeout: 15 minutes (video can be slow)

Job: 'content-demand-cleanup'
  Cron: '0 3 1 * *' (monthly)
  Handler: delete demand signals older than 90 days
```

---

## STEP 6: API Endpoints

```
POST /api/topics/[topicId]/request-content
  Student auth. "I want content for this topic" button.
  Inserts demand signal with type='direct_request', weight=5.0
  Returns: { message: "Your request has been noted. Content will be 
  created based on demand." }

GET /api/admin/auto-content/dashboard
  Admin auth. Returns:
  - Today's generation stats (generated, cost, pending review)
  - Top 20 topics by demand (with demand breakdown)
  - Recent generations with status
  - Daily budget usage

POST /api/admin/auto-content/generate
  Admin auth. Manually trigger generation for specific topic.
  Body: { topicId, contentType }

POST /api/admin/auto-content/[jobId]/approve
  Admin auth. Approve pending content → publishes it.

POST /api/admin/auto-content/[jobId]/reject
  Admin auth. Reject content with notes. Will not retry.

GET /api/admin/auto-content/costs
  Admin auth. Cost breakdown by day, by content type, by provider.
```

---

## STEP 7: Content Review Admin UI

Create NEW page: `src/app/(admin)/auto-content/page.tsx`

Content generation dashboard:
- Stats cards: Today generated | Pending review | Published | Budget used
- Top demand topics list with "Generate Now" button
- Pending review queue:
  - Card per content piece: title, topic, type badge, preview
  - "Approve & Publish" / "Reject" / "Edit" buttons
  - For text notes: render ContentBlocks inline
  - For audio: embedded audio player
  - For video: embedded video player
- Generation history with cost tracking

---

## STEP 8: Environment Variables

Add to .env.example:
```
# Auto content generation
PADVIK_SYSTEM_CREATOR_ID=       # user ID for "Padvik Official" account
DAILY_CONTENT_BUDGET=5.00       # max USD per day on content generation
AUTO_CONTENT_ENABLED=true       # kill switch

# TTS Providers (at least one required for audio)
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=            # Indian English voice
GOOGLE_TTS_API_KEY=

# Video Generation (optional — text+audio work without this)
HEYGEN_API_KEY=
HEYGEN_AVATAR_ID=               # selected Indian presenter avatar
```

---

## LAUNCH STRATEGY: What to Generate First

Week 1 (before launch):
- Manually trigger generation for 50 high-value topics:
  CBSE Class 10: Physics (all chapters), Chemistry (all chapters)
  Kerala SSLC: Maths, Science (all chapters)
- Generate: text_note + question_set for each = 100 content pieces
- Admin reviews and publishes all 100
- This gives students something to see on day 1

Week 2-4 (soft launch):
- Enable demand tracking
- Let real student behavior drive what gets generated next
- Daily budget: $3/day = ~60 text notes + 10 audio per week

Month 2+ (growth):
- Increase budget based on subscription revenue
- Start video generation for top 10 most-viewed topics
- Expand to more boards and classes based on user geography

GOLDEN RULE: If a topic has < 5 demand signals in 30 days, 
DO NOT generate content for it. Nobody asked for it.
Only generate what students actually want.

---

## VERIFICATION

1. pnpm build — no errors
2. Demand signals are tracked when student searches/asks AI/etc.
3. Daily cron calculates demand scores correctly
4. Text note generation produces valid ContentBlock JSON
5. Audio generation produces MP3 via TTS API
6. Content publishes under "Padvik Official" creator
7. Daily budget cap stops generation at limit
8. Admin can review, approve, reject pending content
9. Question sets auto-approve and are free for all students
10. "Request content" button works from topic page
