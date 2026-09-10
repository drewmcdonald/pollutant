import type { Metadata } from "next";

import { StableResultsClient } from "@/lib/stable-results-client";

type RouteParams = {
  publicSlug: string;
  hostSecret: string;
  questionId: string;
};

export const metadata: Metadata = {
  title: "Question Results",
  description: "Stable, host-only results for one question.",
};

export default async function StableResultsPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { publicSlug, hostSecret, questionId } = await params;
  return (
    <StableResultsClient
      publicSlug={publicSlug}
      hostSecret={hostSecret}
      questionId={questionId}
    />
  );
}
