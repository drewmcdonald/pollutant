import type { Metadata } from "next";
import { Separator } from "@/components/ui/separator";
import { PageContainer } from "@/components/polls/page-container";
import { DashboardClient } from "@/lib/dashboard-client";

export const metadata: Metadata = {
  title: "Host Dashboard",
  description:
    "Create a new live poll or reopen an event this browser remembers.",
};

export default function DashboardPage() {
  return (
    <PageContainer>
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Your events</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          This browser remembers events you&apos;ve created or opened. It
          isn&apos;t authoritative — a bookmarked host link keeps working even
          if you clear this list, and clearing it never deletes an event.
        </p>
      </header>

      <DashboardClient />

      <Separator className="my-10" />

      <p className="text-xs text-muted-foreground">
        Lost a host link? There&apos;s no account recovery — a co-presenter who
        has the secret host URL can share it with you directly.
      </p>
    </PageContainer>
  );
}
