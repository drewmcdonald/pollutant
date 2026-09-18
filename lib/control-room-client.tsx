"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Component, useEffect, useState, type ReactNode } from "react";
import { ConvexError } from "convex/values";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowDown, ArrowUp, MonitorPlay, Plus, Square } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PageContainer } from "@/components/polls/page-container";
import { PollEditor, type PollDraft } from "@/components/polls/poll-editor";
import { SharePoll, CopyLinkButton } from "@/components/polls/share-poll";
import { ResultsBar } from "@/components/polls/results-bar";
import { VotingStatusBadge } from "@/components/polls/status-badge";
import { Countdown } from "@/components/polls/countdown";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { rememberEvent } from "@/lib/remembered-events";
import { usePollImages } from "@/lib/use-poll-images";

type Props = { publicSlug: string; hostSecret: string };
type AppErrorData = { code?: string; message?: string };
type QuestionDetail = FunctionReturnType<typeof api.questions.getHostDetail>;
type QuestionView = {
  selected?: FunctionReturnType<
    typeof api.presentation.getDeck
  >["questions"][number];
  activeEditor: Id<"questions"> | "new" | null;
  revision: number;
  detail?: QuestionDetail;
  results?: FunctionReturnType<typeof api.presentation.getQuestionResults>;
};

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError)
    return (error.data as AppErrorData).message ?? "Couldn't save this poll.";
  return "Couldn't reach the server. Please try again.";
}

function votingState(
  event: { generation: number; openQuestionId?: Id<"questions"> },
  question: { _id: Id<"questions">; closedGeneration?: number },
): "ready" | "open" | "closed" {
  if (event.openQuestionId === question._id) return "open";
  return question.closedGeneration === event.generation ? "closed" : "ready";
}
class DeckErrorBoundary extends Component<
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
        <PageContainer narrow>
          <Card>
            <CardHeader>
              <CardTitle>
                {accessError
                  ? "Host link unavailable"
                  : "Control room unavailable"}
              </CardTitle>
              <CardDescription>
                {accessError
                  ? (data?.message ??
                    "This host link is invalid or no longer available.")
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

export function ControlRoomClient(
  props: Props & { startWithNewQuestion?: boolean },
) {
  return (
    <DeckErrorBoundary>
      <ControlRoom {...props} />
    </DeckErrorBoundary>
  );
}

function ControlRoom({
  publicSlug,
  hostSecret,
  startWithNewQuestion = false,
}: Props & { startWithNewQuestion?: boolean }) {
  const router = useRouter();
  const host = { publicSlug, hostSecret };
  const deck = useQuery(api.presentation.getDeck, host);
  const save = useMutation(api.polls.save);
  const prepareImages = usePollImages();
  const start = useMutation(api.polls.start);
  const close = useMutation(api.presentation.closeVoting);
  const setSlide = useMutation(api.presentation.setSlide);
  const resetEvent = useMutation(api.events.reset);
  const resetQuestion = useMutation(api.questions.resetResponses);
  const removeQuestion = useMutation(api.questions.removeOrArchive);
  const reorder = useMutation(api.questions.reorder);
  const updateDetails = useMutation(api.events.updateDetails);
  const [selectedId, setSelectedId] = useState<Id<"questions">>();
  const [editor, setEditor] = useState<
    Id<"questions"> | "new" | null | undefined
  >(startWithNewQuestion ? "new" : undefined);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [previousView, setPreviousView] = useState<QuestionView>();
  const [error, setError] = useState<string | null>(null);
  const hostBase = `/host/${publicSlug}/${hostSecret}`;
  useEffect(() => {
    if (startWithNewQuestion) router.replace(hostBase, { scroll: false });
  }, [startWithNewQuestion, hostBase, router]);
  const requestedQuestion =
    deck?.questions.find((question) => question._id === selectedId) ??
    deck?.questions.find(
      (question) =>
        deck.event.currentSlide.kind === "question" &&
        question._id === deck.event.currentSlide.questionId,
    ) ??
    deck?.questions[0];
  const requestedResults = useQuery(
    api.presentation.getQuestionResults,
    requestedQuestion ? { ...host, questionId: requestedQuestion._id } : "skip",
  );
  const requestedEditor =
    editor === undefined
      ? requestedQuestion &&
        deck &&
        votingState(deck.event, requestedQuestion) === "ready"
        ? requestedQuestion._id
        : deck?.questions.length === 0
          ? "new"
          : null
      : editor;
  const requestedDetail = useQuery(
    api.questions.getHostDetail,
    requestedEditor && requestedEditor !== "new"
      ? { ...host, questionId: requestedEditor }
      : "skip",
  );
  const loadingQuestion =
    requestedEditor === "new"
      ? false
      : requestedEditor
        ? requestedDetail === undefined
        : !!requestedQuestion && requestedResults === undefined;
  // Keep the complete current panel mounted until the next query is ready.
  const view: QuestionView =
    loadingQuestion && previousView
      ? previousView
      : {
          selected: requestedQuestion,
          activeEditor: requestedEditor,
          revision,
          detail: requestedDetail,
          results: requestedResults,
        };
  const {
    selected,
    activeEditor,
    detail,
    results,
    revision: formRevision,
  } = view;
  const busy = saving || loadingQuestion;

  const eventTitle = deck?.event.title;
  useEffect(() => {
    if (eventTitle !== undefined)
      rememberEvent({ publicSlug, hostUrl: hostBase, title: eventTitle });
  }, [publicSlug, hostBase, eventTitle]);

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function savePoll(
    draft: PollDraft,
    shouldStart: boolean,
    questionId?: Id<"questions">,
    expectedChoiceIds: Id<"choices">[] = [],
    nextEditor?: "new" | Id<"questions">,
  ) {
    await run(async () => {
      const fields = await prepareImages(draft, host);
      const result = await save({
        ...host,
        ...fields,
        start: shouldStart,
        questionId,
        expectedChoiceIds,
      });
      setPreviousView(view);
      setSelectedId(
        nextEditor && nextEditor !== "new" ? nextEditor : result.questionId,
      );
      setEditor(
        nextEditor ??
          (shouldStart ||
          (deck && selected && votingState(deck.event, selected) === "open")
            ? null
            : result.questionId),
      );
      setRevision((value) => value + 1);
    });
  }

  if (!deck)
    return (
      <PageContainer>
        <p className="text-sm text-muted-foreground">Loading your poll…</p>
      </PageContainer>
    );
  const state = selected ? votingState(deck.event, selected) : "ready";
  const liveQuestion = deck.questions.find(
    (question) => question._id === deck.event.openQuestionId,
  );

  async function moveQuestion(index: number, direction: -1 | 1) {
    if (!deck) return;
    const ids = deck.questions.map((question) => question._id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    await run(() => reorder({ ...host, orderedQuestionIds: ids }));
  }

  return (
    <PageContainer className="max-w-5xl">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Your polls
          </Link>
          <h1 className="break-words text-xl font-semibold">
            {deck.questions.length > 1 ? deck.event.title : "Your poll"}
          </h1>
        </div>
        <Button variant="outline" asChild>
          <a href={`${hostBase}/present`} target="_blank" rel="noreferrer">
            <MonitorPlay /> Present
          </a>
        </Button>
      </header>
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {liveQuestion && (activeEditor || selected?._id !== liveQuestion._id) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <p className="text-sm">Live now: {liveQuestion.prompt}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => close(host))}
          >
            End voting
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-5">
          {deck.questions.length > 0 && (
            <nav
              aria-label="Questions"
              className="rounded-xl border-2 border-border bg-muted/50 p-3"
            >
              <p className="mb-3 text-sm font-semibold">Questions</p>
              <div
                role="tablist"
                aria-label="Questions"
                className="flex flex-wrap gap-2"
                onKeyDown={(event) => {
                  const tabs = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]:not(:disabled)',
                    ),
                  );
                  const index = tabs.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  let next = index;
                  if (event.key === "ArrowRight")
                    next = (index + 1) % tabs.length;
                  else if (event.key === "ArrowLeft")
                    next = (index - 1 + tabs.length) % tabs.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = tabs.length - 1;
                  else return;
                  event.preventDefault();
                  tabs[next]?.focus();
                }}
              >
                {deck.questions.map((question, index) => {
                  const isSelected =
                    (activeEditor ?? selected?._id) === question._id;
                  return (
                    <Button
                      key={question._id}
                      id={`question-tab-${question._id}`}
                      role="tab"
                      aria-selected={isSelected}
                      aria-controls="question-panel"
                      tabIndex={isSelected ? 0 : -1}
                      type={activeEditor ? "submit" : "button"}
                      form={activeEditor ? "poll-question-editor" : undefined}
                      value={`question:${question._id}`}
                      variant={isSelected ? "default" : "outline"}
                      className={`h-auto min-h-12 max-w-full justify-start gap-3 rounded-lg border-2 px-3 py-2 text-left ${isSelected ? "border-primary shadow-md" : "border-border bg-background hover:border-primary/50"}`}
                      disabled={busy}
                      onClick={(event) => {
                        if (isSelected) {
                          event.preventDefault();
                          return;
                        }
                        if (!activeEditor) {
                          setPreviousView(view);
                          setSelectedId(question._id);
                          setEditor(null);
                          setError(null);
                        }
                      }}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ${isSelected ? "bg-primary-foreground/20" : "bg-muted"}`}
                      >
                        {index + 1}
                      </span>
                      <span className="max-w-52 truncate">
                        {question.prompt || "Untitled question"}
                      </span>
                      {deck.event.openQuestionId === question._id && (
                        <span className="text-xs">Live</span>
                      )}
                    </Button>
                  );
                })}
                {activeEditor === "new" && (
                  <Button
                    id="question-tab-new"
                    role="tab"
                    aria-selected
                    aria-controls="question-panel"
                    type="button"
                    className="h-auto min-h-12 gap-3 rounded-lg border-2 border-primary px-3 py-2 shadow-md"
                    disabled={busy}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary-foreground/20 text-xs font-bold">
                      {deck.questions.length + 1}
                    </span>
                    New question
                  </Button>
                )}
              </div>
            </nav>
          )}
          <Card
            id="question-panel"
            aria-busy={busy}
            role={deck.questions.length ? "tabpanel" : undefined}
            aria-labelledby={
              deck.questions.length
                ? `question-tab-${activeEditor ?? selected?._id}`
                : undefined
            }
          >
            <CardContent className="p-5 sm:p-7">
              {activeEditor === "new" ? (
                <PollEditor
                  key={`new-${formRevision}`}
                  busy={busy}
                  onSave={(draft, shouldStart) => savePoll(draft, shouldStart)}
                  onAddQuestion={(draft) =>
                    savePoll(draft, false, undefined, [], "new")
                  }
                  onSelectQuestion={(draft, target) =>
                    savePoll(draft, false, undefined, [], target)
                  }
                  canAddQuestion={deck.questions.length < 99}
                  onCancel={
                    deck.questions.length
                      ? () => {
                          setPreviousView(view);
                          setEditor(null);
                        }
                      : undefined
                  }
                />
              ) : activeEditor && detail ? (
                <ExistingQuestionForm
                  key={`${activeEditor}-${formRevision}`}
                  {...host}
                  detail={detail}
                  questionId={activeEditor}
                  busy={busy}
                  live={deck.event.openQuestionId === activeEditor}
                  closed={deck.questions.some(
                    (question) =>
                      question._id === activeEditor &&
                      votingState(deck.event, question) === "closed",
                  )}
                  onSave={savePoll}
                  canAddQuestion={deck.questions.length < 100}
                  onCancel={() => {
                    setPreviousView(view);
                    setEditor(null);
                    setError(null);
                  }}
                />
              ) : activeEditor ? (
                <p className="text-sm text-muted-foreground">Loading editor…</p>
              ) : selected ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-3">
                    <VotingStatusBadge state={state} />
                    {state === "open" &&
                      selected.countdownSeconds !== undefined &&
                      deck.event.votingOpenedAt !== undefined && (
                        <Countdown
                          countdownSeconds={selected.countdownSeconds}
                          openedAt={deck.event.votingOpenedAt}
                        />
                      )}
                  </div>
                  <h2 className="break-words text-2xl font-semibold">
                    {selected.prompt || "Untitled question"}
                  </h2>
                  {results?.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- Convex storage URLs are deployment-specific.
                    <img
                      src={results.imageUrl}
                      alt="Question illustration"
                      className="max-h-72 rounded-lg object-contain"
                    />
                  )}
                  {results ? (
                    <div className="space-y-4" aria-live="polite">
                      {results.choices.map((choice) => (
                        <ResultsBar
                          key={choice.choiceId}
                          choice={choice}
                          isWinner={state === "closed" && choice.winner}
                        />
                      ))}
                      <p className="text-sm text-muted-foreground">
                        {results.ballotCount} vote
                        {results.ballotCount === 1 ? "" : "s"}
                        {state === "ready" && " · Ready when you are"}
                      </p>
                      {selected.maxSelections > 1 && (
                        <p className="text-xs text-muted-foreground">
                          People can choose multiple answers, so percentages may
                          total more than 100%.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Loading results…
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {state === "open" ? (
                      <Button
                        disabled={busy}
                        onClick={() => void run(() => close(host))}
                      >
                        <Square /> End voting
                      </Button>
                    ) : (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            start({ ...host, questionId: selected._id }),
                          )
                        }
                      >
                        {state === "closed" ? "Reopen poll" : "Start poll"}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setPreviousView(view);
                        setEditor(selected._id);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              ) : (
                <Button onClick={() => setEditor("new")}>
                  <Plus /> Add a question
                </Button>
              )}
            </CardContent>
          </Card>
          {!activeEditor && (
            <Button
              variant="ghost"
              disabled={busy || deck.questions.length >= 100}
              onClick={() => {
                setEditor("new");
                setError(null);
              }}
            >
              <Plus /> Add another question
            </Button>
          )}
        </div>
        <SharePoll publicSlug={publicSlug} />
      </div>
      <details className="mt-8 rounded-lg border p-4">
        <summary className="cursor-pointer text-sm text-muted-foreground">
          Manage poll
        </summary>
        <div className="mt-5 space-y-6">
          <div className="space-y-2">
            <CopyLinkButton path={hostBase}>
              Copy private host link
            </CopyLinkButton>
            <p className="text-xs text-muted-foreground">
              Keep this link to edit your poll on another device. Anyone with it
              can manage the poll.
            </p>
          </div>
          <details>
            <summary className="cursor-pointer text-sm">Event details</summary>
            <EventDetails
              title={deck.event.title}
              description={deck.event.description ?? ""}
              busy={busy}
              onSave={(title, description) =>
                run(() =>
                  updateDetails({
                    ...host,
                    title,
                    description: description.trim() || null,
                  }),
                )
              }
            />
          </details>
          {deck.questions.length > 1 && (
            <details>
              <summary className="cursor-pointer text-sm">
                Presentation and question order
              </summary>
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (deck.event.openQuestionId) await close(host);
                        await setSlide({ ...host, slide: { kind: "welcome" } });
                      })
                    }
                  >
                    Show welcome
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (deck.event.openQuestionId) await close(host);
                        await setSlide({ ...host, slide: { kind: "finale" } });
                      })
                    }
                  >
                    Finish event
                  </Button>
                </div>
                {deck.questions.map((question, index) => (
                  <div key={question._id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {question.prompt || `Question ${index + 1}`}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move question ${index + 1} up`}
                      disabled={busy || index === 0}
                      onClick={() => void moveQuestion(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move question ${index + 1} down`}
                      disabled={busy || index === deck.questions.length - 1}
                      onClick={() => void moveQuestion(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            {selected && (
              <>
                <Button variant="outline" asChild>
                  <a
                    href={`${hostBase}/results/${selected._id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open results separately
                  </a>
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Clear this question's votes? This cannot be undone.",
                      )
                    )
                      void run(() =>
                        resetQuestion({ ...host, questionId: selected._id }),
                      );
                  }}
                >
                  Clear question votes
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Remove this question? Recorded votes will be kept in its results.",
                      )
                    )
                      void run(async () => {
                        await removeQuestion({
                          ...host,
                          questionId: selected._id,
                        });
                        setSelectedId(undefined);
                        setEditor(undefined);
                      });
                  }}
                >
                  Remove question
                </Button>
              </>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Clear all votes and restart this event? This cannot be undone.",
                  )
                )
                  void run(async () => {
                    await resetEvent(host);
                    setEditor(undefined);
                  });
              }}
            >
              Reset event
            </Button>
          </div>
        </div>
      </details>
    </PageContainer>
  );
}

type QuestionFormProps = Props & {
  questionId: Id<"questions">;
  busy: boolean;
  live: boolean;
  closed: boolean;
  canAddQuestion: boolean;
  onSave: (
    draft: PollDraft,
    start: boolean,
    questionId: Id<"questions">,
    expectedChoiceIds: Id<"choices">[],
    nextEditor?: "new" | Id<"questions">,
  ) => Promise<void>;
  onCancel: () => void;
};
function ExistingQuestionForm({
  detail,
  ...props
}: QuestionFormProps & { detail: QuestionDetail }) {
  const [original] = useState(detail);
  const active = original.choices.filter((choice) => !choice.archived);
  const expectedChoiceIds = active.map((choice) => choice._id);
  return (
    <PollEditor
      initial={{
        prompt: original.question.prompt,
        imageUrl: original.question.imageUrl,
        choices: active.map((choice) => ({
          id: choice._id,
          label: choice.label,
          imageUrl: choice.imageUrl,
        })),
        minSelections: original.question.minSelections,
        maxSelections: original.question.maxSelections,
        countdownSeconds: original.question.countdownSeconds,
      }}
      busy={props.busy}
      live={props.live}
      closed={props.closed}
      onSave={(draft, start) =>
        props.onSave(draft, start, props.questionId, expectedChoiceIds)
      }
      onCancel={props.onCancel}
      onAddQuestion={(draft) =>
        props.onSave(draft, false, props.questionId, expectedChoiceIds, "new")
      }
      onSelectQuestion={(draft, target) =>
        props.onSave(draft, false, props.questionId, expectedChoiceIds, target)
      }
      canAddQuestion={props.canAddQuestion}
    />
  );
}

function EventDetails({
  title,
  description,
  busy,
  onSave,
}: {
  title: string;
  description: string;
  busy: boolean;
  onSave: (title: string, description: string) => Promise<void>;
}) {
  const [titleDraft, setTitleDraft] = useState(title);
  const [descriptionDraft, setDescriptionDraft] = useState(description);
  return (
    <form
      className="mt-4 max-w-xl space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(titleDraft, descriptionDraft);
      }}
    >
      <Label htmlFor="event-title">Title</Label>
      <Input
        id="event-title"
        value={titleDraft}
        required
        maxLength={200}
        disabled={busy}
        onChange={(event) => setTitleDraft(event.target.value)}
      />
      <Label htmlFor="event-description">Description</Label>
      <Textarea
        id="event-description"
        value={descriptionDraft}
        maxLength={2000}
        disabled={busy}
        onChange={(event) => setDescriptionDraft(event.target.value)}
      />
      <Button type="submit" variant="outline" disabled={busy}>
        Save details
      </Button>
    </form>
  );
}
