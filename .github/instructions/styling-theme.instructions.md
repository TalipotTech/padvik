---
applyTo: "**/*.css,tailwind.config.ts,src/components/**/*"
---
# Styling & Purple Theme

## Color System
- Primary: `bg-primary` / `text-primary` — violet-600 (#7C3AED)
- Use CSS variables from globals.css, never hardcoded hex
- Semantic education colors available in Tailwind config:
  - `mastered` (green) — completed topics, correct answers
  - `learning` (amber) — in-progress topics
  - `not-started` (muted purple) — untouched topics
  - `correct` (green), `incorrect` (red), `skipped` (muted) — exam answers
- Direct violet palette available: `violet-50` through `violet-950` for custom needs

## Dark Mode
- Every component must work in both modes
- Add `dark:` variants for any custom color usage beyond CSS variables
- Background: white in light, deep purple-black in dark (`--background` variable handles this)

## Responsive
- Mobile-first always: write base (mobile), then add `sm:` `md:` `lg:` `xl:`
- Sidebar → bottom sheet/nav on mobile
- Data tables → card layout on mobile
- Multi-column grids: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
- Touch targets: `min-h-11 min-w-11` (44px) on all tappable elements
- Readable text: minimum `text-sm` (14px), body defaults to `text-base` (16px)

## shadcn/ui Usage
- Always check `src/components/ui/` before building custom components
- Key components: Button, Card, Input, Select, Dialog, Sheet, Tabs, Badge, Skeleton, Separator, Avatar, DropdownMenu, Command, Popover
- Loading states: use Skeleton component, not custom spinners
- Forms: use shadcn Form + FormField + FormItem pattern with react-hook-form

## Animation
- Use Tailwind utilities: `animate-fade-in`, `animate-slide-in`, `animate-pulse-soft`
- Keep subtle — max 300ms for UI transitions
- Respect `motion-safe:` prefix for animations
- Page transitions: fade-in on route change
