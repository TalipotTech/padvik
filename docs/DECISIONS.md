# DECISIONS.md — Padvik Architecture Decisions Log

## ADR-001: Project Name
**Decision:** Padvik
**Rationale:** Chosen by founder. Sanskrit/Indian origin, memorable, brandable.

## ADR-002: BIGINT over UUID for Primary Keys
**Decision:** All tables use BIGINT GENERATED ALWAYS AS IDENTITY
**Rationale:** Explicit founder requirement. Benefits: faster indexing (8 bytes vs 16), sequential (better for B-tree), smaller storage, human-readable IDs.
**Trade-off:** No globally unique IDs across services — acceptable for monolith.

## ADR-003: Drizzle ORM over Prisma
**Decision:** Drizzle ORM
**Rationale:** Lighter weight, better raw SQL escape hatch, closer to ExamForge patterns, better TypeScript inference for complex queries.

## ADR-004: Monorepo (Single Next.js App)
**Decision:** Single Next.js 15 monorepo — no microservices at MVP
**Rationale:** Matches ExamForge architecture. Ship fast, split later. App Router handles API + frontend in one deploy.

## ADR-005: AI Provider Strategy
**Decision:** Claude Sonnet 4 (primary), Haiku 4.5 (bulk), GPT-4o (fallback)
**Rationale:** Same providers as ExamForge. Claude for quality, Haiku for cost on bulk ops (tagging, scoring), GPT-4o for resilience.

## ADR-006: Syllabus-First Architecture
**Decision:** Board → Standard → Subject → Chapter → Topic is the core data model; all content, questions, and analytics are anchored to this hierarchy.
**Rationale:** This is what differentiates Padvik from generic tutoring apps. The syllabus IS the product.

## ADR-007: Content Source Strategy
**Decision:** Multi-source with this priority: Official scraping → DIKSHA/Sunbird open API → AI generation → Community uploads
**Rationale:** Official sources ensure accuracy. DIKSHA is MIT-licensed government platform with 182M+ enrolments. AI fills gaps. Community adds depth.

## ADR-008: Content Review Pipeline
**Decision:** All non-official content starts as `review_status = 'pending'` with AI quality scoring. Content below 0.5 score is auto-flagged. Teacher-uploaded content has expedited review.
**Rationale:** Balance between automated scaling and quality control. Minimal human input per founder requirement.

## ADR-009: All Boards, Not Just Top 3
**Decision:** Architecture supports 30+ boards from day 1, with phased rollout.
**Rationale:** Market opportunity is in breadth. State board students are underserved by existing platforms.

## ADR-010: Dual User Model (Student + Teacher)
**Decision:** Teachers can create classrooms, assign exams, upload content, grade. Students learn and take exams.
**Rationale:** Teacher involvement drives organic growth (teacher recommends → students adopt) and improves content quality.

---

# TODO.md — Running Task List

## Ready to Start
- [ ] Initialize Next.js 15 monorepo with TypeScript
- [ ] Set up Drizzle ORM + PostgreSQL connection
- [ ] Create all database schema files (9 schema modules)
- [ ] Run initial migration
- [ ] Seed boards data (Phase 1: CBSE, ICSE, Kerala)
- [ ] Seed standard subjects for CBSE Classes 1-12
- [ ] Set up Auth.js with Google + credentials provider
- [ ] Create AI provider service (`/src/lib/ai/provider.ts`)
- [ ] Set up S3 client for file uploads
- [ ] Build CBSE syllabus scraper (first pipeline)

## Backlog
- [ ] Landing page
- [ ] Board selection onboarding
- [ ] Syllabus explorer UI
- [ ] Admin dashboard
- [ ] Notes viewer + editor
- [ ] Question bank CRUD
- [ ] Exam engine
- [ ] AI chat
- [ ] Analytics dashboard
- [ ] Classroom features
- [ ] Parent view

---

# CHANGELOG.md

## [Unreleased] - 2026-03-31
### Added
- Project outline document (learnforge-outline.md → now Padvik)
- CLAUDE.md project instructions
- AGENTS.md orchestration guide
- Claude Code rules (database.md, ai-integration.md)
- Cursor rules (frontend.md)
- Board seed data documentation (30+ Indian boards)
- Architecture decision records (ADR-001 through ADR-010)
