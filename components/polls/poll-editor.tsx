"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageControl } from "@/components/polls/image-control";
import { validateImageFile } from "@/lib/image-upload";
import { Textarea } from "@/components/ui/textarea";

type DraftImage = { imageFile?: File | null; imageUrl?: string | null };
export type PollDraft = DraftImage & {
  prompt: string;
  choices: ({ id?: Id<"choices">; label: string } & DraftImage)[];
  minSelections: number;
  maxSelections: number;
  countdownSeconds?: number;
};

type Props = {
  initial?: PollDraft;
  busy: boolean;
  live?: boolean;
  closed?: boolean;
  onSave: (draft: PollDraft, start: boolean) => Promise<void>;
  onAddQuestion?: (draft: PollDraft) => Promise<void>;
  canAddQuestion?: boolean;
  onCancel?: () => void;
  onSelectQuestion?: (
    draft: PollDraft,
    questionId: Id<"questions">,
  ) => Promise<void>;
};

export function PollEditor({
  initial,
  busy,
  live = false,
  closed = false,
  onSave,
  onAddQuestion,
  canAddQuestion = true,
  onCancel,
  onSelectQuestion,
}: Props) {
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const inputRefs = useRef(new Map<number, HTMLInputElement>());
  const nextKey = useRef(initial?.choices.length || 2);
  const [choices, setChoices] = useState(() =>
    (initial?.choices.length
      ? initial.choices
      : [{ label: "" }, { label: "" }]
    ).map((choice, key): PollDraft["choices"][number] & { key: number } => ({
      ...choice,
      key,
    })),
  );
  const [multiple, setMultiple] = useState((initial?.maxSelections ?? 1) > 1);
  const [min, setMin] = useState(String(initial?.minSelections ?? 1));
  const [max, setMax] = useState(String(initial?.maxSelections ?? 2));
  const [timer, setTimer] = useState(
    initial?.countdownSeconds?.toString() ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [questionImage, setQuestionImage] = useState<DraftImage>({
    imageUrl: initial?.imageUrl,
  });
  const previewUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  function chooseImage(file: File | null, key?: number) {
    setError(null);
    if (file) {
      const invalid = validateImageFile(file);
      if (invalid) {
        setError(invalid);
        return;
      }
    }
    const imageUrl = file ? URL.createObjectURL(file) : null;
    if (imageUrl) previewUrls.current.add(imageUrl);
    const image = { imageFile: file, imageUrl };
    if (key === undefined) setQuestionImage(image);
    else
      setChoices((rows) =>
        rows.map((row) => (row.key === key ? { ...row, ...image } : row)),
      );
  }

  function addChoice() {
    const key = nextKey.current++;
    setChoices((rows) => [...rows, { key, label: "" }]);
    requestAnimationFrame(() => inputRefs.current.get(key)?.focus());
  }

  function moveChoice(index: number, direction: -1 | 1) {
    setChoices((rows) => {
      const next = [...rows];
      [next[index], next[index + direction]] = [
        next[index + direction],
        next[index],
      ];
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute(
      "value",
    );
    const selectedQuestion = action?.startsWith("question:")
      ? (action.slice("question:".length) as Id<"questions">)
      : undefined;
    const start =
      !selectedQuestion &&
      action !== "draft" &&
      action !== "add-question" &&
      !live;
    setError(null);
    if ((start || live) && !prompt.trim()) {
      setError("Add a question before starting the poll.");
      return;
    }
    const draft: PollDraft = {
      prompt,
      ...(questionImage.imageFile !== undefined
        ? { imageFile: questionImage.imageFile }
        : {}),
      choices: choices.map(({ id, label, imageFile }) => ({
        ...(id ? { id } : {}),
        label,
        ...(imageFile !== undefined ? { imageFile } : {}),
      })),
      minSelections: multiple ? Number(min) : 1,
      maxSelections: multiple ? Number(max) : 1,
      ...(timer.trim() ? { countdownSeconds: Number(timer) } : {}),
    };
    if (
      !Number.isInteger(draft.minSelections) ||
      !Number.isInteger(draft.maxSelections) ||
      draft.minSelections < 1 ||
      draft.maxSelections < draft.minSelections ||
      draft.maxSelections > 20
    ) {
      setError("Choose a valid answer range between 1 and 20.");
      return;
    }
    if (
      draft.countdownSeconds !== undefined &&
      (!Number.isInteger(draft.countdownSeconds) ||
        draft.countdownSeconds < 5 ||
        draft.countdownSeconds > 3600)
    ) {
      setError("The countdown must be between 5 and 3,600 seconds.");
      return;
    }
    if (selectedQuestion) {
      await onSelectQuestion?.(draft, selectedQuestion);
    } else if (action === "add-question") {
      if (canAddQuestion) await onAddQuestion?.(draft);
    } else {
      await onSave(draft, start);
    }
  }

  return (
    <form
      id="poll-question-editor"
      onSubmit={submit}
      noValidate
      className="space-y-6"
    >
      <fieldset disabled={busy} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="poll-question">Your question</Label>
          <Textarea
            id="poll-question"
            placeholder="What should we talk about next?"
            value={prompt}
            maxLength={500}
            onChange={(event) => setPrompt(event.target.value)}
            className="min-h-24 text-base"
          />
        </div>
        <div className="space-y-3">
          <Label>Answer options</Label>
          {choices.map((choice, index) => (
            <div key={choice.key} className="flex items-center gap-3">
              <ImageControl
                imageUrl={choice.imageUrl ?? null}
                label={`Image for option ${index + 1}`}
                uploading={false}
                progress={undefined}
                disabled={busy}
                onUpload={(file) => chooseImage(file, choice.key)}
                onRemove={() => chooseImage(null, choice.key)}
                compact
              />
              <Input
                ref={(element) => {
                  if (element) inputRefs.current.set(choice.key, element);
                  else inputRefs.current.delete(choice.key);
                }}
                aria-label={`Option ${index + 1}`}
                placeholder={`Option ${index + 1}`}
                value={choice.label}
                maxLength={200}
                onChange={(event) =>
                  setChoices((rows) =>
                    rows.map((row) =>
                      row.key === choice.key
                        ? { ...row, label: event.target.value }
                        : row,
                    ),
                  )
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    index === choices.length - 1 &&
                    choices.length < 20
                  ) {
                    event.preventDefault();
                    addChoice();
                  }
                }}
                onPaste={(event) => {
                  const lines = event.clipboardData
                    .getData("text")
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean);
                  if (lines.length < 2) return;
                  const remaining = choices
                    .slice(index + 1)
                    .filter(
                      (row) => row.id || row.label.trim() || row.imageUrl,
                    );
                  if (index + lines.length + remaining.length > 20) {
                    event.preventDefault();
                    setError("A poll can have up to 20 options.");
                    return;
                  }
                  event.preventDefault();
                  const rows = lines.map((label, lineIndex) =>
                    lineIndex === 0
                      ? { ...choice, label }
                      : { key: nextKey.current++, label },
                  );
                  setChoices((current) => [
                    ...current.slice(0, index),
                    ...rows,
                    ...remaining,
                  ]);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={choices.length <= 2}
                aria-label={`Remove option ${index + 1}`}
                onClick={() =>
                  setChoices((rows) =>
                    rows.filter((row) => row.key !== choice.key),
                  )
                }
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={choices.length >= 20}
            onClick={addChoice}
          >
            <Plus /> Add option
          </Button>
        </div>
        <details className="rounded-lg border px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">
            Options
          </summary>
          <div className="mt-5 space-y-5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={multiple}
                onChange={(event) => {
                  setMultiple(event.target.checked);
                  if (event.target.checked && Number(max) < 2)
                    setMax(String(Math.max(choices.length, 2)));
                }}
              />{" "}
              Allow multiple answers
            </label>
            {multiple && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="poll-min">At least</Label>
                  <Input
                    id="poll-min"
                    type="number"
                    min={1}
                    max={20}
                    value={min}
                    onChange={(event) => setMin(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="poll-max">At most</Label>
                  <Input
                    id="poll-max"
                    type="number"
                    min={1}
                    max={20}
                    value={max}
                    onChange={(event) => setMax(event.target.value)}
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="poll-timer">Countdown in seconds</Label>
              <Input
                id="poll-timer"
                type="number"
                min={5}
                max={3600}
                placeholder="No timer"
                value={timer}
                onChange={(event) => setTimer(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A reminder to wrap up. You decide when voting ends.
              </p>
            </div>
            <details>
              <summary className="cursor-pointer text-sm">
                Reorder options
              </summary>
              <div className="mt-3 space-y-2">
                {choices.map((choice, index) => (
                  <div key={choice.key} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {choice.label || `Option ${index + 1}`}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move option ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => moveChoice(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move option ${index + 1} down`}
                      disabled={index === choices.length - 1}
                      onClick={() => moveChoice(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                ))}
              </div>
            </details>
            <div className="space-y-2">
              <Label>Question image</Label>
              <ImageControl
                imageUrl={questionImage.imageUrl ?? null}
                label="Question image"
                uploading={false}
                progress={undefined}
                disabled={busy}
                onUpload={(file) => chooseImage(file)}
                onRemove={() => chooseImage(null)}
              />
            </div>
          </div>
        </details>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" value="start" className="relative">
            <span className={busy ? "invisible" : undefined}>
              {live ? "Save changes" : closed ? "Reopen poll" : "Start poll"}
            </span>
            {busy && <span className="absolute">Saving…</span>}
          </Button>
          {!live && (
            <Button type="submit" variant="outline" size="lg" value="draft">
              {initial ? "Save changes" : "Save draft"}
            </Button>
          )}
          {onAddQuestion && (
            <Button
              type="submit"
              variant="outline"
              size="lg"
              value="add-question"
              disabled={!canAddQuestion}
            >
              <Plus /> Add another question
            </Button>
          )}
          {onCancel && (
            <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
