import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireHost } from "./lib/auth";
import { resetObsoleteCounters } from "./lib/counters";
import {
  assertQuestionLimit,
  assertExactIdSet,
  hasAnyCurrentGenerationBallot,
  loadActiveChoices,
  loadActiveQuestions,
  reindexQuestionPositions,
  requireQuestionInEvent,
} from "./lib/data";
import {
  backgroundPresetValidator,
  presetForPosition,
} from "./lib/backgrounds";
import { questionImageIds } from "./lib/questionImages";
import { appError } from "./lib/errors";
import { MAX_CHOICES_PER_QUESTION_SCAN } from "./lib/results";

const MAX_PROMPT_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 200;
const MIN_SELECTIONS = 1;
const MAX_SELECTIONS = 20;
const MIN_COUNTDOWN_SECONDS = 5;
const MAX_COUNTDOWN_SECONDS = 3600;

/** Ballots are deleted in batches of this size per scheduled cleanup step. */
const RESPONSE_CLEANUP_BATCH_SIZE = 50;

type SelectionBounds = {
  prompt: string;
  description: string | undefined;
  minSelections: number;
  maxSelections: number;
  countdownSeconds: number | undefined;
};

/**
 * Validates the full set of question fields, trimming the prompt. A question
 * may be saved as an incomplete draft with an empty trimmed prompt;
 * completeness (non-empty prompt, minimum active choices, etc.) is enforced
 * only when voting is opened, not here.
 */
function validateQuestionFields(fields: SelectionBounds): SelectionBounds {
  const prompt = fields.prompt.trim();
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw appError(
      "VALIDATION_ERROR",
      `Prompt must be at most ${MAX_PROMPT_LENGTH} characters.`,
    );
  }
  const description = fields.description?.trim() || undefined;
  if (
    description !== undefined &&
    description.length > MAX_DESCRIPTION_LENGTH
  ) {
    throw appError(
      "VALIDATION_ERROR",
      `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }

  if (
    !Number.isInteger(fields.minSelections) ||
    fields.minSelections < MIN_SELECTIONS
  ) {
    throw appError(
      "VALIDATION_ERROR",
      `minSelections must be an integer of at least ${MIN_SELECTIONS}.`,
    );
  }
  if (
    !Number.isInteger(fields.maxSelections) ||
    fields.maxSelections < fields.minSelections ||
    fields.maxSelections > MAX_SELECTIONS
  ) {
    throw appError(
      "VALIDATION_ERROR",
      `maxSelections must be an integer between minSelections and ${MAX_SELECTIONS}.`,
    );
  }

  if (fields.countdownSeconds !== undefined) {
    if (
      !Number.isInteger(fields.countdownSeconds) ||
      fields.countdownSeconds < MIN_COUNTDOWN_SECONDS ||
      fields.countdownSeconds > MAX_COUNTDOWN_SECONDS
    ) {
      throw appError(
        "VALIDATION_ERROR",
        `countdownSeconds must be an integer between ${MIN_COUNTDOWN_SECONDS} and ${MAX_COUNTDOWN_SECONDS}.`,
      );
    }
  }

  return {
    prompt,
    description,
    minSelections: fields.minSelections,
    maxSelections: fields.maxSelections,
    countdownSeconds: fields.countdownSeconds,
  };
}

export const create = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    prompt: v.string(),
    description: v.optional(v.string()),
    minSelections: v.number(),
    maxSelections: v.number(),
    countdownSeconds: v.optional(v.number()),
  },
  returns: v.object({ questionId: v.id("questions") }),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);

    const fields = validateQuestionFields({
      prompt: args.prompt,
      description: args.description,
      minSelections: args.minSelections,
      maxSelections: args.maxSelections,
      countdownSeconds: args.countdownSeconds,
    });

    const activeQuestions = await loadActiveQuestions(ctx, event._id);
    assertQuestionLimit(activeQuestions.length);

    const position = activeQuestions.length;
    const questionId = await ctx.db.insert("questions", {
      eventId: event._id,
      position,
      prompt: fields.prompt,
      ...(fields.description !== undefined
        ? { description: fields.description }
        : {}),
      minSelections: fields.minSelections,
      maxSelections: fields.maxSelections,
      countdownSeconds: fields.countdownSeconds,
      backgroundPreset: presetForPosition(position),
      responseGeneration: 0,
    });

    return { questionId };
  },
});

export const update = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    questionId: v.id("questions"),
    prompt: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    minSelections: v.optional(v.number()),
    maxSelections: v.optional(v.number()),
    countdownSeconds: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const question = await requireQuestionInEvent(
      ctx,
      args.questionId,
      event._id,
    );

    const fields = validateQuestionFields({
      prompt: args.prompt ?? question.prompt,
      description:
        args.description === null
          ? undefined
          : (args.description ?? question.description),
      minSelections: args.minSelections ?? question.minSelections,
      maxSelections: args.maxSelections ?? question.maxSelections,
      countdownSeconds:
        args.countdownSeconds === null
          ? undefined
          : (args.countdownSeconds ?? question.countdownSeconds),
    });

    await ctx.db.patch(question._id, fields);

    return null;
  },
});

export const removeOrArchive = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    questionId: v.id("questions"),
  },
  returns: v.object({ archived: v.boolean() }),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const question = await requireQuestionInEvent(
      ctx,
      args.questionId,
      event._id,
    );

    const referenced = await hasAnyCurrentGenerationBallot(
      ctx,
      event._id,
      event.generation,
      question._id,
    );

    // An archived or removed question can never remain the current slide or
    // the open question (system-design.md §5.3, invariant 8).
    const patches: Array<Promise<unknown>> = [];
    if (event.openQuestionId === question._id) {
      patches.push(
        ctx.db.patch(event._id, {
          openQuestionId: undefined,
          votingOpenedAt: undefined,
        }),
      );
    }
    if (
      event.currentSlide.kind === "question" &&
      event.currentSlide.questionId === question._id
    ) {
      patches.push(
        ctx.db.patch(event._id, { currentSlide: { kind: "welcome" } }),
      );
    }
    await Promise.all(patches);

    if (referenced) {
      await ctx.db.patch(question._id, { archivedAt: Date.now() });
    } else {
      const activeChoices = await loadActiveChoices(ctx, question._id);
      for (const choice of activeChoices) {
        await ctx.db.delete(choice._id);
      }
      await ctx.db.delete(question._id);
    }

    const remainingActiveQuestions = await loadActiveQuestions(ctx, event._id);
    await reindexQuestionPositions(ctx, remainingActiveQuestions);

    return { archived: referenced };
  },
});

export const reorder = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    orderedQuestionIds: v.array(v.id("questions")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);

    const activeQuestions = await loadActiveQuestions(ctx, event._id);
    const byId = new Map<string, Doc<"questions">>(
      activeQuestions.map((question) => [question._id, question]),
    );

    assertExactIdSet(
      args.orderedQuestionIds,
      activeQuestions.map((question) => question._id),
    );

    const orderedQuestions = args.orderedQuestionIds.map((id) => {
      const question = byId.get(id);
      if (question === undefined) {
        throw appError(
          "INVALID_REORDER",
          "The reorder list references a question outside this event.",
        );
      }
      return question;
    });

    await reindexQuestionPositions(ctx, orderedQuestions);

    return null;
  },
});

export const resetResponses = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    questionId: v.id("questions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const question = await requireQuestionInEvent(
      ctx,
      args.questionId,
      event._id,
    );

    if (event.openQuestionId === question._id) {
      await ctx.db.patch(event._id, {
        openQuestionId: undefined,
        votingOpenedAt: undefined,
      });
    }

    const obsoleteResponseGeneration = question.responseGeneration;
    await ctx.db.patch(question._id, {
      responseGeneration: obsoleteResponseGeneration + 1,
      closedGeneration: undefined,
      closedAt: undefined,
    });

    // Bounded (at most 21 choices) and cheap enough to reset inline; only the
    // unbounded ballot deletion below needs batched scheduling.
    const choicesForCleanup = await ctx.db
      .query("choices")
      .withIndex("by_question_and_position", (q) =>
        q.eq("questionId", question._id),
      )
      .take(MAX_CHOICES_PER_QUESTION_SCAN);
    await resetObsoleteCounters(
      ctx,
      {
        eventId: event._id,
        eventGeneration: event.generation,
        questionId: question._id,
        responseGeneration: obsoleteResponseGeneration,
      },
      choicesForCleanup.map((choice) => choice._id),
    );

    await ctx.scheduler.runAfter(
      0,
      internal.questions.cleanupPreviousResponses,
      {
        eventId: event._id,
        eventGeneration: event.generation,
        questionId: question._id,
        obsoleteResponseGeneration,
      },
    );

    return null;
  },
});

export const cleanupPreviousResponses = internalMutation({
  args: {
    eventId: v.id("events"),
    eventGeneration: v.number(),
    questionId: v.id("questions"),
    obsoleteResponseGeneration: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const obsoleteBallots = await ctx.db
      .query("ballots")
      .withIndex("by_question_response", (q) =>
        q
          .eq("eventId", args.eventId)
          .eq("eventGeneration", args.eventGeneration)
          .eq("questionId", args.questionId)
          .eq("responseGeneration", args.obsoleteResponseGeneration),
      )
      .take(RESPONSE_CLEANUP_BATCH_SIZE);

    for (const ballot of obsoleteBallots) {
      await ctx.db.delete(ballot._id);
    }

    if (obsoleteBallots.length === RESPONSE_CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.questions.cleanupPreviousResponses,
        args,
      );
    }

    return null;
  },
});

const questionDetailValidator = v.object({
  _id: v.id("questions"),
  _creationTime: v.number(),
  eventId: v.id("events"),
  position: v.number(),
  prompt: v.string(),
  description: v.union(v.string(), v.null()),
  imageUrl: v.union(v.string(), v.null()),
  imageUrls: v.array(v.string()),
  backgroundPreset: v.union(backgroundPresetValidator, v.null()),
  backgroundImageUrl: v.union(v.string(), v.null()),
  minSelections: v.number(),
  maxSelections: v.number(),
  countdownSeconds: v.optional(v.number()),
  responseGeneration: v.number(),
  closedGeneration: v.optional(v.number()),
  closedAt: v.optional(v.number()),
  archivedAt: v.optional(v.number()),
});

const choiceDetailValidator = v.object({
  _id: v.id("choices"),
  _creationTime: v.number(),
  questionId: v.id("questions"),
  position: v.number(),
  label: v.string(),
  imageUrl: v.union(v.string(), v.null()),
  archived: v.boolean(),
});

/**
 * Host-authorized detail for one question's focused editor: editable
 * question fields plus every active and archived choice in position
 * order, with storage ids resolved to URLs. Never leaks the host-secret
 * hash. `getHostWorkspace` intentionally omits this level of detail,
 * returning only sequence summaries.
 */
export const getHostDetail = query({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    questionId: v.id("questions"),
  },
  returns: v.object({
    question: questionDetailValidator,
    choices: v.array(choiceDetailValidator),
  }),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const question = await requireQuestionInEvent(
      ctx,
      args.questionId,
      event._id,
    );

    // Same bound used for the exact-results scan (lib/results.ts), so the
    // editor and the results view never disagree about how many choices a
    // question can have.
    const choices = await ctx.db
      .query("choices")
      .withIndex("by_question_and_position", (q) =>
        q.eq("questionId", question._id),
      )
      .take(MAX_CHOICES_PER_QUESTION_SCAN);

    const [questionImageUrls, backgroundImageUrl, choiceDetails] =
      await Promise.all([
        Promise.all(
          questionImageIds(question).map((imageId) =>
            ctx.storage.getUrl(imageId),
          ),
        ),
        question.backgroundImageId === undefined
          ? Promise.resolve(null)
          : ctx.storage.getUrl(question.backgroundImageId),
        Promise.all(
          choices.map(async (choice) => ({
            _id: choice._id,
            _creationTime: choice._creationTime,
            questionId: choice.questionId,
            position: choice.position,
            label: choice.label,
            imageUrl:
              choice.imageId === undefined
                ? null
                : await ctx.storage.getUrl(choice.imageId),
            archived: choice.archivedAt !== undefined,
          })),
        ),
      ]);

    return {
      question: {
        _id: question._id,
        _creationTime: question._creationTime,
        eventId: question.eventId,
        position: question.position,
        prompt: question.prompt,
        description: question.description ?? null,
        imageUrl: questionImageUrls.find((url) => url !== null) ?? null,
        imageUrls: questionImageUrls.filter(
          (url): url is string => url !== null,
        ),
        backgroundPreset: question.backgroundPreset ?? null,
        backgroundImageUrl,
        minSelections: question.minSelections,
        maxSelections: question.maxSelections,
        countdownSeconds: question.countdownSeconds,
        responseGeneration: question.responseGeneration,
        closedGeneration: question.closedGeneration,
        closedAt: question.closedAt,
        archivedAt: question.archivedAt,
      },
      choices: choiceDetails,
    };
  },
});
