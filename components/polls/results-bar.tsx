import { Crown } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ResultChoice = {
  label: string;
  imageUrl: string | null;
  archived?: boolean;
  selections: number;
  respondentPercentage: number;
  winner?: boolean;
};

export function ResultsBar({
  choice,
  isWinner,
  highContrast,
}: {
  choice: ResultChoice;
  isWinner?: boolean;
  highContrast?: boolean;
}) {
  const pct = choice.respondentPercentage;
  const winner = isWinner ?? choice.winner ?? false;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {choice.imageUrl !== null && (
            // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL: host is per-deployment/dynamic, so next/image can't safely whitelist it via remotePatterns.
            <img
              src={choice.imageUrl}
              alt=""
              width={40}
              height={40}
              className={cn(
                "h-10 w-10 shrink-0 rounded-md border bg-muted object-cover",
                highContrast && "border-white/30 bg-white/10",
              )}
            />
          )}
          <span
            className={cn(
              "truncate font-medium",
              highContrast && "text-lg text-white",
            )}
          >
            {choice.label}
          </span>
          {choice.archived && (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              Archived
            </Badge>
          )}
          {winner && (
            <Crown
              className={cn(
                "h-4 w-4 shrink-0 text-amber-500",
                highContrast && "text-amber-300",
              )}
            />
          )}
        </div>
        <span
          className={cn(
            "shrink-0 tabular-nums text-sm text-muted-foreground",
            highContrast && "text-base text-white/80",
          )}
        >
          {choice.selections} · {pct.toFixed(1)}%
        </span>
      </div>
      <Progress
        value={pct}
        className={cn(highContrast && "h-3.5 bg-white/15")}
        indicatorClassName={cn(
          winner && "bg-amber-500",
          highContrast && !winner && "bg-sky-400",
          highContrast && winner && "bg-amber-300",
        )}
      />
    </div>
  );
}
