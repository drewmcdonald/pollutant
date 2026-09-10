import { KeyRound } from "lucide-react";

export function SecretPill({ secret }: { secret: string }) {
  const visible =
    secret.length > 10 ? `${secret.slice(0, 6)}…${secret.slice(-4)}` : secret;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-xs text-amber-700 dark:text-amber-400"
      title="Host secret — treat this URL like a password"
    >
      <KeyRound className="h-3.5 w-3.5" />
      {visible}
    </span>
  );
}
