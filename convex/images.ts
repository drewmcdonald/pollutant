import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { requireHost } from "./lib/auth";
import {
  backgroundPresetValidator,
  type BackgroundPreset,
} from "./lib/backgrounds";
import { requireChoiceInEvent, requireQuestionInEvent } from "./lib/data";
import { appError } from "./lib/errors";
import {
  MAX_QUESTION_IMAGES,
  questionImageSlotId,
  questionImageSlotPatch,
} from "./lib/questionImages";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Verifies an uploaded storage object still exists, is an image, and is
 * within the enforced size bound. Throws `INVALID_IMAGE` otherwise.
 */
async function requireValidImage(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
): Promise<void> {
  const metadata = await ctx.db.system.get("_storage", storageId);
  if (metadata === null) {
    throw appError("INVALID_IMAGE", "The uploaded file no longer exists.");
  }
  if (
    metadata.contentType === undefined ||
    !metadata.contentType.startsWith("image/")
  ) {
    throw appError("INVALID_IMAGE", "The uploaded file must be an image.");
  }
  if (metadata.size > MAX_IMAGE_BYTES) {
    throw appError(
      "INVALID_IMAGE",
      `The uploaded image must be at most ${MAX_IMAGE_BYTES} bytes.`,
    );
  }
}

/** Schedules cleanup of a replaced or removed image if it becomes unreferenced. */
async function scheduleCleanupIfChanged(
  ctx: MutationCtx,
  previousImageId: Id<"_storage"> | undefined,
  nextImageId: Id<"_storage"> | undefined,
): Promise<void> {
  if (previousImageId === undefined || previousImageId === nextImageId) {
    return;
  }
  await ctx.scheduler.runAfter(0, internal.images.deleteIfUnreferenced, {
    storageId: previousImageId,
  });
}

export const generateUploadUrl = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
  },
  returns: v.object({ uploadUrl: v.string() }),
  handler: async (ctx, args) => {
    await requireHost(ctx, args.publicSlug, args.hostSecret);
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

export const setQuestionImage = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    questionId: v.id("questions"),
    storageId: v.optional(v.union(v.id("_storage"), v.null())),
    storageId2: v.optional(v.union(v.id("_storage"), v.null())),
    storageId3: v.optional(v.union(v.id("_storage"), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const question = await requireQuestionInEvent(
      ctx,
      args.questionId,
      event._id,
    );

    const nextIds = [args.storageId, args.storageId2, args.storageId3];
    if (nextIds.every((id) => id === undefined)) {
      return null;
    }
    if (nextIds.length > MAX_QUESTION_IMAGES) {
      throw appError(
        "INVALID_IMAGE",
        `A question can have at most ${MAX_QUESTION_IMAGES} images.`,
      );
    }

    for (let slot = 0; slot < MAX_QUESTION_IMAGES; slot++) {
      const next = nextIds[slot];
      if (next === undefined) continue;
      const nextImageId = next ?? undefined;
      if (nextImageId !== undefined) {
        await requireValidImage(ctx, nextImageId);
      }
      const previousImageId = questionImageSlotId(question, slot as 0 | 1 | 2);
      await ctx.db.patch(
        question._id,
        questionImageSlotPatch(slot as 0 | 1 | 2, nextImageId),
      );
      await scheduleCleanupIfChanged(ctx, previousImageId, nextImageId);
    }

    return null;
  },
});

export const setChoiceImage = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    choiceId: v.id("choices"),
    storageId: v.union(v.id("_storage"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const { choice } = await requireChoiceInEvent(
      ctx,
      args.choiceId,
      event._id,
    );

    const nextImageId = args.storageId ?? undefined;
    if (nextImageId !== undefined) {
      await requireValidImage(ctx, nextImageId);
    }

    await ctx.db.patch(choice._id, { imageId: nextImageId });
    await scheduleCleanupIfChanged(ctx, choice.imageId, nextImageId);

    return null;
  },
});

export const setQuestionBackground = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    questionId: v.id("questions"),
    preset: v.optional(v.union(backgroundPresetValidator, v.null())),
    storageId: v.optional(v.union(v.id("_storage"), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const question = await requireQuestionInEvent(
      ctx,
      args.questionId,
      event._id,
    );

    const patch: {
      backgroundPreset?: BackgroundPreset;
      backgroundImageId?: Id<"_storage">;
    } = {};
    if (args.preset !== undefined) {
      patch.backgroundPreset = args.preset ?? undefined;
    }
    let previousBackgroundId: Id<"_storage"> | undefined;
    if (args.storageId !== undefined) {
      const nextImageId = args.storageId ?? undefined;
      if (nextImageId !== undefined) {
        await requireValidImage(ctx, nextImageId);
      }
      patch.backgroundImageId = nextImageId;
      previousBackgroundId = question.backgroundImageId;
    }

    if (args.preset !== undefined || args.storageId !== undefined) {
      await ctx.db.patch(question._id, patch);
    }
    if (args.storageId !== undefined) {
      await scheduleCleanupIfChanged(
        ctx,
        previousBackgroundId,
        args.storageId ?? undefined,
      );
    }

    return null;
  },
});

/**
 * Deletes a storage object only if no question or choice still references
 * it, using the existing `by_image_id` indexes with bounded `.first()`
 * lookups — never an unbounded scan.
 */
export const deleteIfUnreferenced = internalMutation({
  args: {
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const referencingQuestion = await ctx.db
      .query("questions")
      .withIndex("by_image_id", (q) => q.eq("imageId", args.storageId))
      .first();
    if (referencingQuestion !== null) {
      return null;
    }
    const referencingQuestion2 = await ctx.db
      .query("questions")
      .withIndex("by_image_id_2", (q) => q.eq("imageId2", args.storageId))
      .first();
    if (referencingQuestion2 !== null) {
      return null;
    }
    const referencingQuestion3 = await ctx.db
      .query("questions")
      .withIndex("by_image_id_3", (q) => q.eq("imageId3", args.storageId))
      .first();
    if (referencingQuestion3 !== null) {
      return null;
    }

    const referencingChoice = await ctx.db
      .query("choices")
      .withIndex("by_image_id", (q) => q.eq("imageId", args.storageId))
      .first();
    if (referencingChoice !== null) {
      return null;
    }

    const referencingBackground = await ctx.db
      .query("questions")
      .withIndex("by_background_image_id", (q) =>
        q.eq("backgroundImageId", args.storageId),
      )
      .first();
    if (referencingBackground !== null) {
      return null;
    }

    await ctx.storage.delete(args.storageId);

    return null;
  },
});
