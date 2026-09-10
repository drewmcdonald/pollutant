import type { Metadata } from "next";

import { AudienceClient } from "./audience-client";

type RouteParams = { publicSlug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { publicSlug } = await params;
  return {
    title: "Vote now",
    description: `Join the live poll and cast your ballot. Event code ${publicSlug}.`,
  };
}

export default async function AudiencePage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { publicSlug } = await params;
  return <AudienceClient publicSlug={publicSlug} />;
}
