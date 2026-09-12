import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import {
  currentSlideValidator,
  eventSummaryValidator,
  questionSummaryValidator,
  toEventSummary,
  toQuestionSummary,
} from "./events";
import { requireHost } from "./lib/auth";
import { loadActiveChoices, loadActiveQuestions } from "./lib/data";
import { appError } from "./lib/errors";
import { loadQuestionResults, questionResultsValidator } from "./lib/results";

const MIN_COUNTDOWN_SECONDS = 5;
const MAX_COUNTDOWN_SECONDS = 3600;

/** The finale is paginated at no more than this many questions per query (system-design.md section 11). */
const MAX_FINALE_PAGE_SIZE = 10;

export const setSlide = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    slide: currentSlideValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);

    if (args.slide.kind === "question") {
      // Archived questions can never become the current slide
      // (system-design.md §5.3, invariant 8).
      const question = await ctx.db.get(args.slide.questionId);
      if (
        question === null ||
        question.eventId !== event._id ||
        question.archivedAt !== undefined
      ) {
        throw appError(
          "QUESTION_NOT_FOUND",
          "No question exists for this event.",
        );
      }
    }

    // Changing the slide never implicitly opens or closes voting
    // (invariant 4) — only `currentSlide` is patched here.
    await ctx.db.patch(event._id, { currentSlide: args.slide });

    return null;
  },
});

export const openVoting = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    questionId: v.id("questions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);

    const question = await ctx.db.get(args.questionId);
    if (
      question === null ||
      question.eventId !== event._id ||
      question.archivedAt !== undefined
    ) {
      throw appError(
        "QUESTION_NOT_FOUND",
        "No question exists for this event.",
      );
    }

    if (question.prompt.trim().length === 0) {
      throw appError(
        "VALIDATION_ERROR",
        "The question must have a prompt before voting can open.",
      );
    }

    const activeChoices = await loadActiveChoices(ctx, question._id);
    if (activeChoices.length < 2) {
      throw appError(
        "VALIDATION_ERROR",
        "The question needs at least two active choices before voting can open.",
      );
    }
    for (const choice of activeChoices) {
      if (choice.label.trim().length === 0 && choice.imageId === undefined) {
        throw appError(
          "VALIDATION_ERROR",
          "Every active choice needs a label or an image before voting can open.",
        );
      }
    }

    if (
      question.minSelections < 1 ||
      question.maxSelections < question.minSelections ||
      question.maxSelections > activeChoices.length
    ) {
      throw appError(
        "VALIDATION_ERROR",
        "The selection limits are not valid for the current number of active choices.",
      );
    }

    if (question.countdownSeconds !== undefined) {
      if (
        question.countdownSeconds < MIN_COUNTDOWN_SECONDS ||
        question.countdownSeconds > MAX_COUNTDOWN_SECONDS
      ) {
        throw appError(
          "VALIDATION_ERROR",
          `countdownSeconds must be between ${MIN_COUNTDOWN_SECONDS} and ${MAX_COUNTDOWN_SECONDS}.`,
        );
      }
    }

    // Opening one question closes any previously open question
    // (invariant 3).
    if (
      event.openQuestionId !== undefined &&
      event.openQuestionId !== question._id
    ) {
      const previousQuestion = await ctx.db.get(event.openQuestionId);
      if (previousQuestion !== null) {
        await ctx.db.patch(previousQuestion._id, {
          closedGeneration: event.generation,
          closedAt: Date.now(),
        });
      }
    }

    await ctx.db.patch(event._id, {
      openQuestionId: question._id,
      votingOpenedAt: Date.now(),
    });

    return null;
  },
});

export const closeVoting = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);

    if (event.openQuestionId === undefined) {
      throw appError(
        "QUESTION_NOT_OPEN",
        "No question is currently open for voting.",
      );
    }

    const question = await ctx.db.get(event.openQuestionId);
    if (question !== null) {
      await ctx.db.patch(question._id, {
        closedGeneration: event.generation,
        closedAt: Date.now(),
      });
    }

    await ctx.db.patch(event._id, {
      openQuestionId: undefined,
      votingOpenedAt: undefined,
    });

    return null;
  },
});

export const getDeck = query({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
  },
  returns: v.object({
    event: eventSummaryValidator,
    questions: v.array(questionSummaryValidator),
    currentQuestionResults: v.union(questionResultsValidator, v.null()),
  }),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const questions = await loadActiveQuestions(ctx, event._id);

    let currentQuestionResults = null;
    if (event.currentSlide.kind === "question") {
      const question = await ctx.db.get(event.currentSlide.questionId);
      if (question !== null) {
        currentQuestionResults = await loadQuestionResults(
          ctx,
          event,
          question,
        );
      }
    }

    return {
      event: toEventSummary(event),
      questions: questions.map(toQuestionSummary),
      currentQuestionResults,
    };
  },
});

export const getQuestionResults = query({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    questionId: v.id("questions"),
  },
  returns: questionResultsValidator,
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);

    // Stable and independent of the deck's current position: intentionally
    // allows an archived question, since archived questions retain their
    // host-only results until the event is reset.
    const question = await ctx.db.get(args.questionId);
    if (question === null || question.eventId !== event._id) {
      throw appError(
        "QUESTION_NOT_FOUND",
        "No question exists for this event.",
      );
    }

    return loadQuestionResults(ctx, event, question);
  },
});

/**
 * A bounded page of active questions in sequence, each with its exact
 * results and winners, for the projector's finale slide. `numItems` is
 * always clamped to `MAX_FINALE_PAGE_SIZE` regardless of what the client
 * requests, so a maximum-sized deck never reads every counter in one query
 * (system-design.md sections 11 and 16).
 */
export const getFinalePage = query({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(questionResultsValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);

    const boundedPaginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(args.paginationOpts.numItems, MAX_FINALE_PAGE_SIZE),
    };

    const paginated = await ctx.db
      .query("questions")
      .withIndex("by_event_archived_and_position", (q) =>
        q.eq("eventId", event._id).eq("archivedAt", undefined),
      )
      .paginate(boundedPaginationOpts);

    const page = await Promise.all(
      paginated.page.map((question) =>
        loadQuestionResults(ctx, event, question),
      ),
    );

    return {
      page,
      isDone: paginated.isDone,
      continueCursor: paginated.continueCursor,
    };
  },
});
