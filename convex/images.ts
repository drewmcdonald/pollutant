import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { requireHost } from "./lib/auth";
import { requireChoiceInEvent, requireQuestionInEvent } from "./lib/data";
import { appError } from "./lib/errors";

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
    storageId: v.union(v.id("_storage"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const question = await requireQuestionInEvent(
      ctx,
      args.questionId,
      event._id,
    );

    const nextImageId = args.storageId ?? undefined;
    if (nextImageId !== undefined) {
      await requireValidImage(ctx, nextImageId);
    }

    await ctx.db.patch(question._id, { imageId: nextImageId });
    await scheduleCleanupIfChanged(ctx, question.imageId, nextImageId);

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

    const referencingChoice = await ctx.db
      .query("choices")
      .withIndex("by_image_id", (q) => q.eq("imageId", args.storageId))
      .first();
    if (referencingChoice !== null) {
      return null;
    }

    await ctx.storage.delete(args.storageId);

    return null;
  },
});
