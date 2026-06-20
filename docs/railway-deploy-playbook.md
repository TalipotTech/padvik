# Railway Deployment Playbook (reusable reference)

A battle-tested guide for deploying a web app + PostgreSQL to **Railway**, distilled from a
real deploy (Spring Boot API + Vite SPA + Postgres). Written to be **stack-agnostic**, with
**Next.js + Postgres** specifics called out — drop it into a new repo and adapt.

> The "Gotchas" section (§4) is the valuable part — these are mistakes that only surface on
> Railway, not locally. Read it before you start.

---

## 1. Mental model

- **One Railway "service" per component.** Typically: a **Postgres** service, your **app**
  service(s). A monorepo with separate frontend/backend = two app services, each with its own
  **Root Directory**. A Next.js full-stack app = usually **one** app service.
- **Railway builds from your connected GitHub repo + branch, on push.** It checks out a
  **clean copy** — anything gitignored or unpushed is NOT in the build (see §4.2).
- **Two networks:** a **private** network (`*.railway.internal`, service-to-service, no SSL
  needed) and **public** domains you explicitly generate. Services talk to the DB over the
  private network.
- **`$PORT` is injected.** Your app MUST listen on `process.env.PORT` / `$PORT`. Railway routes
  public traffic to whatever port your app listens on.
- **Variable references** link services: `${{ServiceName.VAR}}` resolves another service's var
  at deploy time — no copy-pasting credentials.

---

## 2. Step-by-step

1. **Provision Postgres.** `+ New → Database → PostgreSQL` (or a template — see §4.7 if you'll
   need extensions like `pgvector`/`postgis`). Wait for **Active**.
2. **Create the app service.** `+ New → GitHub Repo → <repo>`. For a monorepo set
   **Settings → Root Directory** (e.g. `frontend`, `backend`, or repo root). Railway auto-detects
   the build (Nixpacks) or uses your `Dockerfile`.
3. **Set environment variables** on the app service (§3).
4. **Generate a public domain:** app service → **Settings → Networking → Generate Domain**.
5. **Deploy:** push to the tracked branch (Railway auto-builds), or **Deployments → Deploy**.
6. **Verify** (§5).

---

## 3. Environment variables

**Database — reference the Postgres service** (don't paste credentials):
```
# Node/Prisma/Drizzle: a single URL is usually enough —
DATABASE_URL = ${{Postgres.DATABASE_URL}}
# Prefer the PRIVATE url for app->db traffic if exposed:
DATABASE_URL = ${{Postgres.DATABASE_PRIVATE_URL}}
```
If you build the URL from parts instead, reference each (`PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD`)
— but read §4.1 about `PGHOST`.

**App secrets** set by hand (never commit): auth secrets, API keys, SMTP creds, etc.

**Railway provides automatically** (do not set): `PORT`, and on the DB service the `PG*` /
`DATABASE_URL` / `RAILWAY_PRIVATE_DOMAIN` vars.

---

## 4. Gotchas (the hard-won lessons)

### 4.1 The DB's `PGHOST` is often `0.0.0.0` — don't use it as a connect host
A managed Postgres service may expose its own `PGHOST=0.0.0.0` (its internal *bind* address).
Connecting to that from the app fails. Use the **private domain** instead:
```
PGHOST = ${{Postgres.RAILWAY_PRIVATE_DOMAIN}}     # -> something.railway.internal
# or hardcode: PGHOST = <service-name>.railway.internal
```
With a single URL var, prefer `DATABASE_PRIVATE_URL` (already uses the internal host).

### 4.2 Railway builds from a CLEAN git checkout
- **Unpushed commits don't deploy.** `git push` first; Railway builds the pushed branch.
- **Gitignored files aren't in the build.** If runtime config lives in a gitignored file
  locally, the deployed build won't have it → crash. Use **env vars** for config, or commit a
  template and materialize it at build. (Next.js reads env vars natively, so this is mostly a
  non-issue — but never rely on a gitignored `.env` being present in the build.)

### 4.3 Build-time vs runtime env vars — the #1 frontend trap
Client-exposed vars are **inlined at BUILD time**:
- **Next.js:** only `NEXT_PUBLIC_*` reach the browser, and they're **baked at build**. They must
  exist as build-time variables; setting them at runtime does NOT change the built bundle.
  Server-only env vars (no `NEXT_PUBLIC_`) are read at **runtime** — fine to set normally.
- **Vite:** same idea with `VITE_*`.
If you change a `NEXT_PUBLIC_*` value, you must **rebuild/redeploy**. Verify by grepping the
built output for the value.

### 4.4 Bind to `$PORT`
- **Next.js:** `next start` respects the `PORT` env var (Railway sets it) — usually nothing to do.
  If you customize the server, use `process.env.PORT`.
- **Static/nginx:** template `listen ${PORT};` and render it at start (nginx image's envsubst).
- **Spring/Java:** `server.port=${PORT:8080}`.

### 4.5 Healthchecks: don't let a non-critical dependency fail the deploy
If the platform healthcheck path returns unhealthy, the deploy fails. Make `/health` cheap and
not dependent on optional services (e.g. SMTP). Set the service **Healthcheck Path** to it.

### 4.6 Schema migrations on an EXISTING database
Auto-DDL ("create/update from models") often **won't** alter existing `CHECK` constraints, enum
value lists, or column types once data exists. Plan real migrations:
- **Prisma:** run `prisma migrate deploy` in the **release/build** step (not `db push` in prod).
- **Drizzle:** `drizzle-kit migrate`.
Remember to also apply one-off manual fixes to **prod** (a fresh local DB won't reveal them).

### 4.7 Pick the Postgres image for FUTURE needs up front
If you'll later need extensions (`pgvector`, `postgis`, etc.), provision a Postgres image that
ships them **now** (e.g. the **Supabase Postgres** template) — migrating the DB image after you
have production data is painful. Confirm availability:
`SELECT name FROM pg_available_extensions WHERE name IN ('vector','postgis');`

### 4.8 Managed Postgres may require SSL
Some images enforce SSL. Node clients: set `ssl: { rejectUnauthorized: false }` or append
`?sslmode=require` to `DATABASE_URL` if you hit SSL errors (internal/private connections often
don't need it).

### 4.9 CORS (only if frontend and API are different origins)
Allowlist the **exact deployed frontend origin**; never wildcard `*` together with credentials
(browsers reject it). Make the allowlist an env var. (Next.js full-stack with same-origin API
routes usually needs no CORS.)

### 4.10 The public DB proxy is internet-reachable
Railway exposes a public TCP proxy (`*.proxy.rlwy.net:port`) and `DATABASE_PUBLIC_URL`. Handy for
running migrations/seeds from your laptop — but it means the DB is reachable from the internet.
**Don't leak the password; rotate it if exposed; restrict the proxy if you don't need it.**

### 4.11 Seeding / running migrations against the Railway DB
From your machine: `railway connect Postgres` (psql shell), or
`psql "$DATABASE_PUBLIC_URL" -f seed.sql`, or your ORM's deploy command pointed at the public URL.

---

## 5. Verification checklist
- [ ] Build succeeds; logs show the app started (no crash loop)
- [ ] App reaches the DB (no connection/auth/SSL errors) — see §4.1, §4.8
- [ ] Migrations applied (tables/columns exist in the Railway DB)
- [ ] Public domain serves the app; healthcheck path returns 200
- [ ] Client-exposed (`NEXT_PUBLIC_*` / `VITE_*`) values are correct in the **built** output (§4.3)
- [ ] A full user round-trip works against the deployed DB (e.g. sign-up → login → an authed action)
- [ ] (SPA/multi-page) deep-link refresh doesn't 404 (SPA fallback / Next routing)

---

## 6. Next.js + Postgres quick recipe (for PadVik)
1. **Postgres service** (Supabase template if you'll need pgvector/postgis later).
2. **App service** from the repo, Root Directory = the Next.js app dir. Railway/Nixpacks detects
   Next.js (`npm run build` → `next start`); no Dockerfile required (add one only for
   `output: 'standalone'` slimming or custom needs).
3. **Variables:**
   - `DATABASE_URL = ${{Postgres.DATABASE_PRIVATE_URL}}` (or build from `PG*` with the private host).
   - Server secrets (auth, API keys) as normal runtime vars.
   - Any `NEXT_PUBLIC_*` as **build-time** vars (rebuild on change).
4. **Migrations:** add `prisma migrate deploy` (or drizzle migrate) to the build/release so the
   schema is applied on each deploy. For the first deploy, ensure the migration runs before the
   app serves traffic.
5. **Generate Domain**, then run §5.

---

*Distilled from a real Railway deploy (Spring Boot API + Vite SPA + PostgreSQL). The principles
in §4 are stack-independent; the §3/§6 specifics adapt per framework.*
