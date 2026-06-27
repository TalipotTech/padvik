import { Suspense } from "react";
import { SearchResults } from "./_components/search-results";

/**
 * /dashboard/search?q=...&topicId=...
 * The landing page for the home search box. Server Component — reads the query
 * params and hands them to the client results view.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; topicId?: string }>;
}) {
  const { q, topicId } = await searchParams;
  const topicIdNum = topicId ? parseInt(topicId, 10) : null;

  return (
    <Suspense fallback={null}>
      <SearchResults
        query={q ?? ""}
        topicId={topicIdNum && !Number.isNaN(topicIdNum) ? topicIdNum : null}
      />
    </Suspense>
  );
}
