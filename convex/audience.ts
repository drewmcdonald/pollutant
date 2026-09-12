import { v, type Infer } from "convex/values";
import { query } from "./_generated/server";
import { findEventByPublicSlug } from "./lib/auth";
import { loadActiveQuestionResults } from "./lib/results";

const MAX_RESPONDENT_TOKEN_LENGTH = 128;

const audienceChoiceValidator = v.object({
  choiceId: v.id("choices"),
  label: v.string(),
  imageUrl: v.union(v.string(), v.null()),
  selections: v.number(),
  respondentPercentage: v.number(),
  winner: v.boolean(),
});

const audienceQuestionValidator = v.object({
  questionId: v.id("questions"),
  eventGeneration: v.number(),
  responseGeneration: v.number(),
  prompt: v.string(),
  imageUrl: v.union(v.string(), v.null()),
  minSelections: v.number(),
  maxSelections: v.number(),
  countdownSeconds: v.optional(v.number()),
  votingOpenedAt: v.number(),
  ballotCount: v.number(),
  choices: v.array(audienceChoiceValidator),
});

const submittedBallotValidator = v.object({
  selectedChoiceIds: v.array(v.id("choices")),
});
type SubmittedBallot = Infer<typeof submittedBallotValidator>;

const audienceStateValidator = v.union(
  v.object({ kind: v.literal("notFound") }),
  v.object({
    kind: v.literal("waiting"),
    eventTitle: v.string(),
    presenceRoomId: v.string(),
  }),
  v.object({
    kind: v.literal("question"),
    question: audienceQuestionValidator,
    existingBallot: v.optional(submittedBallotValidator),
    presenceRoomId: v.string(),
  }),
  v.object({
    kind: v.literal("finished"),
    eventTitle: v.string(),
    presenceRoomId: v.string(),
  }),
);

/**
 * Returns the minimal public audience state for one event. Never returns
 * the host-secret hash, the full question sequence, prior question
 * results, host-only metadata, or another respondent's ballot
 * (system-design.md §9.1, §10.4).
 */
export const getCurrentState = query({
  args: {
    publicSlug: v.string(),
    respondentToken: v.optional(v.string()),
  },
  returns: audienceStateValidator,
  handler: async (ctx, args) => {
    const event = await findEventByPublicSlug(ctx, args.publicSlug);
    if (event === null) {
      return { kind: "notFound" as const };
    }
    // Audience presence is scoped by generation, so every non-notFound
    // state shares this room id regardless of which slide is showing
    // (system-design.md section 7.6).
    const presenceRoomId = `${event._id}:${event.generation}`;

    if (event.currentSlide.kind === "welcome") {
      return {
        kind: "waiting" as const,
        eventTitle: event.title,
        presenceRoomId,
      };
    }
    if (event.currentSlide.kind === "finale") {
      return {
        kind: "finished" as const,
        eventTitle: event.title,
        presenceRoomId,
      };
    }

    const question = await ctx.db.get(event.currentSlide.questionId);
    if (
      question === null ||
      event.openQuestionId !== question._id ||
      event.votingOpenedAt === undefined
    ) {
      // The slide points at a question, but it is not the one currently
      // open for voting (not yet opened, or already closed). Audience
      // states collapse this to "waiting" (system-design.md section 10.4).
      return {
        kind: "waiting" as const,
        eventTitle: event.title,
        presenceRoomId,
      };
    }

    const results = await loadActiveQuestionResults(ctx, event, question);

    let existingBallot: SubmittedBallot | undefined;
    if (
      args.respondentToken !== undefined &&
      args.respondentToken.length > 0 &&
      args.respondentToken.length <= MAX_RESPONDENT_TOKEN_LENGTH
    ) {
      const ballot = await ctx.db
        .query("ballots")
        .withIndex("by_question_response_and_respondent", (q) =>
          q
            .eq("eventId", event._id)
            .eq("eventGeneration", event.generation)
            .eq("questionId", question._id)
            .eq("responseGeneration", question.responseGeneration)
            .eq("respondentToken", args.respondentToken as string),
        )
        .unique();
      if (ballot !== null) {
        existingBallot = { selectedChoiceIds: ballot.selectedChoiceIds };
      }
    }

    return {
      kind: "question" as const,
      question: {
        questionId: question._id,
        eventGeneration: event.generation,
        responseGeneration: question.responseGeneration,
        prompt: question.prompt,
        imageUrl: results.imageUrl,
        minSelections: question.minSelections,
        maxSelections: question.maxSelections,
        countdownSeconds: question.countdownSeconds,
        votingOpenedAt: event.votingOpenedAt,
        ballotCount: results.ballotCount,
        choices: results.choices.map((choice) => ({
          choiceId: choice.choiceId,
          label: choice.label,
          imageUrl: choice.imageUrl,
          selections: choice.selections,
          respondentPercentage: choice.respondentPercentage,
          winner: choice.winner,
        })),
      },
      existingBallot,
      presenceRoomId,
    };
  },
});
