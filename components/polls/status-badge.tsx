import { Badge } from "@/components/ui/badge";

export type VotingState = "ready" | "open" | "closed";

const LABEL: Record<VotingState, string> = {
  ready: "Ready",
  open: "Open",
  closed: "Closed",
};

const VARIANT: Record<VotingState, "outline" | "success" | "secondary"> = {
  ready: "outline",
  open: "success",
  closed: "secondary",
};

export function VotingStatusBadge({ state }: { state: VotingState }) {
  return (
    <Badge variant={VARIANT[state]} className="uppercase tracking-wide">
      {state === "open" && (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
      )}
      {LABEL[state]}
    </Badge>
  );
}
