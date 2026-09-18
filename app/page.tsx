import type { Metadata } from "next";
import { PageContainer } from "@/components/polls/page-container";
import { DashboardClient } from "@/lib/dashboard-client";

export const metadata: Metadata = {
  title: "Create a poll",
  description: "Ask a question, share a link, and watch the votes come in.",
};

export default function DashboardPage() {
  return (
    <PageContainer className="max-w-2xl">
      <header className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Ask the room.</h1>
        <p className="text-muted-foreground">
          Make a poll, share the link, see what people think. No sign-up.
        </p>
      </header>
      <DashboardClient />
    </PageContainer>
  );
}
