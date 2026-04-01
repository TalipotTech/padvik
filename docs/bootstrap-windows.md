# Padvik — Bootstrap Guide (Windows + Claude Desktop)

## Your Setup
- **IDE:** Claude Desktop App → Code tab
- **Project Path:** `E:\DEVELOPMENT\WEBSITE\ENSATE\INHOUSE\PadVikProject`
- **OS:** Windows
- **Debugging IDE:** Cursor (open same folder)

---

## STEP 0: Prerequisites Check

Open **PowerShell** (not CMD) and verify these are installed:

```powershell
# Check Node.js (need v22+)
node --version

# Check pnpm (if not installed: npm install -g pnpm)
pnpm --version

# Check Git
git --version

# Check PostgreSQL (should be running)
pg_isready
```

**If Node.js not installed:**
Download from https://nodejs.org (v22 LTS) — or use:
```powershell
winget install OpenJS.NodeJS.LTS
```

**If pnpm not installed:**
```powershell
npm install -g pnpm
```

**If PostgreSQL not installed:**
```powershell
winget install PostgreSQL.PostgreSQL.16
```
Or use **Supabase** (free cloud PostgreSQL): https://supabase.com
Or use **Neon** (free cloud PostgreSQL): https://neon.tech

**If Redis not installed:**
Option A: Use **Upstash** (free cloud Redis): https://upstash.com (recommended for Windows)
Option B: Install Redis via WSL or Docker

---

## STEP 1: Create Project Folder & Initialize Git

```powershell
# Navigate to your path
cd E:\DEVELOPMENT\WEBSITE\ENSATE\INHOUSE

# Create project folder (if not exists)
mkdir PadVikProject
cd PadVikProject

# Initialize git
git init
```

---

## STEP 2: Copy Config Files

Copy the entire `/padvik` folder contents from the downloaded files into `E:\DEVELOPMENT\WEBSITE\ENSATE\INHOUSE\PadVikProject\`

Your folder should look like:
```
PadVikProject\
├── CLAUDE.md              ← Claude Code reads this automatically
├── AGENTS.md
├── .claude\
│   └── rules\
│       ├── database.md
│       └── ai-integration.md
├── .cursor\
│   └── rules\
│       └── frontend.md
├── docs\
│   ├── getting-started.md
│   ├── padvik-outline.md
│   ├── seed-boards.md
│   └── DECISIONS.md
└── theme\
    ├── globals.css
    ├── tailwind.config.ts
    └── manifest.json
```

---

## STEP 3: Open in Claude Desktop → Code Tab

1. Open **Claude Desktop App**
2. Click the **Code** tab (bottom navigation)
3. It will ask you to select a project folder
4. Navigate to: `E:\DEVELOPMENT\WEBSITE\ENSATE\INHOUSE\PadVikProject`
5. Select it and confirm

Claude Code will automatically detect and read your `CLAUDE.md` file.

---

## STEP 4: Your First Prompts in Claude Desktop Code Tab

### Prompt 1 — Scaffold the Project
Copy and paste this as your first message:

```
Read CLAUDE.md, AGENTS.md, and all files in docs/ and theme/ folders. 
Then scaffold the Next.js 15 project in this directory with:

1. pnpm as package manager
2. TypeScript strict mode
3. App Router (not Pages Router)
4. Tailwind CSS + shadcn/ui
5. ESLint + Prettier
6. Drizzle ORM for PostgreSQL
7. Auth.js (NextAuth v5)
8. PWA support using @serwist/next

Use the purple theme from theme/globals.css and theme/tailwind.config.ts.
Copy theme/manifest.json to public/manifest.json.
Set up the complete folder structure as defined in CLAUDE.md.
Use pnpm for all package installations.

For the .env.example file, use these variables:
- DATABASE_URL=postgresql://postgres:postgres@localhost:5432/padvik
- REDIS_URL=redis://localhost:6379
- NEXTAUTH_SECRET=change-me-in-production
- NEXTAUTH_URL=http://localhost:3000
- ANTHROPIC_API_KEY=
- OPENAI_API_KEY=
- AWS_ACCESS_KEY_ID=
- AWS_SECRET_ACCESS_KEY=
- AWS_S3_BUCKET=padvik-uploads
- AWS_REGION=ap-south-1
```

### Prompt 2 — Database Schema
After scaffold completes:

```
Now create all the Drizzle ORM schema files in src/db/schema/ as defined 
in docs/padvik-outline.md Section 3. Create these schema files:

1. auth.ts — users, user_sessions tables
2. curriculum.ts — boards, standards, subjects, chapters, topics, topic_mappings
3. content.ts — content_items, user_notes, file_uploads
4. questions.ts — questions, question_papers
5. exams.ts — exams, exam_questions, exam_attempts, exam_responses
6. analytics.ts — student_progress, learning_sessions, performance_reports
7. classrooms.ts — classrooms, classroom_members, teacher_assessments
8. chat.ts — conversations, messages
9. system.ts — scrape_jobs, content_pipeline_logs, system_config

ALL primary keys must be BIGINT using bigint('id', { mode: 'number' }) 
with .primaryKey().generatedAlwaysAsIdentity()

Export everything from src/db/schema/index.ts.
Create src/db/index.ts with the Drizzle client connection.
Generate the migration with drizzle-kit generate.
```

### Prompt 3 — Seed Board Data
After migrations:

```
Create a seed script at scripts/seed-boards.ts that populates the boards 
table with all Indian education boards from docs/seed-boards.md.

Start with Phase 1 boards (CBSE, ICSE, Kerala SCERT) with full metadata.
Then seed the standards table with Classes 1-12 for CBSE (with streams 
for 11-12: Science, Commerce, Humanities).
Then seed the core subjects for each standard based on the subject mapping 
in seed-boards.md.

Run the seed script after creating it.
```

### Prompt 4 — Auth System
```
Set up Auth.js (NextAuth v5) with these providers:
1. Google OAuth
2. Credentials (email + password with bcrypt)
3. Phone OTP placeholder (we'll implement Twilio/MSG91 later)

Create the auth middleware to protect /dashboard routes.
Create login and register pages at src/app/(auth)/login and 
src/app/(auth)/register using shadcn/ui form components with 
the purple theme.
Add role-based access: student, teacher, admin, parent.
```

### Prompt 5 — Start Syllabus Scraper
```
Build the CBSE syllabus scraping pipeline:

1. Create src/lib/scraper/base-scraper.ts — base class with retry logic,
   rate limiting, and error handling
2. Create src/lib/scraper/cbse-scraper.ts — scrape CBSE syllabus PDFs 
   from cbseacademic.nic.in/curriculum_2026.html
3. Create src/lib/ai/provider.ts — centralized AI provider with Claude 
   as primary (use @anthropic-ai/sdk)
4. Create src/lib/ai/prompts/syllabus-parser.ts — prompt to parse 
   syllabus PDFs into our schema structure
5. Create a scrape-jobs API at src/app/api/admin/scrape-jobs/route.ts
6. Create a simple admin page to trigger and monitor scrape jobs

The pipeline: Download PDF → Extract text → Send to Claude for structured 
parsing → Validate → Insert into boards/standards/subjects/chapters/topics.
```

---

## STEP 5: Open Same Folder in Cursor (Parallel)

1. Open **Cursor** IDE
2. File → Open Folder → `E:\DEVELOPMENT\WEBSITE\ENSATE\INHOUSE\PadVikProject`
3. Cursor will read `.cursor/rules/frontend.md` automatically
4. Use Cursor for:
   - UI/frontend component development
   - Debugging (breakpoints, DevTools)
   - Viewing file diffs from Claude Code's changes
   - Quick inline edits with Cmd+K / Ctrl+K

**Split workflow:**
- Claude Desktop Code tab: backend, APIs, DB, AI, scraping
- Cursor: frontend, UI, debugging, visual work

Both tools edit the same files on disk. Changes from one appear instantly in the other.

---

## STEP 6: Create Local Database

Open PostgreSQL shell or pgAdmin:

```sql
-- Create the database
CREATE DATABASE padvik;

-- Create a dev user (optional, or use default postgres user)
CREATE USER padvik_dev WITH PASSWORD 'padvik_dev_2026';
GRANT ALL PRIVILEGES ON DATABASE padvik TO padvik_dev;
```

Then update your `.env` file:
```
DATABASE_URL=postgresql://padvik_dev:padvik_dev_2026@localhost:5432/padvik
```

Or if using default postgres user:
```
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/padvik
```

---

## STEP 7: Run the Dev Server

In Cursor's integrated terminal:
```powershell
cd E:\DEVELOPMENT\WEBSITE\ENSATE\INHOUSE\PadVikProject
pnpm dev
```

Open browser: http://localhost:3000

---

## TIPS FOR CLAUDE DESKTOP CODE TAB

1. **Session management:** Each Code tab session is independent. Click 
   "+ New session" in the sidebar to work on multiple tasks in parallel 
   (each gets its own git worktree).

2. **Switching between tabs:** You can switch to Chat tab for quick 
   questions and come back to Code tab — your session persists.

3. **Use Cowork tab** for long-running autonomous tasks like bulk 
   scraping or content generation.

4. **Context management:** If a session gets long, start a new one. 
   Claude Code reads CLAUDE.md fresh each time, so it always has 
   project context.

5. **File references:** Use @filename to point Claude at specific files. 
   Example: "Update @src/db/schema/curriculum.ts to add an index on..."

6. **Approve carefully:** Claude shows diffs before making changes. 
   Review each one — especially for database migrations.

7. **Git commits:** Ask Claude to commit after each feature: 
   "Commit these changes with message: feat(auth): add Google OAuth login"

---

## ENVIRONMENT SETUP SUMMARY

```
Project Path:     E:\DEVELOPMENT\WEBSITE\ENSATE\INHOUSE\PadVikProject
Primary Tool:     Claude Desktop App → Code tab
Secondary Tool:   Cursor (debugging + frontend)
Package Manager:  pnpm
Node Version:     22 LTS
Database:         PostgreSQL 16 (local or Supabase/Neon)
Cache:            Redis (Upstash recommended for Windows)
AI Primary:       Anthropic Claude API
AI Fallback:      OpenAI GPT-4o
File Storage:     AWS S3 (ap-south-1 Mumbai)
Theme:            Purple (#7C3AED)
App Type:         PWA (Progressive Web App)
```
