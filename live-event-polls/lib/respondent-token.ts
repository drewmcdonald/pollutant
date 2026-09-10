/**
 * Per-event respondent tokens, backed by `localStorage`.
 *
 * Exposed as a `useSyncExternalStore`-compatible store: `getRespondentTokenSnapshot`
 * is a pure read (never allocates unless the underlying storage actually
 * changed), and `ensureRespondentToken` is the one place a token is
 * actually created — an idempotent side effect meant to be called from a
 * `useEffect`, never from render/`getSnapshot`.
 */

const STORAGE_KEY = "live-event-polls:respondent-tokens:v1";
const MAX_TOKEN_LENGTH = 128;

type RespondentTokenMap = Record<string, string>;

/**
 * Tokens created when `localStorage` couldn't be written (private
 * browsing, a full quota, or a disabled storage API). Scoped to this JS
 * module instance (i.e. this tab), so a tab that can't persist still gets
 * a stable token for its own lifetime instead of `ensureRespondentToken`
 * silently creating a new, unusable one on every call.
 */
const memoryFallbackTokens: RespondentTokenMap = {};

let cachedRaw: string | null = null;
let cachedPersistedTokens: RespondentTokenMap = {};

function parseTokenMap(raw: string | null): RespondentTokenMap {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    const validEntries = Object.entries(parsed).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" &&
        entry[1].length > 0 &&
        entry[1].length <= MAX_TOKEN_LENGTH,
    );
    return Object.fromEntries(validEntries);
  } catch {
    return {};
  }
}

function readRawTokenStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Memoized against the raw stored string: re-parses and reallocates the
 * map only when the underlying `localStorage` value actually changed,
 * instead of on every call (React's `useSyncExternalStore` calls
 * `getSnapshot` on every render, including for consistency checks).
 */
function readPersistedTokenMap(): RespondentTokenMap {
  const raw = readRawTokenStorage();
  if (raw === cachedRaw) return cachedPersistedTokens;
  cachedRaw = raw;
  cachedPersistedTokens = parseTokenMap(raw);
  return cachedPersistedTokens;
}

function generateToken(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * `getSnapshot` for `useSyncExternalStore`: a pure read of the existing
 * token for `publicSlug`, preferring a persisted (`localStorage`) token
 * and falling back to this tab's in-memory token, or `null` if neither
 * exists yet. Never creates or persists a token — see
 * `ensureRespondentToken` for that.
 */
export function getRespondentTokenSnapshot(publicSlug: string): string | null {
  const persisted = readPersistedTokenMap()[publicSlug];
  if (persisted !== undefined) return persisted;
  return memoryFallbackTokens[publicSlug] ?? null;
}

/** `getServerSnapshot` for `useSyncExternalStore`: the server never has
 * localStorage, so it always renders as "no token yet". */
export function getServerRespondentTokenSnapshot(): null {
  return null;
}

const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

/**
 * `subscribe` for `useSyncExternalStore`. Notifies on tokens created via
 * `ensureRespondentToken` in this tab, and on the `storage` event so a
 * token created by another tab for the same event is picked up here too.
 */
export function subscribeRespondentToken(
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

/**
 * Idempotently creates a respondent token for `publicSlug` if one doesn't
 * already exist yet (persisted or in-memory), and notifies same-tab
 * subscribers. This is a genuine side effect and must be called from a
 * `useEffect`, never from render or a `getSnapshot` — calling it
 * redundantly (every mount, StrictMode's double-invoke, etc.) is safe
 * since it's a no-op once a token exists.
 *
 * Tries to persist to `localStorage` first, so this tab and any other tab
 * open on the same event converge on one shared token (letting presence
 * and ballot uniqueness deduplicate them). If persistence fails, the
 * token instead lives in `memoryFallbackTokens` for the rest of this tab's
 * lifetime, so the tab still reaches a single stable token rather than
 * `getRespondentTokenSnapshot` reading `null` forever.
 */
export function ensureRespondentToken(publicSlug: string): void {
  if (getRespondentTokenSnapshot(publicSlug) !== null) return;

  const token = generateToken();
  const nextPersisted = { ...readPersistedTokenMap(), [publicSlug]: token };
  const raw = JSON.stringify(nextPersisted);
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
    cachedRaw = raw;
    cachedPersistedTokens = nextPersisted;
  } catch {
    memoryFallbackTokens[publicSlug] = token;
  }
  emitChange();
}
