import { v, type Infer } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { requireHost } from "./lib/auth";
import {
  assertExactIdSet,
  loadActiveChoices,
  loadActiveQuestions,
  requireQuestionInEvent,
} from "./lib/data";
import { appError } from "./lib/errors";

const imageId = v.optional(v.union(v.id("_storage"), v.null()));
const pollValidator = v.object({
  imageId,
  prompt: v.string(),
  choices: v.array(
    v.object({ id: v.optional(v.id("choices")), label: v.string(), imageId }),
  ),
  minSelections: v.number(),
  maxSelections: v.number(),
  countdownSeconds: v.optional(v.number()),
  start: v.boolean(),
});
const fields = pollValidator.fields;
type Poll = Infer<typeof pollValidator>;
type Host = { publicSlug: string; hostSecret: string };

/** Nested mutations share this transaction, including validation when starting. */
async function saveQuestion(
  ctx: MutationCtx,
  host: Host,
  poll: Poll,
  questionId?: Id<"questions">,
  expectedChoiceIds: Id<"choices">[] = [],
): Promise<Id<"questions">> {
  if (poll.choices.length > 20) {
    throw appError(
      "CHOICE_LIMIT_EXCEEDED",
      "A poll can have up to 20 options.",
    );
  }
  const event = await requireHost(ctx, host.publicSlug, host.hostSecret);
  const questionFields = {
    prompt: poll.prompt,
    minSelections: poll.minSelections,
    maxSelections: poll.maxSelections,
    countdownSeconds: poll.countdownSeconds,
  };
  let previousPrompt: string | undefined;
  let activeChoices: Awaited<ReturnType<typeof loadActiveChoices>> = [];
  if (questionId === undefined) {
    if (poll.choices.some((choice) => choice.id !== undefined)) {
      throw appError("CHOICE_NOT_FOUND", "New polls must use new options.");
    }
    const created: { questionId: Id<"questions"> } = await ctx.runMutation(
      api.questions.create,
      {
        ...host,
        ...questionFields,
      },
    );
    questionId = created.questionId;
  } else {
    const question = await requireQuestionInEvent(ctx, questionId, event._id);
    if (question.archivedAt !== undefined) {
      throw appError("QUESTION_NOT_FOUND", "This question has been removed.");
    }
    previousPrompt = question.prompt;
    activeChoices = await loadActiveChoices(ctx, questionId);
    assertExactIdSet(
      expectedChoiceIds,
      activeChoices.map((choice) => choice._id),
    );
    const suppliedIds = poll.choices.flatMap((choice) =>
      choice.id === undefined ? [] : [choice.id],
    );
    if (
      new Set(suppliedIds).size !== suppliedIds.length ||
      suppliedIds.some(
        (id) => !activeChoices.some((choice) => choice._id === id),
      )
    ) {
      throw appError(
        "CHOICE_NOT_FOUND",
        "An option no longer belongs to this question. Reopen the editor and try again.",
      );
    }
    await ctx.runMutation(api.questions.update, {
      ...host,
      ...questionFields,
      questionId,
      countdownSeconds: poll.countdownSeconds ?? null,
    });
  }

  for (const choice of activeChoices) {
    if (!poll.choices.some((draft) => draft.id === choice._id)) {
      await ctx.runMutation(api.choices.removeOrArchive, {
        ...host,
        choiceId: choice._id,
      });
    }
  }
  const orderedChoiceIds: Id<"choices">[] = [];
  for (const choice of poll.choices) {
    let choiceId: Id<"choices">;
    if (choice.id !== undefined) {
      await ctx.runMutation(api.choices.update, {
        ...host,
        choiceId: choice.id,
        label: choice.label,
      });
      choiceId = choice.id;
    } else {
      const created: { choiceId: Id<"choices"> } = await ctx.runMutation(
        api.choices.create,
        {
          ...host,
          questionId,
          label: choice.label,
        },
      );
      choiceId = created.choiceId;
    }
    orderedChoiceIds.push(choiceId);
    if (choice.imageId !== undefined) {
      await ctx.runMutation(api.images.setChoiceImage, {
        ...host,
        choiceId,
        storageId: choice.imageId,
      });
    }
  }
  if (poll.imageId !== undefined) {
    await ctx.runMutation(api.images.setQuestionImage, {
      ...host,
      questionId,
      storageId: poll.imageId,
    });
  }
  await ctx.runMutation(api.choices.reorder, {
    ...host,
    questionId,
    orderedChoiceIds,
  });

  if (
    previousPrompt !== undefined &&
    event.title === (previousPrompt.trim().slice(0, 200) || "Untitled poll") &&
    (await loadActiveQuestions(ctx, event._id, 2)).length === 1
  ) {
    await ctx.db.patch(event._id, {
      title: poll.prompt.trim().slice(0, 200) || "Untitled poll",
    });
  }

  if (poll.start || event.openQuestionId === questionId) {
    await ctx.runMutation(api.presentation.openVoting, { ...host, questionId });
    // Saving an already-live poll must not restart its countdown.
    if (event.openQuestionId === questionId) {
      await ctx.db.patch(event._id, { votingOpenedAt: event.votingOpenedAt });
    }
  }
  if (poll.start) {
    await ctx.runMutation(api.presentation.setSlide, {
      ...host,
      slide: { kind: "question", questionId },
    });
  }
  return questionId;
}

export const create = mutation({
  args: { ...fields, hostSecret: v.string() },
  returns: v.object({
    publicSlug: v.string(),
    title: v.string(),
    questionId: v.id("questions"),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    publicSlug: string;
    title: string;
    questionId: Id<"questions">;
  }> => {
    const event: { eventId: Id<"events">; publicSlug: string; title: string } =
      await ctx.runMutation(api.events.create, {
        title: args.prompt.trim().slice(0, 200) || "Untitled poll",
        hostSecret: args.hostSecret,
      });
    const questionId = await saveQuestion(
      ctx,
      { publicSlug: event.publicSlug, hostSecret: args.hostSecret },
      args,
    );
    return { publicSlug: event.publicSlug, title: event.title, questionId };
  },
});

export const save = mutation({
  args: {
    ...fields,
    publicSlug: v.string(),
    hostSecret: v.string(),
    questionId: v.optional(v.id("questions")),
    expectedChoiceIds: v.array(v.id("choices")),
  },
  returns: v.object({ questionId: v.id("questions") }),
  handler: async (ctx, args): Promise<{ questionId: Id<"questions"> }> => ({
    questionId: await saveQuestion(
      ctx,
      { publicSlug: args.publicSlug, hostSecret: args.hostSecret },
      args,
      args.questionId,
      args.expectedChoiceIds,
    ),
  }),
});

export const start = mutation({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
    questionId: v.id("questions"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    if (event.openQuestionId !== args.questionId) {
      await ctx.runMutation(api.presentation.openVoting, args);
    }
    await ctx.runMutation(api.presentation.setSlide, {
      publicSlug: args.publicSlug,
      hostSecret: args.hostSecret,
      slide: { kind: "question", questionId: args.questionId },
    });
    return null;
  },
});
