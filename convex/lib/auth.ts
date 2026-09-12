import type { Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { appError } from "./errors";

/** Either a query or a mutation context — both expose `db.query`. */
type ReadCtx = QueryCtx | MutationCtx;

/** SHA-256 digest of a UTF-8 string, hex-encoded, using Convex's V8 Web Crypto. */
export async function sha256Hex(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time comparison of two equal-length hex digests. Falls back to a
 * length check (which is not secret-dependent) when lengths differ, since a
 * timing side-channel on length alone leaks nothing about digest content.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Bounded indexed lookup of an event by its opaque public slug. */
export async function findEventByPublicSlug(
  ctx: ReadCtx,
  publicSlug: string,
): Promise<Doc<"events"> | null> {
  return ctx.db
    .query("events")
    .withIndex("by_public_slug", (q) => q.eq("publicSlug", publicSlug))
    .unique();
}

/**
 * Authenticates a host for the event identified by `publicSlug`.
 *
 * Throws `EVENT_NOT_FOUND` when no event matches the slug, and
 * `HOST_ACCESS_DENIED` when the secret's digest doesn't match the stored
 * hash. Never reveals which case occurred beyond that, and never leaks the
 * stored hash or any timing signal derived from it.
 */
export async function requireHost(
  ctx: ReadCtx,
  publicSlug: string,
  hostSecret: string,
): Promise<Doc<"events">> {
  const event = await findEventByPublicSlug(ctx, publicSlug);
  if (event === null) {
    throw appError("EVENT_NOT_FOUND", "No event exists for this link.");
  }

  const candidateHash = await sha256Hex(hostSecret);
  if (!constantTimeEqual(candidateHash, event.hostSecretHash)) {
    throw appError("HOST_ACCESS_DENIED", "The host secret is incorrect.");
  }

  return event;
}
