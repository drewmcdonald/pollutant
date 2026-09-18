"use client";
import { useRef, type ChangeEvent } from "react";
import { ImageIcon, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
export function ImageControl({
  imageUrl,
  label,
  uploading,
  progress,
  disabled,
  onUpload,
  onRemove,
  compact = false,
}: {
  imageUrl: string | null;
  label: string;
  uploading: boolean;
  /** 0-100 upload percentage while `uploading` is true, when the browser
   * could compute it (`ProgressEvent.lengthComputable`); `undefined` shows
   * an indeterminate spinner instead. */
  progress: number | undefined;
  disabled: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so choosing the exact same file again still fires onChange.
    event.target.value = "";
    if (file !== undefined) onUpload(file);
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      aria-label={`Choose ${label.toLowerCase()}`}
      disabled={disabled}
      className="hidden"
      onChange={handleFileChange}
    />
  );

  if (compact) {
    return (
      <div className="relative shrink-0">
        {fileInput}
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-dashed border-foreground/40 bg-muted text-foreground transition-colors hover:border-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          title={
            imageUrl
              ? `Replace ${label.toLowerCase()}`
              : `Upload ${label.toLowerCase()}`
          }
          aria-label={
            imageUrl
              ? `Replace ${label.toLowerCase()}`
              : `Upload ${label.toLowerCase()}`
          }
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            progress !== undefined ? (
              <span className="text-[9px] font-semibold tabular-nums">
                {progress}%
              </span>
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )
          ) : imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL: host is per-deployment/dynamic, so next/image can't safely whitelist it via remotePatterns.
            <img className="h-full w-full object-cover" src={imageUrl} alt="" />
          ) : (
            <ImageIcon className="h-3.5 w-3.5" />
          )}
        </button>
        {imageUrl && !uploading && (
          <button
            type="button"
            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-white disabled:opacity-50"
            aria-label={`Remove ${label.toLowerCase()}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
      {fileInput}
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL: host is per-deployment/dynamic, so next/image can't safely whitelist it via remotePatterns.
        <img className="h-10 w-10 rounded object-cover" src={imageUrl} alt="" />
      ) : (
        <ImageIcon className="h-4 w-4" />
      )}
      <span>
        {uploading
          ? progress !== undefined
            ? `Uploading\u2026 ${progress}%`
            : "Uploading\u2026"
          : imageUrl
            ? `${label} attached`
            : "No image attached"}
      </span>
      {uploading && progress !== undefined && (
        <Progress value={progress} className="h-1.5 w-full" />
      )}
      <div className="ml-auto flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={
            imageUrl
              ? `Replace ${label.toLowerCase()}`
              : `Upload ${label.toLowerCase()}`
          }
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {imageUrl ? "Replace" : "Upload"}
        </Button>
        {imageUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${label.toLowerCase()}`}
            disabled={disabled}
            onClick={onRemove}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
