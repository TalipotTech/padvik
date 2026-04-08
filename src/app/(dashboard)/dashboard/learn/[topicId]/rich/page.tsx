import { RichLearnView } from "./_components/rich-learn-view";

export const metadata = { title: "Rich View | Padvik" };

export default async function RichLearnPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  return <RichLearnView topicId={parseInt(topicId, 10)} />;
}
