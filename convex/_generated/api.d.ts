/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audience from "../audience.js";
import type * as ballots from "../ballots.js";
import type * as choices from "../choices.js";
import type * as events from "../events.js";
import type * as images from "../images.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_counters from "../lib/counters.js";
import type * as lib_data from "../lib/data.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_results from "../lib/results.js";
import type * as presence from "../presence.js";
import type * as presentation from "../presentation.js";
import type * as questions from "../questions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audience: typeof audience;
  ballots: typeof ballots;
  choices: typeof choices;
  events: typeof events;
  images: typeof images;
  "lib/auth": typeof lib_auth;
  "lib/counters": typeof lib_counters;
  "lib/data": typeof lib_data;
  "lib/errors": typeof lib_errors;
  "lib/results": typeof lib_results;
  presence: typeof presence;
  presentation: typeof presentation;
  questions: typeof questions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  shardedCounter: import("@convex-dev/sharded-counter/_generated/component.js").ComponentApi<"shardedCounter">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
};
