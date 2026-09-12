import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const currentSlide = v.union(
  v.object({ kind: v.literal("welcome") }),
  v.object({ kind: v.literal("question"), questionId: v.id("questions") }),
  v.object({ kind: v.literal("finale") }),
);

export default defineSchema({
  events: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    publicSlug: v.string(),
    hostSecretHash: v.string(),
    generation: v.number(),
    currentSlide,
    openQuestionId: v.optional(v.id("questions")),
    votingOpenedAt: v.optional(v.number()),
  }).index("by_public_slug", ["publicSlug"]),

  questions: defineTable({
    eventId: v.id("events"),
    position: v.number(),
    prompt: v.string(),
    imageId: v.optional(v.id("_storage")),
    minSelections: v.number(),
    maxSelections: v.number(),
    countdownSeconds: v.optional(v.number()),
    responseGeneration: v.number(),
    closedGeneration: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_event_archived_and_position", [
      "eventId",
      "archivedAt",
      "position",
    ])
    .index("by_image_id", ["imageId"]),

  choices: defineTable({
    questionId: v.id("questions"),
    position: v.number(),
    label: v.string(),
    imageId: v.optional(v.id("_storage")),
    archivedAt: v.optional(v.number()),
  })
    .index("by_question_and_position", ["questionId", "position"])
    .index("by_question_archived_and_position", [
      "questionId",
      "archivedAt",
      "position",
    ])
    .index("by_image_id", ["imageId"]),

  ballots: defineTable({
    eventId: v.id("events"),
    eventGeneration: v.number(),
    questionId: v.id("questions"),
    responseGeneration: v.number(),
    respondentToken: v.string(),
    selectedChoiceIds: v.array(v.id("choices")),
  })
    .index("by_question_response_and_respondent", [
      "eventId",
      "eventGeneration",
      "questionId",
      "responseGeneration",
      "respondentToken",
    ])
    .index("by_question_response", [
      "eventId",
      "eventGeneration",
      "questionId",
      "responseGeneration",
    ])
    .index("by_event_generation", ["eventId", "eventGeneration"]),
});
