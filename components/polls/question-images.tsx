"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export function questionImageUrls(
  imageUrls?: string[] | null,
  imageUrl?: string | null,
): string[] {
  if (imageUrls && imageUrls.length > 0) return imageUrls;
  return imageUrl ? [imageUrl] : [];
}

export function QuestionImages({
  urls,
  alt,
  size = "audience",
}: {
  urls: string[];
  alt: string;
  size?: "audience" | "present" | "host";
}) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const canCycle = urls.length > 1;
  const focusedUrl =
    focusedIndex === null ? undefined : urls[focusedIndex];

  const showNext = () => {
    setFocusedIndex((current) =>
      current === null ? current : (current + 1) % urls.length,
    );
  };

  const showPrevious = () => {
    setFocusedIndex((current) =>
      current === null ? current : (current - 1 + urls.length) % urls.length,
    );
  };

  useEffect(() => {
    if (focusedIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFocusedIndex(null);
        return;
      }
      if (!canCycle) return;
      if (event.key === "ArrowRight") {
        setFocusedIndex((current) =>
          current === null ? current : (current + 1) % urls.length,
        );
      }
      if (event.key === "ArrowLeft") {
        setFocusedIndex((current) =>
          current === null
            ? current
            : (current - 1 + urls.length) % urls.length,
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canCycle, focusedIndex, urls.length]);

  if (urls.length === 0) return null;

  return (
    <>
      <div
        className={cn(
          "mx-auto flex w-full max-w-4xl flex-col",
          size === "present" ? "gap-5" : "gap-3",
        )}
      >
        {urls.map((url, index) => (
          // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL: host is per-deployment/dynamic, so next/image can't safely whitelist it via remotePatterns.
          <img
            key={`${url}:${index}`}
            src={url}
            alt={index === 0 ? alt : ""}
            title="Double-click to enlarge"
            className={cn(
              "h-auto w-full cursor-zoom-in bg-black/10 object-contain",
              size === "present" &&
                "rounded-xl border border-white/20 shadow-lg",
              size === "audience" && "border-b last:border-b-0",
              size === "host" && "rounded-lg border",
            )}
            onDoubleClick={(event) => {
              event.preventDefault();
              setFocusedIndex(index);
            }}
          />
        ))}
      </div>
      {focusedUrl !== undefined &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-3 sm:p-8"
            onClick={() => setFocusedIndex(null)}
          >
            {canCycle && (
              <button
                type="button"
                aria-label="Previous image"
                className="absolute left-3 top-1/2 z-[81] flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 sm:left-6"
                onClick={(event) => {
                  event.stopPropagation();
                  showPrevious();
                }}
              >
                <ChevronLeft className="h-8 w-8" />
              </button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage URL: host is per-deployment/dynamic, so next/image can't safely whitelist it via remotePatterns. */}
            <img
              src={focusedUrl}
              alt={alt}
              className="max-h-full max-w-full cursor-zoom-out object-contain"
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => {
                event.preventDefault();
                setFocusedIndex(null);
              }}
            />
            {canCycle && (
              <button
                type="button"
                aria-label="Next image"
                className="absolute right-3 top-1/2 z-[81] flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 sm:right-6"
                onClick={(event) => {
                  event.stopPropagation();
                  showNext();
                }}
              >
                <ChevronRight className="h-8 w-8" />
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
