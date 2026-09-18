import type { Metadata } from "next";

import { ControlRoomClient } from "@/lib/control-room-client";

export const metadata: Metadata = {
  title: "Your poll",
  description: "Share your poll, watch results, and ask another question.",
};

type RouteParams = { publicSlug: string; hostSecret: string };

export default async function ControlRoomPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<{ newQuestion?: string }>;
}) {
  const { publicSlug, hostSecret } = await params;
  const { newQuestion } = await searchParams;
  return (
    <ControlRoomClient
      publicSlug={publicSlug}
      hostSecret={hostSecret}
      startWithNewQuestion={newQuestion === "1"}
    />
  );
}
