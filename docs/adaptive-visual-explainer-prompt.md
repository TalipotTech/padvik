# Padvik — Adaptive Visual Topic Explainer
## "Explain Like I'm Struggling" — AI that sees you're stuck and adapts

---

## THE CORE IDEA

This is NOT a slideshow or a PowerPoint generator. Those are static, linear, 
and the student either gets it or they don't.

This is a **live visual conversation** between the AI and the student. 
The AI generates one visual explanation card at a time. The student either:
- Gets it → moves to the next concept (deeper)
- Doesn't get it → taps "Explain differently" → AI generates a simpler 
  version with a different approach (analogy, real-world example, diagram)
- Has a specific doubt → types a question → AI generates a targeted 
  visual answer addressing exactly that confusion

The UI is a vertical scroll of cards — like an Instagram story meets a 
textbook meets a tutor. Each card is one atomic concept with one visual. 
Clean. Focused. Not overwhelming.

---

## HOW IT FEELS TO THE STUDENT

```
Student opens: CBSE Class 10 > Physics > Chapter 12 > Ohm's Law

┌──────────────────────────────────────────────┐
│  Ohm's Law                          1 of 5   │
│  ─────────────────────────────────────────── │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │                                          │ │
│  │   [SVG: Simple circuit diagram]          │ │
│  │   Battery → Wire → Resistor → Back       │ │
│  │                                          │ │
│  │   V = I × R                              │ │
│  │                                          │ │
│  │   Think of it like a water pipe:         │ │
│  │   • Voltage = water pressure             │ │
│  │   • Current = how much water flows       │ │
│  │   • Resistance = how narrow the pipe is  │ │
│  │                                          │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│  ┌──────────┐  ┌──────────────┐  ┌─────────┐│
│  │ Got it ✓ │  │ Explain more │  │ Ask a ? ││
│  └──────────┘  └──────────────┘  └─────────┘│
└──────────────────────────────────────────────┘

Student taps "Explain more" →

┌──────────────────────────────────────────────┐
│  Ohm's Law — Another way to see it   1b      │
│  ─────────────────────────────────────────── │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │                                          │ │
│  │   [SVG: Water pipe analogy diagram]      │ │
│  │   Wide pipe = low resistance = more flow │ │
│  │   Narrow pipe = high resistance = less   │ │
│  │                                          │ │
│  │   Real example from your house:          │ │
│  │   When you half-close a tap (↑ R),       │ │
│  │   less water comes out (↓ I),            │ │
│  │   but the pressure in the pipe stays     │ │
│  │   the same (V constant).                 │ │
│  │                                          │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│  ┌──────────┐  ┌──────────────┐  ┌─────────┐│
│  │ Got it ✓ │  │ Still stuck  │  │ Ask a ? ││
│  └──────────┘  └──────────────┘  └─────────┘│
└──────────────────────────────────────────────┘

Student taps "Got it ✓" → moves to card 2 of 5 (next concept)

Student types a question: "But what happens if resistance is zero?"

┌──────────────────────────────────────────────┐
│  Your question                        ↳ 1c   │
│  ─────────────────────────────────────────── │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │                                          │ │
│  │   [SVG: Circuit with R=0, showing short  │ │
│  │    circuit with sparks/danger symbol]     │ │
│  │                                          │ │
│  │   If R = 0, then V = I × 0              │ │
│  │   So I → ∞ (infinite current!)           │ │
│  │                                          │ │
│  │   This is called a SHORT CIRCUIT.        │ │
│  │   The wire gets very hot, melts, or      │ │
│  │   causes a fire. That's why we have      │ │
│  │   FUSES — they break the circuit         │ │
│  │   before damage happens.                 │ │
│  │                                          │ │
│  │   🔗 This connects to Chapter 13:        │ │
│  │   "Domestic Electric Circuits"            │ │
│  │                                          │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│  ┌──────────┐  ┌──────────────┐  ┌─────────┐│
│  │ Got it ✓ │  │ Explain more │  │ Ask a ? ││
│  └──────────┘  └──────────────┘  └─────────┘│
└──────────────────────────────────────────────┘
```

---

## THE THREE LAYERS

### Layer 1: Pre-generated Topic Deck (cached, instant)
For each topic in the syllabus, pre-generate a 3-7 card deck at 
three difficulty levels. This is done in bulk by a background job — 
NOT in real time. When a student opens a topic, the deck loads instantly.

**Level 1 — Foundation (Class below):**
  Explains using only concepts from previous classes. 
  Simple language. Everyday analogies.
  "Imagine voltage is like pushing a ball down a slide..."

**Level 2 — Standard (Grade level):**
  Matches the board's textbook difficulty. Uses NCERT-style language 
  and examples. Covers exactly what the exam expects.
  "Ohm's Law states that V = IR, where..."

**Level 3 — Advanced (Challenge):**
  Goes deeper. Real-world applications, edge cases, connections to 
  other chapters, JEE/NEET level thinking.
  "Consider a non-ohmic conductor where V-I is nonlinear..."

Student starts at Level 2 (their grade). If they tap "Explain more" 
repeatedly, the system drops to Level 1. If they breeze through 
with "Got it" on every card, it offers Level 3.

### Layer 2: Adaptive Re-explanation (generated on demand)
When the student taps "Explain more" or "Still stuck" after seeing 
both Level 2 and Level 1, the AI generates a FRESH explanation in 
real time. This is not from the cache — it's a new take.

The AI knows:
- Which cards the student already saw (don't repeat)
- Which approach was used (analogy? diagram? formula? example?)
- Use a DIFFERENT approach this time
- The student's board, class, language preference

Strategy rotation for re-explanations:
1st re-explain: Real-world analogy (water pipes, roads, cooking)
2nd re-explain: Visual diagram with labels
3rd re-explain: Step-by-step numerical example
4th re-explain: Compare with something they already know from a previous chapter
5th re-explain: "Let's try a question together" — guided problem solving

### Layer 3: Conversational Q&A (fully real-time)
When the student types a specific question, the AI generates a 
targeted visual answer. This is the Ask AI tutor but embedded 
WITHIN the topic explainer context. The AI knows exactly where 
the student is in the topic and what they've already seen.

---

## VISUAL FORMAT: React Cards (NOT slides, NOT images)

Each explanation card is a **React component rendered inline** — 
NOT a PNG/JPG image, NOT a PowerPoint slide. This gives us:

- SVG diagrams that scale perfectly on any screen
- LaTeX math rendering (via KaTeX)
- Animated transitions (elements appearing step by step)
- Interactive elements (tap to reveal, drag to explore)
- Instant loading (no image download)
- Dark mode support
- Accessibility (screen readers can read the text)

The AI generates structured JSON, and the frontend renders it as 
a beautiful card. The AI does NOT generate raw HTML/SVG — it generates 
a card spec, and the UI component renders it.

### Card Schema:

```typescript
type ExplainerCard = {
  id: string
  topicId: bigint
  level: 1 | 2 | 3
  position: number                    // card 1, 2, 3... in sequence
  variant: string                     // 'a', 'b', 'c' for re-explanations

  title: string                       // "Ohm's Law"
  subtitle?: string                   // "The relationship between V, I, and R"

  // Content blocks — rendered in order
  blocks: ContentBlock[]

  // Navigation
  nextAction: 'got_it' | 'explain_more' | 'ask_question'
  relatedTopics?: { topicId: bigint, title: string }[]
  
  // Metadata
  approach: string                    // 'analogy' | 'diagram' | 'numerical' | 
                                      // 'comparison' | 'guided_problem' | 'real_world'
  estimatedReadTime: number           // seconds
  generatedAt: Date
  isPreGenerated: boolean             // true = cached, false = real-time
}

type ContentBlock =
  | { type: 'text', content: string }                    // markdown text
  | { type: 'heading', content: string }
  | { type: 'formula', latex: string }                   // rendered via KaTeX
  | { type: 'diagram', svg: string }                     // inline SVG
  | { type: 'image', url: string, alt: string }          // referenced image
  | { type: 'callout', variant: 'tip' | 'warning' | 'remember' | 'example',
      content: string }
  | { type: 'comparison', left: string, right: string,   // side-by-side
      leftLabel: string, rightLabel: string }
  | { type: 'steps', items: string[] }                   // numbered steps
  | { type: 'interactive_reveal', prompt: string,         // tap to reveal
      answer: string }
  | { type: 'quick_check', question: string,              // inline MCQ
      options: string[], correctIndex: number,
      explanation: string }
  | { type: 'analogy', source: string, target: string,   // X is like Y
      mapping: { from: string, to: string }[] }
  | { type: 'animation', frames: { svg: string,          // step-by-step animation
      caption: string }[], autoPlay?: boolean }
```

---

## IMPLEMENTATION

### CLAUDE CODE PROMPT

```
Read the existing code:
- src/db/schema/ — all tables
- src/lib/ai/provider.ts — existing AI provider (DO NOT modify)
- src/components/ — existing UI components

I need an adaptive visual topic explainer feature. When a student 
opens a topic, they see a sequence of explanation cards with visuals. 
Each card explains one atomic concept. The student either "gets it" 
(next card) or "wants more" (AI generates alternative explanation).

=== STEP 1: Database ===

Create NEW file: src/db/schema/explainers.ts

topic_explainer_decks
  id                BIGINT PK GENERATED ALWAYS AS IDENTITY
  topic_id          BIGINT REFERENCES topics(id) NOT NULL
  board_id          BIGINT REFERENCES boards(id)
  standard_id       BIGINT REFERENCES standards(id)
  subject_id        BIGINT REFERENCES subjects(id)
  level             SMALLINT NOT NULL         -- 1=foundation, 2=standard, 3=advanced
  cards_json        JSONB NOT NULL            -- array of ExplainerCard
  card_count        SMALLINT
  total_read_time   INT                       -- estimated total seconds
  language          VARCHAR(10) DEFAULT 'en'
  generation_model  VARCHAR(50)               -- which AI model generated this
  generation_cost   DECIMAL(6,4)              -- USD cost to generate
  quality_score     DECIMAL(3,2)              -- AI self-rating 0-1
  view_count        BIGINT DEFAULT 0
  avg_completion    DECIMAL(3,2) DEFAULT 0    -- what % of cards students complete
  created_at        TIMESTAMPTZ DEFAULT NOW()
  updated_at        TIMESTAMPTZ DEFAULT NOW()
  UNIQUE(topic_id, level, language)

Indexes:
  - (topic_id, level, language)
  - (subject_id, standard_id, level)

student_explainer_progress
  id                BIGINT PK GENERATED ALWAYS AS IDENTITY
  student_id        BIGINT REFERENCES users(id) NOT NULL
  topic_id          BIGINT REFERENCES topics(id) NOT NULL
  deck_id           BIGINT REFERENCES topic_explainer_decks(id)
  current_card      SMALLINT DEFAULT 1
  current_level     SMALLINT DEFAULT 2       -- started at standard
  cards_completed   SMALLINT DEFAULT 0
  re_explanations   SMALLINT DEFAULT 0       -- how many times "explain more"
  questions_asked   SMALLINT DEFAULT 0       -- how many questions typed
  level_dropped     BOOLEAN DEFAULT FALSE    -- did they need level 1?
  level_raised      BOOLEAN DEFAULT FALSE    -- did they reach level 3?
  completed         BOOLEAN DEFAULT FALSE
  completed_at      TIMESTAMPTZ
  time_spent_secs   INT DEFAULT 0
  started_at        TIMESTAMPTZ DEFAULT NOW()
  updated_at        TIMESTAMPTZ DEFAULT NOW()
  UNIQUE(student_id, topic_id)

Indexes:
  - (student_id, completed)
  - (topic_id, completed) — for topic-level analytics

Generate and run migration.


=== STEP 2: Deck Generator (Background Job) ===

Create NEW file: src/lib/explainer/generate-deck.ts

async function generateTopicDeck(
  topicId: bigint,
  level: 1 | 2 | 3,
  language: string = 'en'
): Promise<ExplainerCard[]>

This function calls the AI provider to generate a complete deck 
for one topic at one difficulty level.

SYSTEM PROMPT:
"You are an expert visual educator for Indian K-12 students.
You create explanation cards for topics. Each card explains ONE 
atomic concept with a visual element.

RULES:
- Each card must have at least one visual: an SVG diagram, a formula, 
  an analogy visualization, or a comparison layout.
- Use simple, clear language. No jargon without explanation.
- Every abstract concept needs a concrete, relatable example.
- For Indian students: use examples from Indian daily life 
  (cricket, cooking, monsoon, railways, festivals, markets).
- SVG diagrams: use viewBox='0 0 400 300', purple theme 
  (#7C3AED primary, #1E1033 background, #A78BFA accent, 
  #C4B5FD highlight). Keep diagrams simple and labeled.
- LaTeX formulas: use KaTeX-compatible syntax.
- Each card should take 30-90 seconds to read.
- 3-7 cards per topic. Start with the simplest concept, 
  build to the complete understanding.

OUTPUT FORMAT:
Return a JSON array of ExplainerCard objects. Each card has:
- title: string
- subtitle: string (optional)
- blocks: array of ContentBlock objects (see types below)
- approach: 'analogy' | 'diagram' | 'numerical' | 'real_world' | 'comparison'
- estimatedReadTime: number (seconds)

ContentBlock types:
- { type: 'text', content: 'markdown string' }
- { type: 'formula', latex: 'V = IR' }
- { type: 'diagram', svg: '<svg ...>...</svg>' }
- { type: 'callout', variant: 'tip|warning|remember|example', content: 'text' }
- { type: 'comparison', leftLabel: 'X', rightLabel: 'Y', left: 'text', right: 'text' }
- { type: 'steps', items: ['step 1', 'step 2', ...] }
- { type: 'analogy', source: 'Water in pipes', target: 'Current in wires',
    mapping: [{ from: 'Pressure', to: 'Voltage' }, ...] }
- { type: 'quick_check', question: '...', options: ['A','B','C','D'],
    correctIndex: 1, explanation: '...' }

Return ONLY valid JSON. No markdown fences."

USER PROMPT (varies by level):

Level 1 (Foundation):
"Create an explanation deck for the topic: '{topicName}'
Board: {board}, Class: {class}, Subject: {subject}, Chapter: {chapter}
Difficulty: FOUNDATION — explain as if the student is one class below.
Use everyday analogies. Avoid technical terms until the very end.
Use examples a {class-1}th grader would understand."

Level 2 (Standard):
"Create an explanation deck for the topic: '{topicName}'
Board: {board}, Class: {class}, Subject: {subject}, Chapter: {chapter}
Difficulty: STANDARD — match the board textbook difficulty.
Use NCERT-style explanations. Cover what the exam expects.
Include one numerical example if applicable."

Level 3 (Advanced):
"Create an explanation deck for the topic: '{topicName}'
Board: {board}, Class: {class}, Subject: {subject}, Chapter: {chapter}
Difficulty: ADVANCED — go deeper than the textbook.
Include real-world applications, edge cases, and connections to 
other chapters. Include a challenging practice question."

AFTER AI RESPONDS:
1. Parse and validate JSON with Zod
2. Validate each SVG (well-formed XML, has viewBox)
3. Validate each LaTeX formula (parseable by KaTeX)
4. If validation fails on specific cards, regenerate those cards only
5. Store in topic_explainer_decks


Create NEW file: src/lib/explainer/generate-realtime.ts

async function generateReExplanation(
  topicId: bigint,
  cardPosition: number,
  previousApproaches: string[],    // approaches already shown
  studentQuestion?: string,         // if student typed a question
  language: string = 'en'
): Promise<ExplainerCard>

This generates a SINGLE card in real time when the student 
taps "Explain more" or asks a question.

SYSTEM PROMPT: same as above, plus:
"The student has already seen explanations using these approaches: 
{previousApproaches}. Use a DIFFERENT approach.

Approach rotation priority:
1. Real-world analogy from Indian daily life
2. Labeled SVG diagram
3. Step-by-step numerical example with actual numbers
4. Comparison with a concept they already learned
5. Guided problem: 'Let's solve this together' with blanks to fill

If the student asked a specific question: '{studentQuestion}'
Answer THAT question directly with a visual. Don't repeat the 
general explanation."

Returns ONE ExplainerCard. Append to the student's deck in the UI.


=== STEP 3: Bulk Generation Job ===

Create NEW file: src/lib/explainer/bulk-generate.ts

async function bulkGenerateDecks(options?: {
  boardId?: bigint,
  subjectId?: bigint,
  standardId?: bigint,
  level?: 1 | 2 | 3,
  limit?: number,           // how many topics to process
}): Promise<{ generated: number, failed: number, skipped: number }>

Logic:
1. Query topics that don't have a deck at the specified level yet:
   SELECT t.* FROM topics t
   LEFT JOIN topic_explainer_decks d 
     ON d.topic_id = t.id AND d.level = $level
   WHERE d.id IS NULL
   AND (t.board_id = $boardId OR $boardId IS NULL)
   LIMIT $limit

2. For each topic: call generateTopicDeck()
3. Rate limit: 1 generation per 5 seconds (AI cost control)
4. Log progress and errors

Register BullMQ job:
Job: 'generate-explainer-decks'
Data: { boardId?, subjectId?, standardId?, level?, limit? }
Default cron: none (triggered manually or after new topics are added)


=== STEP 4: API Endpoints ===

GET /api/topics/[topicId]/explainer
  Auth required.
  Query: level? (default: auto-detect from student's history)
  
  Logic:
  1. Check student_explainer_progress for this topic
     - If exists and not completed: resume from current_card
     - If exists and completed: return deck for review (level they completed at)
     - If not exists: start fresh at Level 2
  2. Fetch topic_explainer_decks for this topic at the determined level
     - If deck exists: return cached deck
     - If no deck: generate Level 2 in real time, cache it, return it
  3. Create or update student_explainer_progress
  
  Returns: {
    deck: ExplainerCard[],
    progress: { currentCard, currentLevel, cardsCompleted, reExplanations },
    hasLevel1: boolean,    -- is foundation deck available
    hasLevel3: boolean,    -- is advanced deck available
  }

POST /api/topics/[topicId]/explainer/progress
  Auth required.
  Body: { 
    action: 'got_it' | 'explain_more' | 'ask_question',
    currentCard: number,
    timeSpentSecs?: number,
    question?: string       -- if action is 'ask_question'
  }
  
  Logic by action:
  
  'got_it':
    - Increment cards_completed
    - If all cards done: mark completed, check if should offer Level 3
    - Return: { nextCard: position + 1 } or { completed: true, offerAdvanced: boolean }
  
  'explain_more':
    - Increment re_explanations count
    - If re_explanations on this card >= 2 AND current_level == 2:
      Drop to Level 1. Set level_dropped = true.
      Return the Level 1 deck's card at same position.
    - Otherwise: generate a real-time re-explanation card
      Call generateReExplanation() with previously used approaches
    - Return: { reExplanationCard: ExplainerCard }
  
  'ask_question':
    - Increment questions_asked
    - Generate targeted answer card via generateReExplanation() 
      with the student's question
    - Return: { answerCard: ExplainerCard }

POST /api/admin/explainer/generate
  Admin auth. Trigger bulk deck generation.
  Body: { boardId?, subjectId?, standardId?, level?, limit? }
  Queues BullMQ job.

GET /api/admin/explainer/stats
  Admin auth. Returns:
  - Topics with decks vs without, by board/subject
  - Average completion rate
  - Average re-explanations per topic (higher = topic is hard)
  - Most "stuck" topics (highest re-explanation rate)


=== STEP 5: Frontend Components ===

Install: pnpm add katex react-katex

Create NEW directory: src/components/explainer/

File: src/components/explainer/ExplainerView.tsx
  Main container. Fetches the deck, manages progress state.
  - Shows one card at a time (not all at once — less overwhelming)
  - Smooth scroll/transition between cards
  - Progress bar at top: "Card 3 of 5"
  - Level indicator: "Standard" / "Foundation" / "Advanced"

File: src/components/explainer/ExplainerCard.tsx
  Renders a single ExplainerCard from JSON.
  - Iterates over card.blocks and renders each ContentBlock
  - Purple theme card with rounded corners, subtle border
  - Entrance animation: blocks appear one by one with slight delay
    (like a tutor writing on a board, not everything at once)
  
  Block renderers:
  - TextBlock: renders markdown (use react-markdown or simple parser)
  - FormulaBlock: renders LaTeX via KaTeX
  - DiagramBlock: renders inline SVG (sanitize first!)
  - CalloutBlock: colored box (tip=purple, warning=amber, remember=blue, example=green)
  - ComparisonBlock: two-column layout with labels
  - StepsBlock: numbered steps with checkmarks
  - AnalogyBlock: visual mapping (source → target with arrows)
  - QuickCheckBlock: inline MCQ, tap to answer, shows explanation
  - AnimationBlock: step-through frames with "Next" button

File: src/components/explainer/ExplainerActions.tsx
  Bottom action bar with three buttons:
  
  ┌──────────┐  ┌──────────────┐  ┌──────────────┐
  │ Got it ✓ │  │ Explain more │  │  Ask AI 💬   │
  └──────────┘  └──────────────┘  └──────────────┘
  
  - "Got it" → green button, calls progress API with 'got_it'
  - "Explain more" → purple outline button, shows loading shimmer 
    while AI generates, then smoothly inserts new card below current
  - "Ask AI" → opens a small text input below the card, student types 
    question, sends to API, receives and displays answer card

  IMPORTANT UX RULES:
  - Only show ONE card at a time. Not a scrollable list of all cards.
  - Transition: current card slides up/fades, new card slides in.
  - When "Explain more" generates a new card, it replaces the current 
    card (not added below). The original is accessible via "back" swipe.
  - The UI should feel calm and focused, like a patient tutor — 
    NOT like a dashboard with 50 things happening.
  - Loading state: skeleton shimmer in the card area, with text 
    "Creating a new explanation for you..." (not a spinner)

File: src/components/explainer/ExplainerComplete.tsx
  Shown when student completes all cards:
  - Congratulations animation (subtle confetti or checkmark)
  - Summary: "You covered 5 concepts in 4 minutes"
  - "Try a quick quiz on this topic?" → link to exam generator
  - "Explore advanced level?" → if they breezed through Level 2
  - "Next topic →" → next topic in the chapter

File: src/app/(dashboard)/topics/[topicId]/learn/page.tsx
  Page that hosts the ExplainerView.
  Route: /topics/123/learn
  - Fetches deck via API
  - Full-screen focused view (minimal header, no sidebar distractions)
  - Back button to return to topic overview
  - Mobile-first: works beautifully on phones


=== STEP 6: Student Behavior Tracking ===

The progress API already tracks:
- cards_completed — how far they got
- re_explanations — how many times they tapped "explain more"
- questions_asked — how many questions they typed
- level_dropped — did they need foundation level
- time_spent_secs — total time on this topic

This data feeds into the student's learning profile:

After completing a topic explainer:
1. Update student_progress table (existing) with:
   - topic mastery score = f(completion, re_explanations, questions_asked)
   - score = 1.0 if completed Level 2 with 0 re-explanations
   - score = 0.8 if completed Level 2 with 1-2 re-explanations  
   - score = 0.6 if dropped to Level 1
   - score = 0.4 if didn't complete
   - score = 1.2 if completed Level 3 (above expected)
   
2. Topics with score < 0.6 get flagged for:
   - Exam generator: weight these topics higher
   - Dashboard: "Topics that need attention" section
   - Parent report: "Your child may need help with [topic]"

3. Topics with score > 1.0 get flagged for:
   - Skip in revision plans
   - Suggest student help peers (future study group feature)


=== STEP 7: Content Quality & Caching ===

Pre-generated decks are cached in the database.
Re-explanations are generated in real time but also cached:

When a re-explanation card is generated:
- Store it in a JSONB array in student_explainer_progress.extra_cards
- If 5+ different students get the same re-explanation approach for 
  the same card, promote it to the main deck as a variant
- This means the system gets smarter over time: popular re-explanations 
  become pre-cached for future students

Quality checks:
- AI self-rates each deck 0-1 during generation
- Decks scoring < 0.5 are flagged for admin review
- Admin can edit cards manually via admin UI
- Student "report issue" button on each card feeds back to admin


=== IMPORTANT DESIGN PRINCIPLES ===

1. ONE THING AT A TIME
   Never show multiple cards simultaneously. One concept, one visual, 
   one action. The student's cognitive load should be minimal.

2. NEVER REPEAT
   When the AI re-explains, it MUST use a different approach. If the 
   student saw an analogy, give them a diagram. If they saw a diagram, 
   give them a numerical example. The previousApproaches array enforces this.

3. VISUAL FIRST
   Every card MUST have a visual element. Text-only cards are not allowed.
   Even a simple formula block counts. A card with only paragraphs of 
   text is a failure — the AI prompt enforces this.

4. EXIT RAMPS
   The student can leave at any time. Progress is saved. When they 
   come back, they resume exactly where they left off. No "you must 
   complete all 5 cards to continue."

5. CELEBRATE PROGRESS
   Small wins matter. After each "Got it", subtle positive feedback.
   After completing a topic, genuine celebration. After completing a 
   chapter's worth of topics, a milestone badge.

6. DON'T GENERATE SLIDES
   This is NOT a slide deck. There is no "slide 3 of 20" with bullet 
   points. Each card is a self-contained micro-lesson that the student 
   actively interacts with. If it feels like a PowerPoint, it's wrong.

=== VERIFICATION ===

1. pnpm build — no TypeScript errors
2. Topic with pre-generated deck loads instantly
3. Topic without deck generates in real-time (< 10 seconds)
4. "Got it" advances to next card
5. "Explain more" generates fresh card with different approach
6. "Ask AI" with typed question generates targeted answer
7. Level auto-drops to Foundation after repeated "explain more"
8. Completion updates student progress
9. Mobile layout works cleanly on 390px width
10. SVG diagrams render correctly
11. LaTeX formulas render via KaTeX
12. Progress persists across sessions
```

---

## COST ESTIMATE

Pre-generating decks (3 levels × ~5 cards × ~500 tokens per card):
- Per topic: ~7,500 tokens input + ~4,500 output ≈ $0.05-0.10 (Sonnet)
- 1,000 topics (one subject, one board): ~$50-100 one-time
- All CBSE Class 10 topics (~300): ~$15-30

Real-time re-explanations:
- Per request: ~1,000 tokens input + ~800 output ≈ $0.01 (Haiku for simple)
- Average student needs 2-3 re-explanations per topic: ~$0.03 per topic visit
- At 1,000 daily active students: ~$30/day if every student uses this feature

Start by generating Level 2 decks for your home market:
Kerala SCERT + CBSE, Classes 8-12, core subjects (Maths, Physics, Chemistry).
That's roughly 1,500 topics = ~$75-150 one-time investment.
