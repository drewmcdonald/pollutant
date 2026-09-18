"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrBlock } from "@/components/polls/qr-block";

function subscribeOrigin() {
  return () => {};
}
function getOrigin() {
  return window.location.origin;
}
function getServerOrigin() {
  return null;
}

export function CopyLinkButton({
  path,
  children,
}: {
  path: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          const url = `${window.location.origin}${path}`;
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setFallback(url);
          }
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : children}
      </Button>
      {fallback && (
        <input
          aria-label="Link to copy"
          readOnly
          value={fallback}
          onFocus={(event) => event.target.select()}
          className="w-full rounded border bg-background p-2 text-xs"
        />
      )}
    </div>
  );
}

export function SharePoll({ publicSlug }: { publicSlug: string }) {
  const origin = useSyncExternalStore(
    subscribeOrigin,
    getOrigin,
    getServerOrigin,
  );
  return (
    <aside className="space-y-5 rounded-xl border p-5 lg:w-64">
      <div className="space-y-1">
        <h2 className="font-medium">Invite people to vote</h2>
        <p className="text-sm text-muted-foreground">
          Share the link or scan the QR code.
        </p>
      </div>
      <CopyLinkButton path={`/e/${publicSlug}`}>
        Copy voting link
      </CopyLinkButton>
      {origin && (
        <div className="break-all">
          <QrBlock audienceUrl={`${origin}/e/${publicSlug}`} />
        </div>
      )}
    </aside>
  );
}
