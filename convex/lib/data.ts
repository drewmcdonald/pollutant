import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "./errors";

type ReadCtx = QueryCtx | MutationCtx;

/** An event may have at most this many active (non-archived) questions. */
export const MAX_ACTIVE_QUESTIONS = 100;

/** A question may have at most this many active (non-archived) choices. */
export const MAX_ACTIVE_CHOICES = 20;

/**
 * Upper bound on ballots scanned per question when checking whether a choice
 * is still referenced. The design targets approximately 250 concurrent
 * audience devices per event (system-design.md §16), so one question's
 * current-generation ballot count is bounded well below this constant.
 */
export const MAX_BALLOTS_SCANNED_PER_QUESTION = 260;

/** Bounded, position-ordered list of an event's active (non-archived) questions. */
export async function loadActiveQuestions(
  ctx: ReadCtx,
  eventId: Id<"events">,
  limit: number = MAX_ACTIVE_QUESTIONS + 1,
): Promise<Doc<"questions">[]> {
  return ctx.db
    .query("questions")
    .withIndex("by_event_archived_and_position", (q) =>
      q.eq("eventId", eventId).eq("archivedAt", undefined),
    )
    .take(limit);
}

/** Bounded, position-ordered list of a question's active (non-archived) choices. */
export async function loadActiveChoices(
  ctx: ReadCtx,
  questionId: Id<"questions">,
  limit: number = MAX_ACTIVE_CHOICES + 1,
): Promise<Doc<"choices">[]> {
  return ctx.db
    .query("choices")
    .withIndex("by_question_archived_and_position", (q) =>
      q.eq("questionId", questionId).eq("archivedAt", undefined),
    )
    .take(limit);
}

/** Loads a question and verifies it belongs to `eventId`; else `QUESTION_NOT_FOUND`. */
export async function requireQuestionInEvent(
  ctx: ReadCtx,
  questionId: Id<"questions">,
  eventId: Id<"events">,
): Promise<Doc<"questions">> {
  const question = await ctx.db.get(questionId);
  if (question === null || question.eventId !== eventId) {
    throw appError("QUESTION_NOT_FOUND", "No question exists for this event.");
  }
  return question;
}

/**
 * Loads a choice and its parent question, verifying the question belongs to
 * `eventId`. A missing choice or a choice whose question belongs to a
 * different event both surface as `CHOICE_NOT_FOUND`, since from the
 * caller's perspective (holding only a choice id) that is the entity in
 * question.
 */
export async function requireChoiceInEvent(
  ctx: ReadCtx,
  choiceId: Id<"choices">,
  eventId: Id<"events">,
): Promise<{ choice: Doc<"choices">; question: Doc<"questions"> }> {
  const choice = await ctx.db.get(choiceId);
  if (choice === null) {
    throw appError("CHOICE_NOT_FOUND", "No choice exists for this event.");
  }
  const question = await ctx.db.get(choice.questionId);
  if (question === null || question.eventId !== eventId) {
    throw appError("CHOICE_NOT_FOUND", "No choice exists for this event.");
  }
  return { choice, question };
}

/** Throws `QUESTION_LIMIT_EXCEEDED` when adding one more question would exceed the bound. */
export function assertQuestionLimit(activeCount: number): void {
  if (activeCount >= MAX_ACTIVE_QUESTIONS) {
    throw appError(
      "QUESTION_LIMIT_EXCEEDED",
      `An event may have at most ${MAX_ACTIVE_QUESTIONS} active questions.`,
    );
  }
}

/** Throws `CHOICE_LIMIT_EXCEEDED` when adding one more choice would exceed the bound. */
export function assertChoiceLimit(activeCount: number): void {
  if (activeCount >= MAX_ACTIVE_CHOICES) {
    throw appError(
      "CHOICE_LIMIT_EXCEEDED",
      `A question may have at most ${MAX_ACTIVE_CHOICES} active choices.`,
    );
  }
}

/**
 * Reassigns contiguous zero-based positions to an ordered list of active
 * questions, patching only the documents whose position actually changes.
 */
export async function reindexQuestionPositions(
  ctx: MutationCtx,
  orderedQuestions: Doc<"questions">[],
): Promise<void> {
  for (let index = 0; index < orderedQuestions.length; index++) {
    const question = orderedQuestions[index];
    if (question.position !== index) {
      await ctx.db.patch(question._id, { position: index });
    }
  }
}

/**
 * Reassigns contiguous zero-based positions to an ordered list of active
 * choices, patching only the documents whose position actually changes.
 */
export async function reindexChoicePositions(
  ctx: MutationCtx,
  orderedChoices: Doc<"choices">[],
): Promise<void> {
  for (let index = 0; index < orderedChoices.length; index++) {
    const choice = orderedChoices[index];
    if (choice.position !== index) {
      await ctx.db.patch(choice._id, { position: index });
    }
  }
}

/**
 * Verifies that `candidateIds` is exactly the same set as `activeIds` — same
 * size, no duplicates, no foreign or missing members — else throws
 * `INVALID_REORDER`.
 */
export function assertExactIdSet<T extends string>(
  candidateIds: T[],
  activeIds: T[],
): void {
  const candidateSet = new Set(candidateIds);
  const activeSet = new Set(activeIds);
  const isExactMatch =
    candidateSet.size === candidateIds.length &&
    candidateSet.size === activeSet.size &&
    candidateIds.every((id) => activeSet.has(id));
  if (!isExactMatch) {
    throw appError(
      "INVALID_REORDER",
      "The reorder list must contain exactly the current active items, with no duplicates, additions, or omissions.",
    );
  }
}

/**
 * Bounded check for whether any ballot at the question's current event
 * generation exists at all (any response generation). Used to decide
 * whether removing the question must archive it instead of deleting it.
 */
export async function hasAnyCurrentGenerationBallot(
  ctx: ReadCtx,
  eventId: Id<"events">,
  eventGeneration: number,
  questionId: Id<"questions">,
): Promise<boolean> {
  const ballot = await ctx.db
    .query("ballots")
    .withIndex("by_question_response", (q) =>
      q
        .eq("eventId", eventId)
        .eq("eventGeneration", eventGeneration)
        .eq("questionId", questionId),
    )
    .first();
  return ballot !== null;
}

/**
 * Bounded scan (see `MAX_BALLOTS_SCANNED_PER_QUESTION`) of a question's
 * current-generation, current-response-generation ballots for a reference to
 * `choiceId`. Used to decide whether removing the choice must archive it
 * instead of deleting it.
 */
export async function isChoiceReferencedByCurrentBallots(
  ctx: ReadCtx,
  eventId: Id<"events">,
  eventGeneration: number,
  questionId: Id<"questions">,
  responseGeneration: number,
  choiceId: Id<"choices">,
): Promise<boolean> {
  const ballots = await ctx.db
    .query("ballots")
    .withIndex("by_question_response", (q) =>
      q
        .eq("eventId", eventId)
        .eq("eventGeneration", eventGeneration)
        .eq("questionId", questionId)
        .eq("responseGeneration", responseGeneration),
    )
    .take(MAX_BALLOTS_SCANNED_PER_QUESTION);
  return ballots.some((ballot) => ballot.selectedChoiceIds.includes(choiceId));
}
