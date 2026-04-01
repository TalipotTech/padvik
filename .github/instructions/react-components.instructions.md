---
applyTo: "src/app/**/*.tsx,src/components/**/*.tsx"
---
# React Component Rules

## Server vs Client
- Server Components by default — fetch data directly with async/await, no useEffect for data
- Add `'use client'` only when the component needs useState, useEffect, event handlers, or browser APIs
- Page-level data fetching happens in Server Components; interactivity is delegated to child Client Components

## Data Fetching
- Server Components: query Drizzle directly or call server actions
- Client Components: TanStack Query hooks from `src/hooks/`
- Always handle 3 states: loading (use shadcn Skeleton), error (message + retry button), empty (helpful message with action)

## Forms
- Use react-hook-form with zodResolver for all forms
- Shared Zod schemas from `src/lib/validators.ts`
- Show inline field errors below inputs, not toast-only
- Disable submit button while submitting, show loading spinner

## Layout Patterns
- Dashboard pages: sidebar (collapsible on mobile) + main content area
- Syllabus explorer: tree navigation left, content right (stacked on mobile)
- Exam taking: full-screen focused mode, question nav sidebar
- Chat: messages list + input bar fixed at bottom, conversation list in sheet/sidebar

## Component Composition
- Page-specific components go in `src/app/(dashboard)/[feature]/_components/`
- Shared components go in `src/components/[domain]/` (syllabus, exam, content, chat, analytics)
- Reusable UI primitives stay in `src/components/ui/` (shadcn)

## Accessibility
- All interactive elements need aria-label or visible label
- Semantic HTML: nav, main, article, section, aside, header, footer
- Buttons need explicit `type="button"` or `type="submit"`
- Images need alt text; decorative images use `alt=""`
- Focus management: trap focus in modals/dialogs, return focus on close
- Keyboard nav: all features must work without a mouse
