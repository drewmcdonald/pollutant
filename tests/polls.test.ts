/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import shardedCounter from "@convex-dev/sharded-counter/test";
import type { GenericDatabaseWriter, GenericDataModel } from "convex/server";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
const hostSecret = "test-host-secret-with-at-least-32-characters";
const draft = {
  hostSecret,
  prompt: "Which topic?",
  choices: [{ label: "Design" }, { label: "Engineering" }],
  minSelections: 1,
  maxSelections: 1,
  start: true,
};
function backend() {
  const t = convexTest(schema, modules);
  shardedCounter.register(t);
  return t;
}
async function storeFile(
  t: ReturnType<typeof backend>,
  contentType: string,
  body = "image",
) {
  return t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob([body], { type: contentType }));
    // convex-test 0.0.58 omits MIME metadata when storing blobs; real uploads include it.
    const db = ctx.db as GenericDatabaseWriter<GenericDataModel>;
    await db.patch(id, { contentType });
    return id;
  });
}

async function setup() {
  const t = backend();
  const poll = await t.mutation(api.polls.create, draft);
  const host = { publicSlug: poll.publicSlug, hostSecret };
  const detail = await t.query(api.questions.getHostDetail, {
    ...host,
    questionId: poll.questionId,
  });
  const saved = {
    ...draft,
    ...host,
    questionId: poll.questionId,
    choices: detail.choices.map((choice) => ({
      id: choice._id,
      label: choice.label,
    })),
    expectedChoiceIds: detail.choices.map((choice) => choice._id),
  };
  return { t, poll, host, detail, saved };
}

describe("question-first polls", () => {
  test("one call creates a complete, visible poll and accepts a vote", async () => {
    const { t, poll, host, detail } = await setup();
    const deck = await t.query(api.presentation.getDeck, host);
    expect(deck.event.title).toBe(draft.prompt);
    expect(deck.event.currentSlide).toEqual({
      kind: "question",
      questionId: poll.questionId,
    });
    expect(deck.event.openQuestionId).toBe(poll.questionId);
    await t.mutation(api.ballots.submit, {
      publicSlug: poll.publicSlug,
      questionId: poll.questionId,
      eventGeneration: 0,
      respondentToken: "voter-a",
      selectedChoiceIds: [detail.choices[0]._id],
    });
    const audience = await t.query(api.audience.getCurrentState, {
      publicSlug: poll.publicSlug,
      respondentToken: "voter-a",
    });
    expect(audience.kind).toBe("question");
    if (audience.kind !== "question") throw new Error("Expected question");
    expect(audience.question.ballotCount).toBe(1);
    expect(audience.existingBallot?.selectedChoiceIds).toEqual([
      detail.choices[0]._id,
    ]);
  });

  test("failed creation rolls back the event, question, and options", async () => {
    const t = backend();
    await expect(
      t.mutation(api.polls.create, {
        ...draft,
        choices: [{ label: "Only option" }],
      }),
    ).rejects.toThrow(/at least two/);
    const counts = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.query("events").take(2),
        ctx.db.query("questions").take(2),
        ctx.db.query("choices").take(2),
      ]),
    );
    expect(counts).toEqual([[], [], []]);
  });

  test("incomplete drafts stay private until saved and started together", async () => {
    const t = backend();
    const poll = await t.mutation(api.polls.create, {
      ...draft,
      prompt: "",
      choices: [{ label: "" }, { label: "" }],
      start: false,
    });
    const host = { publicSlug: poll.publicSlug, hostSecret };
    expect(
      (
        await t.query(api.audience.getCurrentState, {
          publicSlug: poll.publicSlug,
        })
      ).kind,
    ).toBe("waiting");
    const detail = await t.query(api.questions.getHostDetail, {
      ...host,
      questionId: poll.questionId,
    });
    await t.mutation(api.polls.save, {
      ...draft,
      ...host,
      questionId: poll.questionId,
      expectedChoiceIds: detail.choices.map((choice) => choice._id),
      choices: detail.choices.map((choice, index) => ({
        id: choice._id,
        label: draft.choices[index].label,
      })),
    });
    expect(
      (
        await t.query(api.audience.getCurrentState, {
          publicSlug: poll.publicSlug,
        })
      ).kind,
    ).toBe("question");
  });

  test("closing retains results for voters and late arrivals, and rejects late votes", async () => {
    const { t, poll, host, detail } = await setup();
    const ballot = {
      publicSlug: poll.publicSlug,
      questionId: poll.questionId,
      eventGeneration: 0,
      respondentToken: "voter-a",
      selectedChoiceIds: [detail.choices[0]._id],
    };
    await t.mutation(api.ballots.submit, ballot);
    await t.mutation(api.presentation.closeVoting, host);
    for (const respondentToken of ["voter-a", "late-arrival"]) {
      const state = await t.query(api.audience.getCurrentState, {
        publicSlug: poll.publicSlug,
        respondentToken,
      });
      expect(state.kind).toBe("question");
      if (state.kind !== "question") throw new Error("Expected results");
      expect(state.question.votingState).toBe("closed");
      expect(state.question.ballotCount).toBe(1);
    }
    await expect(
      t.mutation(api.ballots.submit, {
        ...ballot,
        respondentToken: "late-arrival",
      }),
    ).rejects.toThrow(/not currently open/);
    await t.mutation(api.polls.start, { ...host, questionId: poll.questionId });
    await expect(t.mutation(api.ballots.submit, ballot)).rejects.toThrow(
      /already been submitted/,
    );
  });

  test("starting another question closes the previous one and moves the audience", async () => {
    const { t, poll, host } = await setup();
    const second = await t.mutation(api.polls.save, {
      ...draft,
      ...host,
      prompt: "Next topic?",
      expectedChoiceIds: [],
    });
    const deck = await t.query(api.presentation.getDeck, host);
    expect(deck.event.openQuestionId).toBe(second.questionId);
    expect(deck.event.currentSlide).toEqual({
      kind: "question",
      questionId: second.questionId,
    });
    expect(
      deck.questions.find((question) => question._id === poll.questionId)
        ?.closedGeneration,
    ).toBe(0);
  });

  test("failed edits leave both the saved options and live state unchanged", async () => {
    const { t, host, saved } = await setup();
    const before = await t.query(api.presentation.getDeck, host);
    await expect(
      t.mutation(api.polls.save, {
        ...saved,
        prompt: "Changed",
        choices: [saved.choices[0]],
      }),
    ).rejects.toThrow(/at least two/);
    expect(await t.query(api.presentation.getDeck, host)).toEqual(before);
  });

  test("rejects wrong host secrets, foreign questions and foreign choice ids", async () => {
    const { t, host, saved } = await setup();
    await expect(
      t.mutation(api.polls.save, { ...saved, hostSecret: "wrong" }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.polls.start, {
        ...host,
        questionId: saved.questionId,
        hostSecret: "wrong",
      }),
    ).rejects.toThrow();
    const other = await t.mutation(api.polls.create, {
      ...draft,
      hostSecret: "different-secret-with-at-least-32-characters",
    });
    await expect(
      t.mutation(api.polls.save, { ...saved, questionId: other.questionId }),
    ).rejects.toThrow(/No question/);
    const foreign = await t.run(async (ctx) =>
      ctx.db
        .query("choices")
        .withIndex("by_question_and_position", (q) =>
          q.eq("questionId", other.questionId),
        )
        .first(),
    );
    await expect(
      t.mutation(api.polls.save, {
        ...saved,
        choices: [{ id: foreign!._id, label: "Foreign" }, saved.choices[1]],
      }),
    ).rejects.toThrow(/no longer belongs/);
  });

  test("stale editors cannot remove newly added options", async () => {
    const { t, host, saved } = await setup();
    await t.mutation(api.choices.create, {
      ...host,
      questionId: saved.questionId,
      label: "Added elsewhere",
    });
    await expect(t.mutation(api.polls.save, saved)).rejects.toThrow(
      /exactly the current active/,
    );
    const detail = await t.query(api.questions.getHostDetail, {
      ...host,
      questionId: saved.questionId,
    });
    expect(detail.choices).toHaveLength(3);
  });

  test("saving a live poll preserves the countdown and recorded choice ids", async () => {
    const { t, host, saved } = await setup();
    await t.run(async (ctx) => {
      const event = await ctx.db
        .query("events")
        .withIndex("by_public_slug", (q) => q.eq("publicSlug", host.publicSlug))
        .unique();
      await ctx.db.patch(event!._id, { votingOpenedAt: 12345 });
    });
    await t.mutation(api.polls.save, {
      ...saved,
      start: false,
      countdownSeconds: 30,
      choices: [...saved.choices].reverse(),
    });
    const deck = await t.query(api.presentation.getDeck, host);
    expect(deck.event.votingOpenedAt).toBe(12345);
    expect(
      deck.currentQuestionResults?.choices.map((choice) => choice.choiceId),
    ).toEqual(saved.expectedChoiceIds.toReversed());
  });
  test("editing a single-question draft updates its automatic title, but preserves a custom title", async () => {
    const { t, host, saved } = await setup();
    await t.mutation(api.polls.save, { ...saved, prompt: "Updated question" });
    expect((await t.query(api.presentation.getDeck, host)).event.title).toBe(
      "Updated question",
    );
    await t.mutation(api.events.updateDetails, { ...host, title: "My event" });
    await t.mutation(api.polls.save, { ...saved, prompt: "Another question" });
    expect((await t.query(api.presentation.getDeck, host)).event.title).toBe(
      "My event",
    );
  });
});

describe("saving poll images", () => {
  test("image-only options are attached before opening voting and survive text edits", async () => {
    const t = backend();
    const imageId = await storeFile(t, "image/png");
    const poll = await t.mutation(api.polls.create, {
      ...draft,
      imageId,
      choices: [{ label: "", imageId }, { label: "No image" }],
    });
    const host = { publicSlug: poll.publicSlug, hostSecret };
    const detail = await t.query(api.questions.getHostDetail, {
      ...host,
      questionId: poll.questionId,
    });
    expect(detail.question.imageUrl).toBeTruthy();
    expect(detail.choices[0].imageUrl).toBeTruthy();
    await t.mutation(api.polls.save, {
      ...draft,
      ...host,
      questionId: poll.questionId,
      start: false,
      prompt: "Updated question",
      expectedChoiceIds: detail.choices.map((choice) => choice._id),
      choices: detail.choices.map((choice) => ({
        id: choice._id,
        label: choice.label,
      })),
    });
    const updated = await t.query(api.questions.getHostDetail, {
      ...host,
      questionId: poll.questionId,
    });
    expect(updated.choices[0].imageUrl).toBe(detail.choices[0].imageUrl);
    const audience = await t.query(api.audience.getCurrentState, {
      publicSlug: poll.publicSlug,
    });
    expect(audience.kind).toBe("question");
    if (audience.kind !== "question") throw new Error("Expected question");
    expect(audience.question.choices[0].imageUrl).toBeTruthy();
  });

  test("images can be replaced and removed together with the saved draft", async () => {
    const { t, host, saved } = await setup();
    const imageId = await storeFile(t, "image/png");
    const nextImageId = await storeFile(t, "image/png", "replacement");
    await t.mutation(api.polls.save, {
      ...saved,
      imageId,
      choices: saved.choices.map((choice) => ({ ...choice, imageId })),
    });
    await t.mutation(api.polls.save, {
      ...saved,
      imageId: null,
      choices: [
        { ...saved.choices[0], imageId: nextImageId },
        { ...saved.choices[1], imageId: null },
      ],
    });
    const detail = await t.query(api.questions.getHostDetail, {
      ...host,
      questionId: saved.questionId,
    });
    expect(detail.question.imageUrl).toBeNull();
    expect(detail.choices[0].imageUrl).toBeTruthy();
    expect(detail.choices[1].imageUrl).toBeNull();
    expect(
      await t.run(
        async (ctx) => (await ctx.db.get(saved.choices[0].id))?.imageId,
      ),
    ).toBe(nextImageId);
  });

  test("invalid image files roll back the question, options, and live state", async () => {
    const { t, host, saved } = await setup();
    const imageId = await storeFile(t, "text/plain");
    const before = await t.query(api.presentation.getDeck, host);
    await expect(
      t.mutation(api.polls.save, {
        ...saved,
        prompt: "Changed",
        choices: [{ ...saved.choices[0], imageId }, saved.choices[1]],
      }),
    ).rejects.toThrow(/must be an image/);
    expect(await t.query(api.presentation.getDeck, host)).toEqual(before);
  });
});
