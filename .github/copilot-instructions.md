# Padvik — Copilot Instructions

## Project
Padvik is an AI-powered K-12 curriculum learning platform for Indian education boards (CBSE, ICSE, Kerala State, 28+ state boards). Next.js 15 App Router, TypeScript, Tailwind CSS, shadcn/ui, PostgreSQL 16 with Drizzle ORM, Auth.js, Claude API. PWA — no native mobile app. Purple theme (#7C3AED).

## Rules
- All database PKs are BIGINT — never UUID
- pnpm only — never npm or yarn
- TypeScript strict — no `any` without explicit justification
- API responses: `{ success, data?, error?: { code, message } }`
- Zod for all input validation
- Server Components by default — `'use client'` only for interactivity
- File naming: kebab-case files, PascalCase components, camelCase functions
- AI calls go through `src/lib/ai/provider.ts` only — never import SDKs directly
- Purple theme via CSS variables — don't hardcode hex colors
- All components must support dark mode via `dark:` variant
- Mobile-first responsive: base → `sm:` → `md:` → `lg:` → `xl:`
- Use shadcn/ui from `@/components/ui/` — check existing before building custom
- Touch targets minimum 44x44px
- `cn()` from `src/lib/utils.ts` for conditional Tailwind classes
