import { LearnView } from "./_components/learn-view";

export const metadata = { title: "Playground | Padvik" };

export default async function LearnTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  return <LearnView topicId={parseInt(topicId, 10)} />;
}
