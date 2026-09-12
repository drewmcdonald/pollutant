import { Users } from "lucide-react";

import { cn } from "@/lib/utils";

export function PresencePill({
  count,
  size = "default",
}: {
  count: number;
  size?: "default" | "large";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-sm",
        size === "large" && "gap-3 px-5 py-2 text-xl text-white",
      )}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <Users className={cn("h-4 w-4", size === "large" && "h-6 w-6")} />
      <span className="font-medium tabular-nums">{count}</span>
      <span className="text-muted-foreground">joined</span>
    </div>
  );
}
