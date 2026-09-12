import { ShardedCounter } from "@convex-dev/sharded-counter";
import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Every scope that can invalidate prior ballots and their tallies. */
export type CounterScope = {
  eventId: Id<"events">;
  eventGeneration: number;
  questionId: Id<"questions">;
  responseGeneration: number;
};

type ReadCtx = QueryCtx | MutationCtx;

/**
 * A generation-scoped ballot or choice counter, sharded 16 ways by default.
 * Keys are opaque encoded strings — never construct them outside this
 * module.
 */
const resultCounters = new ShardedCounter<string>(components.shardedCounter, {
  defaultShards: 16,
});

/**
 * Encodes the counter key for the total number of ballots cast in `scope`.
 * Ids never contain the `|` delimiter, and the leading tag disambiguates
 * this key shape from `choiceCounterKey`'s five-segment shape, so no two
 * distinct scopes or key kinds can ever collide.
 */
function ballotCounterKey(scope: CounterScope): string {
  return [
    "ballot",
    scope.eventId,
    scope.eventGeneration,
    scope.questionId,
    scope.responseGeneration,
  ].join("|");
}

/** Encodes the counter key for the number of ballots that selected `choiceId` in `scope`. */
function choiceCounterKey(
  scope: CounterScope,
  choiceId: Id<"choices">,
): string {
  return [
    "choice",
    scope.eventId,
    scope.eventGeneration,
    scope.questionId,
    scope.responseGeneration,
    choiceId,
  ].join("|");
}

/**
 * Atomically increments the ballot total and every selected choice's total
 * for `scope`. Callers invoke this from within the same mutation that
 * inserts the immutable ballot document, so the counter updates and the
 * insert commit together.
 */
export async function recordBallot(
  ctx: MutationCtx,
  scope: CounterScope,
  selectedChoiceIds: Id<"choices">[],
): Promise<void> {
  await resultCounters.inc(ctx, ballotCounterKey(scope));
  for (const choiceId of selectedChoiceIds) {
    await resultCounters.inc(ctx, choiceCounterKey(scope, choiceId));
  }
}

/** Reads the exact ballot total for `scope`. Never estimated. */
export async function readBallotCount(
  ctx: ReadCtx,
  scope: CounterScope,
): Promise<number> {
  return resultCounters.count(ctx, ballotCounterKey(scope));
}

/** Reads the exact selection total for `choiceId` within `scope`. Never estimated. */
export async function readChoiceCount(
  ctx: ReadCtx,
  scope: CounterScope,
  choiceId: Id<"choices">,
): Promise<number> {
  return resultCounters.count(ctx, choiceCounterKey(scope, choiceId));
}

/**
 * Resets the ballot counter and the counters for `choiceIds` back to zero
 * for an obsolete `scope` (e.g. a response generation being replaced by
 * `questions.resetResponses`, or an event generation being replaced by a
 * future `events.reset`). `choiceIds` must be a bounded, caller-supplied
 * list — this never scans for which choices existed under the obsolete
 * scope, keeping the reset bounded to the keys the caller already knows
 * about.
 */
export async function resetObsoleteCounters(
  ctx: MutationCtx,
  scope: CounterScope,
  choiceIds: Id<"choices">[],
): Promise<void> {
  await resultCounters.reset(ctx, ballotCounterKey(scope));
  for (const choiceId of choiceIds) {
    await resultCounters.reset(ctx, choiceCounterKey(scope, choiceId));
  }
}
