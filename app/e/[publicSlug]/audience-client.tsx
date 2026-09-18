"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import usePresence from "@convex-dev/presence/react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { ConvexError } from "convex/values";
import { Check, CheckCircle2, Radio, Sparkles } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Countdown } from "@/components/polls/countdown";
import { PageContainer } from "@/components/polls/page-container";
import { ResultsBar } from "@/components/polls/results-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ensureRespondentToken,
  getRespondentTokenSnapshot,
  getServerRespondentTokenSnapshot,
  subscribeRespondentToken,
} from "@/lib/respondent-token";

type AudienceState = FunctionReturnType<typeof api.audience.getCurrentState>;
type FoundAudienceState = Exclude<AudienceState, { kind: "notFound" }>;
type QuestionState = Extract<AudienceState, { kind: "question" }>;

type DraftState = {
  questionKey: string;
  selectedChoiceIds: Id<"choices">[];
  locallySubmitted: boolean;
};

type AudienceError = {
  questionKey: string;
  message: string;
};

function AudiencePresence({
  state,
  respondentToken,
  children,
}: {
  state: FoundAudienceState;
  respondentToken: string;
  children: ReactNode;
}) {
  usePresence(api.presence, state.presenceRoomId, respondentToken, 10_000);
  return children;
}

function LoadingState() {
  return (
    <PageContainer
      narrow
      className="flex min-h-dvh flex-col justify-center py-6"
    >
      <Card aria-busy="true">
        <CardContent className="flex flex-col gap-4 p-7">
          <div className="mx-auto h-3 w-24 animate-pulse rounded-full bg-muted" />
          <div className="h-7 animate-pulse rounded-md bg-muted" />
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function MessageState({
  eyebrow,
  title,
  message,
  finished = false,
  connected = false,
}: {
  eyebrow?: string;
  title: string;
  message: string;
  finished?: boolean;
  connected?: boolean;
}) {
  return (
    <PageContainer
      narrow
      className="flex min-h-dvh flex-col justify-center py-6"
    >
      {eyebrow !== undefined && (
        <p className="mb-5 text-center text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </p>
      )}
      <Card className="overflow-hidden">
        <div
          className={cn(
            "h-1.5 w-full",
            finished ? "bg-emerald-500" : "bg-primary",
          )}
        />
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full",
              finished
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-primary/10 text-primary",
            )}
          >
            {finished ? (
              <Sparkles className="h-6 w-6" />
            ) : (
              <Radio className="h-6 w-6" />
            )}
          </span>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {message}
            </p>
          </div>
          {connected && (
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Connected live
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function selectionGuidance(minSelections: number, maxSelections: number) {
  if (minSelections === 1 && maxSelections === 1) {
    return "Choose one answer";
  }
  if (minSelections === maxSelections) {
    return `Choose exactly ${minSelections} answers`;
  }
  return `Choose ${minSelections}–${maxSelections} answers`;
}

function AudienceQuestion({
  publicSlug,
  respondentToken,
  state,
}: {
  publicSlug: string;
  respondentToken: string;
  state: QuestionState;
}) {
  const submitBallot = useMutation(api.ballots.submit);
  const question = state.question;
  const questionKey = `${question.eventGeneration}:${question.questionId}:${question.responseGeneration}`;
  const [draft, setDraft] = useState<DraftState>({
    questionKey,
    selectedChoiceIds: [],
    locallySubmitted: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [audienceError, setAudienceError] = useState<AudienceError | null>(
    null,
  );

  const selectedChoiceIds =
    draft.questionKey === questionKey ? draft.selectedChoiceIds : [];
  const submitted =
    state.existingBallot !== undefined ||
    (draft.questionKey === questionKey && draft.locallySubmitted);
  const visibleError =
    audienceError?.questionKey === questionKey ? audienceError.message : null;
  const closed = question.votingState === "closed";
  const atMaximum = selectedChoiceIds.length >= question.maxSelections;
  const validSelectionCount =
    selectedChoiceIds.length >= question.minSelections &&
    selectedChoiceIds.length <= question.maxSelections;

  function toggleChoice(choiceId: Id<"choices">) {
    setAudienceError(null);
    setDraft((current) => {
      const currentSelection =
        current.questionKey === questionKey ? current.selectedChoiceIds : [];
      const alreadySelected = currentSelection.includes(choiceId);
      let nextSelection: Id<"choices">[];

      if (question.maxSelections === 1) {
        nextSelection = [choiceId];
      } else if (alreadySelected) {
        nextSelection = currentSelection.filter((id) => id !== choiceId);
      } else if (currentSelection.length < question.maxSelections) {
        nextSelection = [...currentSelection, choiceId];
      } else {
        nextSelection = currentSelection;
      }

      return {
        questionKey,
        selectedChoiceIds: nextSelection,
        locallySubmitted: false,
      };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validSelectionCount || submitted || closed) return;

    const submittedChoiceIds = [...selectedChoiceIds];
    setSubmitting(true);
    setAudienceError(null);
    try {
      await submitBallot({
        publicSlug,
        eventGeneration: question.eventGeneration,
        questionId: question.questionId,
        respondentToken,
        selectedChoiceIds: submittedChoiceIds,
      });
      setDraft({
        questionKey,
        selectedChoiceIds: submittedChoiceIds,
        locallySubmitted: true,
      });
    } catch (caught) {
      if (caught instanceof ConvexError) {
        const data = caught.data as { code?: string; message?: string };
        if (data.code === "ALREADY_VOTED") {
          setDraft({
            questionKey,
            selectedChoiceIds: submittedChoiceIds,
            locallySubmitted: true,
          });
        } else {
          setAudienceError({
            questionKey,
            message: data.message ?? "Your ballot could not be submitted.",
          });
        }
      } else {
        setAudienceError({
          questionKey,
          message:
            "Could not reach the server. Check your connection and try again.",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageContainer narrow className="min-h-dvh py-6 sm:py-10">
      <div className="mb-5 flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Live poll
        </p>
        {!submitted &&
          !closed &&
          question.countdownSeconds !== undefined &&
          question.votingOpenedAt !== undefined && (
            <Countdown
              countdownSeconds={question.countdownSeconds}
              openedAt={question.votingOpenedAt}
            />
          )}
      </div>

      <Card className="overflow-hidden shadow-sm">
        {question.imageUrl !== null && (
          // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL: host is per-deployment/dynamic, so next/image can't safely whitelist it via remotePatterns.
          <img
            src={question.imageUrl}
            alt={`Illustration for ${question.prompt}`}
            className="aspect-[16/9] w-full border-b object-cover"
          />
        )}
        <CardHeader className="gap-3 pb-4">
          <h1 className="text-balance text-center text-xl font-semibold leading-snug sm:text-2xl">
            {question.prompt}
          </h1>
          {!submitted && !closed && (
            <div className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
              <span>
                {selectionGuidance(
                  question.minSelections,
                  question.maxSelections,
                )}
              </span>
              {question.maxSelections > 1 && (
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium tabular-nums text-foreground">
                  {selectedChoiceIds.length}/{question.maxSelections}
                </span>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent>
          {submitted || closed ? (
            <div className="flex flex-col gap-6">
              <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-medium">
                    {closed ? "Voting has ended" : "Your vote is in"}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {closed
                      ? "Here are the final results."
                      : "Watch the results update live."}
                  </p>
                </div>
              </div>

              <div className="space-y-4" aria-live="polite">
                {question.choices.map((choice) => (
                  <ResultsBar key={choice.choiceId} choice={choice} />
                ))}
              </div>
              <div className="text-center text-xs leading-relaxed text-muted-foreground">
                <p className="font-medium text-foreground">
                  {question.ballotCount} vote
                  {question.ballotCount === 1 ? "" : "s"}
                </p>
                {question.maxSelections > 1 && (
                  <p className="mt-1">
                    Percentages show the share of respondents selecting each
                    choice, so they may total more than 100%.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Answer choices</legend>
                {question.choices.map((choice) => {
                  const checked = selectedChoiceIds.includes(choice.choiceId);
                  const disabled =
                    submitting ||
                    (question.maxSelections > 1 && !checked && atMaximum);
                  return (
                    <label
                      key={choice.choiceId}
                      className={cn(
                        "group flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                        checked && "border-primary bg-primary/5 shadow-sm",
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <input
                        type={
                          question.maxSelections === 1 ? "radio" : "checkbox"
                        }
                        name="choice"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleChoice(choice.choiceId)}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                          question.maxSelections === 1
                            ? "rounded-full"
                            : "rounded-md",
                          checked &&
                            "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        <Check
                          className={cn("h-4 w-4", !checked && "hidden")}
                        />
                      </span>
                      {choice.imageUrl !== null && (
                        // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL: host is per-deployment/dynamic, so next/image can't safely whitelist it via remotePatterns.
                        <img
                          src={choice.imageUrl}
                          alt=""
                          width={64}
                          height={64}
                          className="h-14 w-14 shrink-0 rounded-lg border object-cover"
                        />
                      )}
                      <span className="min-w-0 font-medium leading-snug">
                        {choice.label}
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              {visibleError !== null && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {visibleError}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                className="mt-1 w-full"
                disabled={!validSelectionCount || submitting}
              >
                {submitting ? "Submitting…" : "Vote"}
              </Button>
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                Choose carefully — you can vote once.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

export function AudienceClient({ publicSlug }: { publicSlug: string }) {
  // The token itself is only ever created as a side effect (a
  // localStorage write), never from render/getSnapshot - that write
  // belongs in an effect. useSyncExternalStore then reads it purely, and
  // re-renders once the effect has created it.
  useEffect(() => {
    ensureRespondentToken(publicSlug);
  }, [publicSlug]);

  const respondentToken = useSyncExternalStore(
    subscribeRespondentToken,
    () => getRespondentTokenSnapshot(publicSlug),
    getServerRespondentTokenSnapshot,
  );

  const state = useQuery(
    api.audience.getCurrentState,
    respondentToken === null
      ? "skip"
      : {
          publicSlug,
          respondentToken,
        },
  );

  if (respondentToken === null || state === undefined) {
    return <LoadingState />;
  }

  if (state.kind === "notFound") {
    return (
      <MessageState
        title="Event not found"
        message="This audience link is invalid or the event is no longer available. Ask the host for the current link."
      />
    );
  }

  return (
    <AudiencePresence state={state} respondentToken={respondentToken}>
      {state.kind === "waiting" ? (
        <MessageState
          eyebrow={state.eventTitle}
          title="Waiting for the host"
          message="You're connected. The next question will appear here automatically as soon as voting opens."
          connected
        />
      ) : state.kind === "finished" ? (
        <MessageState
          eyebrow={state.eventTitle}
          title="That’s a wrap"
          message="The host has finished this event. Thanks for taking part."
          finished
        />
      ) : (
        <AudienceQuestion
          publicSlug={publicSlug}
          respondentToken={respondentToken}
          state={state}
        />
      )}
    </AudiencePresence>
  );
}
