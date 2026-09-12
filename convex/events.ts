import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { appError } from "./lib/errors";
import { findEventByPublicSlug, requireHost, sha256Hex } from "./lib/auth";
import { loadActiveQuestions } from "./lib/data";
import { resetObsoleteCounters } from "./lib/counters";
import { MAX_CHOICES_PER_QUESTION_SCAN } from "./lib/results";

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MIN_HOST_SECRET_LENGTH = 32;

/** Ballots are deleted in batches of this size per scheduled cleanup step. */
const GENERATION_CLEANUP_BATCH_SIZE = 50;

export const currentSlideValidator = v.union(
  v.object({ kind: v.literal("welcome") }),
  v.object({ kind: v.literal("question"), questionId: v.id("questions") }),
  v.object({ kind: v.literal("finale") }),
);

export const questionSummaryValidator = v.object({
  _id: v.id("questions"),
  _creationTime: v.number(),
  eventId: v.id("events"),
  position: v.number(),
  prompt: v.string(),
  imageId: v.optional(v.id("_storage")),
  minSelections: v.number(),
  maxSelections: v.number(),
  countdownSeconds: v.optional(v.number()),
  responseGeneration: v.number(),
  closedGeneration: v.optional(v.number()),
  closedAt: v.optional(v.number()),
});
export type QuestionSummary = Infer<typeof questionSummaryValidator>;

export const eventSummaryValidator = v.object({
  _id: v.id("events"),
  _creationTime: v.number(),
  title: v.string(),
  description: v.optional(v.string()),
  publicSlug: v.string(),
  generation: v.number(),
  currentSlide: currentSlideValidator,
  openQuestionId: v.optional(v.id("questions")),
  votingOpenedAt: v.optional(v.number()),
});
export type EventSummary = Infer<typeof eventSummaryValidator>;

/** Maps an event document to its host-safe summary (never the secret hash). */
export function toEventSummary(event: Doc<"events">): EventSummary {
  return {
    _id: event._id,
    _creationTime: event._creationTime,
    title: event.title,
    description: event.description,
    publicSlug: event.publicSlug,
    generation: event.generation,
    currentSlide: event.currentSlide,
    openQuestionId: event.openQuestionId,
    votingOpenedAt: event.votingOpenedAt,
  };
}

/** Maps a question document to its host-safe sequence summary. */
export function toQuestionSummary(question: Doc<"questions">): QuestionSummary {
  return {
    _id: question._id,
    _creationTime: question._creationTime,
    eventId: question.eventId,
    position: question.position,
    prompt: question.prompt,
    imageId: question.imageId,
    minSelections: question.minSelections,
    maxSelections: question.maxSelections,
    countdownSeconds: question.countdownSeconds,
    responseGeneration: question.responseGeneration,
    closedGeneration: question.closedGeneration,
    closedAt: question.closedAt,
  };
}

/** Trims and validates a required, bounded-length string field. */
function requireBoundedText(
  raw: string,
  field: string,
  maxLength: number,
): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw appError("VALIDATION_ERROR", `${field} must not be empty.`);
  }
  if (trimmed.length > maxLength) {
    throw appError(
      "VALIDATION_ERROR",
      `${field} must be at most ${maxLength} characters.`,
    );
  }
  return trimmed;
}

function requireStrongHostSecret(hostSecret: string): string {
  if (hostSecret.length < MIN_HOST_SECRET_LENGTH) {
    throw appError(
      "VALIDATION_ERROR",
      `Host secret must be at least ${MIN_HOST_SECRET_LENGTH} characters.`,
    );
  }
  return hostSecret;
}

export const create = mutation({
  args: {
    title: v.string(),
    hostSecret: v.string(),
  },
  returns: v.object({
    eventId: v.id("events"),
    publicSlug: v.string(),
    title: v.string(),
  }),
  handler: async (ctx, args) => {
    const title = requireBoundedText(args.title, "title", MAX_TITLE_LENGTH);
    const hostSecret = requireStrongHostSecret(args.hostSecret);
    const hostSecretHash = await sha256Hex(hostSecret);

    let publicSlug = crypto.randomUUID();
    while ((await findEventByPublicSlug(ctx, publicSlug)) !== null) {
      publicSlug = crypto.randomUUID();
    }

    const eventId = await ctx.db.insert("events", {
      title,
      publicSlug,
      hostSecretHash,
      generation: 0,
      currentSlide: { kind: "welcome" },
    });

    return { eventId, publicSlug, title };
  },
});

export const getHostWorkspace = query({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
  },
  returns: v.object({
    event: eventSummaryValidator,
    questions: v.array(questionSummaryValidator),
  }),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);

    const questions = await loadActiveQuestions(ctx, event._id);

    return {
      event: toEventSummary(event),
      questions: questions.map(toQuestionSummary),
    };
  },
});

export const updateDetails = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    title: v.string(),
    description: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);

    const title = requireBoundedText(args.title, "title", MAX_TITLE_LENGTH);
    if (args.description === undefined) {
      await ctx.db.patch(event._id, { title });
    } else if (args.description === null) {
      await ctx.db.patch(event._id, { title, description: undefined });
    } else {
      const description = requireBoundedText(
        args.description,
        "description",
        MAX_DESCRIPTION_LENGTH,
      );
      await ctx.db.patch(event._id, { title, description });
    }

    return null;
  },
});

export const reset = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const obsoleteGeneration = event.generation;

    // Switches the active generation atomically: old ballots and counters
    // become unreachable to current queries immediately, even though their
    // physical deletion finishes shortly afterward (system-design.md §4.7).
    await ctx.db.patch(event._id, {
      generation: obsoleteGeneration + 1,
      currentSlide: { kind: "welcome" },
      openQuestionId: undefined,
      votingOpenedAt: undefined,
    });

    await ctx.scheduler.runAfter(0, internal.events.cleanupPreviousGeneration, {
      eventId: event._id,
      obsoleteGeneration,
      cursor: null,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.events.resetPreviousGenerationCounters,
      {
        eventId: event._id,
        obsoleteGeneration,
        cursor: null,
      },
    );

    return null;
  },
});

export const cleanupPreviousGeneration = internalMutation({
  args: {
    eventId: v.id("events"),
    obsoleteGeneration: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const obsoleteBallots = await ctx.db
      .query("ballots")
      .withIndex("by_event_generation", (q) =>
        q
          .eq("eventId", args.eventId)
          .eq("eventGeneration", args.obsoleteGeneration),
      )
      .paginate({
        numItems: GENERATION_CLEANUP_BATCH_SIZE,
        cursor: args.cursor,
      });

    for (const ballot of obsoleteBallots.page) {
      await ctx.db.delete(ballot._id);
    }

    if (!obsoleteBallots.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.events.cleanupPreviousGeneration,
        {
          eventId: args.eventId,
          obsoleteGeneration: args.obsoleteGeneration,
          cursor: obsoleteBallots.continueCursor,
        },
      );
    }

    return null;
  },
});

/**
 * Resets obsolete-generation ballot/choice counters one question at a
 * time, paginating the event's full question list (active and archived,
 * since archived questions can still hold obsolete-generation counters).
 * Never reads or resets every event counter in one mutation
 * (system-design.md §7.5).
 */
export const resetPreviousGenerationCounters = internalMutation({
  args: {
    eventId: v.id("events"),
    obsoleteGeneration: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const nextQuestionPage = await ctx.db
      .query("questions")
      .withIndex("by_event_archived_and_position", (q) =>
        q.eq("eventId", args.eventId),
      )
      .paginate({ numItems: 1, cursor: args.cursor });

    const question = nextQuestionPage.page[0];
    if (question !== undefined) {
      const choices = await ctx.db
        .query("choices")
        .withIndex("by_question_and_position", (q) =>
          q.eq("questionId", question._id),
        )
        .take(MAX_CHOICES_PER_QUESTION_SCAN);

      await resetObsoleteCounters(
        ctx,
        {
          eventId: args.eventId,
          eventGeneration: args.obsoleteGeneration,
          questionId: question._id,
          responseGeneration: question.responseGeneration,
        },
        choices.map((choice) => choice._id),
      );
    }

    if (!nextQuestionPage.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.events.resetPreviousGenerationCounters,
        {
          eventId: args.eventId,
          obsoleteGeneration: args.obsoleteGeneration,
          cursor: nextQuestionPage.continueCursor,
        },
      );
    }

    return null;
  },
});
