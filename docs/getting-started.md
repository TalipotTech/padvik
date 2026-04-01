# Padvik — Getting Started Guide

## 1. HOW TO START IN CLAUDE CODE

### Prerequisites
- Node.js 22 LTS (check: `node --version`)
- Git installed
- Claude Pro ($20/mo) or Claude Max ($100/mo) subscription
- PostgreSQL 16 running locally (or use Supabase/Neon for cloud)
- Redis running locally (or Upstash for cloud)

### Step 1: Install Claude Code
```bash
# macOS / Linux / WSL
curl -fsSL https://claude.ai/install.sh | bash

# Windows (PowerShell)
irm https://claude.ai/install.ps1 | iex

# Verify
claude --version
```

### Step 2: Authenticate
```bash
claude
# Browser opens → log in with your Anthropic account
# Return to terminal — you're connected
```

### Step 3: Create the Project
```bash
# Create project directory
mkdir padvik && cd padvik

# Copy the config files we created into this directory:
# - CLAUDE.md (root)
# - AGENTS.md (root)
# - .claude/rules/database.md
# - .claude/rules/ai-integration.md
# - .cursor/rules/frontend.md
# - docs/seed-boards.md
# - docs/DECISIONS.md
# - docs/padvik-outline.md

# Initialize git
git init
git add -A
git commit -m "initial: project config and documentation"
```

### Step 4: First Claude Code Session
```bash
cd padvik
claude

# Your first prompt to Claude Code:
> Read CLAUDE.md and AGENTS.md. Then scaffold the Next.js 15 project with
> TypeScript, Tailwind CSS, shadcn/ui (purple theme), Drizzle ORM, and
> Auth.js. Set up the full project structure from CLAUDE.md. Use pnpm
> as package manager. Initialize with the App Router.
```

Claude Code will:
1. Read your CLAUDE.md and understand the entire project
2. Run `pnpm create next-app` with the right flags
3. Install all dependencies
4. Set up the folder structure
5. Configure Tailwind, shadcn/ui, Drizzle, etc.

### Step 5: Database Schema
```bash
# In the same Claude Code session (or a new one):
> Now create all the Drizzle schema files as defined in CLAUDE.md
> and the padvik-outline.md. Start with the auth and curriculum
> schemas. All PKs must be BIGINT GENERATED ALWAYS AS IDENTITY.
> Generate the migration and run it against my local PostgreSQL.
```

### Step 6: Explore-Plan-Code-Commit Workflow
This is the recommended Claude Code workflow for every feature:

```
1. EXPLORE: "What files would need to change to add the syllabus explorer API?"
2. PLAN:    "Plan the implementation for the syllabus explorer API endpoints"
3. CODE:    "Implement the syllabus explorer API routes"
4. COMMIT:  "Commit these changes with a descriptive message"
```

### Key Claude Code Commands
```
/init          — Generate CLAUDE.md from codebase analysis (we already have one)
/clear         — Clear context (use when switching tasks)
/cost          — Check token usage
/model         — Switch model (opus for complex, sonnet for routine)
Shift+Tab      — Toggle Plan Mode (Claude plans but doesn't execute)
Esc            — Stop Claude mid-action
@filename      — Reference a specific file
!command       — Run a shell command and feed output to Claude
```

### Daily Workflow with Claude Code
```
Morning:
  cd padvik
  claude
  > "Read CLAUDE.md. What did we work on yesterday? What's next on the sprint?"
  > [Start building the day's backend features]

When switching tasks:
  /clear
  > "Now let's work on [different feature]"

Before ending:
  > "Commit all changes and update CHANGELOG.md with today's work"
```

---

## 2. IDE FOR DEBUGGING — USE VS CODE + CURSOR

### Recommended Setup: Split Workflow

```
┌─────────────────────────────────────────────────────────┐
│                     YOUR WORKFLOW                         │
├──────────────────────┬──────────────────────────────────┤
│  TERMINAL (Claude    │  VS CODE / CURSOR                │
│  Code CLI)           │  (Debugging + Frontend)           │
│                      │                                   │
│  • Backend APIs      │  • Breakpoint debugging           │
│  • DB migrations     │  • Component development          │
│  • AI integrations   │  • React DevTools                 │
│  • Scraping logic    │  • Network tab inspection         │
│  • Complex business  │  • TypeScript type checking       │
│    logic             │  • Git diff viewing               │
│                      │  • File searching                 │
│  Run in VS Code's    │  • UI visual feedback             │
│  integrated terminal │                                   │
└──────────────────────┴──────────────────────────────────┘
```

### Primary IDE: Cursor
- It IS VS Code (fork) so you get all VS Code debugging features
- Built-in AI assistance (Cursor Tab, Cmd+K, Chat)
- Use Cursor for all frontend work and debugging
- Claude Code runs in Cursor's integrated terminal — changes appear instantly in the editor

### How to Debug in Cursor / VS Code

**Next.js Server-Side (API routes, server components):**
Create `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Next.js: debug server",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["dev"],
      "port": 9229,
      "console": "integratedTerminal",
      "serverReadyAction": {
        "pattern": "- Local:.+(https?://.+)",
        "uriFormat": "%s",
        "action": "debugWithChrome"
      }
    },
    {
      "name": "Next.js: debug client",
      "type": "chrome",
      "request": "launch",
      "url": "http://localhost:3000"
    },
    {
      "name": "Next.js: debug full stack",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["dev"],
      "port": 9229,
      "serverReadyAction": {
        "pattern": "- Local:.+(https?://.+)",
        "uriFormat": "%s",
        "action": "debugWithChrome"
      }
    }
  ]
}
```

**Recommended VS Code / Cursor Extensions:**
```
- ESLint (dbaeumer.vscode-eslint)
- Prettier (esbenp.prettier-vscode)
- Tailwind CSS IntelliSense (bradlc.vscode-tailwindcss)
- Prisma / Drizzle extension
- PostgreSQL Explorer (ckolkman.vscode-postgres)
- Thunder Client (REST API testing)
- Error Lens (usernamehw.errorlens) — inline error display
- GitLens (eamodio.gitlens)
- React Developer Tools (via Chrome)
```

### The Split-Screen Pattern
1. Left panel: Cursor editor with your code
2. Bottom panel: Two terminal splits
   - Terminal 1: `pnpm dev` (Next.js dev server)
   - Terminal 2: `claude` (Claude Code session)
3. Right panel: Browser with your app + DevTools open

This way, when Claude Code makes changes in Terminal 2, you see the file update instantly in the editor (left panel), and the Next.js dev server (Terminal 1) hot-reloads the browser (right panel).

---

## 3. PURPLE THEME — PADVIK BRAND COLORS

### shadcn/ui Purple Theme Configuration

We'll use a deep purple (violet) as the primary color, which gives a scholarly, premium feel for an education platform.

**Color Palette:**
```
Primary:      hsl(263, 70%, 50%)    — #7C3AED (Violet-600)
Primary Dark: hsl(263, 70%, 40%)    — #6D28D9 (Violet-700)
Primary Light: hsl(263, 70%, 96%)   — #F5F3FF (Violet-50)
Accent:       hsl(280, 65%, 60%)    — #A855F7 (Purple-500)
Background:   hsl(0, 0%, 100%)      — White
Foreground:   hsl(263, 47%, 13%)    — Dark purple-black
Card:         hsl(263, 30%, 98%)    — Very light purple tint
Destructive:  hsl(0, 84%, 60%)     — Red for errors
Success:      hsl(142, 76%, 36%)   — Green for correct answers
Warning:      hsl(38, 92%, 50%)    — Amber for warnings
```

The theme CSS variables and Tailwind config are in the tailwind-theme.ts file (attached).

---

## 4. PWA — NOT A SEPARATE MOBILE APP

### Decision: PWA First, Native Later (If Ever)

**Go with PWA.** Here's why it's the right call for Padvik:

**Why PWA wins for an Indian education platform:**

1. **Zero friction onboarding.** Indian students (especially in smaller towns like Adoor) don't want to download a 100MB app. A PWA is instant — share a link on WhatsApp, student opens it, starts learning. No Play Store, no storage anxiety.

2. **Works on low-end devices.** Many Indian students use budget Android phones with 2-3GB RAM and limited storage. PWAs run lighter than native apps and don't eat storage.

3. **Offline support built in.** Service workers cache syllabus data, notes, and questions locally. Students can study even without internet — critical for rural Kerala and other areas.

4. **SEO = free acquisition.** "CBSE Class 10 Science syllabus" gets massive Google search volume. A PWA is fully indexable — every topic page is a landing page. A native app is invisible to Google.

5. **Single codebase = ship 3x faster.** You're one person. Building Next.js gives you web + PWA + "mobile app feel" from one codebase. No maintaining separate iOS/Android/web.

6. **Push notifications work.** PWAs support push notifications on Android (97% of Indian smartphones) and recent iOS versions. You can remind students about study streaks, exam dates, etc.

7. **Cost savings of 50-70%.** PWA dev costs roughly half of native + web dual development.

8. **WhatsApp shareability.** Teachers can share a Padvik topic link on WhatsApp groups → student opens directly in browser → adds to home screen. This viral loop doesn't work with app store links.

**What you DON'T need native for:**
- No camera/AR features needed
- No Bluetooth/NFC needed
- No heavy gaming/graphics
- No background GPS tracking
- Content consumption is PWA's sweet spot

**The future path if needed:**
```
Phase 1 (Now):     PWA with Next.js (installable, offline, push notifications)
Phase 2 (6+ months): Capacitor wrapper → publish to Play Store as APK (same codebase)
Phase 3 (If needed): React Native for truly native features (rare for education)
```

Capacitor (by Ionic) can wrap your Next.js PWA into a Play Store app with one command — so you get app store presence without separate native development.

### PWA Setup in Next.js
This requires `next-pwa` or `@serwist/next` package. The manifest and service worker config will be created during project scaffold.

Key PWA files:
```
public/manifest.json       — App name, icons, theme color (purple)
public/icons/              — Icon set (192x192, 512x512, maskable)
src/app/layout.tsx         — <link rel="manifest"> + meta tags
next.config.ts             — PWA plugin config
```

---

## 5. QUICK START CHECKLIST

```
□ Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash
□ Install Cursor: https://cursor.com/downloads
□ Install Node.js 22 LTS: https://nodejs.org
□ Install pnpm: npm install -g pnpm
□ Set up PostgreSQL 16 locally (or use Supabase)
□ Set up Redis locally (or use Upstash)
□ Create Anthropic API key: console.anthropic.com
□ Create OpenAI API key: platform.openai.com (fallback)
□ Create AWS account + S3 bucket (ap-south-1 Mumbai)
□ Create project: mkdir padvik && cd padvik && git init
□ Copy all config files (CLAUDE.md, AGENTS.md, rules, docs)
□ Open in Cursor
□ Open integrated terminal → run `claude`
□ First prompt: scaffold the Next.js project
□ Second prompt: create database schemas
□ Third prompt: seed boards data
□ Start building the syllabus scraping pipeline
```
