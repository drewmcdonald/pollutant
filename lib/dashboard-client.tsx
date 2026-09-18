"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { ConvexError } from "convex/values";
import { Check, Copy, X } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PollEditor, type PollDraft } from "@/components/polls/poll-editor";
import { generateHostSecret } from "@/lib/host-secret";
import { hasPendingImages, usePollImages } from "@/lib/use-poll-images";
import {
  forgetRememberedEvent,
  getRememberedEventsSnapshot,
  getServerRememberedEventsSnapshot,
  rememberEvent,
  subscribeRememberedEvents,
  type RememberedEvent,
} from "@/lib/remembered-events";

function relativeTime(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function subscribeNever(): () => void {
  return () => {};
}
function getTrue(): boolean {
  return true;
}
function getFalse(): boolean {
  return false;
}

/**
 * True only once the client has taken over from the server-rendered HTML.
 * `useSyncExternalStore` (rather than `useState` + `useEffect`) is what
 * makes this hydration-safe: React renders `getServerSnapshot` for both
 * the SSR pass and the matching initial client pass, then swaps to
 * `getSnapshot` immediately after — without an effect, and without a
 * hydration-mismatch warning.
 */
function useHasHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, getTrue, getFalse);
}

export function DashboardClient() {
  const router = useRouter();
  const createPoll = useMutation(api.polls.create);
  const createEvent = useMutation(api.events.create);
  const savePoll = useMutation(api.polls.save);
  const prepareImages = usePollImages();
  const uploadHost = useRef<{ publicSlug: string; hostSecret: string } | null>(
    null,
  );
  const hasHydrated = useHasHydrated();
  const events = useSyncExternalStore(
    subscribeRememberedEvents,
    getRememberedEventsSnapshot,
    getServerRememberedEventsSnapshot,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyFeedbackTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  async function handleSubmit(
    draft: PollDraft,
    start: boolean,
    addAnother = false,
  ) {
    setSubmitting(true);
    setError(null);
    try {
      const title = draft.prompt.trim().slice(0, 200) || "Untitled poll";
      if (hasPendingImages(draft) && !uploadHost.current) {
        const hostSecret = generateHostSecret();
        const event = await createEvent({ title, hostSecret });
        uploadHost.current = { publicSlug: event.publicSlug, hostSecret };
        rememberEvent({
          publicSlug: event.publicSlug,
          title,
          hostUrl: `/host/${event.publicSlug}/${hostSecret}`,
        });
      }
      let host = uploadHost.current;
      if (host) {
        const fields = await prepareImages(draft, host);
        await savePoll({ ...host, ...fields, start, expectedChoiceIds: [] });
      } else {
        const hostSecret = generateHostSecret();
        const fields = await prepareImages(draft);
        const result = await createPoll({ ...fields, start, hostSecret });
        host = { publicSlug: result.publicSlug, hostSecret };
      }
      const hostUrl = `/host/${host.publicSlug}/${host.hostSecret}`;
      rememberEvent({ publicSlug: host.publicSlug, hostUrl, title });
      router.push(addAnother ? `${hostUrl}?newQuestion=1` : hostUrl);
    } catch (caught) {
      if (caught instanceof ConvexError) {
        const data = caught.data as { code?: string; message?: string };
        setError(data.message ?? "Couldn't create that poll.");
      } else {
        setError(
          "Couldn't reach the server. Check your connection and try again.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleRemove(publicSlug: string) {
    forgetRememberedEvent(publicSlug);
  }

  /**
   * Copies an absolute URL (current origin + `path`) to the clipboard.
   * `kind` distinguishes the audience link (never carries the host secret)
   * from the host link (`event.hostUrl`, which does) purely for feedback
   * state/messaging — the caller decides which `path` to pass.
   */
  async function copyLink(
    publicSlug: string,
    kind: "audience" | "host",
    path: string,
  ) {
    setError(null);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is not available in this browser.");
      }
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      clearTimeout(copyFeedbackTimeout.current);
      setCopiedKey(`${publicSlug}:${kind}`);
      copyFeedbackTimeout.current = setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setError(
        `Couldn't copy the ${kind === "audience" ? "audience" : "host"} link. Copy it manually from the address bar instead.`,
      );
    }
  }

  return (
    <>
      <Card className="mb-10">
        <CardContent className="p-5 sm:p-7">
          <PollEditor
            busy={submitting}
            onSave={handleSubmit}
            onAddQuestion={(draft) => handleSubmit(draft, false, true)}
          />
          {error && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          Recent polls
        </h2>
        <span className="text-xs text-muted-foreground">
          {hasHydrated ? `${events.length} polls` : "…"}
        </span>
      </div>

      {!hasHydrated ? (
        <ul className="flex flex-col gap-3" aria-hidden>
          {[0, 1].map((key) => (
            <li key={key}>
              <Card>
                <CardContent className="h-[92px] animate-pulse p-5" />
              </Card>
            </li>
          ))}
        </ul>
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Your polls will appear here on this device.
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((event) => (
            <li key={event.publicSlug}>
              <RememberedEventCard
                event={event}
                copiedKey={copiedKey}
                onCopyLink={copyLink}
                onRemove={handleRemove}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RememberedEventCard({
  event,
  copiedKey,
  onCopyLink,
  onRemove,
}: {
  event: RememberedEvent;
  copiedKey: string | null;
  onCopyLink: (
    publicSlug: string,
    kind: "audience" | "host",
    path: string,
  ) => void;
  onRemove: (publicSlug: string) => void;
}) {
  const audienceCopied = copiedKey === `${event.publicSlug}:audience`;
  const hostCopied = copiedKey === `${event.publicSlug}:host`;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate font-medium">{event.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Opened {relativeTime(event.lastOpenedAt)} ·{" "}
            <span className="font-mono">/e/{event.publicSlug}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" asChild>
            <a href={event.hostUrl}>Open poll</a>
          </Button>
          <details className="relative">
            <summary
              className="cursor-pointer rounded px-3 py-2 text-sm"
              aria-label={`More options for ${event.title}`}
            >
              •••
            </summary>
            <div className="absolute right-0 z-10 mt-2 flex w-52 flex-col gap-1 rounded-lg border bg-background p-2 shadow-lg">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onCopyLink(
                    event.publicSlug,
                    "audience",
                    `/e/${event.publicSlug}`,
                  )
                }
              >
                {audienceCopied ? <Check /> : <Copy />} Copy voting link
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onCopyLink(event.publicSlug, "host", event.hostUrl)
                }
              >
                {hostCopied ? <Check /> : <Copy />} Copy private host link
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove(event.publicSlug)}
              >
                <X /> Remove from this device
              </Button>
            </div>
          </details>
        </div>
      </CardContent>
    </Card>
  );
}
