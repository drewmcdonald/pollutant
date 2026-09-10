import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireHost, sha256Hex } from "./lib/auth";
import { appError } from "./lib/errors";

const presence = new Presence(components.presence);

const MAX_RESPONDENT_TOKEN_LENGTH = 128;
const MIN_HEARTBEAT_INTERVAL_MS = 1000;
const MAX_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Approximate limit on how many devices `getConnectedCount` will read from
 * the room. The design targets approximately 250 concurrent audience
 * devices per event (system-design.md §16), so this bound is never reached
 * in practice; it exists so the read is always bounded regardless.
 */
const MAX_CONNECTED_COUNT_SCAN = 251;

export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  returns: v.object({
    roomToken: v.string(),
    sessionToken: v.string(),
  }),
  handler: async (ctx, args) => {
    const separatorIndex = args.roomId.lastIndexOf(":");
    if (separatorIndex <= 0 || separatorIndex === args.roomId.length - 1) {
      throw appError("VALIDATION_ERROR", "roomId is malformed.");
    }
    const eventIdText = args.roomId.slice(0, separatorIndex);
    const generationText = args.roomId.slice(separatorIndex + 1);

    const eventId = ctx.db.normalizeId("events", eventIdText);
    if (eventId === null) {
      throw appError("EVENT_NOT_FOUND", "No event exists for this room.");
    }
    const event = await ctx.db.get(eventId);
    if (event === null) {
      throw appError("EVENT_NOT_FOUND", "No event exists for this room.");
    }

    const generation = Number(generationText);
    if (!Number.isInteger(generation) || generation !== event.generation) {
      throw appError(
        "STALE_EVENT_GENERATION",
        "This event has moved on to a new run.",
      );
    }

    if (
      args.userId.length === 0 ||
      args.userId.length > MAX_RESPONDENT_TOKEN_LENGTH
    ) {
      throw appError(
        "VALIDATION_ERROR",
        `userId must be between 1 and ${MAX_RESPONDENT_TOKEN_LENGTH} characters.`,
      );
    }

    if (
      args.interval < MIN_HEARTBEAT_INTERVAL_MS ||
      args.interval > MAX_HEARTBEAT_INTERVAL_MS
    ) {
      throw appError(
        "VALIDATION_ERROR",
        `interval must be between ${MIN_HEARTBEAT_INTERVAL_MS} and ${MAX_HEARTBEAT_INTERVAL_MS} milliseconds.`,
      );
    }

    return await presence.heartbeat(
      ctx,
      args.roomId,
      args.userId,
      args.sessionId,
      args.interval,
    );
  },
});

export const list = query({
  args: { roomToken: v.string() },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
      data: v.optional(v.any()),
    }),
  ),
  handler: async (ctx, args) => {
    const entries = await presence.list(ctx, args.roomToken);

    // Redact real respondent tokens: replace each with a one-way digest so
    // list entries stay distinct without exposing the identity used for
    // ballot uniqueness (system-design.md §8, §9.1).
    return await Promise.all(
      entries.map(async (entry) => ({
        userId: (await sha256Hex(entry.userId)).slice(0, 16),
        online: entry.online,
        lastDisconnected: entry.lastDisconnected,
        data: entry.data,
      })),
    );
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await presence.disconnect(ctx, args.sessionToken);
  },
});

export const getConnectedCount = query({
  args: {
    publicSlug: v.string(),
    hostSecret: v.string(),
  },
  returns: v.object({ connectedCount: v.number() }),
  handler: async (ctx, args) => {
    const event = await requireHost(ctx, args.publicSlug, args.hostSecret);
    const roomId = `${event._id}:${event.generation}`;

    const onlineUsers = await presence.listRoom(
      ctx,
      roomId,
      true,
      MAX_CONNECTED_COUNT_SCAN,
    );

    return { connectedCount: onlineUsers.length };
  },
});
