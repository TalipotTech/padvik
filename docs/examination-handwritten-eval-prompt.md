# Padvik — Examination & Handwritten Answer Evaluation System
## Claude Code Implementation Prompt

---

## CONTEXT

Read existing code first:
- `src/db/schema/` — all tables (questions, exams, etc. if from ExamForge)
- `src/lib/ai/provider.ts` — existing 6-provider AI router (DO NOT modify)
- `src/lib/document-parser/` — existing document parser
- `src/lib/s3.ts` — existing S3 utilities

DO NOT modify existing files unless explicitly stated.
BIGINT PKs, Drizzle ORM, Zod validation. Purple theme.

This system is modeled after ExamForge's exam engine but adapted 
for K-12 board exam preparation with handwritten answer evaluation.

---

## WHAT THIS SYSTEM DOES

1. Students practice with board-style test papers
2. They can answer on screen (typed) OR write on paper and upload photos
3. AI evaluates handwritten answers with detailed marks and feedback
4. Everything is FREE — this is the engagement hook that drives daily visits
5. Covers every board, grade, subject with exam-pattern-accurate papers

---

## STEP 1: Database Schema

Create NEW file: `src/db/schema/examinations.ts`

```
-- Question bank
question_bank
  id                BIGINT PK GENERATED ALWAYS AS IDENTITY
  board_id          BIGINT REFERENCES boards(id) NOT NULL
  standard_id       BIGINT REFERENCES standards(id) NOT NULL
  subject_id        BIGINT REFERENCES subjects(id) NOT NULL
  chapter_id        BIGINT REFERENCES chapters(id)
  topic_id          BIGINT REFERENCES topics(id)
  
  question_text     TEXT NOT NULL
  question_html     TEXT                        -- rendered version with formatting
  question_blocks   JSONB                       -- ContentBlock[] for rich rendering
  question_images   JSONB DEFAULT '[]'          -- [{url, alt}]
  
  question_type     VARCHAR(30) NOT NULL
                    -- 'mcq' | 'fill_blank' | 'true_false' | 'short_answer' |
                    -- 'long_answer' | 'numerical' | 'assertion_reason' |
                    -- 'case_study' | 'match_columns' | 'diagram'
  
  -- For MCQ/True-False
  options           JSONB                       -- [{id, text, isCorrect}]
  correct_answer    TEXT                        -- for fill_blank, short_answer
  
  -- For all types
  solution          TEXT                        -- detailed step-by-step solution
  solution_blocks   JSONB                       -- ContentBlock[] for rich solution
  marks             SMALLINT DEFAULT 1
  difficulty        VARCHAR(10) DEFAULT 'medium' -- 'easy' | 'medium' | 'hard'
  bloom_level       VARCHAR(20)                 -- 'remember' | 'understand' | 'apply' |
                                                -- 'analyze' | 'evaluate' | 'create'
  
  -- Exam pattern metadata
  is_from_paper     BOOLEAN DEFAULT FALSE       -- extracted from real board paper
  paper_year        SMALLINT                    -- 2024, 2025, etc.
  paper_source      VARCHAR(200)                -- "CBSE 2024 Set 1"
  frequency_score   DECIMAL(3,2)                -- how often this type appears (0-1)
  
  -- AI generation metadata
  is_ai_generated   BOOLEAN DEFAULT FALSE
  generation_model  VARCHAR(50)
  
  -- Rubric for subjective evaluation
  marking_rubric    JSONB                       -- for AI grading handwritten answers
                    -- { criteria: [{name, maxMarks, description}], 
                    --   keywords: [], acceptableVariations: [] }
  
  tags              TEXT[] DEFAULT '{}'
  language          VARCHAR(10) DEFAULT 'en'
  is_active         BOOLEAN DEFAULT TRUE
  created_at        TIMESTAMPTZ DEFAULT NOW()
  updated_at        TIMESTAMPTZ DEFAULT NOW()

Indexes:
  - (board_id, standard_id, subject_id, is_active)
  - (chapter_id, difficulty)
  - (topic_id)
  - (question_type, difficulty)
  - (is_from_paper, paper_year)
  - GIN on tags


-- Test papers (pre-built exam-format papers)
test_papers
  id                BIGINT PK GENERATED ALWAYS AS IDENTITY
  title             VARCHAR(500) NOT NULL        -- "CBSE Class 10 Science Sample Paper 2026"
  slug              VARCHAR(500)
  board_id          BIGINT REFERENCES boards(id) NOT NULL
  standard_id       BIGINT REFERENCES standards(id) NOT NULL
  subject_id        BIGINT REFERENCES subjects(id) NOT NULL
  
  paper_type        VARCHAR(30) NOT NULL
                    -- 'full_paper' | 'half_paper' | 'chapter_test' | 'topic_exercise' |
                    -- 'previous_year' | 'sample_paper' | 'practice_set'
  
  total_marks       SMALLINT NOT NULL
  duration_minutes  SMALLINT NOT NULL            -- exam time limit
  
  -- Structure matches actual board paper format
  sections          JSONB NOT NULL
                    -- [{
                    --   name: "Section A",
                    --   instructions: "Answer all questions. Each carries 1 mark.",
                    --   questionIds: [bigint[]],
                    --   marksPerQuestion: 1,
                    --   totalMarks: 20,
                    --   questionType: "mcq"
                    -- }]
  
  instructions      TEXT                         -- general exam instructions
  
  -- Access control
  is_free            BOOLEAN DEFAULT TRUE        -- FREE for engagement
  is_published       BOOLEAN DEFAULT FALSE
  published_at       TIMESTAMPTZ
  
  -- Stats
  attempt_count      BIGINT DEFAULT 0
  avg_score_percent  DECIMAL(5,2)
  avg_time_minutes   DECIMAL(6,1)
  
  -- Generation
  is_ai_generated    BOOLEAN DEFAULT FALSE
  generation_model   VARCHAR(50)
  
  created_at         TIMESTAMPTZ DEFAULT NOW()
  updated_at         TIMESTAMPTZ DEFAULT NOW()

Indexes:
  - (board_id, standard_id, subject_id, paper_type, is_published)
  - (paper_type, is_free)


-- Student exam attempts
exam_attempts
  id                BIGINT PK GENERATED ALWAYS AS IDENTITY
  student_id        BIGINT REFERENCES users(id) NOT NULL
  paper_id          BIGINT REFERENCES test_papers(id) NOT NULL
  
  status            VARCHAR(20) DEFAULT 'in_progress'
                    -- 'in_progress' | 'submitted' | 'evaluating' | 'evaluated'
  
  started_at        TIMESTAMPTZ DEFAULT NOW()
  submitted_at      TIMESTAMPTZ
  evaluated_at      TIMESTAMPTZ
  time_taken_secs   INT
  
  -- Scoring
  total_marks_obtained  DECIMAL(6,2)
  total_marks_possible  SMALLINT
  percentage            DECIMAL(5,2)
  grade                 VARCHAR(5)               -- A1, A2, B1, B2, C1, C2, D, E
  
  -- Answer mode
  answer_mode       VARCHAR(20) DEFAULT 'typed'
                    -- 'typed' | 'handwritten' | 'mixed'
  
  -- Section-wise results
  section_results   JSONB                        -- [{sectionName, marksObtained, totalMarks}]
  
  -- Feedback
  ai_feedback       TEXT                         -- overall AI feedback
  strengths         TEXT[] DEFAULT '{}'           -- topics student was strong in
  weaknesses        TEXT[] DEFAULT '{}'           -- topics needing improvement
  
  metadata          JSONB DEFAULT '{}'
  created_at        TIMESTAMPTZ DEFAULT NOW()

Indexes:
  - (student_id, status, created_at DESC) — "My Exams"
  - (paper_id, status) — paper attempt stats
  - (student_id, paper_id) — check if already attempted


-- Individual question responses
exam_responses
  id                BIGINT PK GENERATED ALWAYS AS IDENTITY
  attempt_id        BIGINT REFERENCES exam_attempts(id) ON DELETE CASCADE NOT NULL
  question_id       BIGINT REFERENCES question_bank(id) NOT NULL
  section_name      VARCHAR(50)
  
  -- Student's answer
  answer_type       VARCHAR(20) NOT NULL
                    -- 'selected_option' | 'typed_text' | 'handwritten_image'
  
  selected_option   VARCHAR(5)                   -- 'A','B','C','D' for MCQ
  typed_answer      TEXT                         -- for typed subjective answers
  
  -- Handwritten answer upload
  handwritten_images JSONB DEFAULT '[]'          -- [{url, pageNumber}]
  ocr_text          TEXT                         -- AI-extracted text from handwriting
  
  -- Evaluation
  is_correct        BOOLEAN                      -- for objective questions
  marks_obtained    DECIMAL(4,1) DEFAULT 0
  marks_possible    SMALLINT NOT NULL
  
  -- AI evaluation details (for subjective/handwritten)
  ai_evaluation     JSONB
                    -- {
                    --   extractedAnswer: "student's answer as read by AI",
                    --   criteriaScores: [{criterion, score, maxScore, comment}],
                    --   overallComment: "Good attempt but missed...",
                    --   suggestedImprovement: "Next time, include the formula...",
                    --   confidence: 0.85
                    -- }
  
  -- Timing
  time_spent_secs   INT
  answered_at       TIMESTAMPTZ
  
  created_at        TIMESTAMPTZ DEFAULT NOW()

Indexes:
  - (attempt_id, question_id) UNIQUE
  - (question_id, is_correct) — question difficulty analysis
```

Generate and run migration.


---

## STEP 2: Question Generation

Create NEW file: `src/lib/examination/generate-questions.ts`

```typescript
async function generateQuestions(options: {
  boardId: bigint,
  standardId: bigint,
  subjectId: bigint,
  chapterId?: bigint,
  topicId?: bigint,
  questionType: QuestionType,
  difficulty: 'easy' | 'medium' | 'hard',
  count: number,
  language?: string,
}): Promise<GeneratedQuestion[]>
```

AI PROMPT (use existing provider, task = 'generate_questions'):

SYSTEM:
"You are an expert question paper setter for Indian board examinations.
You create questions that exactly match the pattern, difficulty, and
marking scheme of actual board exam papers.

RULES:
- Match the EXACT format of {board} board papers
- For CBSE: follow CBSE marking scheme and question types
- Include marking rubric for subjective questions
- For numericals: provide full step-by-step solution
- For diagrams: describe the diagram in detail for SVG generation
- Tag each question with Bloom's taxonomy level
- Include common mistakes students make (for AI grading reference)
- Specify keywords and acceptable answer variations for grading

OUTPUT — JSON array:
[{
  questionText: 'text with LaTeX for formulas',
  questionType: 'mcq|short_answer|long_answer|numerical|...',
  options: [{id:'A', text:'...', isCorrect: bool}],  // for MCQ only
  correctAnswer: 'for fill_blank/short_answer',
  solution: 'step-by-step solution text',
  marks: number,
  difficulty: 'easy|medium|hard',
  bloomLevel: 'remember|understand|apply|analyze',
  markingRubric: {
    criteria: [{name:'Correct formula', maxMarks:1, description:'...'}],
    keywords: ['ohm', 'resistance', 'V=IR'],
    acceptableVariations: ['V equals IR', 'voltage = current × resistance'],
    commonMistakes: ['Confusing V and I', 'Wrong unit for resistance']
  }
}]"


---

## STEP 3: Test Paper Generator

Create NEW file: `src/lib/examination/generate-paper.ts`

```typescript
async function generateTestPaper(options: {
  boardId: bigint,
  standardId: bigint,
  subjectId: bigint,
  paperType: PaperType,
  chapterIds?: bigint[],     // for chapter tests
  topicIds?: bigint[],       // for topic exercises
}): Promise<{ paperId: bigint }>
```

Logic:

1. DETERMINE PAPER STRUCTURE based on board and paper type:

   CBSE Class 10 Science Full Paper:
   - Section A: 16 MCQs × 1 mark = 16 marks
   - Section B: 6 assertion-reason × 1 mark = 6 marks  
   - Section C: 6 short answers × 2 marks = 12 marks
   - Section D: 6 short answers × 3 marks = 18 marks
   - Section E: 3 long answers × 5 marks = 15 marks
   - Section F: 3 case-study × 4 marks = 12 marks
   Total: 80 marks, 180 minutes

   CBSE Class 10 Maths Full Paper:
   - Section A: 20 MCQs × 1 mark = 20 marks
   - Section B: 5 questions × 2 marks = 10 marks
   - Section C: 6 questions × 3 marks = 18 marks
   - Section D: 4 questions × 5 marks = 20 marks
   - Section E: 3 case-study × 4 marks = 12 marks
   Total: 80 marks, 180 minutes

   Kerala SSLC Science:
   (define based on Kerala board pattern)

   Half Paper: 50% of full paper marks, 90 minutes
   Chapter Test: 10-15 questions from specific chapters, 30 minutes
   Topic Exercise: 5-10 questions from one topic, 15 minutes

2. FILL SECTIONS with questions:
   For each section:
   a. First: pull from question_bank (existing questions matching criteria)
   b. If not enough questions: generate new ones via AI
   c. Ensure chapter/topic coverage is balanced
   d. Ensure difficulty distribution: 30% easy, 50% medium, 20% hard
   e. For previous_year type: weight questions by frequency_score
      (topics that appear most often in board papers get more questions)

3. CREATE test_papers row with sections JSON

4. For 'previous_year' papers: reconstruct from extracted question_bank
   entries where is_from_paper = true


---

## STEP 4: Exam Taking Flow

### API Endpoints

```
GET /api/exams/papers
  Query: boardId, standardId, subjectId, paperType, isFree
  Returns: paginated list of available test papers
  Filter: is_published = true

GET /api/exams/papers/[paperId]
  Returns: paper details + sections (question IDs, not full questions yet)

POST /api/exams/papers/[paperId]/start
  Student auth. Start an exam attempt.
  Creates exam_attempts row with status = 'in_progress'
  Returns: { attemptId, questions (full question data), duration }
  
  Logic:
  - Check if student has an in-progress attempt for this paper
    If yes: resume it (return existing attempt with saved answers)
  - Shuffle question order within each section (optional, configurable)
  - For MCQ: shuffle option order
  - Start the timer

POST /api/exams/attempts/[attemptId]/answer
  Student auth. Save an answer (auto-save, called frequently).
  Body: {
    questionId: bigint,
    answerType: 'selected_option' | 'typed_text',
    selectedOption?: string,
    typedAnswer?: string,
    timeSpentSecs?: number
  }
  Upserts exam_responses row.
  Does NOT evaluate yet — just saves.

POST /api/exams/attempts/[attemptId]/upload-handwritten
  Student auth. Upload handwritten answer pages.
  Multipart form: questionId + image files (JPG/PNG, max 10MB each)
  
  Logic:
  1. Validate images (format, size)
  2. Upload to S3: exams/{attemptId}/{questionId}/page-{n}.jpg
  3. Optimize images via sharp:
     - Resize to max 2000px wide (preserve aspect)
     - Increase contrast slightly for better OCR
     - Convert to JPEG quality 85
  4. Create/update exam_responses with handwritten_images array
  5. Set answer_type = 'handwritten_image'
  
  Students can upload multiple pages per question (multi-page answers).
  They can also upload one image containing answers to multiple questions
  (the AI will parse and split later).

POST /api/exams/attempts/[attemptId]/submit
  Student auth. Submit the exam for evaluation.
  Sets status = 'submitted', submitted_at = now()
  Calculates time_taken_secs
  Queues evaluation job.
  Returns: { message: "Your exam has been submitted. Evaluation will 
  be ready in 2-5 minutes." }
```

---

## STEP 5: Handwritten Answer Evaluation (THE KEY FEATURE)

Create NEW file: `src/lib/examination/evaluate-handwritten.ts`

```typescript
async function evaluateHandwrittenAnswer(
  responseId: bigint,
  questionId: bigint,
  handwrittenImages: string[],  // S3 URLs
  question: QuestionBankRow,
): Promise<EvaluationResult>
```

This is the most important function. It takes photos of a student's 
handwritten answer and evaluates it like a teacher would.

IMPLEMENTATION:

Step 1 — OCR the handwritten images:

Send each image to AI Vision (use existing provider with task = 'ocr_english'
or 'ocr_indic' based on language):

PROMPT:
"You are reading a student's handwritten exam answer sheet.
Extract ALL text from this image exactly as written.

RULES:
- Preserve the student's exact wording (including mistakes)
- For mathematical formulas, convert to LaTeX
- For diagrams drawn by student, describe what's drawn:
  [DIAGRAM: student drew a circuit with battery, resistor, and ammeter in series]
- For tables, extract as structured data
- If handwriting is unclear, write [UNCLEAR: best guess]
- Preserve line breaks and paragraph structure
- Note any crossed-out text as [CROSSED OUT: text]

Return the extracted text as plain text with LaTeX where applicable."

Store the OCR result in exam_responses.ocr_text

Step 2 — Evaluate the answer:

Send the extracted answer + original question + rubric to AI:

SYSTEM:
"You are an experienced {board} board exam evaluator. You are grading
a Class {standard} {subject} answer paper.

You MUST follow the official marking scheme. Be fair but strict.
Award marks for correct steps even if the final answer is wrong
(step marking). Deduct for conceptual errors. Give partial marks
where appropriate.

Grade according to this rubric:
{question.markingRubric}

You are evaluating a HANDWRITTEN answer. The OCR may have errors.
Be lenient about OCR artifacts but strict about content accuracy."

USER:
"QUESTION ({marks} marks):
{question.questionText}

EXPECTED ANSWER / SOLUTION:
{question.solution}

MARKING RUBRIC:
{JSON.stringify(question.markingRubric)}

STUDENT'S ANSWER (extracted from handwriting):
{ocrText}

{IF student drew a diagram: 'Student also drew a diagram: [description]'}

Evaluate this answer. Return JSON:
{
  extractedAnswer: 'cleaned up version of what student wrote',
  marksObtained: number (0 to {marks}),
  marksBreakdown: [
    { criterion: 'Correct formula stated', maxMarks: 1, awarded: 1, comment: 'V=IR correctly stated' },
    { criterion: 'Correct substitution', maxMarks: 1, awarded: 0.5, comment: 'Partially correct, used wrong unit' },
    { criterion: 'Final answer with unit', maxMarks: 1, awarded: 0, comment: 'Final answer missing' }
  ],
  overallComment: '2-3 sentence feedback on the answer quality',
  suggestedImprovement: 'specific actionable advice for next time',
  conceptualErrors: ['list of misconceptions detected'],
  confidence: 0.0-1.0 (how confident AI is in the evaluation)
}"

Step 3 — Handle edge cases:

- If confidence < 0.5: flag for human review (don't auto-grade)
- If OCR extracted very little text: ask student to re-upload clearer image
- If student uploaded a blank image: marks = 0, comment = "No answer detected"
- If student answered a different question: marks = 0, flag, explain
- For diagram questions: evaluate the diagram description from OCR step

Step 4 — Store results:

Update exam_responses:
- ocr_text = extracted text
- marks_obtained = AI's marks
- ai_evaluation = full JSON evaluation
- is_correct = (marks_obtained == marks_possible)


---

## STEP 6: Full Exam Evaluation Orchestrator

Create NEW file: `src/lib/examination/evaluate-attempt.ts`

```typescript
async function evaluateExamAttempt(attemptId: bigint): Promise<void>
```

Called when student submits. Runs as BullMQ job.

Logic:

1. Set exam_attempts.status = 'evaluating'

2. Fetch all exam_responses for this attempt

3. For each response:

   IF answer_type == 'selected_option' (MCQ/True-False):
     - Compare with question.options[].isCorrect
     - Set is_correct, marks_obtained (instant, no AI needed)

   IF answer_type == 'typed_text' (short/long answer):
     - For short answers with exact match: compare directly
     - For subjective: send to AI for evaluation (same as handwritten 
       but without OCR step — text is already clean)

   IF answer_type == 'handwritten_image':
     - Call evaluateHandwrittenAnswer()
     - This does OCR + evaluation

4. After ALL responses are evaluated:

   Calculate totals:
   - total_marks_obtained = SUM(marks_obtained)
   - percentage = total_marks_obtained / total_marks_possible × 100
   - grade = calculateGrade(percentage, board)
   - section_results = group by section

   Grade mapping (CBSE pattern):
   91-100 → A1, 81-90 → A2, 71-80 → B1, 61-70 → B2,
   51-60 → C1, 41-50 → C2, 33-40 → D, <33 → E

5. Generate overall feedback via AI:

   PROMPT:
   "Based on this student's exam performance, provide brief feedback:
   Subject: {subject}, Class: {standard}
   Score: {marks}/{total} ({percentage}%)
   Strong sections: {sections where score > 70%}
   Weak sections: {sections where score < 40%}
   
   Return JSON:
   {
     overallFeedback: '3-4 sentences of encouraging but honest feedback',
     strengths: ['topic1', 'topic2'],
     weaknesses: ['topic3', 'topic4'],
     studyPlan: 'Brief suggestion for what to focus on next'
   }"

6. Update exam_attempts:
   status = 'evaluated', evaluated_at = now()
   Set all calculated fields.

7. Update student_progress for each topic covered:
   - If student scored > 70% on questions for a topic: mastery up
   - If scored < 40%: flag as weak area
   - Feed into demand signals for auto-content generation


---

## STEP 7: BullMQ Jobs

```
Job: 'evaluate-exam'
  Data: { attemptId: bigint }
  Handler: evaluateExamAttempt(attemptId)
  Retry: 3 attempts
  Timeout: 10 minutes (handwritten evaluation can be slow)

Job: 'generate-weekly-papers'
  Cron: '0 5 * * 0' (Sunday 5 AM)
  Handler: generate new test papers for top-demand board/subject combos
  - 2 full papers per active board/class/subject combo
  - Only if < 3 unused papers exist for that combo
  - Limit: 20 papers per week

Job: 'import-previous-papers'
  Manual trigger only.
  Data: { filePath, board, standard, subject, year }
  Handler: parse uploaded question paper → extract questions → 
  store in question_bank with is_from_paper = true
```

---

## STEP 8: API — Results & Analytics

```
GET /api/exams/attempts/[attemptId]/result
  Student auth (must be their attempt). 
  Only available when status = 'evaluated'.
  Returns: {
    paper: { title, totalMarks, duration },
    score: { obtained, total, percentage, grade },
    sectionResults: [...],
    responses: [{
      question: { text, marks, type },
      studentAnswer: { typed or OCR text },
      evaluation: { marksObtained, breakdown, comment },
      solution: { correct answer, steps }
    }],
    feedback: { overall, strengths, weaknesses, studyPlan },
    comparisonStats: { 
      averageScore: all students average on this paper,
      yourRank: percentile rank,
      topScore: highest score achieved
    }
  }

GET /api/exams/my-attempts
  Student auth. All their exam attempts.
  Query: status?, subjectId?, limit?, offset?
  Returns: paginated list with scores and dates.

GET /api/exams/performance
  Student auth. Performance analytics:
  - Score trend over time (chart data)
  - Subject-wise average scores
  - Weak topics (sorted by lowest scores)
  - Improvement suggestions
  - Exams attempted this week/month
```

---

## STEP 9: Frontend Pages

```
src/app/(dashboard)/exams/page.tsx — Exam hub
  - "Start Practice" section: paper type cards
    (Full Paper, Half Paper, Chapter Test, Quick Exercise)
  - Board/class/subject selector
  - List of available papers with difficulty, marks, duration
  - "My Results" tab: past attempts with scores

src/app/(dashboard)/exams/[paperId]/page.tsx — Exam details
  - Paper info: title, marks, duration, sections breakdown
  - "Start Exam" button → creates attempt, navigates to exam screen
  - Previous attempts on this paper (if any)

src/app/(dashboard)/exams/attempt/[attemptId]/page.tsx — Exam screen
  FULL SCREEN exam interface (hide sidebar, header):
  - Timer (countdown from paper duration)
  - Question navigation panel (sidebar with question numbers)
  - Question display area (center)
  - Answer area:
    For MCQ: radio buttons
    For typed: textarea with auto-save (debounced 2 seconds)
    For handwritten: "Upload Handwritten Answer" button
      → camera capture (on mobile) or file upload
      → preview thumbnails of uploaded pages
      → "Add more pages" button
  - Question status indicators:
    ⬜ Not visited, 🟡 Visited not answered, 🟢 Answered, 📷 Uploaded
  - "Submit Exam" button (with confirmation dialog)
  - Auto-save every 30 seconds
  
  IMPORTANT UX:
  - Timer is prominent but not stressful (no red flashing until last 5 min)
  - Allow navigation between questions freely
  - Show "Question X of Y" with marks
  - Mobile-first: question on top, answer below, nav at bottom
  - Camera button for handwritten should be ONE TAP (no complex flow)

src/app/(dashboard)/exams/attempt/[attemptId]/result/page.tsx — Results
  - Score card at top: marks, percentage, grade (large, celebratory if good)
  - Section-wise breakdown bar chart
  - Question-by-question review:
    For each question:
    - Question text
    - Student's answer (typed text or handwritten image thumbnail)
    - AI evaluation: marks breakdown with criteria
    - Correct answer / solution (collapsible)
    - "I disagree with this marking" button (flags for review)
  - AI feedback section: overall comment, strengths, weaknesses
  - "Practice weak topics" button → links to explainer/exercises
  - "Share score" button → shareable image card for WhatsApp
  
  HANDWRITTEN ANSWER DISPLAY:
  - Show the uploaded image(s) of student's handwriting
  - Next to it: show the OCR-extracted text (so student sees what AI read)
  - Below: show marks breakdown per criterion
  - If AI confidence < 0.5: show "This evaluation needs human review" badge

src/app/(dashboard)/exams/analytics/page.tsx — Performance dashboard
  - Score trend line chart (last 10 attempts)
  - Subject-wise radar chart
  - Weak topics table with links to study material
  - "Exams this week" streak counter
  - Comparison with class average (if in a classroom)
```

---

## STEP 10: Shareable Score Card

When student completes an exam, generate a shareable image:

```
┌──────────────────────────────────────┐
│  📚 PADVIK                           │
│                                      │
│  Arjun scored                        │
│  ██████████████░░  72/80             │
│           90% — Grade A1             │
│                                      │
│  CBSE Class 10 Science               │
│  Full Practice Paper                 │
│                                      │
│  🏆 Top 15% among Padvik students    │
│                                      │
│  Practice FREE at padvik.com         │
└──────────────────────────────────────┘
```

Generate as PNG (400x600) using SVG → sharp.
Student shares on WhatsApp → friends visit padvik.com → viral loop.

```
POST /api/exams/attempts/[attemptId]/share-card
  Returns: { imageUrl: S3 URL of generated card }
```

---

## STEP 11: Environment Variables

```
# Examination system
EXAM_EVALUATION_TIMEOUT=600          # seconds, for handwritten eval
EXAM_AUTO_SUBMIT_BUFFER=60           # seconds after timer expires
MAX_HANDWRITTEN_PAGES=10             # per question
MAX_HANDWRITTEN_IMAGE_SIZE=10485760  # 10MB per image
```

---

## ENGAGEMENT STRATEGY: Why This Drives Daily Visits

1. ALL exam features are FREE — no paywall on practice papers
2. New papers generated weekly → always fresh content
3. Handwritten evaluation is the killer feature — no other free 
   platform does this. Students write on paper (how they'll write 
   in actual board exams) and get instant AI grading.
4. Score cards shared on WhatsApp drive organic signups
5. Weak topic detection → links to Padvik study material (text/audio/video)
   → drives subscription for premium content
6. The exam system is the HOOK. The content/creator platform is the PRODUCT.

---

## VERIFICATION

1. pnpm build — no errors
2. Question generation produces valid, board-appropriate questions
3. Test paper structure matches actual board paper format
4. MCQ auto-grading works instantly
5. Handwritten image upload via camera works on mobile
6. OCR extracts readable text from handwritten images
7. AI evaluation produces fair marks with detailed rubric breakdown
8. Results page shows question-by-question review
9. Shareable score card generates correctly
10. Timer works with auto-save and auto-submit
11. Performance analytics calculate correctly
12. Weak topics feed back into study recommendations
