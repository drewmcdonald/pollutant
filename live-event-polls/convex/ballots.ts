import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { findEventByPublicSlug } from "./lib/auth";
import { recordBallot, type CounterScope } from "./lib/counters";
import { requireQuestionInEvent } from "./lib/data";
import { appError } from "./lib/errors";

const MAX_RESPONDENT_TOKEN_LENGTH = 128;

export const submit = mutation({
  args: {
    publicSlug: v.string(),
    eventGeneration: v.number(),
    questionId: v.id("questions"),
    respondentToken: v.string(),
    selectedChoiceIds: v.array(v.id("choices")),
  },
  returns: v.object({ ballotId: v.id("ballots") }),
  handler: async (ctx, args) => {
    const event = await findEventByPublicSlug(ctx, args.publicSlug);
    if (event === null) {
      throw appError("EVENT_NOT_FOUND", "No event exists for this link.");
    }

    if (args.eventGeneration !== event.generation) {
      throw appError(
        "STALE_EVENT_GENERATION",
        "This event has moved on to a new run.",
      );
    }

    if (
      args.respondentToken.length === 0 ||
      args.respondentToken.length > MAX_RESPONDENT_TOKEN_LENGTH
    ) {
      throw appError(
        "VALIDATION_ERROR",
        `respondentToken must be between 1 and ${MAX_RESPONDENT_TOKEN_LENGTH} characters.`,
      );
    }

    // Archived questions can never be open for voting (invariant 8), so a
    // ballot against one is treated the same as an unknown question.
    const question = await requireQuestionInEvent(
      ctx,
      args.questionId,
      event._id,
    );
    if (question.archivedAt !== undefined) {
      throw appError(
        "QUESTION_NOT_FOUND",
        "No question exists for this event.",
      );
    }

    if (event.openQuestionId !== question._id) {
      throw appError(
        "QUESTION_NOT_OPEN",
        "This question is not currently open for voting.",
      );
    }

    const uniqueSelectedIds = new Set(args.selectedChoiceIds);
    if (uniqueSelectedIds.size !== args.selectedChoiceIds.length) {
      throw appError(
        "INVALID_SELECTION_COUNT",
        "Selected choices must not contain duplicates.",
      );
    }

    if (
      args.selectedChoiceIds.length < question.minSelections ||
      args.selectedChoiceIds.length > question.maxSelections
    ) {
      throw appError(
        "INVALID_SELECTION_COUNT",
        `Select between ${question.minSelections} and ${question.maxSelections} choices.`,
      );
    }

    // Bounded: at most maxSelections (<=20) choices are checked, never an
    // unbounded scan.
    for (const choiceId of args.selectedChoiceIds) {
      const choice = await ctx.db.get(choiceId);
      if (choice === null || choice.questionId !== question._id) {
        throw appError(
          "INVALID_CHOICE",
          "A selected choice does not belong to this question.",
        );
      }
      if (choice.archivedAt !== undefined) {
        throw appError(
          "CHOICE_ARCHIVED",
          "A selected choice is no longer active.",
        );
      }
    }

    const scope: CounterScope = {
      eventId: event._id,
      eventGeneration: event.generation,
      questionId: question._id,
      responseGeneration: question.responseGeneration,
    };

    // The full uniqueness key (including respondentToken) is the only
    // index that can answer "has this browser already voted here" — a
    // bounded, indexed lookup, never a scan.
    const existingBallot = await ctx.db
      .query("ballots")
      .withIndex("by_question_response_and_respondent", (q) =>
        q
          .eq("eventId", event._id)
          .eq("eventGeneration", event.generation)
          .eq("questionId", question._id)
          .eq("responseGeneration", question.responseGeneration)
          .eq("respondentToken", args.respondentToken),
      )
      .unique();
    if (existingBallot !== null) {
      throw appError(
        "ALREADY_VOTED",
        "A ballot has already been submitted for this question.",
      );
    }

    const ballotId = await ctx.db.insert("ballots", {
      eventId: event._id,
      eventGeneration: event.generation,
      questionId: question._id,
      responseGeneration: question.responseGeneration,
      respondentToken: args.respondentToken,
      selectedChoiceIds: args.selectedChoiceIds,
    });

    // Committed in the same transaction as the insert above, so the ballot
    // and its counter increments are atomic.
    await recordBallot(ctx, scope, args.selectedChoiceIds);

    return { ballotId };
  },
});
