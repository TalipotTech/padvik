# Running Padvik Locally

Quick reference for everything you need to start, stop, and operate the app on Windows.

Cursor's terminal pools history across every project on the machine, so it's
easy to forget which `pnpm` you ran where. Pin this page and prefer the
[`run-padvik.ps1`](../run-padvik.ps1) launcher — it runs inside the current
Cursor terminal tab (no external windows) and renames the tab to `PADVIK - WEB`
/ `PADVIK - WORKERS` so you can find them in the tab dropdown.

---

## 1. One-time setup

```powershell
# From the project root:
pnpm install
copy .env.example .env.local      # then fill in real values
pnpm db:migrate                   # apply Drizzle migrations
pnpm db:seed                      # seed boards
```

Required services running on your machine (or via Docker):

| Service    | Default port | Used for                          |
| ---------- | ------------ | --------------------------------- |
| PostgreSQL | 5432         | Primary DB (Drizzle)              |
| Redis      | 6379         | BullMQ queues, rate limiting, cache |

---

## 2. The two processes that make up "the app"

Padvik is **two processes**, not one. Forgetting the worker is the #1 source of
"why is my scrape job stuck?" confusion.

| Process     | Command            | What it does                                            |
| ----------- | ------------------ | ------------------------------------------------------- |
| Web (Next)  | `pnpm dev`         | Next.js 15 + Turbopack, serves UI + API routes on :3000 |
| Workers     | `pnpm workers`     | BullMQ workers: scrape, content, file, pipeline, etc.   |

Run BOTH in separate terminals if you're working on anything that triggers a
background job (scraping, content generation, explainer deck generation, file
uploads, school imports).

---

## 3. Recommended: two Cursor terminal tabs

The launcher runs in the CURRENT terminal — it does NOT spawn external
PowerShell windows. Open two Cursor terminal tabs (`Ctrl+Shift+\`` to split,
or click `+` to add a tab) and run one role per tab:

```powershell
# Tab 1 — leave this running, watches and rebuilds
./run-padvik.ps1 web

# Tab 2 — leave this running, processes background jobs
./run-padvik.ps1 workers
```

Each tab renames itself (`PADVIK - WEB`, `PADVIK - WORKERS`) so the Cursor tab
dropdown shows you which is which.

Ctrl+C in a tab stops that process. Closing the tab also stops it.

### Single-tab mode (merged output)

If you only have one tab to spare, run both in the same terminal with output
streams prefixed:

```powershell
./run-padvik.ps1 both
# Output lines are tagged:
#   [WEB] ...   from pnpm dev
#   [WRK] ...   from pnpm workers
```

Ctrl+C stops both.

### Other launcher modes

```powershell
./run-padvik.ps1 web         # Next.js dev server in this tab
./run-padvik.ps1 workers     # BullMQ workers in this tab
./run-padvik.ps1 both        # both in one tab, merged output with prefixes
./run-padvik.ps1 studio      # Drizzle Studio on :4983
./run-padvik.ps1 build       # production build
./run-padvik.ps1 start       # production start (after build)
./run-padvik.ps1 stop        # kill node/pnpm processes for this project
./run-padvik.ps1 help        # show usage
```

---

## 4. All commands by category

### Dev

```powershell
pnpm dev          # Next.js with Turbopack on http://localhost:3000
pnpm workers      # Start all BullMQ workers (scrape, content, file, pipeline, creator, school)
pnpm lint         # ESLint
pnpm format       # Prettier write
pnpm format:check # Prettier check (CI)
```

### Build / production

```powershell
pnpm build        # next build
pnpm start        # next start  (run AFTER pnpm build)
```

### Database (Drizzle)

```powershell
pnpm db:generate          # Generate SQL migrations from schema changes
pnpm db:migrate           # Apply pending migrations
pnpm db:push              # Push schema to DB without migrations (dev only)
pnpm db:studio            # Drizzle Studio at http://localhost:4983
pnpm db:seed              # Seed boards
pnpm db:seed:curriculum   # Seed curriculum
```

### Scraping / content (one-shot scripts via tsx)

```powershell
pnpm scrape                                    # run-scraper.ts
pnpm tsx scripts/full-content-pipeline.ts      # End-to-end content pipeline
pnpm tsx scripts/bootstrap-core-content.ts     # Seed first-pass content
pnpm tsx scripts/auto-publish-high-quality-ncert.ts
pnpm tsx scripts/audit-content-coverage.ts
# Any other file in scripts/ runs the same way: pnpm tsx scripts/<name>.ts
```

---

## 5. URLs and ports

| What             | URL                          |
| ---------------- | ---------------------------- |
| App              | http://localhost:3000        |
| Admin            | http://localhost:3000/admin  |
| Drizzle Studio   | http://localhost:4983        |
| Postgres         | localhost:5432               |
| Redis            | localhost:6379               |

---

## 6. Common troubleshooting

**"Connection refused" on Redis / Postgres**
Start the service. On Windows with Docker Desktop:
```powershell
docker start padvik-postgres padvik-redis
```

**"Worker started but job never runs"**
You ran `pnpm dev` but forgot `pnpm workers`. Open another terminal and start
the workers — or just use `./run-padvik.ps1`.

**Port 3000 already in use**
Either another `pnpm dev` is still running (use `./run-padvik.ps1 stop`) or
something else owns the port:
```powershell
netstat -ano | findstr :3000
taskkill /F /PID <pid>
```

**App suddenly returns 500 on every route / build fails with `/_not-found`**
You ran `pnpm build` while `pnpm dev` was running — they share the `.next`
folder and corrupt each other. Stop the dev server, then either restart it
(`./run-padvik.ps1 web`) or, to run a clean production build, stop dev first.
To type-check without touching `.next`, use `npx tsc --noEmit` instead.

**Type errors after a schema change**
```powershell
pnpm db:generate    # produce migration
pnpm db:migrate     # apply it
# Restart pnpm dev so Next picks up the new types
```

**Cursor terminal history is too noisy**
Use `./run-padvik.ps1 web` and `./run-padvik.ps1 workers` in separate Cursor
tabs. Each tab renames itself (`PADVIK - WEB`, `PADVIK - WORKERS`) so you can
identify them in the Cursor tab dropdown without scrolling shared history.

---

## 7. Typical day-to-day workflow

```powershell
# Morning:
# Tab 1 in Cursor:
./run-padvik.ps1 web
# Tab 2 in Cursor:
./run-padvik.ps1 workers

# Edit code in Cursor — Turbopack hot-reloads the web tab automatically.

# After editing a Drizzle schema (src/db/schema/*.ts), in a third tab:
pnpm db:generate
pnpm db:migrate

# Before committing:
pnpm lint
pnpm build       # catch type errors that dev mode hides

# End of day: Ctrl+C in each tab, or close them.
# If something gets wedged:
./run-padvik.ps1 stop
```
