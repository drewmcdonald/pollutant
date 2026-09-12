import type { Metadata } from "next";

import { ControlRoomClient } from "@/lib/control-room-client";

export const metadata: Metadata = {
  title: "Control Room",
  description: "Author questions, run voting, and drive the presentation.",
};

type RouteParams = { publicSlug: string; hostSecret: string };

export default async function ControlRoomPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { publicSlug, hostSecret } = await params;
  return <ControlRoomClient publicSlug={publicSlug} hostSecret={hostSecret} />;
}
