"use client";

import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { ConvexError } from "convex/values";
import { Check, Copy, ExternalLink, MonitorPlay, Plus, X } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateHostSecret } from "@/lib/host-secret";
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
  const createEvent = useMutation(api.events.create);
  const hasHydrated = useHasHydrated();
  const events = useSyncExternalStore(
    subscribeRememberedEvents,
    getRememberedEventsSnapshot,
    getServerRememberedEventsSnapshot,
  );
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyFeedbackTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  async function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setError("Give the event a title first.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const hostSecret = generateHostSecret();
      const result = await createEvent({ title: trimmedTitle, hostSecret });
      const hostUrl = `/host/${result.publicSlug}/${hostSecret}`;
      rememberEvent({
        publicSlug: result.publicSlug,
        hostUrl,
        title: result.title,
      });
      setTitle("");
      router.push(hostUrl);
    } catch (caught) {
      if (caught instanceof ConvexError) {
        const data = caught.data as { code?: string; message?: string };
        setError(data.message ?? "Couldn't create that event.");
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
        <CardHeader>
          <CardTitle className="text-base">Create a new event</CardTitle>
          <CardDescription>
            Generates a public audience link and a secret host link only this
            browser will remember.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
            onSubmit={handleSubmit}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="event-title">Event title</Label>
              <Input
                id="event-title"
                name="title"
                placeholder="Friday All-Hands Trivia"
                value={title}
                onChange={(changeEvent) => setTitle(changeEvent.target.value)}
                disabled={submitting}
              />
            </div>
            <Button
              type="submit"
              size="default"
              className="sm:w-auto"
              disabled={submitting}
            >
              <Plus className="h-4 w-4" />
              {submitting ? "Creating…" : "Create event"}
            </Button>
          </form>
          {error && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          Remembered on this device
        </h2>
        <span className="text-xs text-muted-foreground">
          {hasHydrated ? `${events.length} events` : "…"}
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
            No events remembered on this device yet. Create one above, or open a
            host link someone shared with you.
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
        <div className="flex flex-wrap shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              audienceCopied ? "Audience link copied" : "Copy audience link"
            }
            title="Copy audience link"
            onClick={() =>
              onCopyLink(event.publicSlug, "audience", `/e/${event.publicSlug}`)
            }
          >
            {audienceCopied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <a href={`/e/${event.publicSlug}`} target="_blank">
              <ExternalLink className="h-3.5 w-3.5" />
              Audience view
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={hostCopied ? "Host link copied" : "Copy host link"}
            title="Copy host link"
            onClick={() => onCopyLink(event.publicSlug, "host", event.hostUrl)}
          >
            {hostCopied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button size="sm" asChild>
            <a href={event.hostUrl}>
              <MonitorPlay className="h-3.5 w-3.5" />
              Open control room
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove from this device"
            title="Remove from this device (doesn't delete the event)"
            onClick={() => onRemove(event.publicSlug)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
