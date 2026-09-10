import { ConvexError } from "convex/values";

/**
 * Structured error codes per docs/system-design.md §9.3. Clients branch on
 * `error.data.code`, never on `error.message` text.
 */
export const ERROR_CODES = [
  "EVENT_NOT_FOUND",
  "HOST_ACCESS_DENIED",
  "QUESTION_NOT_FOUND",
  "CHOICE_NOT_FOUND",
  "QUESTION_NOT_OPEN",
  "ALREADY_VOTED",
  "INVALID_SELECTION_COUNT",
  "INVALID_CHOICE",
  "CHOICE_ARCHIVED",
  "STALE_EVENT_GENERATION",
  "INVALID_REORDER",
  "VALIDATION_ERROR",
  "QUESTION_LIMIT_EXCEEDED",
  "CHOICE_LIMIT_EXCEEDED",
  "INVALID_IMAGE",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type AppErrorData = {
  code: ErrorCode;
  message: string;
};

/** Build the structured `ConvexError` every app-facing failure should throw. */
export function appError(
  code: ErrorCode,
  message: string,
): ConvexError<AppErrorData> {
  return new ConvexError<AppErrorData>({ code, message });
}
