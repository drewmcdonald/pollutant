/**
 * Client-only "remembered events" store, backed by `localStorage`.
 *
 * This is a convenience list this browser keeps for itself — it is never
 * authoritative and never talks to the backend. Creating or opening a host
 * link remembers it here; removing an entry only forgets it locally and
 * never deletes the underlying Convex event.
 *
 * Exposed as a `useSyncExternalStore`-compatible store (a memoized snapshot
 * getter, a server snapshot, and a subscribe function) rather than a plain
 * read function, so components can read it without an effect-based
 * "hydrate after mount" dance.
 */

export type RememberedEvent = {
  publicSlug: string;
  hostUrl: string;
  title: string;
  lastOpenedAt: number;
};

const STORAGE_KEY = "live-event-polls:remembered-events:v1";

/** Stable empty-array reference: both the server snapshot and the "nothing
 * stored yet" client snapshot must return the *same* reference every call,
 * or `useSyncExternalStore` sees a spurious change on every render. */
const EMPTY_SNAPSHOT: RememberedEvent[] = [];

function isRememberedEvent(value: unknown): value is RememberedEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.publicSlug === "string" &&
    typeof candidate.hostUrl === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.lastOpenedAt === "number"
  );
}

function parseSnapshot(raw: string | null): RememberedEvent[] {
  if (raw === null) return EMPTY_SNAPSHOT;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_SNAPSHOT;
    const events = parsed.filter(isRememberedEvent);
    if (events.length === 0) return EMPTY_SNAPSHOT;
    return events.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    // Corrupt or inaccessible storage (private browsing, quota, tampering)
    // degrades to "nothing remembered" rather than throwing.
    return EMPTY_SNAPSHOT;
  }
}

function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRaw(events: RememberedEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Storage may be full or disabled; the write is best-effort.
  }
}

let cachedRaw: string | null = null;
let cachedSnapshot: RememberedEvent[] = EMPTY_SNAPSHOT;

/**
 * `getSnapshot` for `useSyncExternalStore`. Memoized against the raw stored
 * string so it returns the exact same array reference between calls unless
 * the underlying storage actually changed.
 */
export function getRememberedEventsSnapshot(): RememberedEvent[] {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedSnapshot;
  cachedRaw = raw;
  cachedSnapshot = parseSnapshot(raw);
  return cachedSnapshot;
}

/** `getServerSnapshot` for `useSyncExternalStore`: the server never has
 * localStorage, so it always renders as "nothing remembered yet". */
export function getServerRememberedEventsSnapshot(): RememberedEvent[] {
  return EMPTY_SNAPSHOT;
}

const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

/**
 * `subscribe` for `useSyncExternalStore`. Notifies on writes made through
 * `rememberEvent`/`forgetRememberedEvent` in this tab, and on the
 * `storage` event so another tab's changes are picked up too.
 */
export function subscribeRememberedEvents(
  onStoreChange: () => void,
): () => void {
  listeners.add(onStoreChange);
  function handleStorage(event: StorageEvent): void {
    if (event.key === null || event.key === STORAGE_KEY) onStoreChange();
  }
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

/** Adds (or re-stamps) an event as just-opened and persists it. */
export function rememberEvent(
  event: Omit<RememberedEvent, "lastOpenedAt"> & { lastOpenedAt?: number },
): void {
  const lastOpenedAt = event.lastOpenedAt ?? Date.now();
  const next = [
    {
      publicSlug: event.publicSlug,
      hostUrl: event.hostUrl,
      title: event.title,
      lastOpenedAt,
    },
    ...parseSnapshot(readRaw()).filter(
      (e) => e.publicSlug !== event.publicSlug,
    ),
  ];
  writeRaw(next);
  emitChange();
}

/** Removes an event from this device's local list only — never deletes it
 * on the backend. */
export function forgetRememberedEvent(publicSlug: string): void {
  const next = parseSnapshot(readRaw()).filter(
    (e) => e.publicSlug !== publicSlug,
  );
  writeRaw(next);
  emitChange();
}
