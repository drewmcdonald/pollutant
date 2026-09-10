import type { Metadata } from "next";

import { ProjectorClient } from "@/lib/projector-client";

type RouteParams = { publicSlug: string; hostSecret: string };

export const metadata: Metadata = {
  title: "Projector",
  description: "Read-only presentation surface for the projector or TV.",
};

export default async function ProjectorPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { publicSlug, hostSecret } = await params;
  return <ProjectorClient publicSlug={publicSlug} hostSecret={hostSecret} />;
}
