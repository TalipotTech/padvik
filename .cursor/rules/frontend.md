# Cursor Rules — Padvik Frontend

## Framework
- Next.js 15 App Router, TypeScript strict, Tailwind CSS, shadcn/ui
- Server Components by default; `'use client'` only for interactivity
- pnpm only — never npm or yarn

## Components
- Page-specific: `src/app/(dashboard)/[feature]/_components/`
- Shared: `src/components/[domain]/` (syllabus, exam, content, chat, analytics)
- UI primitives: `src/components/ui/` (shadcn) — always check before building custom
- Every data component needs loading (Skeleton), error, and empty states

## Forms
- react-hook-form + zodResolver for all forms
- Shared schemas in `src/lib/validators.ts`
- Inline field errors below inputs

## State
- Server state: TanStack Query with server actions
- Client state: useState/useReducer for local UI only
- No Redux/Zustand unless specifically needed

## Styling
- Purple theme: `bg-primary` = violet-600 (#7C3AED), use CSS variables not hex
- Dark mode: always add `dark:` variants
- Mobile-first: base → `sm:` → `md:` → `lg:` → `xl:`
- Touch targets: min 44x44px
- `cn()` utility for conditional classes

## Accessibility
- Semantic HTML: nav, main, article, section, aside
- ARIA labels on all interactive elements
- Keyboard navigation for all features
- Focus trap in modals, return focus on close

## Files
- Pages: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`
- Components: PascalCase (`SyllabusTree.tsx`)
- Hooks: camelCase with `use` prefix (`useExamAttempt.ts`)
