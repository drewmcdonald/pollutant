import type { Id } from "../_generated/dataModel";

export const MAX_QUESTION_IMAGES = 3;

const QUESTION_IMAGE_FIELDS = ["imageId", "imageId2", "imageId3"] as const;

export type QuestionImageFields = {
  imageId?: Id<"_storage">;
  imageId2?: Id<"_storage">;
  imageId3?: Id<"_storage">;
};

export function questionImageIds(
  question: QuestionImageFields,
): Id<"_storage">[] {
  return QUESTION_IMAGE_FIELDS.flatMap((field) => {
    const imageId = question[field];
    return imageId === undefined ? [] : [imageId];
  });
}

export function questionImageSlotPatch(
  slot: 0 | 1 | 2,
  storageId: Id<"_storage"> | undefined,
): QuestionImageFields {
  const field = QUESTION_IMAGE_FIELDS[slot];
  return { [field]: storageId };
}

export function questionImageSlotId(
  question: QuestionImageFields,
  slot: 0 | 1 | 2,
): Id<"_storage"> | undefined {
  return question[QUESTION_IMAGE_FIELDS[slot]];
}
