/**
 * /help/auto-content — Full workflow guide for the auto-content pipeline.
 */
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Coins,
  Cpu,
  LayoutDashboard,
  ListChecks,
  MousePointerClick,
  Radar,
  ServerCog,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Auto-Content Pipeline — Help" };

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------
function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon className="h-5 w-5 text-violet-600" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-semibold text-white">
        {n}
      </span>
      <div className="space-y-1 pt-0.5">
        <p className="font-medium text-foreground">{title}</p>
        <div>{children}</div>
      </div>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function AutoContentHelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Link href="/help" className="hover:text-foreground">
            Help
          </Link>{" "}
          / Auto-Content Pipeline
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Auto-Content Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          The pipeline watches what students struggle with, generates study material with AI,
          and publishes it under the <span className="font-medium">Padvik Official</span> account
          — automatically every night, or on demand from the dashboard.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild>
            <Link href="/auto-content">
              <LayoutDashboard className="h-4 w-4" /> Open Dashboard
            </Link>
          </Button>
        </div>
      </div>

      {/* Workflow at a glance */}
      <Section icon={Activity} title="The workflow at a glance">
        <p>Every piece of content moves through the same five stages:</p>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <span className="rounded-full bg-muted px-2.5 py-1">1 · Demand</span>
          <span className="text-muted-foreground">→</span>
          <span className="rounded-full bg-muted px-2.5 py-1">2 · Queue</span>
          <span className="text-muted-foreground">→</span>
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-600">3 · Generate</span>
          <span className="text-muted-foreground">→</span>
          <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-violet-600">4 · Review</span>
          <span className="text-muted-foreground">→</span>
          <span className="rounded-full bg-green-500/15 px-2.5 py-1 text-green-600">5 · Publish</span>
        </div>
        <p>
          Students generate <strong>demand signals</strong> as they use the app. The orchestrator
          turns the highest-demand topics into <strong>jobs</strong>, each job runs through an AI{" "}
          <strong>generator</strong>, and the result is either auto-published or held for your{" "}
          <strong>review</strong>.
        </p>
      </Section>

      {/* Prerequisites */}
      <Section icon={ServerCog} title="Before anything runs — required services">
        <p>
          The dashboard only <em>queues</em> work. Jobs are processed by a background worker, so
          these must be running:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <Code>pnpm dev</Code> — the web app &amp; admin dashboard
          </li>
          <li>
            <Code>pnpm workers</Code> — <strong>the background worker</strong> that actually
            generates content. If this is not running, clicking <em>Generate</em> does nothing
            visible.
          </li>
          <li>Redis &amp; PostgreSQL up (the queue and the database)</li>
          <li>
            <Code>.env.local</Code> has <Code>PADVIK_SYSTEM_CREATOR_ID</Code>,{" "}
            <Code>ANTHROPIC_API_KEY</Code>, <Code>DATABASE_URL</Code>, <Code>REDIS_URL</Code>.
            For audio also set a TTS key (<Code>ELEVENLABS_API_KEY</Code> /{" "}
            <Code>GOOGLE_TTS_API_KEY</Code> / <Code>SARVAM_API_KEY</Code>).
          </li>
        </ul>
        <p>
          Set <Code>AUTO_CONTENT_ENABLED=false</Code> to pause the nightly cycle without touching
          manual generation.
        </p>
      </Section>

      {/* Manual generation */}
      <Section icon={MousePointerClick} title="Generate content manually (dashboard)">
        <ol className="space-y-4">
          <Step n={1} title="Open the dashboard">
            Go to <Link href="/auto-content" className="text-violet-600 underline">Auto-Content</Link>{" "}
            (also in the header via <strong>Help → Open Dashboard</strong>).
          </Step>
          <Step n={2} title="Find a topic in “Top Demand Topics”">
            This table lists topics ranked by demand. If it&apos;s empty, no demand signals exist
            yet — see <em>“How topics get on the list”</em> below.
          </Step>
          <Step n={3} title="Pick a content type">
            Use the dropdown on the row: <Badge variant="secondary">Text Note</Badge>{" "}
            <Badge variant="secondary">Audio</Badge> <Badge variant="secondary">Question Set</Badge>.
            Text notes are the fastest and cheapest to start with.
          </Step>
          <Step n={4} title="Click Generate">
            This creates a top-priority job and queues it immediately. The worker picks it up
            within seconds.
          </Step>
          <Step n={5} title="Watch “Recent Activity”">
            Hit <strong>Refresh</strong>. Status moves{" "}
            <span className="font-medium">queued → generating → published</span> (or{" "}
            <span className="font-medium">reviewing</span> for audio).
          </Step>
        </ol>
        <p className="rounded-md bg-muted/60 p-3 text-xs">
          One topic can have only <strong>one job per content type</strong>. To make 5 test pieces,
          generate across 5 different topics, or mix types (e.g. a note + a question set on two
          topics).
        </p>
      </Section>

      {/* Auto-approve */}
      <Section icon={CheckCircle2} title="What publishes automatically vs. needs review">
        <ul className="space-y-2">
          <li className="flex items-center gap-2">
            <Badge className="bg-green-500/15 text-green-600">Auto-publish</Badge>
            <span>
              <strong>Question sets</strong> — low risk, students self-validate by attempting them.
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Badge className="bg-green-500/15 text-green-600">Auto-publish</Badge>
            <span>
              <strong>Text notes</strong> — only if they have ≥ 5 blocks and at least one visual.
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Badge className="bg-violet-500/15 text-violet-600">Needs review</Badge>
            <span>
              <strong>Audio explainers</strong> — TTS quality needs a human ear.
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Badge className="bg-violet-500/15 text-violet-600">Needs review</Badge>
            <span>
              <strong>Video lessons</strong> — highest visibility, always reviewed.
            </span>
          </li>
        </ul>
      </Section>

      {/* Review flow */}
      <Section icon={ListChecks} title="Review pending content">
        <p>
          Anything held for review appears in the <strong>Pending Review</strong> section with a
          preview (first blocks / questions, or an audio player). For each card:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-green-600">Approve &amp; Publish</strong> — makes it live and
            counts toward the creator&apos;s published total.
          </li>
          <li>
            <strong className="text-red-600">Reject</strong> — marks the job rejected and unpublishes
            the draft.
          </li>
        </ul>
        <p>The list refreshes automatically after each action.</p>
      </Section>

      {/* Demand signals */}
      <Section icon={Radar} title="How topics get on the demand list">
        <p>Topics appear once students generate signals for them:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Direct request</strong> (weight 5) — the &quot;Request study material&quot;
            button on a topic
          </li>
          <li>
            <strong>Search with no results</strong> (2) · <strong>Exam weakness</strong> (2.5) ·{" "}
            <strong>Doubt posted</strong> (2) · <strong>Ask AI</strong> (1.5) ·{" "}
            <strong>Topic view</strong> (0.5)
          </li>
        </ul>
        <p>
          A nightly job scores the last 30 days as{" "}
          <Code>SUM(weight) × ln(unique students + 1)</Code>. Higher score &amp; more distinct
          students rank higher.
        </p>
      </Section>

      {/* Budget & schedule */}
      <Section icon={Coins} title="Budget, limits & schedule">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Daily budget</strong> — <Code>DAILY_CONTENT_BUDGET</Code> (default $5.00).
            Generation stops for the day once spend hits the cap; the dashboard bar turns red.
          </li>
          <li>
            <strong>Daily caps</strong> — 15 text notes, 5 audio, 5 question sets per day.
          </li>
          <li>
            <strong>Automatic schedule</strong> — demand scored at 2 AM, generation cycle at 4 AM,
            old signals cleaned monthly. Manual <em>Generate</em> works any time and ignores the
            ranking (but still respects the budget).
          </li>
        </ul>
      </Section>

      {/* Troubleshooting */}
      <Section icon={AlertTriangle} title="Troubleshooting">
        <dl className="space-y-3">
          <div>
            <dt className="font-medium text-foreground">
              I clicked Generate and nothing happened
            </dt>
            <dd>
              The <Code>pnpm workers</Code> process is almost certainly not running — the job is
              queued but nobody is processing it. Start the worker and refresh.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">The demand table is empty</dt>
            <dd>No signals yet. Use the app as a student, or seed a few signals, then refresh.</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">A job is stuck on “failed”</dt>
            <dd>
              Open it via Recent Activity — the job stores a <Code>last_error</Code>. Jobs retry up
              to 3 times before they stay failed (common causes: missing API key, AI validation
              failed twice, budget exhausted).
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">
              Audio generated but there&apos;s no player
            </dt>
            <dd>
              No TTS key is configured, so only the transcript was produced. Add a TTS key and
              regenerate.
            </dd>
          </div>
        </dl>
      </Section>

      <div className="flex items-center gap-2 pt-2">
        <Cpu className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Need to dig deeper? See <Code>src/lib/auto-content/</Code> for the generators,
          orchestrator and publisher.
        </p>
      </div>
    </div>
  );
}
