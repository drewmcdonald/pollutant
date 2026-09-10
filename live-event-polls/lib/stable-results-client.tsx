"use client";

import Link from "next/link";
import { Component, type ReactNode } from "react";
import { ConvexError } from "convex/values";
import { useQuery } from "convex/react";
import { ArrowLeft, Crown } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PageContainer } from "@/components/polls/page-container";
import { ResultsBar } from "@/components/polls/results-bar";
import { VotingStatusBadge } from "@/components/polls/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Props = {
  publicSlug: string;
  hostSecret: string;
  questionId: string;
};
type AppErrorData = { code?: string; message?: string };

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as AppErrorData;
    return data.message ?? "That link could not be loaded.";
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Could not reach the event service. Check your connection and try again.";
}

class ResultsErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error !== null) {
      const data =
        this.state.error instanceof ConvexError
          ? (this.state.error.data as AppErrorData)
          : undefined;
      const accessError =
        data?.code === "EVENT_NOT_FOUND" ||
        data?.code === "HOST_ACCESS_DENIED" ||
        data?.code === "QUESTION_NOT_FOUND";
      return (
        <PageContainer narrow className="max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>
                {accessError ? "Results unavailable" : "Something went wrong"}
              </CardTitle>
              <CardDescription>
                {accessError
                  ? (data?.message ??
                    "This link is invalid or no longer available.")
                  : errorMessage(this.state.error)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/">Return to your events</Link>
              </Button>
            </CardContent>
          </Card>
        </PageContainer>
      );
    }
    return this.props.children;
  }
}

export function StableResultsClient(props: Props) {
  return (
    <ResultsErrorBoundary>
      <StableResults {...props} />
    </ResultsErrorBoundary>
  );
}

function StableResults({ publicSlug, hostSecret, questionId }: Props) {
  const hostBase = `/host/${publicSlug}/${hostSecret}`;
  const typedQuestionId = questionId as Id<"questions">;
  const results = useQuery(api.presentation.getQuestionResults, {
    publicSlug,
    hostSecret,
    // Route params are always plain strings; the query validator performs
    // its own runtime check against the real `questions` table.
    questionId: typedQuestionId,
  });
  // Also loaded to recover `maxSelections`, which the stable exact-results
  // shape intentionally omits. `getHostDetail` allows an archived question
  // (system-design.md section 4.2), so archived questions' stable results
  // stay fully supported.
  const detail = useQuery(api.questions.getHostDetail, {
    publicSlug,
    hostSecret,
    questionId: typedQuestionId,
  });

  if (results === undefined || detail === undefined) {
    return (
      <PageContainer narrow className="max-w-2xl">
        <Button variant="ghost" size="sm" className="mb-4" asChild>
          <a href={hostBase}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to control room
          </a>
        </Button>
        <Card aria-busy="true">
          <CardContent className="flex flex-col gap-4 p-7">
            <div className="h-4 w-24 animate-pulse rounded-full bg-muted" />
            <div className="h-7 animate-pulse rounded-md bg-muted" />
            <div className="h-14 animate-pulse rounded-lg bg-muted" />
            <div className="h-14 animate-pulse rounded-lg bg-muted" />
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const winners = results.choices.filter((choice) => choice.winner);
  const isMultiSelect = detail.question.maxSelections > 1;

  return (
    <PageContainer narrow className="max-w-2xl">
      <Button variant="ghost" size="sm" className="mb-4" asChild>
        <a href={hostBase}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to control room
        </a>
      </Button>

      <Card>
        {results.imageUrl !== null && (
          // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL: host is per-deployment/dynamic, so next/image can't safely whitelist it via remotePatterns.
          <img
            src={results.imageUrl}
            alt=""
            className="aspect-[16/9] w-full rounded-t-xl border-b object-cover"
          />
        )}
        <CardHeader>
          <div className="flex items-center gap-2">
            <VotingStatusBadge state={results.votingState} />
          </div>
          <CardTitle className="text-xl leading-snug">
            {results.prompt}
          </CardTitle>
          <CardDescription>
            {results.ballotCount} ballot{results.ballotCount === 1 ? "" : "s"}{" "}
            submitted
            {results.ballotCount > 0 &&
              (isMultiSelect
                ? " · Respondents could pick multiple choices, so percentages may total more than 100%."
                : " · Percentages show the share of respondents selecting each choice.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {results.ballotCount === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No responses were submitted for this question.
            </p>
          ) : (
            <>
              {winners.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  <Crown className="h-4 w-4 shrink-0 text-amber-500" />
                  <span className="text-muted-foreground">
                    {winners.length > 1 ? "Co-winners:" : "Winner:"}
                  </span>
                  <span className="font-medium">
                    {winners.map((winner) => winner.label).join(", ")}
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-5">
                {results.choices.map((choice) => (
                  <ResultsBar key={choice.choiceId} choice={choice} />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        This link stays stable and never changes the presentation&apos;s current
        slide.
      </p>
    </PageContainer>
  );
}
