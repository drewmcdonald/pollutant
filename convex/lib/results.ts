import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  readBallotCount,
  readChoiceCount,
  type CounterScope,
} from "./counters";
import { loadActiveChoices } from "./data";

type ReadCtx = QueryCtx | MutationCtx;

/**
 * A question's `by_question_and_position` index holds at most this many
 * choices (active and archived combined) per question, matching the
 * enforced 20-active-choice limit plus headroom for one still-visible
 * archived choice at query time.
 */
export const MAX_CHOICES_PER_QUESTION_SCAN = 21;

export const votingStateValidator = v.union(
  v.literal("ready"),
  v.literal("open"),
  v.literal("closed"),
);
export type VotingState = Infer<typeof votingStateValidator>;

export const choiceResultValidator = v.object({
  choiceId: v.id("choices"),
  label: v.string(),
  imageUrl: v.union(v.string(), v.null()),
  archived: v.boolean(),
  selections: v.number(),
  respondentPercentage: v.number(),
  winner: v.boolean(),
});
export type ChoiceResult = Infer<typeof choiceResultValidator>;

export const questionResultsValidator = v.object({
  questionId: v.id("questions"),
  prompt: v.string(),
  imageUrl: v.union(v.string(), v.null()),
  ballotCount: v.number(),
  votingState: votingStateValidator,
  choices: v.array(choiceResultValidator),
});
export type QuestionResults = Infer<typeof questionResultsValidator>;

/**
 * Derives a question's effective voting state from event and question state
 * alone (system-design.md §5.2), avoiding two competing declarations of
 * which question is open.
 */
export function computeVotingState(
  event: Doc<"events">,
  question: Doc<"questions">,
): VotingState {
  if (event.openQuestionId === question._id) {
    return "open";
  }
  if (question.closedGeneration === event.generation) {
    return "closed";
  }
  return "ready";
}

/**
 * Loads the stable, exact results for one question: every active and
 * archived choice in display order, each choice's exact selection count,
 * the exact ballot total, and the resulting winner set. Never scans
 * ballots — every count comes from the sharded result counters.
 */
export async function loadQuestionResults(
  ctx: ReadCtx,
  event: Doc<"events">,
  question: Doc<"questions">,
): Promise<QuestionResults> {
  const choices = await ctx.db
    .query("choices")
    .withIndex("by_question_and_position", (q) =>
      q.eq("questionId", question._id),
    )
    .take(MAX_CHOICES_PER_QUESTION_SCAN);
  return computeQuestionResults(ctx, event, question, choices);
}

/**
 * Loads the same exact results, restricted to active (non-archived)
 * choices only. Used by audience-facing surfaces, which never see archived
 * choices, while still reading from the same exact ballot/choice counters
 * as the host-facing `loadQuestionResults`.
 */
export async function loadActiveQuestionResults(
  ctx: ReadCtx,
  event: Doc<"events">,
  question: Doc<"questions">,
): Promise<QuestionResults> {
  const choices = await loadActiveChoices(ctx, question._id);
  return computeQuestionResults(ctx, event, question, choices);
}

async function computeQuestionResults(
  ctx: ReadCtx,
  event: Doc<"events">,
  question: Doc<"questions">,
  choices: Doc<"choices">[],
): Promise<QuestionResults> {
  const scope: CounterScope = {
    eventId: question.eventId,
    eventGeneration: event.generation,
    questionId: question._id,
    responseGeneration: question.responseGeneration,
  };

  const [ballotCount, choiceCounts, choiceImageUrls, questionImageUrl] =
    await Promise.all([
      readBallotCount(ctx, scope),
      Promise.all(
        choices.map((choice) => readChoiceCount(ctx, scope, choice._id)),
      ),
      Promise.all(
        choices.map((choice) =>
          choice.imageId === undefined
            ? Promise.resolve(null)
            : ctx.storage.getUrl(choice.imageId),
        ),
      ),
      question.imageId === undefined
        ? Promise.resolve(null)
        : ctx.storage.getUrl(question.imageId),
    ]);

  let maxSelections = 0;
  for (const count of choiceCounts) {
    if (count > maxSelections) {
      maxSelections = count;
    }
  }

  const choiceResults: ChoiceResult[] = choices.map((choice, index) => ({
    choiceId: choice._id,
    label: choice.label,
    imageUrl: choiceImageUrls[index],
    archived: choice.archivedAt !== undefined,
    selections: choiceCounts[index],
    respondentPercentage:
      ballotCount === 0 ? 0 : (choiceCounts[index] / ballotCount) * 100,
    winner: maxSelections > 0 && choiceCounts[index] === maxSelections,
  }));

  return {
    questionId: question._id,
    prompt: question.prompt,
    imageUrl: questionImageUrl,
    ballotCount,
    votingState: computeVotingState(event, question),
    choices: choiceResults,
  };
}
