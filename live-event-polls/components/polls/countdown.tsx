"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Renders the advisory countdown described in system-design.md §6:
 * remainingMs = max(0, openedAt + countdownSeconds*1000 - now). This is a
 * presentation cue only — the server keeps accepting ballots at zero until
 * the host explicitly closes voting.
 */
export function Countdown({
  countdownSeconds,
  openedAt,
  size = "default",
}: {
  countdownSeconds: number;
  openedAt: number;
  size?: "default" | "large";
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const remainingMs = Math.max(0, openedAt + countdownSeconds * 1000 - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(remainingSeconds / 60)
    .toString()
    .padStart(2, "0");
  const ss = (remainingSeconds % 60).toString().padStart(2, "0");
  const expired = remainingMs === 0;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono tabular-nums",
        expired
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-muted text-foreground",
        size === "large" && "gap-3 px-6 py-3 text-4xl",
      )}
    >
      <Timer className={cn("h-4 w-4", size === "large" && "h-8 w-8")} />
      <span suppressHydrationWarning>
        {mm}:{ss}
      </span>
    </div>
  );
}
