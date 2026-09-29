"use client";

import { useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { PollDraft } from "@/components/polls/poll-editor";
import type { BackgroundPreset } from "@/convex/lib/backgrounds";
import { uploadFileWithProgress } from "@/lib/image-upload";

type Host = { publicSlug: string; hostSecret: string };

export function hasPendingImages(draft: PollDraft) {
  return (
    !!draft.imageFile ||
    !!draft.backgroundImageFile ||
    draft.choices.some((choice) => !!choice.imageFile)
  );
}

/** Uploads are host-authorized; attaching their IDs happens with the poll save. */
export function usePollImages() {
  const generateUploadUrl = useMutation(api.images.generateUploadUrl);
  const uploadedFiles = useRef(
    new WeakMap<File, { publicSlug: string; storageId: Id<"_storage"> }>(),
  );

  return async (draft: PollDraft, host?: Host) => {
    async function storageIdFor(
      file: File | null | undefined,
    ): Promise<Id<"_storage"> | null | undefined> {
      if (file === undefined) return undefined;
      if (file === null) return null;
      if (!host) throw new Error("A host link is required to upload images.");
      const cached = uploadedFiles.current.get(file);
      if (cached?.publicSlug === host.publicSlug) return cached.storageId;
      const { uploadUrl } = await generateUploadUrl(host);
      const { storageId } = await uploadFileWithProgress(
        uploadUrl,
        file,
        () => {},
      );
      uploadedFiles.current.set(file, {
        publicSlug: host.publicSlug,
        storageId,
      });
      return storageId;
    }

    function imageFields(storageId: Id<"_storage"> | null | undefined) {
      return storageId === undefined ? {} : { imageId: storageId };
    }

    const choices = [];
    for (const choice of draft.choices) {
      choices.push({
        ...(choice.id ? { id: choice.id } : {}),
        label: choice.label,
        ...imageFields(await storageIdFor(choice.imageFile)),
      });
    }
    const backgroundImageId = await storageIdFor(draft.backgroundImageFile);
    const backgroundPreset: BackgroundPreset | undefined =
      draft.backgroundPreset;
    return {
      prompt: draft.prompt,
      description: draft.description ?? "",
      minSelections: draft.minSelections,
      maxSelections: draft.maxSelections,
      ...(draft.countdownSeconds !== undefined
        ? { countdownSeconds: draft.countdownSeconds }
        : {}),
      ...(backgroundPreset !== undefined ? { backgroundPreset } : {}),
      ...(backgroundImageId !== undefined ? { backgroundImageId } : {}),
      ...imageFields(await storageIdFor(draft.imageFile)),
      choices,
    };
  };
}
