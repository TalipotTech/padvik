/**
 * /topics/[topicId]/learn — Adaptive Visual Explainer full-screen view.
 *
 * Kept as a NEW route group so it does not collide with the existing
 * /dashboard/learn/[topicId] flow. Students can be sent here from any
 * topic link (topic cards, chapter views, etc.) without rewiring the
 * existing learn page.
 */
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ExplainerView } from "@/components/explainer/ExplainerView";

async function fetchExplainer(topicId: string) {
  const h = await headers();
  const host = h.get("host");
  const proto =
    h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "development" ? "http" : "https");
  const cookie = h.get("cookie") ?? "";
  const base = `${proto}://${host}`;
  const res = await fetch(`${base}/api/topics/${topicId}/explainer`, {
    cache: "no-store",
    headers: { cookie },
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.success) return null;
  return json.data;
}

export default async function TopicLearnPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  const data = await fetchExplainer(topicId);
  if (!data) notFound();

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50/20 to-white px-4 py-6 dark:from-slate-950 dark:via-purple-950/10 dark:to-slate-900 sm:py-10">
      <ExplainerView
        topicId={Number(topicId)}
        initial={data}
        backHref={`/dashboard/learn/${topicId}`}
      />
    </main>
  );
}
