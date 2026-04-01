# Padvik — Comprehensive Project Outline
### An AI-Powered Curriculum Learning Platform for Indian K-12 Education
**Version:** 0.1 (Draft) | **Date:** March 31, 2026 | **Author:** Ensate Technologies

---

## 1. VISION & POSITIONING

**One-liner:** ExamForge for curriculum — an AI-powered learning platform that maps every Indian education board's syllabus (Classes 1–12) and delivers structured learning, exam preparation, and performance analytics with minimal human intervention.

**Relationship to ExamForge:** Padvik reuses ExamForge's proven architecture (monorepo, Next.js, PostgreSQL, AWS-native infra), auth system, AI chat agent, and exam engine — but pivots the domain from competitive/professional exams to school curriculum learning across CBSE, ICSE, Kerala State (SCERT), and 28+ other state boards.

**Key Differentiators:**
- Syllabus-first architecture: every piece of content is mapped to Board → Standard → Subject → Chapter → Topic
- Previous year question paper intelligence: parsed, tagged, and used to weight exam generation
- Dual-user model: students AND teachers (school + tuition) can contribute content
- Fully automated content pipeline: scrape → parse → tag → store → serve with minimal human QA

---

## 2. TECH STACK (Aligned with ExamForge)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Next.js 15 (App Router) + TypeScript | Shared with ExamForge |
| UI | Tailwind CSS + shadcn/ui | Shared component library |
| Backend | Next.js API Routes + tRPC or REST | Monorepo structure |
| Database | PostgreSQL 16 (BIGINT PKs, no UUIDs) | Drizzle ORM or Prisma |
| Auth | NextAuth.js / Auth.js | Google, phone OTP, email |
| AI Chat | Claude API (Anthropic) | Primary AI provider |
| AI Fallback | OpenAI GPT-4o, Google Gemini | For specific tasks |
| OCR/Document | Claude Vision, Tesseract, pdf.js | PDF/image parsing |
| File Storage | AWS S3 / Cloudflare R2 | PDFs, images, notes |
| Search | PostgreSQL FTS + pg_trgm (→ Meilisearch later) | Content search |
| Cache | Redis / Upstash | Session, rate limiting |
| Queue | BullMQ (Redis-backed) / AWS SQS | Async jobs |
| Infra Path | AWS App Runner → ECS Fargate → EKS | Same as ExamForge |
| CI/CD | GitHub Actions | Monorepo deploy |
| Dev Tools | Claude Code + Cursor (parallel) | Same workflow |

---

## 3. DATABASE SCHEMA (BIGINT PKs throughout)

### 3.1 Core Identity & Auth

```
users (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email           VARCHAR(255) UNIQUE,
  phone           VARCHAR(15) UNIQUE,
  password_hash   TEXT,
  full_name       VARCHAR(255) NOT NULL,
  avatar_url      TEXT,
  role            VARCHAR(20) NOT NULL DEFAULT 'student',  -- student, teacher, admin, parent
  institution     VARCHAR(255),                             -- school/tuition name
  board_id        BIGINT REFERENCES boards(id),
  standard_id     BIGINT REFERENCES standards(id),
  is_verified     BOOLEAN DEFAULT FALSE,
  is_active       BOOLEAN DEFAULT TRUE,
  preferences     JSONB DEFAULT '{}',                       -- UI prefs, language, etc.
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)

user_sessions (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,
  device_info     JSONB,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

### 3.2 Board & Curriculum Hierarchy

```
boards (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  code            VARCHAR(20) UNIQUE NOT NULL,   -- CBSE, ICSE, KL_STATE, TN_STATE, etc.
  name            VARCHAR(255) NOT NULL,
  full_name       TEXT,
  state           VARCHAR(100),                  -- NULL for national boards
  website_url     TEXT,
  syllabus_url    TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  metadata        JSONB DEFAULT '{}',            -- grading system, exam pattern, etc.
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

standards (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  board_id        BIGINT REFERENCES boards(id),
  grade           SMALLINT NOT NULL,             -- 1 to 12
  stream          VARCHAR(50),                   -- NULL for 1-10; Science/Commerce/Arts for 11-12
  academic_year   VARCHAR(10) NOT NULL,          -- 2025-26, 2026-27
  is_active       BOOLEAN DEFAULT TRUE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(board_id, grade, stream, academic_year)
)

subjects (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  standard_id     BIGINT REFERENCES standards(id),
  code            VARCHAR(50) NOT NULL,          -- MATH, PHY, ENG_CORE, etc.
  name            VARCHAR(255) NOT NULL,
  name_local      VARCHAR(255),                  -- Malayalam, Hindi, etc.
  subject_type    VARCHAR(20) DEFAULT 'theory',  -- theory, practical, project
  is_elective     BOOLEAN DEFAULT FALSE,
  max_marks       SMALLINT,
  metadata        JSONB DEFAULT '{}',            -- weightage, practical marks, etc.
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(standard_id, code)
)

chapters (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  subject_id      BIGINT REFERENCES subjects(id),
  chapter_number  SMALLINT NOT NULL,
  title           VARCHAR(500) NOT NULL,
  title_local     VARCHAR(500),
  description     TEXT,
  textbook_ref    VARCHAR(255),                  -- NCERT book name / state textbook
  estimated_hours DECIMAL(4,1),
  weightage_pct   DECIMAL(5,2),                  -- % of total marks from this chapter
  metadata        JSONB DEFAULT '{}',
  sort_order      SMALLINT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(subject_id, chapter_number)
)

topics (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  chapter_id      BIGINT REFERENCES chapters(id),
  title           VARCHAR(500) NOT NULL,
  title_local     VARCHAR(500),
  description     TEXT,
  learning_objectives JSONB DEFAULT '[]',
  bloom_level     VARCHAR(20),                   -- remember, understand, apply, analyze, evaluate, create
  estimated_minutes SMALLINT,
  sort_order      SMALLINT NOT NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

-- Cross-mapping: some topics are shared across boards (e.g., Pythagoras theorem)
topic_mappings (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_topic_id BIGINT REFERENCES topics(id),
  target_topic_id BIGINT REFERENCES topics(id),
  similarity_score DECIMAL(3,2),                 -- 0.00 to 1.00
  mapping_type    VARCHAR(20) DEFAULT 'equivalent', -- equivalent, subset, superset, related
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

### 3.3 Content & Learning Materials

```
content_items (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  topic_id        BIGINT REFERENCES topics(id),
  content_type    VARCHAR(30) NOT NULL,          -- note, summary, explanation, formula, diagram,
                                                 -- video_link, flashcard, mind_map
  title           VARCHAR(500) NOT NULL,
  body            TEXT NOT NULL,                  -- Markdown / HTML
  body_format     VARCHAR(10) DEFAULT 'markdown',
  source_type     VARCHAR(30) NOT NULL,          -- ai_generated, teacher_upload, student_upload,
                                                 -- scraped, official, community
  source_url      TEXT,
  uploaded_by     BIGINT REFERENCES users(id),
  language        VARCHAR(10) DEFAULT 'en',      -- en, hi, ml, ta, etc.
  quality_score   DECIMAL(3,2) DEFAULT 0.00,     -- AI-assessed quality 0-1
  review_status   VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, flagged
  reviewed_by     BIGINT REFERENCES users(id),
  view_count      BIGINT DEFAULT 0,
  upvote_count    INT DEFAULT 0,
  is_published    BOOLEAN DEFAULT FALSE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)

user_notes (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  topic_id        BIGINT REFERENCES topics(id),
  content_item_id BIGINT REFERENCES content_items(id),  -- if note is attached to existing content
  title           VARCHAR(500),
  body            TEXT NOT NULL,
  body_format     VARCHAR(10) DEFAULT 'markdown',
  is_private      BOOLEAN DEFAULT TRUE,
  tags            TEXT[] DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)

file_uploads (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id         BIGINT REFERENCES users(id),
  file_name       VARCHAR(500) NOT NULL,
  file_type       VARCHAR(20) NOT NULL,          -- pdf, image, docx
  file_size_bytes BIGINT,
  storage_key     TEXT NOT NULL,                  -- S3/R2 key
  storage_url     TEXT NOT NULL,
  processing_status VARCHAR(20) DEFAULT 'uploaded', -- uploaded, processing, extracted, failed
  extracted_text  TEXT,                           -- OCR/parsed text
  extracted_content_ids BIGINT[],                 -- content_items created from this file
  upload_context  VARCHAR(30),                    -- question_paper, notes, textbook, worksheet
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

### 3.4 Question Bank & Exam Engine

```
questions (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  topic_id        BIGINT REFERENCES topics(id),
  question_type   VARCHAR(30) NOT NULL,          -- mcq, short_answer, long_answer, fill_blank,
                                                 -- true_false, match, assertion_reason, case_study
  difficulty      VARCHAR(10) NOT NULL,          -- easy, medium, hard
  bloom_level     VARCHAR(20),
  question_text   TEXT NOT NULL,
  question_html   TEXT,                          -- rendered version
  question_images JSONB DEFAULT '[]',            -- [{url, alt_text, position}]
  options         JSONB,                         -- for MCQ: [{id, text, image_url, is_correct}]
  correct_answer  TEXT,                          -- for non-MCQ
  solution        TEXT,                          -- detailed explanation
  solution_html   TEXT,
  marks           DECIMAL(4,1) DEFAULT 1.0,
  negative_marks  DECIMAL(4,1) DEFAULT 0.0,
  time_seconds    SMALLINT,                      -- recommended time
  source_type     VARCHAR(30) NOT NULL,          -- ai_generated, previous_year, teacher_created,
                                                 -- textbook_exercise, community
  source_ref      VARCHAR(255),                  -- "CBSE 2024 Class 10 Paper 1 Q.12"
  source_year     SMALLINT,                      -- year of previous paper
  source_paper_id BIGINT REFERENCES question_papers(id),
  language        VARCHAR(10) DEFAULT 'en',
  is_verified     BOOLEAN DEFAULT FALSE,
  verified_by     BIGINT REFERENCES users(id),
  usage_count     BIGINT DEFAULT 0,
  avg_accuracy    DECIMAL(5,2),                  -- % of students who got it right
  tags            TEXT[] DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)

question_papers (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  board_id        BIGINT REFERENCES boards(id),
  standard_id     BIGINT REFERENCES standards(id),
  subject_id      BIGINT REFERENCES subjects(id),
  paper_title     VARCHAR(500) NOT NULL,
  paper_year      SMALLINT NOT NULL,
  paper_month     VARCHAR(20),                   -- March, October, Supplementary
  paper_type      VARCHAR(30) NOT NULL,          -- board_exam, unit_test, midterm, model_paper,
                                                 -- sample_paper, olympiad
  total_marks     SMALLINT,
  duration_minutes SMALLINT,
  file_upload_id  BIGINT REFERENCES file_uploads(id),
  source_url      TEXT,
  parsing_status  VARCHAR(20) DEFAULT 'pending', -- pending, parsing, parsed, verified, failed
  parsed_by       VARCHAR(30),                   -- ai_vision, ocr_tesseract, manual
  question_count  SMALLINT DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

exams (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title           VARCHAR(500) NOT NULL,
  description     TEXT,
  exam_type       VARCHAR(30) NOT NULL,          -- self_practice, teacher_assigned, mock_board,
                                                 -- chapter_test, weekly_test, full_syllabus
  created_by      BIGINT REFERENCES users(id),
  subject_id      BIGINT REFERENCES subjects(id),
  chapter_ids     BIGINT[] DEFAULT '{}',         -- specific chapters tested
  topic_ids       BIGINT[] DEFAULT '{}',         -- specific topics tested
  generation_mode VARCHAR(20) NOT NULL,          -- ai_generated, manual, random, previous_year_based
  total_marks     DECIMAL(6,1) NOT NULL,
  duration_minutes SMALLINT NOT NULL,
  negative_marking BOOLEAN DEFAULT FALSE,
  negative_pct    DECIMAL(4,2) DEFAULT 0,
  passing_pct     DECIMAL(5,2) DEFAULT 35.00,
  difficulty_mix  JSONB DEFAULT '{"easy":30,"medium":50,"hard":20}',
  question_type_mix JSONB,                       -- {"mcq":40,"short":30,"long":30}
  is_published    BOOLEAN DEFAULT FALSE,
  is_timed        BOOLEAN DEFAULT TRUE,
  allow_review    BOOLEAN DEFAULT TRUE,
  shuffle_questions BOOLEAN DEFAULT TRUE,
  shuffle_options BOOLEAN DEFAULT TRUE,
  max_attempts    SMALLINT DEFAULT 1,
  available_from  TIMESTAMPTZ,
  available_until TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)

exam_questions (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_id         BIGINT REFERENCES exams(id) ON DELETE CASCADE,
  question_id     BIGINT REFERENCES questions(id),
  sort_order      SMALLINT NOT NULL,
  section_label   VARCHAR(50),                   -- Section A, Part I, etc.
  marks_override  DECIMAL(4,1),                  -- override question default
  is_compulsory   BOOLEAN DEFAULT TRUE
)

exam_attempts (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_id         BIGINT REFERENCES exams(id),
  user_id         BIGINT REFERENCES users(id),
  attempt_number  SMALLINT DEFAULT 1,
  status          VARCHAR(20) DEFAULT 'started', -- started, in_progress, submitted, evaluated, abandoned
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  submitted_at    TIMESTAMPTZ,
  time_spent_seconds INT,
  total_score     DECIMAL(6,1),
  max_score       DECIMAL(6,1),
  percentage      DECIMAL(5,2),
  grade           VARCHAR(5),                    -- A1, A2, B1, B2, C1, C2, D, E
  evaluation_mode VARCHAR(20) DEFAULT 'auto',    -- auto, teacher, hybrid
  evaluated_by    BIGINT REFERENCES users(id),
  evaluated_at    TIMESTAMPTZ,
  feedback        TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

exam_responses (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  attempt_id      BIGINT REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id     BIGINT REFERENCES questions(id),
  response_text   TEXT,
  selected_option_ids JSONB,                     -- for MCQ
  response_images JSONB DEFAULT '[]',            -- student-uploaded answer images
  is_correct      BOOLEAN,
  marks_obtained  DECIMAL(4,1),
  time_spent_seconds INT,
  ai_evaluation   JSONB,                         -- {score, reasoning, suggestions}
  teacher_evaluation JSONB,                      -- {score, comments}
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)
```

### 3.5 Performance & Analytics

```
student_progress (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  topic_id        BIGINT REFERENCES topics(id),
  mastery_level   DECIMAL(3,2) DEFAULT 0.00,     -- 0.00 to 1.00
  confidence      DECIMAL(3,2) DEFAULT 0.00,
  total_questions_attempted INT DEFAULT 0,
  correct_answers INT DEFAULT 0,
  time_spent_minutes INT DEFAULT 0,
  last_studied_at TIMESTAMPTZ,
  next_review_at  TIMESTAMPTZ,                   -- spaced repetition
  streak_days     SMALLINT DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, topic_id)
)

learning_sessions (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  session_type    VARCHAR(30) NOT NULL,           -- reading, practice, exam, revision, ai_chat
  subject_id      BIGINT REFERENCES subjects(id),
  chapter_id      BIGINT REFERENCES chapters(id),
  topic_id        BIGINT REFERENCES topics(id),
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  duration_minutes INT,
  pages_read      SMALLINT,
  questions_attempted SMALLINT,
  questions_correct SMALLINT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

performance_reports (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  report_type     VARCHAR(30) NOT NULL,           -- weekly, monthly, chapter, subject, term
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  subject_id      BIGINT REFERENCES subjects(id),
  summary         JSONB NOT NULL,                 -- {total_time, topics_covered, accuracy, strengths, weaknesses}
  recommendations JSONB DEFAULT '[]',             -- AI-generated study recommendations
  generated_at    TIMESTAMPTZ DEFAULT NOW()
)

-- Teacher-student relationships
classrooms (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  teacher_id      BIGINT REFERENCES users(id),
  name            VARCHAR(255) NOT NULL,
  board_id        BIGINT REFERENCES boards(id),
  standard_id     BIGINT REFERENCES standards(id),
  subject_id      BIGINT REFERENCES subjects(id),
  institution     VARCHAR(255),
  join_code       VARCHAR(10) UNIQUE,
  is_active       BOOLEAN DEFAULT TRUE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

classroom_members (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  classroom_id    BIGINT REFERENCES classrooms(id) ON DELETE CASCADE,
  student_id      BIGINT REFERENCES users(id),
  joined_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(classroom_id, student_id)
)

teacher_assessments (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  classroom_id    BIGINT REFERENCES classrooms(id),
  exam_id         BIGINT REFERENCES exams(id),
  assigned_by     BIGINT REFERENCES users(id),
  assigned_at     TIMESTAMPTZ DEFAULT NOW(),
  due_date        TIMESTAMPTZ,
  instructions    TEXT,
  is_graded       BOOLEAN DEFAULT FALSE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

### 3.6 AI Chat & Conversations

```
conversations (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(500),
  context_type    VARCHAR(30),                    -- general, topic_help, exam_doubt, homework
  topic_id        BIGINT REFERENCES topics(id),
  subject_id      BIGINT REFERENCES subjects(id),
  model_used      VARCHAR(50),                    -- claude-sonnet-4, gpt-4o, etc.
  message_count   SMALLINT DEFAULT 0,
  token_count     INT DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)

messages (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
  role            VARCHAR(10) NOT NULL,           -- user, assistant, system
  content         TEXT NOT NULL,
  content_type    VARCHAR(20) DEFAULT 'text',     -- text, image, file
  attachments     JSONB DEFAULT '[]',
  token_count     INT,
  model_used      VARCHAR(50),
  cost_usd        DECIMAL(8,6),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

### 3.7 System & Pipeline

```
scrape_jobs (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  job_type        VARCHAR(30) NOT NULL,           -- syllabus, question_paper, textbook, notes
  source_url      TEXT NOT NULL,
  board_id        BIGINT REFERENCES boards(id),
  standard_id     BIGINT REFERENCES standards(id),
  status          VARCHAR(20) DEFAULT 'queued',   -- queued, running, completed, failed, paused
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  items_found     INT DEFAULT 0,
  items_processed INT DEFAULT 0,
  error_log       TEXT,
  retry_count     SMALLINT DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

content_pipeline_logs (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  pipeline_stage  VARCHAR(30) NOT NULL,           -- scrape, parse, tag, review, publish
  entity_type     VARCHAR(30) NOT NULL,           -- syllabus, question, content, paper
  entity_id       BIGINT NOT NULL,
  status          VARCHAR(20) NOT NULL,
  input_data      JSONB,
  output_data     JSONB,
  processing_time_ms INT,
  ai_model_used   VARCHAR(50),
  ai_tokens_used  INT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

system_config (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  config_key      VARCHAR(100) UNIQUE NOT NULL,
  config_value    JSONB NOT NULL,
  description     TEXT,
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)
```

---

## 4. SYLLABUS ACQUISITION STRATEGY

### 4.1 Data Sources (Priority Order)

| Priority | Source | Method | Coverage | Content Depth |
|----------|--------|--------|----------|---------------|
| 1 | CBSE Academic (cbseacademic.nic.in) | Scrape PDF syllabi | CBSE 1-12 | Syllabus structure + chapters |
| 2 | NCERT Textbooks (ncert.nic.in/textbook.php) | Scrape chapter listings | All NCERT-aligned boards | Full chapter/topic content |
| 3 | DIKSHA/Sunbird API | API integration (open source) | All boards, 36 languages | Content + assessments |
| 4 | SCERT Kerala (scert.kerala.gov.in) | Scrape syllabus PDFs | Kerala State 1-12 | State-specific content |
| 5 | CISCE (cisce.org) | Scrape ICSE/ISC syllabi | ICSE/ISC 1-12 | Syllabus + specimen papers |
| 6 | State Board Websites | Per-state scraping | 28+ state boards | Varies |
| 7 | iDream Education API | Commercial API partnership | NCERT + State boards | Full content library |
| 8 | Community/Crowdsource | Teacher uploads | Gap-fill | Varies |

### 4.2 Scraping Pipeline Architecture

```
[Source URLs] → [Scraper Workers (Playwright/Puppeteer)]
    → [Raw Content Store (S3)]
    → [Parser (PDF→Text, HTML→Structured)]
    → [AI Tagger (Claude API) — maps to board/standard/subject/chapter/topic]
    → [Quality Scorer (AI)]
    → [Human Review Queue (for flagged items)]
    → [PostgreSQL Database]
    → [Search Index Update]
```

### 4.3 AI-Powered Syllabus Parser

For each board's PDF syllabus:
1. Extract text via pdf.js / Claude Vision (for scanned PDFs)
2. Send to Claude with structured prompt:
   ```
   Parse this syllabus document for [Board] [Class X] [Subject].
   Extract: units, chapters, topics, sub-topics, learning outcomes, marks weightage.
   Return as JSON matching our schema.
   ```
3. Validate against known structure (chapter count, subject names)
4. Store with `source_type = 'scraped'` and `review_status = 'pending'`

### 4.4 Previous Year Question Paper Pipeline

```
[Upload PDF/Image] → [OCR (Claude Vision / Tesseract)]
    → [Question Extractor (Claude API)]
        → Splits paper into individual questions
        → Identifies: question_type, marks, section, difficulty
    → [Topic Tagger (Claude API)]
        → Maps each question to topic_id in our hierarchy
    → [Solution Generator (Claude API)]
        → Generates step-by-step solutions
    → [Human Verification Queue]
    → [Question Bank (questions table)]
```

---

## 5. FEATURE MODULES

### 5.1 Syllabus Explorer
- Board/Class/Subject/Chapter/Topic drill-down navigation
- Visual progress overlay (mastered/learning/not started)
- Exam date countdown + study planner
- Syllabus comparison across boards

### 5.2 Learning System (ExamForge-aligned)
- **Notes Viewer:** Topic-wise notes (AI-generated + teacher/student uploaded)
- **My Notes:** Personal note-taking with markdown editor, attach to any topic
- **Smart Content Finder:** AI-powered — "Find me notes on electromagnetic induction for Class 12 CBSE"
- **Flashcards:** Auto-generated from topic content with spaced repetition
- **Mind Maps:** AI-generated visual topic summaries
- **Bookmarks & Highlights:** Save and annotate any content

### 5.3 Exam Engine (ExamForge-aligned + Enhanced)
- **Self Practice:** Student picks chapter(s), difficulty, question types → AI generates exam
- **Previous Year Mode:** Generate exams purely from previous year questions for selected chapters
- **Mock Board Exam:** Full-length board exam simulation with realistic time/marks distribution
- **Random Quiz:** Quick 10-question random quiz on any topic
- **AI-Weighted Generation:** Questions weighted by:
  - Previous year frequency (chapters that appear more get more questions)
  - Student's weak topics (personalized difficulty)
  - Bloom's taxonomy level distribution
  - Board-specific marking scheme compliance
- **Teacher-Assigned Tests:** Teachers create and assign exams to classrooms
- **Adaptive Testing:** Difficulty adjusts based on real-time performance

### 5.4 Assessment & Grading
- **Auto-Grading:** MCQ, fill-blank, true/false → instant
- **AI Grading:** Short answer, long answer → Claude evaluates with rubric
- **Teacher Override:** Teachers can review and adjust AI grades
- **Answer Sheet Upload:** Students upload handwritten answer photos → AI evaluates
- **Detailed Feedback:** Per-question AI feedback with improvement suggestions

### 5.5 Performance Analytics
- **Student Dashboard:** Overall progress, streaks, time spent, mastery per topic
- **Subject Heatmap:** Chapter-wise strength/weakness visualization
- **Exam Analytics:** Score trends, accuracy by question type, time management analysis
- **Peer Comparison:** Anonymous percentile ranking within board/class
- **Teacher Dashboard:** Class-wide analytics, individual student reports
- **Parent View:** Read-only dashboard showing child's progress
- **AI Recommendations:** "Focus on Chapter 7 — you scored 45% and it carries 15% weightage"
- **Spaced Repetition Scheduler:** Auto-schedules topic review based on forgetting curve

### 5.6 AI Chat Agent (ExamForge-aligned)
- **General Chat:** Ask anything academic — context-aware of student's board/class
- **Topic Chat:** Chat anchored to a specific topic with relevant context injected
- **Doubt Resolver:** Snap a photo of a problem → AI solves with steps
- **Homework Helper:** Upload worksheet → AI explains each problem
- **Exam Prep Coach:** AI creates personalized study plans based on performance data
- **Same providers:** Claude (primary), OpenAI (fallback), same API routing as ExamForge

### 5.7 Content Upload & Extraction
- **Student Upload:** PDF/image of class notes → AI extracts, structures, tags to topics
- **Teacher Upload:** Bulk upload question papers, notes, worksheets
- **Auto-Processing Pipeline:**
  1. Upload file → S3
  2. Trigger processing job (BullMQ)
  3. OCR + text extraction (Claude Vision)
  4. AI structuring (split into logical content blocks)
  5. Topic tagging (map to curriculum hierarchy)
  6. Quality assessment
  7. Store in content_items with appropriate source_type
- **Supported Formats:** PDF, JPEG, PNG, HEIC, DOCX

### 5.8 Classroom Management (Teacher Features)
- Create classrooms with join codes
- Assign exams with deadlines
- View class-wide and per-student performance
- Upload notes/papers that automatically become available to students
- Grade subjective answers with AI assistance
- Generate progress reports for parents

---

## 6. SYLLABUS SCRAPING — BOARD-WISE STRATEGY

### Phase 1 (Week 1-2): National Boards
| Board | Source | Method |
|-------|--------|--------|
| CBSE | cbseacademic.nic.in/curriculum_2026.html | Download PDFs → Claude Vision parse |
| CBSE (NCERT content) | ncert.nic.in/textbook.php | Scrape textbook chapter listings |
| ICSE/ISC | cisce.org | Scrape syllabus + specimen papers |

### Phase 2 (Week 3-4): Kerala + Major State Boards
| Board | Source | Method |
|-------|--------|--------|
| Kerala SCERT | scert.kerala.gov.in | Scrape syllabus PDFs |
| Kerala HSE | dhsekerala.gov.in | Scrape HSE syllabus |
| Karnataka | kseab.karnataka.gov.in | Scrape + DIKSHA API |
| Tamil Nadu | dge.tn.gov.in | Scrape + textbook PDFs |
| Maharashtra | mahahsscboard.in | Scrape syllabus |
| Andhra/Telangana | bse.ap.gov.in | Scrape |

### Phase 3 (Week 5-8): Remaining State Boards + DIKSHA Integration
- Integrate with DIKSHA/Sunbird open APIs for bulk content
- Scrape remaining state board websites
- Use AI to normalize all syllabi into our unified schema

---

## 7. AGENTING ORCHESTRATION & DEVELOPMENT SCHEDULE

### Development Philosophy
- Claude Code (primary coding agent) + Cursor (parallel IDE agent)
- Claude Chat (planning, research, architecture decisions)
- Cowork (long-running autonomous tasks: scraping, content generation)

### Sprint Schedule (12-Week MVP)

```
╔══════════════════════════════════════════════════════════════════════╗
║                    PHASE 1: FOUNDATION (Weeks 1-3)                  ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  Week 1: Project Setup & Core Schema                                 ║
║  ├─ Agent: Claude Code                                               ║
║  │  ├─ Initialize monorepo (same structure as ExamForge)             ║
║  │  ├─ Set up Next.js 15 + TypeScript + Tailwind + shadcn/ui        ║
║  │  ├─ PostgreSQL schema migration (all tables from Section 3)       ║
║  │  ├─ Auth system (port from ExamForge, adapt for student/teacher)  ║
║  │  └─ CLAUDE.md, AGENTS.md, .cursor/rules/ config                  ║
║  ├─ Agent: Cursor (parallel)                                         ║
║  │  ├─ Landing page & marketing site                                 ║
║  │  └─ Board selection onboarding flow                               ║
║  └─ Agent: Claude Chat                                               ║
║     └─ Architecture review, API design decisions                     ║
║                                                                      ║
║  Week 2: Syllabus Scraping Pipeline                                  ║
║  ├─ Agent: Claude Code                                               ║
║  │  ├─ Build scraper framework (Playwright + job queue)              ║
║  │  ├─ CBSE syllabus scraper + parser                                ║
║  │  ├─ NCERT textbook chapter scraper                                ║
║  │  └─ AI parsing pipeline (Claude Vision + structuring)             ║
║  ├─ Agent: Cowork (autonomous)                                       ║
║  │  ├─ Run CBSE scraping for all 12 classes                          ║
║  │  └─ Parse and validate results                                    ║
║  └─ Agent: Cursor (parallel)                                         ║
║     └─ Admin dashboard for scrape job monitoring                     ║
║                                                                      ║
║  Week 3: ICSE + Kerala State Board + Content Model                   ║
║  ├─ Agent: Claude Code                                               ║
║  │  ├─ ICSE/ISC scraper                                              ║
║  │  ├─ Kerala SCERT scraper                                          ║
║  │  ├─ Content items CRUD API                                        ║
║  │  └─ File upload pipeline (S3 + processing queue)                  ║
║  ├─ Agent: Cowork (autonomous)                                       ║
║  │  ├─ Run ICSE + Kerala scraping                                    ║
║  │  └─ AI-generate initial topic summaries for CBSE Math/Science     ║
║  └─ Agent: Cursor                                                    ║
║     └─ Syllabus explorer UI (board→class→subject→chapter→topic)      ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║                    PHASE 2: LEARNING CORE (Weeks 4-6)                ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  Week 4: Notes & Content System                                      ║
║  ├─ Agent: Claude Code                                               ║
║  │  ├─ Notes viewer (topic-wise, markdown rendering)                 ║
║  │  ├─ Personal notes editor (markdown + attachments)                ║
║  │  ├─ Content upload + AI extraction pipeline                       ║
║  │  └─ PDF/Image → structured notes extraction                      ║
║  ├─ Agent: Cowork                                                    ║
║  │  └─ Bulk AI content generation for top 5 CBSE subjects (8-12)    ║
║  └─ Agent: Cursor                                                    ║
║     └─ Note-taking UI, file upload UI, content cards                 ║
║                                                                      ║
║  Week 5: Question Bank Foundation                                    ║
║  ├─ Agent: Claude Code                                               ║
║  │  ├─ Question CRUD API with full schema support                    ║
║  │  ├─ Question paper upload → parse → split pipeline                ║
║  │  ├─ AI question generation from topic content                     ║
║  │  └─ Previous year paper scraper (for CBSE/ICSE)                   ║
║  ├─ Agent: Cowork                                                    ║
║  │  ├─ Scrape + parse CBSE previous year papers (2019-2025)          ║
║  │  └─ AI-tag all scraped questions to topics                        ║
║  └─ Agent: Cursor                                                    ║
║     └─ Question bank browser UI with filters                        ║
║                                                                      ║
║  Week 6: Exam Engine                                                 ║
║  ├─ Agent: Claude Code                                               ║
║  │  ├─ Exam creation engine (all generation modes)                   ║
║  │  ├─ Exam attempt flow (timed, auto-save, submit)                  ║
║  │  ├─ Auto-grading (MCQ) + AI grading (subjective)                  ║
║  │  └─ Exam results + detailed answer review                        ║
║  ├─ Agent: Cursor                                                    ║
║  │  └─ Exam UI (creation, taking, review screens)                    ║
║  └─ Milestone: Self-practice exams working end-to-end                ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║                    PHASE 3: INTELLIGENCE LAYER (Weeks 7-9)           ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  Week 7: AI Chat Agent                                               ║
║  ├─ Agent: Claude Code                                               ║
║  │  ├─ Chat API (conversations + messages, streaming)                ║
║  │  ├─ Context injection (student's board, class, current topic)     ║
║  │  ├─ Doubt resolver (image upload → AI solve)                      ║
║  │  └─ Multi-provider routing (Claude primary, OpenAI fallback)      ║
║  └─ Agent: Cursor                                                    ║
║     └─ Chat UI (similar to ExamForge chat interface)                 ║
║                                                                      ║
║  Week 8: Performance Analytics                                       ║
║  ├─ Agent: Claude Code                                               ║
║  │  ├─ Student progress tracking (per-topic mastery)                 ║
║  │  ├─ Learning session logging                                      ║
║  │  ├─ Performance report generation (AI-powered insights)           ║
║  │  ├─ Spaced repetition scheduling algorithm                        ║
║  │  └─ Study plan AI generator                                       ║
║  └─ Agent: Cursor                                                    ║
║     └─ Student dashboard, subject heatmaps, charts                   ║
║                                                                      ║
║  Week 9: Smart Features                                              ║
║  ├─ Agent: Claude Code                                               ║
║  │  ├─ Smart Content Finder (semantic search + AI)                   ║
║  │  ├─ AI-weighted exam generation (previous year frequency)         ║
║  │  ├─ Flashcard auto-generation                                     ║
║  │  └─ Weakness-based question recommendation                        ║
║  └─ Agent: Cursor                                                    ║
║     └─ Smart search UI, flashcard UI, recommendation cards           ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║                    PHASE 4: MULTI-USER & POLISH (Weeks 10-12)        ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  Week 10: Teacher & Classroom Features                               ║
║  ├─ Agent: Claude Code                                               ║
║  │  ├─ Classroom creation, join codes, member management             ║
║  │  ├─ Teacher exam assignment workflow                               ║
║  │  ├─ Teacher grading interface (with AI assist)                    ║
║  │  └─ Teacher content upload → auto-distribute to class             ║
║  └─ Agent: Cursor                                                    ║
║     └─ Teacher dashboard, classroom management UI                    ║
║                                                                      ║
║  Week 11: Remaining State Boards + Content Scaling                   ║
║  ├─ Agent: Claude Code                                               ║
║  │  ├─ DIKSHA/Sunbird API integration for bulk content               ║
║  │  ├─ Remaining state board scrapers (top 10 by student count)      ║
║  │  └─ Content quality scoring pipeline                              ║
║  ├─ Agent: Cowork (autonomous, long-running)                         ║
║  │  ├─ Bulk scrape remaining boards                                  ║
║  │  ├─ AI-generate content for all boards/classes                    ║
║  │  └─ Parse previous year papers for state boards                   ║
║  └─ Agent: Cursor                                                    ║
║     └─ Parent view, peer comparison UI                               ║
║                                                                      ║
║  Week 12: Integration Testing, Polish, Deploy                        ║
║  ├─ Agent: Claude Code                                               ║
║  │  ├─ End-to-end testing                                            ║
║  │  ├─ Performance optimization (queries, caching)                   ║
║  │  ├─ AWS deployment (App Runner)                                   ║
║  │  └─ Monitoring, logging, error tracking                           ║
║  ├─ Agent: Cursor                                                    ║
║  │  └─ UI polish, responsive design, accessibility                   ║
║  └─ Agent: Claude Chat                                               ║
║     └─ Documentation, API docs, user guides                         ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

### Daily Agent Workflow

```
Morning (9 AM - 1 PM):
├── Claude Code: Core backend feature development
├── Cursor: Frontend UI for yesterday's backend work
└── Claude Chat: Quick architecture questions as they arise

Afternoon (2 PM - 6 PM):
├── Claude Code: API endpoints, database queries, AI integrations
├── Cursor: Component development, styling, responsive design
└── Cowork: Background tasks (scraping, content generation, testing)

Evening (7 PM - 10 PM):
├── Claude Code: Bug fixes, code review, tests
├── Cursor: UI polish, animation, micro-interactions
└── Claude Chat: Next day planning, prompt engineering for AI features
```

---

## 8. API ROUTES STRUCTURE

```
/api/auth/
  ├── register          POST    — student/teacher signup
  ├── login             POST    — email/phone + password/OTP
  ├── logout            POST    — invalidate session
  ├── verify-otp        POST    — phone OTP verification
  └── me                GET     — current user profile

/api/boards/
  ├── /                 GET     — list all boards
  ├── /:id              GET     — board details
  ├── /:id/standards    GET     — classes for a board
  └── /:id/subjects     GET     — subjects for board+class

/api/syllabus/
  ├── /explore          GET     — hierarchical browse (board→class→subject→chapter→topic)
  ├── /chapters/:id     GET     — chapter with topics
  ├── /topics/:id       GET     — topic with content
  └── /search           GET     — search across syllabus

/api/content/
  ├── /                 GET     — list content (filtered by topic, type, source)
  ├── /:id              GET     — single content item
  ├── /upload           POST    — upload file for extraction
  ├── /upload/:id/status GET    — processing status
  └── /generate         POST    — AI-generate content for topic

/api/notes/
  ├── /                 GET     — user's notes
  ├── /                 POST    — create note
  ├── /:id              PUT     — update note
  └── /:id              DELETE  — delete note

/api/questions/
  ├── /                 GET     — browse question bank
  ├── /:id              GET     — single question with solution
  ├── /papers           GET     — list question papers
  ├── /papers/:id       GET     — paper details with questions
  └── /papers/upload    POST    — upload paper for parsing

/api/exams/
  ├── /generate         POST    — AI-generate exam
  ├── /                 GET     — list exams (created/assigned)
  ├── /:id              GET     — exam details
  ├── /:id/start        POST    — start attempt
  ├── /:id/respond      POST    — submit answer
  ├── /:id/submit       POST    — submit exam
  ├── /:id/result       GET     — attempt result + review
  └── /my-attempts      GET     — all user's attempts

/api/chat/
  ├── /conversations           GET     — list conversations
  ├── /conversations           POST    — create conversation
  ├── /conversations/:id       GET     — get messages
  ├── /conversations/:id/send  POST    — send message (streaming)
  └── /doubt                   POST    — quick doubt (image + question)

/api/analytics/
  ├── /progress         GET     — topic-wise mastery overview
  ├── /dashboard        GET     — student dashboard data
  ├── /reports          GET     — performance reports
  ├── /study-plan       GET     — AI-generated study plan
  └── /leaderboard      GET     — peer comparison

/api/classrooms/
  ├── /                 GET     — teacher's classrooms / student's enrolled
  ├── /                 POST    — create classroom (teacher)
  ├── /join             POST    — join with code (student)
  ├── /:id              GET     — classroom details
  ├── /:id/assign       POST    — assign exam
  ├── /:id/students     GET     — student list + progress
  └── /:id/reports      GET     — class analytics

/api/admin/
  ├── /scrape-jobs      GET/POST — manage scraping jobs
  ├── /content-review   GET/PUT  — review pending content
  ├── /pipeline-logs    GET      — content pipeline monitoring
  └── /system-config    GET/PUT  — system configuration
```

---

## 9. AI INTEGRATION DETAILS

### 9.1 Provider Configuration (Same as ExamForge)

```typescript
// AI Provider Config
const AI_CONFIG = {
  primary: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 0.3,  // Lower for factual content
  },
  chat: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 2048,
    temperature: 0.7,  // Higher for conversational
  },
  vision: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',  // Vision-capable
  },
  fallback: {
    provider: 'openai',
    model: 'gpt-4o',
  },
  bulk: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',  // Cost-efficient for bulk ops
  }
};
```

### 9.2 AI Use Cases & Prompts

| Use Case | Model | Temperature | Token Budget |
|----------|-------|-------------|-------------|
| Syllabus parsing | Claude Sonnet 4 | 0.1 | 8K |
| Question generation | Claude Sonnet 4 | 0.5 | 4K |
| Question paper OCR | Claude Sonnet 4 (Vision) | 0.1 | 8K |
| Content generation (notes) | Claude Sonnet 4 | 0.3 | 4K |
| Subjective answer grading | Claude Sonnet 4 | 0.2 | 2K |
| Study plan generation | Claude Sonnet 4 | 0.4 | 2K |
| Chat (general) | Claude Sonnet 4 | 0.7 | 2K |
| Doubt resolution | Claude Sonnet 4 (Vision) | 0.3 | 4K |
| Content quality scoring | Claude Haiku 4.5 | 0.1 | 1K |
| Topic tagging (bulk) | Claude Haiku 4.5 | 0.1 | 1K |
| Flashcard generation | Claude Haiku 4.5 | 0.3 | 1K |

---

## 10. KEY ARCHITECTURAL DECISIONS

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary Key Type | BIGINT (not UUID) | Per your requirement; faster indexing, smaller storage, sequential |
| ID Generation | GENERATED ALWAYS AS IDENTITY | PostgreSQL-native, no app-layer ID gen needed |
| ORM | Drizzle ORM | Lighter than Prisma, better raw SQL support, ExamForge-aligned |
| File Storage | AWS S3 (→ Cloudflare R2 for cost) | Same as ExamForge |
| Job Queue | BullMQ on Redis | For scraping, AI processing, file extraction |
| Search | pg_trgm + FTS first → Meilisearch at scale | Start simple, scale later |
| AI Streaming | Server-Sent Events (SSE) | For chat responses, same as ExamForge |
| Content Format | Markdown (stored) + rendered HTML | Universal, easy to edit |
| Multi-language | i18n at content level + UI level | content items have `language` column |
| Caching | Redis/Upstash | Syllabus hierarchy (rarely changes), user sessions |

---

## 11. WHAT TO REUSE FROM EXAMFORGE

| Component | Reuse Level | Adaptation Needed |
|-----------|-------------|-------------------|
| Auth system | 95% | Add phone OTP, parent role |
| Landing page structure | 80% | New branding, education-focused copy |
| AI chat agent | 90% | Add curriculum context injection |
| Exam taking UI | 85% | Add more question types (match, assertion-reason) |
| API routing pattern | 100% | Same tRPC/REST structure |
| CLAUDE.md / config files | 90% | Update for new domain |
| Deployment pipeline | 100% | Same AWS path |
| Error handling | 100% | Same patterns |
| Markdown renderer | 100% | Same component |
| File upload component | 90% | Add OCR processing trigger |

---

## 12. RISK REGISTER & MITIGATIONS

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Syllabus changes mid-year | Content becomes stale | Version syllabi by academic_year; monitor CBSE/board notifications |
| Scraping blocked by boards | No content | Fallback to DIKSHA open API + manual PDF downloads + iDream API |
| AI content accuracy | Wrong answers served | Human verification queue; community flagging; quality_score threshold |
| DPDPA compliance (minor data) | Legal risk | Parental consent flow for <18; data minimization; encryption at rest |
| AI cost at scale | Budget blowout | Use Haiku for bulk ops; cache AI responses; batch processing |
| State board diversity | 28+ different formats | Normalize into unified schema; AI handles format variance |
| Copyright on NCERT content | Legal risk | NCERT is CC BY-NC-SA; attribute properly; don't resell raw content |

---

## 13. IMMEDIATE NEXT STEPS

1. **Confirm project name** (Padvik, StudyForge, CurriculaAI, etc.)
2. **Initialize monorepo** with ExamForge structure (Claude Code)
3. **Run database migrations** for all tables in Section 3
4. **Build CBSE syllabus scraper** as first content pipeline
5. **Port auth system** from ExamForge with BIGINT PKs
6. **Build syllabus explorer UI** — the core navigation experience
7. **Set up S3 bucket** for file uploads
8. **Create AI prompt library** for all use cases in Section 9.2

---

*This document is the foundation. Each section will expand into detailed specs as we build. Your input on priorities, naming, and feature ordering will shape the next iteration.*
