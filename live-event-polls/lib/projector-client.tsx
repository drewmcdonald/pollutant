"use client";

import {
  Component,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ConvexError } from "convex/values";
import { useQuery, usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Crown, Loader2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Countdown } from "@/components/polls/countdown";
import { PresencePill } from "@/components/polls/presence-pill";
import { QrBlock } from "@/components/polls/qr-block";
import { ResultsBar } from "@/components/polls/results-bar";
import { VotingStatusBadge } from "@/components/polls/status-badge";

type Props = { publicSlug: string; hostSecret: string };
type AppErrorData = { code?: string; message?: string };

type QuestionResults = FunctionReturnType<
  typeof api.presentation.getQuestionResults
>;

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

function ProjectorShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 px-6 py-8 text-white sm:px-10">
      {children}
    </div>
  );
}

class ProjectorErrorBoundary extends Component<
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
        data?.code === "EVENT_NOT_FOUND" || data?.code === "HOST_ACCESS_DENIED";
      return (
        <ProjectorShell>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <h1 className="text-2xl font-semibold">
              {accessError ? "Host link unavailable" : "Projector unavailable"}
            </h1>
            <p className="max-w-md text-white/70">
              {accessError
                ? (data?.message ??
                  "This host link is invalid or no longer available.")
                : errorMessage(this.state.error)}
            </p>
          </div>
        </ProjectorShell>
      );
    }
    return this.props.children;
  }
}

export function ProjectorClient(props: Props) {
  return (
    <ProjectorErrorBoundary>
      <Projector {...props} />
    </ProjectorErrorBoundary>
  );
}

/** `window.location.origin` never changes for the life of this tab, so a
 * no-op subscribe is correct here - there is nothing to listen for. Modeling
 * it as a `useSyncExternalStore` (rather than a `useState`+`useEffect` set
 * after mount) is what lets the server render 'no URL yet' and the client
 * render the real origin without a hydration-mismatch warning. */
function subscribeOrigin(): () => void {
  return () => {};
}
function getOrigin(): string {
  return window.location.origin;
}
function getServerOrigin(): null {
  return null;
}

function Projector({ publicSlug, hostSecret }: Props) {
  const deck = useQuery(api.presentation.getDeck, { publicSlug, hostSecret });
  const presence = useQuery(api.presence.getConnectedCount, {
    publicSlug,
    hostSecret,
  });
  const origin = useSyncExternalStore(
    subscribeOrigin,
    getOrigin,
    getServerOrigin,
  );
  const audienceUrl = origin === null ? null : `${origin}/e/${publicSlug}`;

  if (deck === undefined) {
    return (
      <ProjectorShell>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-white/50" />
        </div>
      </ProjectorShell>
    );
  }

  const { event, questions, currentQuestionResults } = deck;
  const connectedCount = presence?.connectedCount ?? 0;
  const currentSlide = event.currentSlide;
  const activeQuestion =
    currentSlide.kind === "question"
      ? questions.find((question) => question._id === currentSlide.questionId)
      : undefined;

  return (
    <ProjectorShell>
      <header className="flex items-center justify-between">
        <p className="text-lg font-medium text-white/70">{event.title}</p>
        <PresencePill count={connectedCount} size="large" />
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-10 py-10">
        {event.currentSlide.kind === "welcome" && (
          <WelcomeSlide title={event.title} audienceUrl={audienceUrl} />
        )}

        {event.currentSlide.kind === "question" &&
          (currentQuestionResults !== null ? (
            <QuestionSlide
              question={currentQuestionResults}
              countdownSeconds={activeQuestion?.countdownSeconds}
              maxSelections={activeQuestion?.maxSelections}
              votingOpenedAt={event.votingOpenedAt}
            />
          ) : (
            <p className="text-white/50">Loading question…</p>
          ))}

        {event.currentSlide.kind === "finale" && (
          <FinaleSlide publicSlug={publicSlug} hostSecret={hostSecret} />
        )}
      </div>
    </ProjectorShell>
  );
}

function WelcomeSlide({
  title,
  audienceUrl,
}: {
  title: string;
  audienceUrl: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-white/50">
          Scan to join
        </p>
        <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-tight sm:text-5xl">
          {title}
        </h1>
      </div>
      {audienceUrl !== null && (
        <QrBlock audienceUrl={audienceUrl} size="large" />
      )}
    </div>
  );
}

function QuestionSlide({
  question,
  countdownSeconds,
  maxSelections,
  votingOpenedAt,
}: {
  question: QuestionResults;
  countdownSeconds: number | undefined;
  maxSelections: number | undefined;
  votingOpenedAt: number | undefined;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-10">
      <div className="flex items-center gap-4">
        <VotingStatusBadge state={question.votingState} />
        {question.votingState === "open" &&
          countdownSeconds !== undefined &&
          votingOpenedAt !== undefined && (
            <Countdown
              countdownSeconds={countdownSeconds}
              openedAt={votingOpenedAt}
              size="large"
            />
          )}
      </div>

      {question.imageUrl !== null && (
        // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL: host is per-deployment/dynamic, so next/image can't safely whitelist it via remotePatterns.
        <img
          src={question.imageUrl}
          alt=""
          className="max-h-72 rounded-xl border border-white/10 object-contain"
        />
      )}

      <h1 className="max-w-4xl text-balance text-center text-5xl font-semibold leading-tight">
        {question.prompt}
      </h1>

      {question.ballotCount === 0 ? (
        <p className="text-lg text-white/50">Waiting for the first response…</p>
      ) : (
        <div className="flex w-full max-w-3xl flex-col gap-6">
          {question.choices.map((choice) => (
            <ResultsBar key={choice.choiceId} choice={choice} highContrast />
          ))}
        </div>
      )}

      <footer className="text-center text-sm text-white/40">
        {question.ballotCount} ballot{question.ballotCount === 1 ? "" : "s"}{" "}
        submitted
        {maxSelections !== undefined &&
          maxSelections > 1 &&
          question.ballotCount > 0 &&
          " · respondents could pick multiple choices, so percentages may total more than 100%"}
      </footer>
    </div>
  );
}

function FinaleSlide({ publicSlug, hostSecret }: Props) {
  const finale = usePaginatedQuery(
    api.presentation.getFinalePage,
    { publicSlug, hostSecret },
    { initialNumItems: 10 },
  );

  const { status: finaleStatus, loadMore } = finale;
  useEffect(() => {
    if (finaleStatus === "CanLoadMore") {
      loadMore(10);
    }
  }, [finaleStatus, loadMore]);

  if (finale.status === "LoadingFirstPage") {
    return <Loader2 className="h-10 w-10 animate-spin text-white/50" />;
  }

  if (finale.results.length === 0) {
    return (
      <div className="text-center">
        <h1 className="text-4xl font-semibold">That&apos;s a wrap</h1>
        <p className="mt-3 text-white/50">No questions were presented.</p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-4xl flex-1 flex-col items-center gap-8 overflow-y-auto py-4">
      <h1 className="text-4xl font-semibold">Final results</h1>
      <div className="flex w-full flex-col gap-6">
        {finale.results.map((question) => (
          <FinaleQuestionCard key={question.questionId} question={question} />
        ))}
      </div>
      {finale.status !== "Exhausted" && (
        <p className="text-sm text-white/40">Loading more results…</p>
      )}
    </div>
  );
}

function FinaleQuestionCard({ question }: { question: QuestionResults }) {
  const winners = question.choices.filter((choice) => choice.winner);
  return (
    <div className="w-full rounded-xl border border-white/10 bg-white/5 p-6">
      {question.imageUrl !== null && (
        // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL: host is per-deployment/dynamic, so next/image can't safely whitelist it via remotePatterns.
        <img
          src={question.imageUrl}
          alt=""
          className="mb-4 max-h-48 w-full rounded-lg border border-white/10 object-cover"
        />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{question.prompt}</h2>
        {winners.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-300/10 px-2.5 py-1 text-xs font-medium text-amber-300">
            <Crown className="h-3.5 w-3.5" />
            {winners.map((winner) => winner.label).join(", ")}
          </span>
        )}
      </div>
      {question.ballotCount === 0 ? (
        <p className="text-sm text-white/50">No responses were submitted.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {question.choices.map((choice) => (
            <ResultsBar key={choice.choiceId} choice={choice} highContrast />
          ))}
        </div>
      )}
    </div>
  );
}
