# AGENTS.md — Padvik Agent Orchestration Guide

## Agent Roles & Responsibilities

### 1. Claude Code (Primary Builder)
**Role:** Core backend and full-stack feature development
**Strengths:** Complex logic, database schemas, AI integrations, API routes, testing
**When to use:**
- Database migrations and schema changes
- API route development
- AI provider integration and prompt engineering
- Scraping pipeline logic
- Complex business logic (exam generation, grading, analytics)
- BullMQ job workers
- Bug fixes requiring deep understanding of data flow
- Code review and refactoring

**Working pattern:**
```
Morning block:  Core feature backend (schema → API → service logic)
Afternoon block: AI integrations, pipeline workers, complex queries
Evening block:  Bug fixes, tests, code review, next-day prep
```

### 2. Cursor (Parallel UI/Frontend Builder)
**Role:** Frontend development, UI components, styling, responsive design
**Strengths:** Fast component scaffolding, CSS/Tailwind, UI polish
**When to use:**
- Page layouts and route structure
- shadcn/ui component integration
- Form building with react-hook-form + Zod
- Dashboard layouts and data visualization
- Responsive design and mobile optimization
- UI polish, animations, micro-interactions
- Component library development

**Working pattern:**
```
Morning block:  Build UI for yesterday's backend features
Afternoon block: New component development, form building
Evening block:  UI polish, responsive fixes, animation
```

### 3. Claude Chat (Advisor & Planner)
**Role:** Architecture decisions, research, planning, prompt engineering
**When to use:**
- Architecture questions and design decisions
- Researching third-party APIs and integration approaches
- AI prompt crafting and optimization
- Sprint planning and task prioritization
- Documentation and README writing
- Troubleshooting complex issues
- Quick one-off questions during development

### 4. Cowork (Autonomous Long-Runner)
**Role:** Long-running autonomous tasks that don't need supervision
**When to use:**
- Running scraping jobs across multiple board websites
- Bulk AI content generation (notes for all topics in a subject)
- Parsing large batches of question papers
- Data validation and cleanup across the database
- Generating seed data for development
- Running comprehensive test suites
- Documentation generation

---

## 12-Week Sprint Schedule

### PHASE 1: FOUNDATION (Weeks 1–3)

#### Week 1: Project Setup & Core Schema
| Day | Claude Code | Cursor | Cowork |
|-----|------------|--------|--------|
| Mon | Init monorepo, package.json, Next.js 15, TS config | — | — |
| Tue | Drizzle ORM setup, auth schema, curriculum schema | Landing page scaffold | — |
| Wed | Content + questions + exams schema | Auth pages (login/register) | — |
| Thu | Analytics + chat + system schema, seed script | Board selection onboarding flow | — |
| Fri | Auth.js config, session management, middleware | Marketing site sections | — |
| Sat | Seed boards data (all Indian boards), test auth flow | Polish landing + onboarding | — |

**Week 1 Deliverable:** Working auth, full DB schema migrated, landing page, board onboarding

#### Week 2: Syllabus Scraping Pipeline
| Day | Claude Code | Cursor | Cowork |
|-----|------------|--------|--------|
| Mon | Base scraper framework (Playwright + BullMQ queue) | Admin layout + sidebar | — |
| Tue | CBSE syllabus scraper (cbseacademic.nic.in PDF scraper) | Scrape job monitoring dashboard | — |
| Wed | NCERT textbook chapter scraper (ncert.nic.in) | Scrape job detail view | — |
| Thu | AI syllabus parser (Claude Vision + structured extraction) | — | Run CBSE scrape: Classes 1-12 |
| Fri | Validation + error handling, retry logic | Pipeline log viewer | CBSE parsing + validation |
| Sat | CBSE content verification, fix parser issues | — | Continue CBSE parsing |

**Week 2 Deliverable:** CBSE syllabus data for all 12 classes in DB, admin monitoring UI

#### Week 3: More Boards + Content Model
| Day | Claude Code | Cursor | Cowork |
|-----|------------|--------|--------|
| Mon | ICSE/ISC scraper | Syllabus explorer: board picker | — |
| Tue | Kerala SCERT scraper | Syllabus explorer: class → subject tree | Run ICSE scraping |
| Wed | Content items CRUD API | Syllabus explorer: chapter → topic view | Run Kerala scraping |
| Thu | File upload pipeline (S3 + processing queue) | Topic detail page (content cards) | — |
| Fri | DIKSHA/Sunbird API client (for remaining boards) | Upload UI component | — |
| Sat | Test all scrapers, fix data issues | Polish syllabus explorer | Generate topic summaries for CBSE Science 8-12 |

**Week 3 Deliverable:** 3 boards scraped, syllabus explorer working, file upload pipeline

---

### PHASE 2: LEARNING CORE (Weeks 4–6)

#### Week 4: Notes & Content System
| Day | Claude Code | Cursor | Cowork |
|-----|------------|--------|--------|
| Mon | Notes viewer API (topic-wise, filtered) | Notes viewer page (markdown rendering) | — |
| Tue | Personal notes CRUD API | Note editor (markdown + toolbar) | Bulk AI notes for CBSE Math 8-12 |
| Wed | Content upload + AI extraction service | File upload UI with progress | Bulk AI notes for CBSE Physics 8-12 |
| Thu | PDF → text extraction pipeline | Content card components | Bulk AI notes for CBSE Chemistry 11-12 |
| Fri | Image → text extraction (Claude Vision) | My Notes page | — |
| Sat | Content quality scoring (Haiku bulk) | Search within notes | Bulk AI notes for CBSE Biology 11-12 |

**Week 4 Deliverable:** Notes system end-to-end, content upload working, AI-generated notes for core subjects

#### Week 5: Question Bank Foundation
| Day | Claude Code | Cursor | Cowork |
|-----|------------|--------|--------|
| Mon | Question CRUD API (all types: MCQ, short, long, etc.) | Question browser page | — |
| Tue | Question paper upload → parse pipeline | Question paper upload UI | — |
| Wed | AI question parser (paper PDF → individual questions) | Question detail view + solution | Scrape CBSE previous year papers 2019-2025 |
| Thu | AI question generator (from topic content) | Question filters (type, difficulty, topic) | Parse scraped papers → questions |
| Fri | Topic tagging service (Haiku bulk) | — | Tag all questions to topics |
| Sat | Question verification workflow | Teacher question creation form | — |

**Week 5 Deliverable:** Question bank with previous year questions, AI generation, topic tagging

#### Week 6: Exam Engine
| Day | Claude Code | Cursor | Cowork |
|-----|------------|--------|--------|
| Mon | Exam creation API (all generation modes) | Exam creation wizard UI | — |
| Tue | AI exam generator (weighted by prev year + difficulty) | Exam configuration form | — |
| Wed | Exam attempt flow (start, auto-save, submit) | Exam taking interface (timed, paginated) | — |
| Thu | Auto-grading (MCQ) + AI grading (subjective via Claude) | Answer review screen | — |
| Fri | Exam results calculation + detailed analytics | Results page + score breakdown | — |
| Sat | Integration testing: create → take → grade → review | Polish exam UI, mobile responsive | — |

**Week 6 Deliverable:** Full exam engine: create, take, grade, review

---

### PHASE 3: INTELLIGENCE LAYER (Weeks 7–9)

#### Week 7: AI Chat Agent
| Day | Claude Code | Cursor | Cowork |
|-----|------------|--------|--------|
| Mon | Chat API (conversations, messages, streaming SSE) | Chat interface (message list + input) | — |
| Tue | Context injection (board, class, current topic) | Chat sidebar (conversation list) | — |
| Wed | Multi-provider routing (Claude primary, OpenAI fallback) | Streaming message rendering | — |
| Thu | Doubt resolver (image upload → AI solve) | Image upload in chat | — |
| Fri | Token tracking + cost logging | Chat settings, new conversation | — |
| Sat | Rate limiting, abuse prevention | Mobile chat UI | — |

**Week 7 Deliverable:** Working AI chat with context awareness, doubt resolver, streaming

#### Week 8: Performance Analytics
| Day | Claude Code | Cursor | Cowork |
|-----|------------|--------|--------|
| Mon | Student progress tracking service | Student dashboard layout | — |
| Tue | Learning session logger (auto-track time on topics) | Subject-wise mastery heatmap | — |
| Wed | Performance report generator (AI insights) | Exam history + score trend charts | — |
| Thu | Spaced repetition algorithm | Topic mastery progress bars | — |
| Fri | AI study plan generator | Study plan view + calendar | — |
| Sat | Streak tracking, achievements | Achievement badges, streak display | — |

**Week 8 Deliverable:** Student dashboard with analytics, AI study plans, spaced repetition

#### Week 9: Smart Features
| Day | Claude Code | Cursor | Cowork |
|-----|------------|--------|--------|
| Mon | Smart Content Finder (semantic search + pg_trgm) | Search UI with filters | — |
| Tue | AI-weighted exam generation (prev year frequency analysis) | Exam mode selector UI | — |
| Wed | Flashcard auto-generation from topics | Flashcard viewer (flip animation) | Generate flashcards for all CBSE Science |
| Thu | Weakness-based question recommendation engine | "Recommended for you" section | — |
| Fri | Mind map generation (AI → structured JSON → visualization) | Mind map component | — |
| Sat | Bookmark & highlight system | Bookmark manager page | — |

**Week 9 Deliverable:** Smart search, flashcards, recommendations, mind maps

---

### PHASE 4: MULTI-USER & POLISH (Weeks 10–12)

#### Week 10: Teacher & Classroom Features
| Day | Claude Code | Cursor | Cowork |
|-----|------------|--------|--------|
| Mon | Classroom CRUD (create, join code, members) | Classroom creation wizard | — |
| Tue | Teacher exam assignment workflow | Classroom dashboard | — |
| Wed | Teacher grading interface (with AI pre-grading) | Grading UI (side-by-side answer + rubric) | — |
| Thu | Teacher content distribution (upload → auto-share) | Teacher content manager | — |
| Fri | Parent view (read-only student progress) | Parent dashboard | — |
| Sat | Notifications system (exam assigned, graded, due) | Notification bell + panel | — |

#### Week 11: Content Scaling + Remaining Boards
| Day | Claude Code | Cursor | Cowork |
|-----|------------|--------|--------|
| Mon | Karnataka board scraper | Peer comparison component | Scrape Karnataka |
| Tue | Tamil Nadu board scraper | Board-specific content badges | Scrape Tamil Nadu |
| Wed | Maharashtra board scraper | Content quality indicators | Scrape Maharashtra |
| Thu | AP + Telangana scrapers | Multi-language content switcher | Scrape AP + Telangana |
| Fri | Content quality pipeline (auto-score + flag) | Admin content review queue UI | Bulk quality scoring |
| Sat | Cross-board topic mapping service | Board comparison view | AI-generate content for new boards |

#### Week 12: Polish, Test, Deploy
| Day | Claude Code | Cursor | Cowork |
|-----|------------|--------|--------|
| Mon | E2E test suite (Playwright) | Final UI audit, fix responsive issues | — |
| Tue | Performance optimization (query analysis, indexing) | Loading states, error boundaries | Run full test suite |
| Wed | Security audit (auth, rate limiting, input validation) | Accessibility audit (a11y) | — |
| Thu | AWS App Runner deployment config | PWA manifest, service worker | — |
| Fri | Monitoring (CloudWatch), error tracking (Sentry) | Final polish pass | — |
| Sat | Soft launch, smoke testing, documentation | — | — |

---

## Parallel Agent Coordination Rules

### Avoiding Conflicts
1. **Claude Code owns:** `/src/db/`, `/src/lib/`, `/src/app/api/`, `drizzle/`, `scripts/`
2. **Cursor owns:** `/src/app/(dashboard)/`, `/src/app/(auth)/`, `/src/app/(marketing)/`, `/src/components/`
3. **Shared (coordinate):** `/src/types/`, `/src/lib/validators.ts`, `/src/hooks/`

### Handoff Protocol
- Claude Code completes an API → updates `/src/types/` with response types → Cursor builds UI against those types
- Cursor needs new API endpoint → documents requirement in TODO.md → Claude Code picks up next session
- Cowork completes bulk job → logs results in DB → both agents can query results

### Communication via Files
- `TODO.md` — Running task list, both agents append
- `CHANGELOG.md` — What was built each day
- `DECISIONS.md` — Architecture decisions log
- `BUGS.md` — Known issues tracker

---

## Key AI Prompt Templates Location
All prompt templates live in `/src/lib/ai/prompts/` and follow this pattern:

```typescript
// Each prompt file exports:
export const SYSTEM_PROMPT = `...`;
export const buildUserPrompt = (params: SomeInput): string => `...`;
export const parseResponse = (raw: string): SomeOutput => { ... };
export const config = {
  model: 'claude-sonnet-4-20250514',
  temperature: 0.3,
  maxTokens: 4096,
};
```

---

## Content Pipeline Stages
```
SCRAPE → PARSE → TAG → SCORE → REVIEW → PUBLISH
  ↓        ↓       ↓      ↓        ↓         ↓
  S3     Extract  AI Map  AI QA   Human    Live DB
  raw    struct   topics  0-1.0   approve  is_published
```

Each stage logs to `content_pipeline_logs` with timing, model used, and token cost.
