import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { requireHost } from "./lib/auth";
import {
  assertChoiceLimit,
  assertExactIdSet,
  isChoiceReferencedByCurrentBallots,
  loadActiveChoices,
  reindexChoicePositions,
  requireChoiceInEvent,
  requireQuestionInEvent,
} from "./lib/data";
import { appError } from "./lib/errors";

const MAX_LABEL_LENGTH = 200;

/**
 * Trims and validates a bounded-length choice label. A choice may be saved
 * as an incomplete draft with an empty trimmed label; completeness (every
 * active choice has a non-empty label or an image) is enforced only when
 * voting is opened, not here.
 */
function sanitizeLabel(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw appError(
      "VALIDATION_ERROR",
      `Label must be at most ${MAX_LABEL_LENGTH} characters.`,
    );
  }
  return trimmed;
}

export const create = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    questionId: v.id("questions"),
    label: v.string(),
  },
  returns: v.object({ choiceId: v.id("choices") }),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const question = await requireQuestionInEvent(
      ctx,
      args.questionId,
      event._id,
    );

    const label = sanitizeLabel(args.label);

    const activeChoices = await loadActiveChoices(ctx, question._id);
    assertChoiceLimit(activeChoices.length);

    const choiceId = await ctx.db.insert("choices", {
      questionId: question._id,
      position: activeChoices.length,
      label,
    });

    return { choiceId };
  },
});

export const update = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    choiceId: v.id("choices"),
    label: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const { choice } = await requireChoiceInEvent(
      ctx,
      args.choiceId,
      event._id,
    );

    // Archived choices retain editability and historical visibility, so
    // this intentionally does not branch on `choice.archivedAt`.
    const label = sanitizeLabel(args.label);
    await ctx.db.patch(choice._id, { label });

    return null;
  },
});

export const removeOrArchive = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    choiceId: v.id("choices"),
  },
  returns: v.object({ archived: v.boolean() }),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const { choice, question } = await requireChoiceInEvent(
      ctx,
      args.choiceId,
      event._id,
    );

    const referenced = await isChoiceReferencedByCurrentBallots(
      ctx,
      event._id,
      event.generation,
      question._id,
      question.responseGeneration,
      choice._id,
    );

    if (referenced) {
      await ctx.db.patch(choice._id, { archivedAt: Date.now() });
    } else {
      await ctx.db.delete(choice._id);
    }

    const remainingActiveChoices = await loadActiveChoices(ctx, question._id);
    await reindexChoicePositions(ctx, remainingActiveChoices);

    return { archived: referenced };
  },
});

export const reorder = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    questionId: v.id("questions"),
    orderedChoiceIds: v.array(v.id("choices")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const question = await requireQuestionInEvent(
      ctx,
      args.questionId,
      event._id,
    );

    const activeChoices = await loadActiveChoices(ctx, question._id);
    const byId = new Map<string, Doc<"choices">>(
      activeChoices.map((choice) => [choice._id, choice]),
    );

    assertExactIdSet(
      args.orderedChoiceIds,
      activeChoices.map((choice) => choice._id),
    );

    const orderedChoices = args.orderedChoiceIds.map((id) => {
      const choice = byId.get(id);
      if (choice === undefined) {
        throw appError(
          "INVALID_REORDER",
          "The reorder list references a choice outside this question.",
        );
      }
      return choice;
    });

    await reindexChoicePositions(ctx, orderedChoices);

    return null;
  },
});
