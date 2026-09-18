import type { Id } from "@/convex/_generated/dataModel";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "Please choose an image file.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Images must be 5 MiB or smaller.";
  }
  return null;
}

type UploadResponse = { storageId: Id<"_storage"> };

function isUploadResponse(value: unknown): value is UploadResponse {
  if (typeof value !== "object" || value === null) return false;
  if (!("storageId" in value)) return false;
  return typeof value.storageId === "string";
}

/**
 * POSTs `file` to `uploadUrl` and resolves with the parsed response body.
 * Uses `XMLHttpRequest` rather than `fetch`, which has no portable
 * upload-progress event - `xhr.upload.onprogress` is what lets
 * `onProgress` report a real 0-100 percentage while the bytes are still
 * uploading. Rejects with a clear, user-facing `Error` on a network
 * failure, an aborted request, a non-2xx response, or an unparsable body,
 * so every failure mode surfaces through the same error path as any other
 * action.
 */
export function uploadFileWithProgress(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<UploadResponse> {
  const { promise, resolve, reject } = Promise.withResolvers<UploadResponse>();
  const xhr = new XMLHttpRequest();
  xhr.open("POST", uploadUrl);
  xhr.setRequestHeader("Content-Type", file.type);
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      onProgress(Math.round((event.loaded / event.total) * 100));
    }
  };
  xhr.onload = () => {
    if (xhr.status < 200 || xhr.status >= 300) {
      reject(new Error("Image upload failed. Try again."));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(xhr.responseText);
    } catch {
      reject(new Error("Image upload failed. Try again."));
      return;
    }
    if (!isUploadResponse(parsed)) {
      reject(new Error("Image upload failed. Try again."));
      return;
    }
    resolve(parsed);
  };
  xhr.onerror = () =>
    reject(
      new Error("Image upload failed. Check your connection and try again."),
    );
  xhr.onabort = () => reject(new Error("Image upload was cancelled."));
  xhr.send(file);
  return promise;
}
