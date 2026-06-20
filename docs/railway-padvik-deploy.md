# Padvik — Railway deployment (project-specific)

Companion to `railway-deploy-playbook.md`. This records the concrete setup for
Padvik: **4 Railway services in one project** — Postgres, Redis, `web`, `worker`.

## Services & config-as-code

| Service    | Source            | Config file             | Start command   |
| ---------- | ----------------- | ----------------------- | --------------- |
| `Postgres` | Railway DB plugin | —                       | —               |
| `Redis`    | Railway DB plugin | —                       | —               |
| `web`      | GitHub repo       | `railway.web.json`      | `pnpm start`    |
| `worker`   | GitHub repo (same)| `railway.worker.json`   | `pnpm workers`  |

Both app services build from the **same repo**. Set each service's
**Settings → Config-as-code → Config File Path** to its file above.
`web` runs `pnpm db:migrate` as a **pre-deploy** step (migrations apply once,
on the web service only). `worker` does not migrate.

## Environment variables

### Shared (set on BOTH `web` and `worker`)

```
DATABASE_URL = ${{Postgres.DATABASE_PRIVATE_URL}}
REDIS_URL    = ${{Redis.REDIS_PRIVATE_URL}}      # or REDIS_URL if that's the exposed var name
NODE_ENV     = production

# AI providers (set the ones you use)
ANTHROPIC_API_KEY = sk-ant-...
OPENAI_API_KEY = sk-...
GOOGLE_GENERATIVE_AI_API_KEY =
MISTRAL_API_KEY =
PERPLEXITY_API_KEY =
SARVAM_API_KEY =
YOUTUBE_API_KEY =

# Auto-content pipeline
PADVIK_SYSTEM_CREATOR_ID = 6
DAILY_CONTENT_BUDGET = 5.00
AUTO_CONTENT_ENABLED = true
AUTO_CONTENT_EFFORT = medium

# File storage (S3, ap-south-1)
AWS_ACCESS_KEY_ID =
AWS_SECRET_ACCESS_KEY =
AWS_S3_BUCKET = padvik-uploads
AWS_REGION = ap-south-1

# TTS (optional)
ELEVENLABS_API_KEY =
ELEVENLABS_VOICE_ID =
GOOGLE_TTS_API_KEY =

# Error monitoring (optional)
SENTRY_DSN =
```

### `web` only

```
AUTH_SECRET     = <openssl rand -base64 32>     # NextAuth v5 (NEXTAUTH_SECRET also read)
NEXTAUTH_SECRET = <same value>                  # belt-and-suspenders for v5 compat
AUTH_TRUST_HOST = true                           # required: app runs behind Railway's proxy
NEXTAUTH_URL    = https://<your-web-domain>.up.railway.app

# Google OAuth (optional — login still works via email/password without it)
GOOGLE_CLIENT_ID =
GOOGLE_CLIENT_SECRET =

# Build-time, baked into the client bundle — must be set BEFORE the build runs.
# Changing these requires a redeploy. (playbook §4.3)
NEXT_PUBLIC_API_READY = true
NEXT_PUBLIC_SENTRY_DSN =
```

> Do **not** set `SKIP_AUTH` in production (it bypasses auth). Demo/phone-OTP
> logins are already gated to `NODE_ENV === "development"`, so they're inert in prod.

## Gotchas hit during this deploy

- **`drizzle/meta/` was gitignored** → committed it, else `drizzle-kit migrate`
  finds no journal and applies nothing (playbook §4.2).
- **`tsx` / `drizzle-kit` / `dotenv` were devDependencies** → moved to
  `dependencies`, because the worker runs via `tsx` and the pre-deploy migrate
  runs `drizzle-kit` in the production image.
- **Private Postgres host** — use `DATABASE_PRIVATE_URL` (the `*.railway.internal`
  host), not `PGHOST` which may be `0.0.0.0` (playbook §4.1). Internal traffic
  usually needs no SSL; if you hit an SSL error, append `?sslmode=require`.

## First-deploy order

1. Provision Postgres + Redis, wait for **Active**.
2. Create `web` from the repo → set config path `railway.web.json`, set vars, Generate Domain.
3. Create `worker` from the same repo → set config path `railway.worker.json`, set shared vars.
4. Push to `main` (Railway auto-builds). The web pre-deploy migrates the DB.
5. Verify per playbook §5: `/api/health` → 200, sign-up → login round-trip, worker logs show "All workers started".
```
