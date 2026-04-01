# CLAUDE.md — Padvik Project Instructions

## Project Overview
Padvik is an AI-powered curriculum learning platform for Indian K-12 education (Classes 1–12). It covers CBSE, ICSE, Kerala State (SCERT), and all major Indian state boards. Built by Ensate Technologies, Adoor, Kerala.

**Sister project:** ExamForge (competitive/professional exam platform — shares architecture patterns)
**Project path:** `E:\DEVELOPMENT\WEBSITE\ENSATE\INHOUSE\PadVikProject`
**Platform:** Windows + Claude Desktop Code tab + Cursor
**Package manager:** pnpm (always use pnpm, never npm or yarn)
**App type:** PWA (Progressive Web App) — no separate mobile app
**Theme:** Purple (#7C3AED violet-600) — see theme/ folder for configs

## Tech Stack
- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Next.js API Routes (REST) with tRPC consideration for internal calls
- **Database:** PostgreSQL 16 with Drizzle ORM
- **Auth:** Auth.js (NextAuth v5) — Google, Phone OTP, Email/Password
- **AI:** Claude API (primary), OpenAI GPT-4o (fallback), Claude Vision (OCR/documents)
- **File Storage:** AWS S3 (production) / local fs (dev)
- **Job Queue:** BullMQ on Redis
- **Cache:** Redis / Upstash
- **Search:** PostgreSQL FTS + pg_trgm (→ Meilisearch at scale)
- **Deployment:** AWS App Runner → ECS Fargate → EKS (progressive path)

## Critical Rules

### Database
- **ALL primary keys are BIGINT** — never use UUID anywhere
- Use `GENERATED ALWAYS AS IDENTITY` for all PKs
- Use Drizzle ORM for all database operations
- All timestamps use `TIMESTAMPTZ` with `DEFAULT NOW()`
- Use JSONB for flexible metadata columns
- Every table must have `created_at`; mutable tables also need `updated_at`
- Foreign keys always include `ON DELETE CASCADE` or explicit policy
- Use snake_case for all column and table names

### Code Style
- TypeScript strict mode — no `any` types except in explicit escape hatches
- All API responses follow: `{ success: boolean, data?: T, error?: { code: string, message: string } }`
- Use Zod for all input validation (API routes, form inputs, AI responses)
- Server Components by default; Client Components only when needed (interactivity, hooks)
- File naming: kebab-case for files, PascalCase for components, camelCase for functions
- Collocate related files: `/app/dashboard/page.tsx`, `/app/dashboard/_components/`, `/app/dashboard/_actions/`

### AI Integration
- Primary provider: Anthropic (Claude Sonnet 4) — `claude-sonnet-4-20250514`
- Bulk/cheap operations: Claude Haiku 4.5 — `claude-haiku-4-5-20251001`
- Vision tasks: Claude Sonnet 4 (same model, vision-capable)
- Fallback: OpenAI GPT-4o
- Always use streaming for chat responses (SSE)
- All AI calls go through a centralized `ai-provider.ts` service
- Log token usage and cost for every AI call
- Cache AI responses where input is deterministic (syllabus parsing, question generation from same topic)

### Content Pipeline
- All scraped/generated content starts as `review_status = 'pending'`
- AI-generated content must have `source_type = 'ai_generated'`
- Quality scores are 0.00 to 1.00 — content below 0.5 is auto-flagged
- File uploads always go through: Upload → S3 → Queue → Process → Extract → Tag → Store
- Support languages: en (English), hi (Hindi), ml (Malayalam), ta (Tamil), te (Telugu), kn (Kannada)

### Project Structure
```
padvik/
├── CLAUDE.md                    # This file
├── AGENTS.md                    # Agent orchestration guide
├── .claude/rules/               # Claude Code rules
├── .cursor/rules/               # Cursor rules
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── drizzle.config.ts
├── tsconfig.json
├── .env.example
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── (auth)/              # Auth pages (login, register, verify)
│   │   ├── (marketing)/         # Landing page, about, pricing
│   │   ├── (dashboard)/         # Protected student/teacher dashboard
│   │   │   ├── syllabus/        # Syllabus explorer
│   │   │   ├── learn/           # Notes, content viewer
│   │   │   ├── exams/           # Exam engine
│   │   │   ├── chat/            # AI chat
│   │   │   ├── analytics/       # Performance dashboard
│   │   │   ├── classroom/       # Teacher classroom management
│   │   │   └── settings/        # User settings
│   │   ├── (admin)/             # Admin panel
│   │   │   ├── scrape-jobs/
│   │   │   ├── content-review/
│   │   │   └── pipeline/
│   │   ├── api/                 # API routes
│   │   │   ├── auth/
│   │   │   ├── boards/
│   │   │   ├── syllabus/
│   │   │   ├── content/
│   │   │   ├── notes/
│   │   │   ├── questions/
│   │   │   ├── exams/
│   │   │   ├── chat/
│   │   │   ├── analytics/
│   │   │   ├── classrooms/
│   │   │   └── admin/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/              # Shared components
│   │   ├── ui/                  # shadcn/ui components
│   │   ├── layout/              # Header, Sidebar, Footer
│   │   ├── syllabus/            # Syllabus tree, topic card, etc.
│   │   ├── exam/                # Exam UI components
│   │   ├── content/             # Note viewer, editor, upload
│   │   ├── chat/                # Chat interface
│   │   └── analytics/           # Charts, heatmaps, progress bars
│   ├── db/                      # Database layer
│   │   ├── schema/              # Drizzle schema definitions
│   │   │   ├── auth.ts          # users, user_sessions
│   │   │   ├── curriculum.ts    # boards, standards, subjects, chapters, topics
│   │   │   ├── content.ts       # content_items, user_notes, file_uploads
│   │   │   ├── questions.ts     # questions, question_papers
│   │   │   ├── exams.ts         # exams, exam_questions, exam_attempts, exam_responses
│   │   │   ├── analytics.ts     # student_progress, learning_sessions, performance_reports
│   │   │   ├── classrooms.ts    # classrooms, classroom_members, teacher_assessments
│   │   │   ├── chat.ts          # conversations, messages
│   │   │   └── system.ts        # scrape_jobs, content_pipeline_logs, system_config
│   │   ├── index.ts             # Drizzle client + connection
│   │   ├── migrate.ts           # Migration runner
│   │   └── seed.ts              # Seed data (boards, initial subjects)
│   ├── lib/                     # Shared utilities
│   │   ├── ai/                  # AI provider abstraction
│   │   │   ├── provider.ts      # Multi-provider router
│   │   │   ├── prompts/         # Prompt templates
│   │   │   │   ├── syllabus-parser.ts
│   │   │   │   ├── question-generator.ts
│   │   │   │   ├── content-generator.ts
│   │   │   │   ├── answer-grader.ts
│   │   │   │   ├── doubt-resolver.ts
│   │   │   │   └── study-planner.ts
│   │   │   └── types.ts
│   │   ├── scraper/             # Scraping pipeline
│   │   │   ├── base-scraper.ts
│   │   │   ├── cbse-scraper.ts
│   │   │   ├── icse-scraper.ts
│   │   │   ├── kerala-scraper.ts
│   │   │   ├── diksha-client.ts
│   │   │   └── parser.ts        # PDF/HTML parsing utilities
│   │   ├── queue/               # BullMQ job definitions
│   │   │   ├── index.ts
│   │   │   ├── scrape-worker.ts
│   │   │   ├── content-worker.ts
│   │   │   └── file-worker.ts
│   │   ├── auth.ts              # Auth.js config
│   │   ├── s3.ts                # S3 client
│   │   ├── redis.ts             # Redis client
│   │   ├── validators.ts        # Shared Zod schemas
│   │   └── utils.ts             # General utilities
│   ├── hooks/                   # React hooks
│   └── types/                   # TypeScript type definitions
├── drizzle/                     # Migration files (auto-generated)
├── public/                      # Static assets
├── scripts/                     # CLI scripts
│   ├── seed-boards.ts           # Seed board data
│   ├── run-scraper.ts           # CLI scraper trigger
│   └── generate-content.ts      # Bulk content generation
└── tests/
```

### Naming Conventions
- Database tables: plural snake_case (`content_items`, `exam_attempts`)
- API routes: kebab-case (`/api/scrape-jobs`)
- Components: PascalCase (`SyllabusExplorer.tsx`)
- Functions/variables: camelCase (`getChaptersBySubject`)
- Constants: UPPER_SNAKE_CASE (`MAX_FILE_SIZE_MB`)
- Types/Interfaces: PascalCase with prefix (`type BoardWithStandards`, `interface ExamConfig`)

### Environment Variables
```
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=padvik-uploads
AWS_REGION=ap-south-1
```

## Board Priority Order
1. CBSE (largest, NCERT-aligned) — source: cbseacademic.nic.in + ncert.nic.in
2. ICSE/ISC — source: cisce.org
3. Kerala SCERT — source: scert.kerala.gov.in
4. Karnataka (KSEAB) — source: kseab.karnataka.gov.in
5. Tamil Nadu (DGE) — source: dge.tn.gov.in
6. Maharashtra (MSBSHSE) — source: mahahsscboard.in
7. Andhra Pradesh (BSEAP) — source: bse.ap.gov.in
8. Telangana (BSETS) — source: bse.telangana.gov.in
9. DIKSHA/Sunbird API — fallback for all remaining boards

## Feature Build Priority
1. Syllabus scraping pipeline (content is king)
2. Notes + content system (learning foundation)
3. Exam engine (assessment core)
4. AI chat agent (intelligence layer)
