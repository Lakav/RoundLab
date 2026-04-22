import MatchViewer from "./MatchViewer";

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MatchViewer id={id} />;
}
