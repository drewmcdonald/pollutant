# pollutant — live event polls

A live audience-polling app: a host runs an event (questions, choices, voting,
a projector view) and an audience joins from a QR code / link to vote in
real time. No accounts — the host and audience are distinguished entirely by
which link you hold.

The app lives at the repository root. Full product and design detail:
[`docs/requirements.md`](./docs/requirements.md) and
[`docs/system-design.md`](./docs/system-design.md).

## Architecture

- **Next.js (App Router) + React 19**, client components fetch/mutate
  directly against Convex via `convex/react` hooks — no separate API layer.
- **Convex** is the backend and source of truth: functions in
  `convex/` (`events`, `questions`, `choices`, `presentation`,
  `audience`, `ballots`, `presence`, `images`) plus shared helpers under
  `convex/lib/` (`auth`, `data`, `counters`, `results`, `errors`).
- **`@convex-dev/presence`** tracks approximate live audience connections;
  **`@convex-dev/sharded-counter`** backs exact, contention-resistant ballot
  and choice tallies so result reads never scan the ballots table.
- **Ballot integrity**: each browser gets a random per-event respondent
  token (`localStorage`); the backend enforces one ballot per
  `(event, question, respondent token)` transactionally.
- **Local host dashboard** (`/`) is a browser-only convenience index
  (`localStorage`) of events this browser has created/opened — clearing it
  never deletes anything server-side, and a bookmarked host link keeps
  working regardless.

## Routes

| Route | Audience | Purpose |
| --- | --- | --- |
| `/` | Host | Dashboard: create an event, reopen/remove remembered events |
| `/e/[publicSlug]` | Public | Audience voting view (join, vote, live results) |
| `/host/[publicSlug]/[hostSecret]` | Host | Control room: author questions/choices, run voting, navigate the deck |
| `/host/[publicSlug]/[hostSecret]/present` | Host | Read-only projector view (welcome QR, live question, finale) for a second screen |
| `/host/[publicSlug]/[hostSecret]/results/[questionId]` | Host | Stable, host-only results for one question, independent of deck position |

## ⚠️ The host secret is a bearer credential

Anyone holding a `/host/[publicSlug]/[hostSecret]` URL has **full control**
of that event — there is no login, and the app never re-checks identity
beyond that URL. Treat it like a password:

- Never share, screenshot, or paste a host link somewhere public.
- Only the `hostSecret`'s SHA-256 digest is stored server-side; it cannot be
  recovered if lost, and there is no account-based recovery.
- The public `/e/[publicSlug]` audience link is safe to share widely — it
  never carries the host secret and grants no control.

## Local setup

```sh
pnpm install
```

Run the backend and frontend in two terminals:

```sh
npx convex dev      # first run: signs in / creates a Convex project and
                     # writes .env.local automatically (gitignored)
pnpm dev             # Next.js dev server
```

Open the URL `pnpm dev` prints (Next picks a free port if the default is
taken) and create an event from the dashboard.

## Verification

Run from the repository root:

```sh
pnpm typecheck         # tsc --noEmit
pnpm lint              # eslint .
npx convex dev --once  # one-shot signed-in push; confirms the backend compiles and deploys
```
