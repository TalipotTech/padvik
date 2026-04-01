import { TopicDetail } from "./_components/topic-detail";

export const metadata = {
  title: "Topic | Padvik",
};

export default async function TopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  return <TopicDetail topicId={Number(topicId)} />;
}
