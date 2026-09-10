"use client";

import Link from "next/link";
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { ConvexError } from "convex/values";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FlagTriangleRight,
  Home,
  ImageIcon,
  Loader2,
  MonitorPlay,
  Plus,
  RotateCcw,
  Save,
  Square,
  Trash2,
  X,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { VotingStatusBadge } from "@/components/polls/status-badge";
import { Countdown } from "@/components/polls/countdown";
import { PresencePill } from "@/components/polls/presence-pill";
import { SecretPill } from "@/components/polls/secret-pill";
import { PageContainer } from "@/components/polls/page-container";
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
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { rememberEvent } from "@/lib/remembered-events";
import { cn } from "@/lib/utils";

type Props = { publicSlug: string; hostSecret: string };
type AppErrorData = { code?: string; message?: string };
type Slide =
  | { kind: "welcome" }
  | { kind: "question"; questionId: Id<"questions"> }
  | { kind: "finale" };

/**
 * Mirrors `convex/questions.ts`'s `getHostDetail` return shape by name,
 * rather than deriving it via `FunctionReturnType<typeof ...>`, so this
 * type documents the contract directly instead of coupling to the query's
 * implementation reference.
 */
type QuestionDetailQuestion = {
  _id: Id<"questions">;
  _creationTime: number;
  eventId: Id<"events">;
  position: number;
  prompt: string;
  imageUrl: string | null;
  minSelections: number;
  maxSelections: number;
  countdownSeconds?: number;
  responseGeneration: number;
  closedGeneration?: number;
  closedAt?: number;
  archivedAt?: number;
};

type QuestionDetailChoice = {
  _id: Id<"choices">;
  _creationTime: number;
  questionId: Id<"questions">;
  position: number;
  label: string;
  imageUrl: string | null;
  archived: boolean;
};

type QuestionDetail = {
  question: QuestionDetailQuestion;
  choices: QuestionDetailChoice[];
};

type QuestionDraft = {
  prompt: string;
  minSelections: string;
  maxSelections: string;
  countdownSeconds: string;
};

type ChoiceDraft = { id: Id<"choices">; label: string };

/** Tracks the in-flight upload's percentage, keyed the same way as `busy`
 * ("question-image" or `choice-image-${choiceId}`) so it's unambiguous
 * which image slot a percentage belongs to. */
type UploadProgressState = { key: string; percent: number } | null;

/** Matches `images.ts`'s server-enforced bound so the client rejects an
 * oversized file before ever starting the upload. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function validateImageFile(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "Please choose an image file.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Images must be 5 MiB or smaller.";
  }
  return null;
}

type UploadResponse = { storageId: Id<"_storage"> };

function isUploadResponse(value: unknown): value is UploadResponse {
  if (typeof value !== "object" || value === null) return false;
  if (!("storageId" in value)) return false;
  return typeof value.storageId === "string";
}

/**
 * POSTs `file` to `uploadUrl` and resolves with the parsed response body.
 * Uses `XMLHttpRequest` rather than `fetch`, which has no portable
 * upload-progress event - `xhr.upload.onprogress` is what lets
 * `onProgress` report a real 0-100 percentage while the bytes are still
 * uploading. Rejects with a clear, user-facing `Error` on a network
 * failure, an aborted request, a non-2xx response, or an unparsable body,
 * so every failure mode surfaces through the same error path as any other
 * action.
 */
function uploadFileWithProgress(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<UploadResponse> {
  const { promise, resolve, reject } = Promise.withResolvers<UploadResponse>();
  const xhr = new XMLHttpRequest();
  xhr.open("POST", uploadUrl);
  xhr.setRequestHeader("Content-Type", file.type);
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      onProgress(Math.round((event.loaded / event.total) * 100));
    }
  };
  xhr.onload = () => {
    if (xhr.status < 200 || xhr.status >= 300) {
      reject(new Error("Image upload failed. Try again."));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(xhr.responseText);
    } catch {
      reject(new Error("Image upload failed. Try again."));
      return;
    }
    if (!isUploadResponse(parsed)) {
      reject(new Error("Image upload failed. Try again."));
      return;
    }
    resolve(parsed);
  };
  xhr.onerror = () =>
    reject(
      new Error("Image upload failed. Check your connection and try again."),
    );
  xhr.onabort = () => reject(new Error("Image upload was cancelled."));
  xhr.send(file);
  return promise;
}

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as AppErrorData;
    return data.message ?? "That action could not be completed.";
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Could not reach the event service. Check your connection and try again.";
}

function votingState(
  event: {
    generation: number;
    openQuestionId?: Id<"questions">;
  },
  question: {
    _id: Id<"questions">;
    closedGeneration?: number;
  },
): "ready" | "open" | "closed" {
  if (event.openQuestionId === question._id) return "open";
  return question.closedGeneration === event.generation ? "closed" : "ready";
}

function displayQuestion(question: {
  prompt: string;
  position: number;
}): string {
  return question.prompt.trim() || `Untitled question ${question.position + 1}`;
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

export function ControlRoomClient(props: Props) {
  return (
    <DeckErrorBoundary>
      <ControlRoom {...props} />
    </DeckErrorBoundary>
  );
}

function ControlRoom({ publicSlug, hostSecret }: Props) {
  const deck = useQuery(api.presentation.getDeck, { publicSlug, hostSecret });
  const presence = useQuery(api.presence.getConnectedCount, {
    publicSlug,
    hostSecret,
  });
  const updateDetails = useMutation(api.events.updateDetails);
  const resetEvent = useMutation(api.events.reset);
  const createQuestion = useMutation(api.questions.create);
  const updateQuestion = useMutation(api.questions.update);
  const removeQuestion = useMutation(api.questions.removeOrArchive);
  const reorderQuestions = useMutation(api.questions.reorder);
  const resetResponses = useMutation(api.questions.resetResponses);
  const createChoice = useMutation(api.choices.create);
  const updateChoice = useMutation(api.choices.update);
  const removeChoice = useMutation(api.choices.removeOrArchive);
  const reorderChoices = useMutation(api.choices.reorder);
  const setSlide = useMutation(api.presentation.setSlide);
  const openVoting = useMutation(api.presentation.openVoting);
  const closeVoting = useMutation(api.presentation.closeVoting);
  const generateUploadUrl = useMutation(api.images.generateUploadUrl);
  const setQuestionImage = useMutation(api.images.setQuestionImage);
  const setChoiceImage = useMutation(api.images.setChoiceImage);

  // Only the host's *explicit* click is stored; the effective selection is
  // derived below (falls back to the first question, or clears itself once
  // the explicit pick is archived/removed) instead of syncing that
  // fallback through a separate effect.
  const [explicitSelectedQuestionId, setExplicitSelectedQuestionId] =
    useState<Id<"questions">>();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Keyed the same way as `busy` ("question-image" or
  // `choice-image-${choiceId}`), so it's unambiguous which upload a
  // percentage belongs to even though only one upload runs at a time.
  const [uploadProgress, setUploadProgress] =
    useState<UploadProgressState>(null);

  const selectedQuestionId =
    deck !== undefined &&
    explicitSelectedQuestionId !== undefined &&
    deck.questions.some(
      (question) => question._id === explicitSelectedQuestionId,
    )
      ? explicitSelectedQuestionId
      : deck?.questions[0]?._id;

  const detail = useQuery(
    api.questions.getHostDetail,
    selectedQuestionId === undefined
      ? "skip"
      : { publicSlug, hostSecret, questionId: selectedQuestionId },
  );

  // Remembers a directly-opened host link locally — a genuine side effect
  // (writing to localStorage), not state derived from a query, so it
  // belongs in an effect rather than during render.
  const eventPublicSlug = deck?.event.publicSlug;
  const eventTitle = deck?.event.title;
  useEffect(() => {
    if (eventPublicSlug === undefined || eventTitle === undefined) return;
    const hostUrl = `/host/${publicSlug}/${hostSecret}`;
    rememberEvent({
      publicSlug: eventPublicSlug,
      hostUrl,
      title: eventTitle,
    });
  }, [eventPublicSlug, eventTitle, hostSecret, publicSlug]);

  const activeQuestion = useMemo(() => {
    const currentSlide = deck?.event.currentSlide;
    if (deck === undefined || currentSlide?.kind !== "question")
      return undefined;
    return deck.questions.find(
      (question) => question._id === currentSlide.questionId,
    );
  }, [deck]);

  const hostBase = `/host/${publicSlug}/${hostSecret}`;

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
      setUploadProgress(null);
    }
  }

  if (deck === undefined) {
    return (
      <PageContainer>
        <div className="space-y-6" aria-busy="true">
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
          <div className="h-20 animate-pulse rounded-lg bg-muted" />
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <div className="h-80 animate-pulse rounded-lg bg-muted" />
            <div className="h-[520px] animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
      </PageContainer>
    );
  }

  const slides: Slide[] = [
    { kind: "welcome" },
    ...deck.questions.map((question) => ({
      kind: "question" as const,
      questionId: question._id,
    })),
    { kind: "finale" },
  ];
  const liveSlide = deck.event.currentSlide;
  const currentSlideIndex = slides.findIndex((slide) => {
    if (slide.kind !== liveSlide.kind) return false;
    if (slide.kind !== "question" || liveSlide.kind !== "question") return true;
    return slide.questionId === liveSlide.questionId;
  });
  const currentSlideLabel =
    deck.event.currentSlide.kind === "welcome"
      ? "Welcome"
      : deck.event.currentSlide.kind === "finale"
        ? "Finale"
        : activeQuestion === undefined
          ? "Question"
          : `Question ${activeQuestion.position + 1} of ${deck.questions.length}`;

  async function changeSlide(slide: Slide) {
    await run("slide", () => setSlide({ publicSlug, hostSecret, slide }));
  }

  async function saveEventDetails(title: string, description: string) {
    await run("details", () =>
      updateDetails({
        publicSlug,
        hostSecret,
        title,
        description: description.trim() === "" ? null : description,
      }),
    );
  }

  async function addQuestion() {
    await run("add-question", async () => {
      const result = await createQuestion({
        publicSlug,
        hostSecret,
        prompt: "",
        minSelections: 1,
        maxSelections: 1,
      });
      setExplicitSelectedQuestionId(result.questionId);
    });
  }

  async function saveQuestion(
    questionId: Id<"questions">,
    draft: QuestionDraft,
  ) {
    const minSelections = Number(draft.minSelections);
    const maxSelections = Number(draft.maxSelections);
    const countdownSeconds = draft.countdownSeconds.trim();
    await run("save-question", () =>
      updateQuestion({
        publicSlug,
        hostSecret,
        questionId,
        prompt: draft.prompt,
        minSelections,
        maxSelections,
        countdownSeconds:
          countdownSeconds === "" ? null : Number(countdownSeconds),
      }),
    );
  }

  async function shiftQuestion(questionId: Id<"questions">, direction: -1 | 1) {
    if (deck === undefined) return;
    const index = deck.questions.findIndex(
      (question) => question._id === questionId,
    );
    const target = index + direction;
    if (index < 0 || target < 0 || target >= deck.questions.length) return;
    const ids = deck.questions.map((question) => question._id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run("reorder-questions", () =>
      reorderQuestions({ publicSlug, hostSecret, orderedQuestionIds: ids }),
    );
  }

  async function archiveQuestion(questionId: Id<"questions">) {
    if (
      !window.confirm(
        "Remove this question? Questions with recorded responses are archived instead.",
      )
    )
      return;
    await run("archive-question", () =>
      removeQuestion({ publicSlug, hostSecret, questionId }),
    );
  }

  async function resetQuestion(questionId: Id<"questions">) {
    if (
      !window.confirm("Reset this question's responses? This cannot be undone.")
    )
      return;
    await run("reset-question", () =>
      resetResponses({ publicSlug, hostSecret, questionId }),
    );
  }

  async function addChoice(questionId: Id<"questions">) {
    await run("add-choice", () =>
      createChoice({ publicSlug, hostSecret, questionId, label: "" }),
    );
  }

  async function saveChoice(choiceId: Id<"choices">, label: string) {
    await run(`save-choice-${choiceId}`, () =>
      updateChoice({ publicSlug, hostSecret, choiceId, label }),
    );
  }

  async function archiveChoice(choiceId: Id<"choices">) {
    if (
      !window.confirm(
        "Remove this choice? Choices with recorded selections are archived instead.",
      )
    )
      return;
    await run(`archive-choice-${choiceId}`, () =>
      removeChoice({ publicSlug, hostSecret, choiceId }),
    );
  }

  async function reorderChoicesFor(
    questionId: Id<"questions">,
    orderedChoiceIds: Id<"choices">[],
  ) {
    await run("reorder-choices", () =>
      reorderChoices({ publicSlug, hostSecret, questionId, orderedChoiceIds }),
    );
  }

  /** POSTs the file to a freshly generated upload URL and returns the
   * storage id Convex assigned it — the only way to attach an image, since
   * `setQuestionImage`/`setChoiceImage` take a storage id, never raw bytes. */
  async function uploadImage(
    file: File,
    onProgress: (percent: number) => void,
  ): Promise<Id<"_storage">> {
    const { uploadUrl } = await generateUploadUrl({ publicSlug, hostSecret });
    const body = await uploadFileWithProgress(uploadUrl, file, onProgress);
    return body.storageId;
  }

  async function uploadQuestionImage(questionId: Id<"questions">, file: File) {
    const validationError = validateImageFile(file);
    if (validationError !== null) {
      setMessage(validationError);
      return;
    }
    await run("question-image", async () => {
      const storageId = await uploadImage(file, (percent) =>
        setUploadProgress({ key: "question-image", percent }),
      );
      await setQuestionImage({ publicSlug, hostSecret, questionId, storageId });
    });
  }

  async function removeQuestionImage(questionId: Id<"questions">) {
    await run("question-image", () =>
      setQuestionImage({ publicSlug, hostSecret, questionId, storageId: null }),
    );
  }

  async function uploadChoiceImage(choiceId: Id<"choices">, file: File) {
    const validationError = validateImageFile(file);
    if (validationError !== null) {
      setMessage(validationError);
      return;
    }
    await run(`choice-image-${choiceId}`, async () => {
      const key = `choice-image-${choiceId}`;
      const storageId = await uploadImage(file, (percent) =>
        setUploadProgress({ key, percent }),
      );
      await setChoiceImage({ publicSlug, hostSecret, choiceId, storageId });
    });
  }

  async function removeChoiceImage(choiceId: Id<"choices">) {
    await run(`choice-image-${choiceId}`, () =>
      setChoiceImage({ publicSlug, hostSecret, choiceId, storageId: null }),
    );
  }

  return (
    <PageContainer>
      <header className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild aria-label="Dashboard">
              <Link href="/">
                <Home className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {deck.event.title}
            </h1>
          </div>
          <p className="ml-10 max-w-2xl text-sm text-muted-foreground">
            {deck.event.description || "No event description yet."}
          </p>
          <div className="ml-10 mt-2 flex flex-wrap items-center gap-2">
            <SecretPill secret={hostSecret} />
            <span className="font-mono text-xs text-muted-foreground">
              /e/{deck.event.publicSlug}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {presence === undefined ? (
            <span className="inline-flex items-center gap-2 rounded-full border bg-muted px-3 py-1 text-sm text-muted-foreground">
              Connecting…
            </span>
          ) : (
            <span title="Approximate - counts devices with an active audience or projector connection">
              <PresencePill count={presence.connectedCount} />
            </span>
          )}
          <Button variant="secondary" asChild>
            <a href={`${hostBase}/present`} target="_blank" rel="noreferrer">
              <MonitorPlay className="h-4 w-4" /> Open projector
            </a>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              if (
                window.confirm(
                  "Reset all event responses and return to the welcome slide? This cannot be undone.",
                )
              ) {
                void run("reset-event", () =>
                  resetEvent({ publicSlug, hostSecret }),
                );
              }
            }}
          >
            <RotateCcw className="h-4 w-4" /> Reset event
          </Button>
        </div>
      </header>

      {message && (
        <p
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {message}
        </p>
      )}

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null || currentSlideIndex <= 0}
              onClick={() => void changeSlide(slides[currentSlideIndex - 1])}
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button
              variant={
                deck.event.currentSlide.kind === "welcome"
                  ? "secondary"
                  : "outline"
              }
              size="sm"
              disabled={busy !== null}
              onClick={() => void changeSlide({ kind: "welcome" })}
            >
              Welcome
            </Button>
            <div className="min-w-36 px-2 text-sm">
              <p className="text-xs text-muted-foreground">Current slide</p>
              <p className="font-medium">{currentSlideLabel}</p>
            </div>
            <Button
              variant={
                deck.event.currentSlide.kind === "finale"
                  ? "secondary"
                  : "outline"
              }
              size="sm"
              disabled={busy !== null}
              onClick={() => void changeSlide({ kind: "finale" })}
            >
              <FlagTriangleRight className="h-4 w-4" /> Finale
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null || currentSlideIndex >= slides.length - 1}
              onClick={() => void changeSlide(slides[currentSlideIndex + 1])}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {activeQuestion ? (
              <VotingStatusBadge
                state={votingState(deck.event, activeQuestion)}
              />
            ) : (
              <Badge variant="outline">No question selected</Badge>
            )}
            {activeQuestion &&
              deck.event.openQuestionId === activeQuestion._id &&
              activeQuestion.countdownSeconds !== undefined &&
              deck.event.votingOpenedAt !== undefined && (
                <Countdown
                  countdownSeconds={activeQuestion.countdownSeconds}
                  openedAt={deck.event.votingOpenedAt}
                />
              )}
            {activeQuestion &&
            deck.event.openQuestionId === activeQuestion._id ? (
              <Button
                variant="destructive"
                disabled={busy !== null}
                onClick={() =>
                  void run("close-voting", () =>
                    closeVoting({ publicSlug, hostSecret }),
                  )
                }
              >
                <Square className="h-4 w-4" /> Close voting
              </Button>
            ) : activeQuestion ? (
              <Button
                disabled={busy !== null}
                onClick={() =>
                  void run("open-voting", () =>
                    openVoting({
                      publicSlug,
                      hostSecret,
                      questionId: activeQuestion._id,
                    }),
                  )
                }
              >
                Open voting
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Sequence</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Add question"
              disabled={busy !== null}
              onClick={() => void addQuestion()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 p-3 pt-0">
            {deck.questions.length === 0 ? (
              <p className="px-2 py-5 text-center text-sm text-muted-foreground">
                Add your first question to begin.
              </p>
            ) : (
              deck.questions.map((question, index) => (
                <div
                  key={question._id}
                  className={cn(
                    "flex items-center gap-1 rounded-md border p-1",
                    selectedQuestionId === question._id &&
                      "border-primary bg-primary/5",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => setExplicitSelectedQuestionId(question._id)}
                  >
                    <span className="mr-1.5 text-muted-foreground">
                      {question.position + 1}.
                    </span>
                    {displayQuestion(question)}
                  </button>
                  <VotingStatusBadge
                    state={votingState(deck.event, question)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Move question ${question.position + 1} up`}
                    disabled={busy !== null || index === 0}
                    onClick={() => void shiftQuestion(question._id, -1)}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Move question ${question.position + 1} down`}
                    disabled={
                      busy !== null || index === deck.questions.length - 1
                    }
                    onClick={() => void shiftQuestion(question._id, 1)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Show question ${question.position + 1}`}
                    disabled={busy !== null}
                    onClick={() =>
                      void changeSlide({
                        kind: "question",
                        questionId: question._id,
                      })
                    }
                  >
                    <MonitorPlay className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <EventDetailsCard
            key={deck.event._id}
            title={deck.event.title}
            description={deck.event.description}
            disabled={busy !== null}
            onSave={saveEventDetails}
          />

          {detail === undefined ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                {deck.questions.length === 0
                  ? "Create a question to open its editor."
                  : "Loading question editor…"}
              </CardContent>
            </Card>
          ) : (
            <QuestionEditorCard
              key={detail.question._id}
              detail={detail}
              hostBase={hostBase}
              busy={busy}
              uploadProgress={uploadProgress}
              liveBallotCount={
                deck.currentQuestionResults?.questionId === detail.question._id
                  ? deck.currentQuestionResults.ballotCount
                  : undefined
              }
              onSaveQuestion={(draft) =>
                saveQuestion(detail.question._id, draft)
              }
              onArchiveQuestion={() => archiveQuestion(detail.question._id)}
              onResetQuestion={() => resetQuestion(detail.question._id)}
              onAddChoice={() => addChoice(detail.question._id)}
              onSaveChoice={saveChoice}
              onArchiveChoice={archiveChoice}
              onReorderChoices={(orderedChoiceIds) =>
                reorderChoicesFor(detail.question._id, orderedChoiceIds)
              }
              onUploadQuestionImage={(file) =>
                uploadQuestionImage(detail.question._id, file)
              }
              onRemoveQuestionImage={() =>
                removeQuestionImage(detail.question._id)
              }
              onUploadChoiceImage={uploadChoiceImage}
              onRemoveChoiceImage={removeChoiceImage}
            />
          )}
        </div>
      </div>
    </PageContainer>
  );
}

/**
 * The event title/description editor. Keyed by the event id in the parent,
 * so its draft state is seeded once from the current `title`/`description`
 * and only ever reset by a full remount (a different event) — never by an
 * effect racing the host's typing against the next reactive query push.
 */
function EventDetailsCard({
  title,
  description,
  disabled,
  onSave,
}: {
  title: string;
  description: string | undefined;
  disabled: boolean;
  onSave: (title: string, description: string) => void;
}) {
  const [titleDraft, setTitleDraft] = useState(title);
  const [descriptionDraft, setDescriptionDraft] = useState(description ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Event details</CardTitle>
        <CardDescription>
          Changes are published only when you save them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="event-title">Title</Label>
          <Input
            id="event-title"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="event-description">Description</Label>
          <Textarea
            id="event-description"
            value={descriptionDraft}
            onChange={(event) => setDescriptionDraft(event.target.value)}
            disabled={disabled}
            placeholder="Optional context for your audience"
          />
        </div>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => onSave(titleDraft, descriptionDraft)}
        >
          <Save className="h-3.5 w-3.5" /> Save event details
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * The focused question/choices editor. Keyed by the question id in the
 * parent, so switching questions fully remounts this component (fresh
 * drafts seeded from the new `detail`) instead of syncing that reset
 * through an effect. Within the *same* question, an added/removed/archived
 * choice still needs to reconcile the choice-label drafts without
 * clobbering an in-progress edit to an untouched choice; that reconciling
 * `setState` call runs directly in the render body (React's documented
 * "adjusting state when a prop changes" pattern), not inside an effect.
 */
function QuestionEditorCard({
  detail,
  hostBase,
  busy,
  uploadProgress,
  liveBallotCount,
  onSaveQuestion,
  onArchiveQuestion,
  onResetQuestion,
  onAddChoice,
  onSaveChoice,
  onArchiveChoice,
  onReorderChoices,
  onUploadQuestionImage,
  onRemoveQuestionImage,
  onUploadChoiceImage,
  onRemoveChoiceImage,
}: {
  detail: QuestionDetail;
  hostBase: string;
  busy: string | null;
  uploadProgress: UploadProgressState;
  liveBallotCount: number | undefined;
  onSaveQuestion: (draft: QuestionDraft) => void;
  onArchiveQuestion: () => void;
  onResetQuestion: () => void;
  onAddChoice: () => void;
  onSaveChoice: (choiceId: Id<"choices">, label: string) => void;
  onArchiveChoice: (choiceId: Id<"choices">) => void;
  onReorderChoices: (orderedChoiceIds: Id<"choices">[]) => void;
  onUploadQuestionImage: (file: File) => void;
  onRemoveQuestionImage: () => void;
  onUploadChoiceImage: (choiceId: Id<"choices">, file: File) => void;
  onRemoveChoiceImage: (choiceId: Id<"choices">) => void;
}) {
  const { question, choices } = detail;

  const [questionDraft, setQuestionDraft] = useState<QuestionDraft>(() => ({
    prompt: question.prompt,
    minSelections: String(question.minSelections),
    maxSelections: String(question.maxSelections),
    countdownSeconds:
      question.countdownSeconds === undefined
        ? ""
        : String(question.countdownSeconds),
  }));
  const [choiceDrafts, setChoiceDrafts] = useState<ChoiceDraft[]>(() =>
    choices.map((choice) => ({ id: choice._id, label: choice.label })),
  );
  const [reconciledChoiceIds, setReconciledChoiceIds] = useState<
    Id<"choices">[]
  >(() => choices.map((choice) => choice._id));

  const currentChoiceIds = choices.map((choice) => choice._id);
  const choiceIdsChanged =
    currentChoiceIds.length !== reconciledChoiceIds.length ||
    currentChoiceIds.some((id, index) => id !== reconciledChoiceIds[index]);
  if (choiceIdsChanged) {
    setReconciledChoiceIds(currentChoiceIds);
    setChoiceDrafts((previous) => {
      const previousById = new Map(previous.map((draft) => [draft.id, draft]));
      return choices.map(
        (choice) =>
          previousById.get(choice._id) ?? {
            id: choice._id,
            label: choice.label,
          },
      );
    });
  }

  const activeChoices = choices.filter((choice) => !choice.archived);
  const disabled = busy !== null;

  function shiftChoice(choiceId: Id<"choices">, direction: -1 | 1) {
    const index = activeChoices.findIndex((choice) => choice._id === choiceId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= activeChoices.length) return;
    const ids = activeChoices.map((choice) => choice._id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onReorderChoices(ids);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">
            Question {question.position + 1}
          </CardTitle>
          <CardDescription>
            Editing this question does not change the projected slide.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a
              href={`${hostBase}/results/${question._id}`}
              target="_blank"
              rel="noreferrer"
            >
              <BarChart3 className="h-3.5 w-3.5" /> Stable results
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onResetQuestion}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset responses
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={disabled}
            onClick={onArchiveQuestion}
          >
            <Archive className="h-3.5 w-3.5" /> Remove
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="prompt">Prompt</Label>
          <Input
            id="prompt"
            value={questionDraft.prompt}
            onChange={(event) =>
              setQuestionDraft({ ...questionDraft, prompt: event.target.value })
            }
            disabled={disabled}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="min">Min selections</Label>
            <Input
              id="min"
              type="number"
              min={1}
              value={questionDraft.minSelections}
              onChange={(event) =>
                setQuestionDraft({
                  ...questionDraft,
                  minSelections: event.target.value,
                })
              }
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="max">Max selections</Label>
            <Input
              id="max"
              type="number"
              min={1}
              value={questionDraft.maxSelections}
              onChange={(event) =>
                setQuestionDraft({
                  ...questionDraft,
                  maxSelections: event.target.value,
                })
              }
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="countdown">Countdown (sec)</Label>
            <Input
              id="countdown"
              type="number"
              min={5}
              value={questionDraft.countdownSeconds}
              onChange={(event) =>
                setQuestionDraft({
                  ...questionDraft,
                  countdownSeconds: event.target.value,
                })
              }
              placeholder="None"
              disabled={disabled}
            />
          </div>
        </div>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => onSaveQuestion(questionDraft)}
        >
          <Save className="h-3.5 w-3.5" /> Save question
        </Button>
        <div className="space-y-1.5">
          <Label>Question image</Label>
          <ImageControl
            imageUrl={question.imageUrl}
            label="Question image"
            uploading={busy === "question-image"}
            progress={
              uploadProgress?.key === "question-image"
                ? uploadProgress.percent
                : undefined
            }
            disabled={disabled}
            onUpload={onUploadQuestionImage}
            onRemove={onRemoveQuestionImage}
          />
        </div>
        <Separator />
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Choices</Label>
            <span className="text-xs text-muted-foreground">
              {activeChoices.length} active choices ·{" "}
              {liveBallotCount !== undefined
                ? `${liveBallotCount} ballots`
                : "results shown on stable results page"}
            </span>
          </div>
          <ul className="space-y-2">
            {choices.map((choice) => {
              const draft = choiceDrafts.find((item) => item.id === choice._id);
              const activeIndex = activeChoices.findIndex(
                (item) => item._id === choice._id,
              );
              return (
                <li
                  key={choice._id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-2.5"
                >
                  <ImageControl
                    imageUrl={choice.imageUrl}
                    label="Choice image"
                    uploading={busy === `choice-image-${choice._id}`}
                    progress={
                      uploadProgress?.key === `choice-image-${choice._id}`
                        ? uploadProgress.percent
                        : undefined
                    }
                    disabled={disabled}
                    onUpload={(file) => onUploadChoiceImage(choice._id, file)}
                    onRemove={() => onRemoveChoiceImage(choice._id)}
                    compact
                  />
                  <Input
                    className="h-8 min-w-40 flex-1"
                    value={draft?.label ?? choice.label}
                    onChange={(event) =>
                      setChoiceDrafts(
                        choiceDrafts.map((item) =>
                          item.id === choice._id
                            ? { ...item, label: event.target.value }
                            : item,
                        ),
                      )
                    }
                    disabled={disabled}
                  />
                  {choice.archived && <Badge variant="outline">Archived</Badge>}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Save choice"
                    disabled={disabled}
                    onClick={() =>
                      onSaveChoice(choice._id, draft?.label ?? choice.label)
                    }
                  >
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Move choice up"
                    disabled={disabled || choice.archived || activeIndex === 0}
                    onClick={() => shiftChoice(choice._id, -1)}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Move choice down"
                    disabled={
                      disabled ||
                      choice.archived ||
                      activeIndex === activeChoices.length - 1
                    }
                    onClick={() => shiftChoice(choice._id, 1)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Remove or archive choice"
                    disabled={disabled || choice.archived}
                    onClick={() => onArchiveChoice(choice._id)}
                  >
                    {choice.archived ? (
                      <Archive className="h-3.5 w-3.5" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onAddChoice}
          >
            <Plus className="h-3.5 w-3.5" /> Add choice
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * A question or choice image slot: shows the current thumbnail (or a
 * neutral placeholder icon so choices without an image keep the same
 * layout as ones that have one), and lets the host upload, replace, or
 * remove it. The hidden file input is the only way to trigger a native
 * file picker from a styled button/icon.
 */
function ImageControl({
  imageUrl,
  label,
  uploading,
  progress,
  disabled,
  onUpload,
  onRemove,
  compact = false,
}: {
  imageUrl: string | null;
  label: string;
  uploading: boolean;
  /** 0-100 upload percentage while `uploading` is true, when the browser
   * could compute it (`ProgressEvent.lengthComputable`); `undefined` shows
   * an indeterminate spinner instead. */
  progress: number | undefined;
  disabled: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so choosing the exact same file again still fires onChange.
    event.target.value = "";
    if (file !== undefined) onUpload(file);
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={handleFileChange}
    />
  );

  if (compact) {
    return (
      <div className="relative shrink-0">
        {fileInput}
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center overflow-hidden rounded bg-muted text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          title={imageUrl ? "Replace image" : "Upload image"}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            progress !== undefined ? (
              <span className="text-[9px] font-semibold tabular-nums">
                {progress}%
              </span>
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )
          ) : imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL: host is per-deployment/dynamic, so next/image can't safely whitelist it via remotePatterns.
            <img className="h-8 w-8 object-cover" src={imageUrl} alt="" />
          ) : (
            <ImageIcon className="h-3.5 w-3.5" />
          )}
        </button>
        {imageUrl && !uploading && (
          <button
            type="button"
            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-white disabled:opacity-50"
            aria-label={`Remove ${label.toLowerCase()}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
      {fileInput}
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL: host is per-deployment/dynamic, so next/image can't safely whitelist it via remotePatterns.
        <img className="h-10 w-10 rounded object-cover" src={imageUrl} alt="" />
      ) : (
        <ImageIcon className="h-4 w-4" />
      )}
      <span>
        {uploading
          ? progress !== undefined
            ? `Uploading\u2026 ${progress}%`
            : "Uploading\u2026"
          : imageUrl
            ? `${label} attached`
            : "No image attached"}
      </span>
      {uploading && progress !== undefined && (
        <Progress value={progress} className="h-1.5 w-full" />
      )}
      <div className="ml-auto flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            imageUrl
              ? `Replace ${label.toLowerCase()}`
              : `Upload ${label.toLowerCase()}`
          }
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {imageUrl ? "Replace" : "Upload"}
        </Button>
        {imageUrl && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove ${label.toLowerCase()}`}
            disabled={disabled}
            onClick={onRemove}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
