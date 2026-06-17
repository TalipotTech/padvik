# Adaptive Visual Topic Explainer

Feature reference. The original product spec lives in
[adaptive-visual-explainer-prompt.md](adaptive-visual-explainer-prompt.md);
this document describes **what was actually built** and how the pieces fit.

## What it is

When a student opens a topic in "Visual Cards" mode, they get a short deck of
explanation cards — each card teaches **one** atomic concept with a visual
(SVG diagram, formula, analogy, comparison, steps, or an inline MCQ). On every
card the student can:

- **Got it** → advance to the next card
- **Explain differently** → AI generates a fresh card using a *different*
  approach (never repeats the one they just saw)
- **Ask AI** → type a question and get a targeted answer card

It adapts: after repeated "Explain differently" on a Standard-level card it
auto-drops to a Foundation deck. On completion it writes a mastery score back
into the existing analytics and offers the Advanced level.

Design principles enforced in code: one card at a time, every card has a
visual, never repeat an approach, progress always resumable, gentle
celebration on completion. It is deliberately **not** a slide deck.

## Architecture at a glance

```
Student → /topics/[id]/learn (page, full-screen)
            │
            ├─ GET  /api/topics/[id]/explainer          → deck + progress (generates on-demand if missing)
            ├─ POST /api/topics/[id]/explainer/progress → got_it | explain_more | ask_question
            └─ GET  /api/topics/[id]/explainer/status   → lightweight availability (no generation)

Generation:  src/lib/explainer/generate-deck.ts      (full deck, Sonnet)
             src/lib/explainer/generate-realtime.ts  (single card, Haiku)
             src/lib/explainer/bulk-generate.ts      (admin batch)
Prompts:     src/lib/ai/prompts/visual-explainer.ts
Validation:  src/lib/explainer/types.ts (Zod schemas + visual-block guard)

Admin:       POST /api/admin/explainer/generate  (bulk)
             GET  /api/admin/explainer/stats      (coverage + stuck topics)

Storage:     topic_explainer_decks, student_explainer_progress (src/db/schema/explainers.ts)
```

All AI calls go through the existing `src/lib/ai/provider.ts` (`aiChat`) — it
was **not** modified.

## Data model — `src/db/schema/explainers.ts`

**`topic_explainer_decks`** — one cached deck per `(topic, level, language)`.
`level` is `1=foundation | 2=standard | 3=advanced`. `cards_json` holds the
validated `ExplainerCard[]`. Also tracks `generation_model`, `generation_cost`,
`quality_score`, `view_count`, `avg_completion`. Unique on
`(topic_id, level, language)`; indexed on `(topic_id, level, language)` and
`(subject_id, standard_id, level)`.

**`student_explainer_progress`** — one row per `(student, topic)`. Tracks
`current_card`, `current_level`, `cards_completed`, `re_explanations`,
`questions_asked`, `level_dropped`, `level_raised`, `completed`,
`time_spent_secs`. Two extra JSONB columns beyond the original spec:
- `approaches_used` — approaches already shown, so re-explanations never repeat
- `extra_cards` — the real-time re-explanation / Q&A cards generated for this
  student (so the Study Journal can replay them)

Migration: `drizzle/0014_black_lady_ursula.sql` (all PKs `BIGINT GENERATED
ALWAYS AS IDENTITY`, all timestamps `TIMESTAMPTZ`, per project rules).

## Card shape — `src/lib/explainer/types.ts`

An `ExplainerCard` has `title`, optional `subtitle`, an `approach`
(`analogy | diagram | numerical | real_world | comparison | guided_problem`),
`estimatedReadTime`, and `blocks[]`. Block types:

`text`, `heading`, `formula` (KaTeX), `diagram` (inline SVG), `image`,
`callout` (tip/warning/remember/example), `comparison`, `steps`, `analogy`
(source→target mapping), `quick_check` (inline MCQ), `interactive_reveal`,
`animation` (step-through SVG frames).

Every card is validated with Zod and must contain **at least one visual block**
(`cardHasVisual()`); text-only cards are rejected. `extractJson()` tolerates
fenced / prefixed AI output.

## Generation

- **Full deck** (`generateTopicDeck`) — loads topic context (board, class,
  subject, chapter, objectives), builds a level-specific prompt, calls
  `aiChat` with the Sonnet model, validates, and upserts the deck. **Output
  cap is 16000 tokens** — SVG-heavy decks were truncating at the old 6k cap and
  failing to parse; there's now an explicit truncation guard that throws a
  clear error instead of a cryptic JSON failure.
- **Single card** (`generateReExplanation`) — used for "Explain differently"
  and "Ask AI". Uses the cheaper Haiku model, rotates to an approach not in
  `previousApproaches`, 4000-token cap with the same guard.
- **Bulk** (`bulkGenerateDecks`) — finds topics lacking a deck at a given
  level (filterable by board/subject/standard/grade) and generates with a
  5s rate-limit between calls. Runs **inline** (invoked by the admin route),
  not via BullMQ — see "Deviations" below.

## API

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/topics/[id]/explainer` | student | Returns the deck + progress; resumes or starts at Level 2; **generates on-demand** if no deck exists; returns `hasLevel1/2/3`. |
| `POST /api/topics/[id]/explainer/progress` | student | `got_it` (advance / complete + mastery sync), `explain_more` (drop level or generate re-explanation), `ask_question` (targeted answer). |
| `GET /api/topics/[id]/explainer/status` | student | Lightweight: `{ hasDeck, levels, progress }`, **never generates**. Powers the button states. |
| `POST /api/admin/explainer/generate` | admin | Bulk generation (server-capped at 50). |
| `GET /api/admin/explainer/stats` | admin | Coverage by board/subject, avg completion, most "stuck" topics (highest re-explanation rate). |

## Frontend — `src/components/explainer/`

- **`ExplainerView.tsx`** — full-screen container. One card at a time, progress
  bar, level chip, topic meta line (subject · chapter · board · class · year).
  Handles got_it / explain_more / ask_question and the overlay model for
  re-explanations.
- **`ExplainerCard.tsx`** — renders one card; blocks fade in one-by-one like a
  tutor writing on a board.
- **`blocks.tsx`** — renderer per block type. SVG is **sanitized** (strips
  `<script>` and `on*` handlers) before `dangerouslySetInnerHTML`; formulas via
  KaTeX; markdown via react-markdown + remark-math/rehype-katex.
- **`ExplainerActions.tsx`** — the three-button bar + inline "Ask AI" textarea.
- **`ExplainerComplete.tsx`** — completion summary + "try advanced" / back.
- **`VisualCardsButton.tsx`** — the entry-point button. Calls the status
  endpoint and shows the real state before clicking: **Generate Cards** (no
  deck yet) / **Visual Cards** / **Resume Cards** / **Review Cards**. On click
  it navigates programmatically and immediately shows a disabled
  "Generating…/Opening…" spinner so a slow first generation can't be
  double-fired. Optional `showHelp` renders a help popover.
- **`HelpHint.tsx`** — reusable "?" affordance (hover tooltip + click popover)
  used on the Visual Cards and Build Foundations buttons.

Route: **`src/app/(dashboard)/topics/[topicId]/learn/page.tsx`** with a
**`loading.tsx`** that shows "Creating your visual cards…" instantly during
on-demand generation, so the click is never a frozen screen.

Dependencies: `katex`, `react-markdown`, `remark-gfm`, `remark-math`,
`rehype-katex` (already in package.json). `@radix-ui/react-popover` wrapped in
`src/components/ui/popover.tsx`.

## Entry points

The feature sits alongside the existing **Playground** and **Curriculum**
views as a third "Visual Cards" mode:

- **Curriculum** (`syllabus-explorer.tsx`) — Visual Cards button in the topic
  toolbar and in the topic content header.
- **Playground** (`learn-view.tsx`) — Visual Cards button in the topic header,
  next to Build Foundations.

Both header placements also carry the `?` help popovers.

## Behavior tracking → mastery

On completion, `progress` writes a mastery score into the existing
`student_progress` analytics table:

- completed Level 2, 0 re-explanations → `1.00`
- 1–2 re-explanations → `0.85`
- 3+ re-explanations → `0.75`
- dropped to Foundation → `0.60`
- not completed → `0.40`
- completed Level 3 → `1.00` (capped)

It also maintains the deck's running `avg_completion`.

## Study Journal integration

`/api/learn/journal?tab=cards` returns each `(student, topic)` session with the
deck cards + the student's `extra_cards`. The Study Journal **Cards** tab lists
sessions (level, progress, completed/in-progress) and the detail pane shows a
summary (cards, minutes, re-explanations, questions, level) plus the actual
cards re-rendered read-only, with a Resume/Review button back into the deck.

## Caching

- Pre-generated decks are cached in `topic_explainer_decks` and reused.
- Real-time re-explanations are cached per student in
  `student_explainer_progress.extra_cards`.

## Operating it

- **Test harness**: `pnpm tsx scripts/setup-explainer-test.ts` ensures a real
  student account (`teststudent@gmail.com` / `Test1234`) and lists CBSE Class
  10 topics with their deck status. `--subject "Mathematics"` to filter.
- **Pre-generate decks**: admin → `POST /api/admin/explainer/generate`
  (or call `bulkGenerateDecks` from a script).
- **Run locally**: see [running-the-app.md](running-the-app.md). The explainer
  generates inline in the API route, so the BullMQ **worker is not required**
  for it.

### Cost (Sonnet for decks, Haiku for re-explanations)

- A 7-card deck ≈ **$0.10–0.12**, generated once then cached.
- A re-explanation / answer card ≈ **~$0.01**.

## Deviations from the original spec & deferred work

Implemented differently (deliberate):
- **Bulk generation runs inline**, invoked by the admin route, instead of a
  registered BullMQ `generate-explainer-decks` job. Kept out of the existing
  queues to avoid interfering with the scrape/content pipelines. Moving it onto
  BullMQ is the natural next step for large batches.
- Re-explanation **replaces** the current card via an overlay (tap "Got it" to
  return) rather than a back-swipe gesture.

Not yet built (future):
- **Smart promotion**: promoting a popular re-explanation to a main-deck
  variant after N students get the same approach (`extra_cards` is stored, the
  promotion job isn't written).
- **AI self-rating** populating `quality_score`, and an admin **edit cards** UI.
- **"Report issue"** button on a card.
- Server-side **SVG well-formedness / KaTeX parse** validation and
  per-card regeneration (currently invalid/text-only cards are dropped; the
  frontend sanitizes SVG and KaTeX renders with `throwOnError: false`).
- Dashboard "topics that need attention" and parent-report surfacing of low
  mastery scores.

## Key files

```
src/db/schema/explainers.ts
drizzle/0014_black_lady_ursula.sql
src/lib/ai/prompts/visual-explainer.ts
src/lib/explainer/{types,generate-deck,generate-realtime,bulk-generate}.ts
src/app/api/topics/[topicId]/explainer/{route,progress/route,status/route}.ts
src/app/api/admin/explainer/{generate,stats}/route.ts
src/app/(dashboard)/topics/[topicId]/learn/{page,loading}.tsx
src/components/explainer/*.tsx
src/components/ui/popover.tsx
scripts/setup-explainer-test.ts
```
