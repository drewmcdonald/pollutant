# Audience Polling App System Design

## 1. Design goals

This design implements the behavior defined in [requirements.md](./requirements.md) for events with up to approximately 250 concurrent audience devices.

The system favors:

- A small number of explicit application states
- Convex transactions for voting invariants
- Reactive queries instead of polling or manual cache invalidation
- Separate public audience and secret host capabilities
- A clean projector surface controlled from a separate host window
- Transactional sharded counters, so result queries never scan an unbounded ballot set

The first version does not introduce authentication, historical event runs, an aggregate component, or a separate presentation remote.

## 2. Application structure

The recommended application stack is:

- Next.js with the App Router
- TypeScript
- Convex React client
- Convex database and functions
- Convex file storage
- `@convex-dev/presence` for approximate live audience presence
- `@convex-dev/sharded-counter` for contention-resistant reactive result counts
- shadcn/Radix primitives for host controls and forms
- A chart implementation rendered from application-owned result data

Convex is the source of truth for event, question, ballot, presentation, and timer state. Browser storage is used only for recoverable local conveniences and anonymous identifiers.

## 3. Routes and capabilities

### 3.1 Local host dashboard — `/`

The dashboard lets a host:

- Enter a question and options, then start the poll or save a draft
- Reopen events remembered by the current browser
- Remove an event from the local list without deleting it
- Copy audience and host links

The dashboard stores this metadata in local storage:

```ts
type RememberedEvent = {
  publicSlug: string;
  hostUrl: string;
  title: string;
  lastOpenedAt: number;
};
```

This list is not authoritative. Clearing it does not affect Convex data, and a bookmarked host URL remains sufficient to reopen an event.

### 3.2 Audience view — `/e/[publicSlug]`

The audience route renders exactly one of these states:

- Event not found
- Welcome or waiting for the host
- Open question before submission
- Open question after submission, including live results
- Closed question with final results
- Event finished

Audience clients do not receive the full question sequence, prior question results, host secrets, or host-only metadata.

### 3.3 Host control room — `/host/[publicSlug]/[hostSecret]`

The private host workspace shows the selected question, live/final results, vote count, Start poll or End voting, and the public voting link and QR code. Drafts open in the shared question editor. Options are collapsed by default; images become available once a draft exists.

Add another question is visible from the homepage and throughout drafting. It saves the current question without starting voting and opens a blank editor only after the save succeeds. The homepage carries this one-time intent to the host route with `?newQuestion=1`, which the host consumes and removes. Present opens the projector separately. Manage poll contains private host-link management, event details, ordering, welcome/finale actions, and resets.

The host secret is a bearer credential. Possession of the URL grants control.

### 3.4 Projector view — `/host/[publicSlug]/[hostSecret]/present`

The projector window renders the current deck state reactively but does not expose interactive event controls.

It displays:

- Welcome slide with QR code and audience URL
- Current question slide and live chart
- Closed-question results when the host navigates backward
- Final winners slide

The projector window does not own navigation or voting keyboard shortcuts. The control room remains the only control surface.

### 3.5 Stable question results — `/host/[publicSlug]/[hostSecret]/results/[questionId]`

This host-only route displays the final or current results for one question. It is independent of the deck's current position and does not mutate presentation state.

## 4. Interaction flows

### 4.1 Create a poll

1. The host enters a question and options on the homepage.
2. The client generates a strong random host secret.
3. `polls.create` creates the event, question, and choices in one transaction using the existing validated mutations. The event title is derived from the question; only the host secret's digest is stored.
4. Start poll also selects the question and opens voting in that transaction. Save draft leaves the audience waiting. A validation failure rolls back the whole operation.
5. The client remembers the private host URL and opens the workspace with sharing and results.

A public slug and host secret are independently generated. Knowledge of the public slug must not help derive the host secret.

### 4.2 Author a sequence

The control room uses two coordinated views:

- A compact list for adding and reordering questions
- A focused detail panel for editing one question and its choices

`polls.save` saves a question and all active choices atomically, preserving IDs and archival behavior. The editor submits its original active choice IDs so changes to the option set by another host are detected before applying the save. Reordering sends the complete ordered list of affected IDs, and the backend verifies that every ID belongs to the event before assigning contiguous positions.

The same pattern applies to choice ordering within a question.

Removing an unvoted question deletes it. Removing a question with ballots archives it instead: it leaves the active sequence and finale but retains its host-only stable results until the event is reset.

### 4.3 Start the presentation

1. The host opens the projector window.
2. The projector subscribes to the host-authorized deck query.
3. The projector displays the current question; multi-question events can show a welcome slide from Manage poll.
4. Audience devices opening the QR URL enter the event's presence room.
5. The projector shows the approximate connected count.

### 4.4 Open a question

1. The host chooses Start poll, or explicitly Reopen poll for a closed question.
2. `polls.start` validates the saved question, closes any previously open question, opens the chosen question, and selects its slide in one transaction. Starting from the editor uses `polls.save` to include the unsaved edits.
3. Audience clients reactively receive the question. If configured, clients derive the timer from the authoritative opening timestamp and duration.
4. Saving an already-live question validates its options without restarting its countdown.

### 4.5 Submit a ballot

1. The audience client validates the number of selected choices.
2. It submits the event slug, event-scoped respondent token, question ID, and selected choice IDs.
3. The mutation revalidates every ballot rule in one transaction.
4. The mutation checks for an existing ballot through the uniqueness index.
5. If none exists, it inserts the immutable ballot and increments generation-scoped sharded counters for the ballot total and selected choices.
6. The ballot and every counter update commit atomically.
7. Reactive results update for the audience, host, projector, and stable result page without scanning ballots.

Client validation improves usability; the mutation is authoritative.

### 4.6 Close and advance

1. At timer zero, the control room prompts the host to close voting but makes no state change.
2. The host closes voting explicitly.
3. The backend clears the event's open question and records the question's closed timestamp.
4. Audience devices continue to see final results for the current question; the voting form is removed. Late arrivals see the same final results.
5. The projector continues to show the final chart until the host advances.
6. The host starts another question or finishes the event from Manage poll.

Navigating to a closed question never reopens it. Reopening uses a separate explicit mutation.

### 4.7 Reset an event

1. The host confirms a destructive reset.
2. A mutation increments the event generation and returns the deck to the welcome slide.
3. Open-question and timer state are cleared immediately.
4. New audience presence uses a room key containing the new generation.
5. New ballots are written under the new generation.
6. New counter keys are also scoped to the new generation.
7. Old ballots and counters are inaccessible to current queries as soon as the generation changes.
8. Old ballots and counters are cleared asynchronously in bounded batches.

The reset is immediate from the product's perspective even when physical deletion finishes shortly afterward.

## 5. Presentation state model

### 5.1 Event deck position

```ts
type CurrentSlide =
  | { kind: "welcome" }
  | { kind: "question"; questionId: Id<"questions"> }
  | { kind: "finale" };
```

The event stores the current slide separately from voting state.

### 5.2 Question voting state

A question's effective state is derived as follows:

```ts
function votingState(event, question): "ready" | "open" | "closed" {
  if (event.openQuestionId === question._id) return "open";
  if (question.closedGeneration === event.generation) return "closed";
  return "ready";
}
```

This avoids maintaining two competing declarations of which question is open.

### 5.3 Invariants

Every host mutation preserves these invariants:

1. An event has zero or one open question.
2. An open question belongs to that event.
3. Opening one question closes any previously open question.
4. Changing slides does not implicitly open or close voting.
5. Timer expiration does not mutate persisted voting state.
6. Only an explicitly open question accepts ballots.
7. Reset changes the active generation atomically.
8. Archived questions cannot become the current slide or open question.

## 6. Timer model

Questions store an optional duration in seconds. Events store the timestamp at which the current question was opened.

```ts
remainingMs = Math.max(
  0,
  openedAt + countdownSeconds * 1000 - estimatedServerNow,
);
```

Clients render a local countdown from this shared timestamp. They do not write once per second.

The UI at zero changes to an expired presentation state, but the server continues to accept ballots while `openQuestionId` still identifies the question. This intentionally implements an advisory timer.

Opening or reopening a question creates a fresh `openedAt`. Closing it clears the event-level opening timestamp.

## 7. Data model

Field names below describe the intended schema. Every table read path requires the corresponding Convex index.

### 7.1 `events`

```ts
type Event = {
  title: string;
  description?: string;
  publicSlug: string;
  hostSecretHash: string;
  generation: number;
  currentSlide: CurrentSlide;
  openQuestionId?: Id<"questions">;
  votingOpenedAt?: number;
};
```

Indexes:

- `by_public_slug` on `publicSlug`

`publicSlug` is unique by generation-time collision checking. Host-secret verification uses the event found through the public slug.

### 7.2 `questions`

```ts
type Question = {
  eventId: Id<"events">;
  position: number;
  prompt: string;
  imageId?: Id<"_storage">;
  minSelections: number;
  maxSelections: number;
  countdownSeconds?: number;
  responseGeneration: number;
  closedGeneration?: number;
  closedAt?: number;
  archivedAt?: number;
};
```

Indexes:

- `by_event_archived_and_position` on `eventId`, `archivedAt`, `position`

Validation rules:

- Prompt is non-empty after trimming.
- `minSelections >= 1`.
- `maxSelections >= minSelections`.
- `maxSelections` does not exceed the number of active choices when voting is opened.
- Countdown is absent or within the supported positive range.

Question state is scoped to the current event generation. Incrementing the generation therefore returns previously closed questions to `ready` without rewriting every question. Archived questions are excluded from the active sequence and finale but retain their stable host-only result pages until reset removes the associated ballots.

`responseGeneration` is independent of the event generation. Resetting one question increments this value atomically, immediately hiding that question's previous ballots and tallies without deleting an unbounded set in the reset mutation.

### 7.3 `choices`

```ts
type Choice = {
  questionId: Id<"questions">;
  position: number;
  label: string;
  imageId?: Id<"_storage">;
  archivedAt?: number;
};
```

Indexes:

- `by_question_and_position` on `questionId`, `position`

A choice with ballot references is archived instead of deleted. An unreferenced choice may be deleted permanently.

### 7.4 `ballots`

```ts
type Ballot = {
  eventId: Id<"events">;
  eventGeneration: number;
  questionId: Id<"questions">;
  responseGeneration: number;
  respondentToken: string;
  selectedChoiceIds: Array<Id<"choices">>;
};
```

Indexes:

- `by_question_response_and_respondent` on `eventId`, `eventGeneration`, `questionId`, `responseGeneration`, `respondentToken`
- `by_question_response` on `eventId`, `eventGeneration`, `questionId`, `responseGeneration`
- `by_event_generation` on `eventId`, `eventGeneration` for bounded event-reset cleanup

The submit mutation queries the full uniqueness key and inserts only when no ballot exists. Convex transactions and optimistic concurrency control prevent concurrent duplicate insertion.

Ballots are the immutable record used to recover the current browser's submitted choices. Result queries do not enumerate them.

### 7.5 Sharded result counters

Result counts use [`@convex-dev/sharded-counter`](https://github.com/get-convex/sharded-counter), configured with 16 shards per key. Counter keys include every scope that can invalidate prior responses:

```ts
type CounterScope = {
  eventId: Id<"events">;
  eventGeneration: number;
  questionId: Id<"questions">;
  responseGeneration: number;
};

ballotCounterKey(scope);
choiceCounterKey(scope, choiceId);
```

The key encoder must be centralized and collision-safe. The ballot mutation increments the ballot counter once and each selected choice counter once in the same mutation that inserts the ballot.

The component owns counter shards and their concurrency behavior. Application code does not create or conditionally insert tally rows, avoiding both hot single-document totals and duplicate first-write initialization races. Exact reactive reads use `count`; estimated counts are not used for displayed results.

Counter keys from obsolete event or question generations become unreachable immediately. Internal cleanup resets obsolete keys in bounded groups; it never reads or resets every event counter in one mutation.

### 7.6 Presence

Presence is partitioned by a room key derived from:

```ts
`${eventId}:${generation}`;
```

The event-scoped respondent token is used as the audience identity within that room. Host and projector clients do not join the audience room.

## 8. Anonymous respondent identity

Each audience browser maintains a separate random token for each event.

Recommended local-storage shape:

```ts
type RespondentTokens = Record<string, string>; // publicSlug -> random token
```

Properties:

- Generated with a cryptographically secure browser API
- Stable across reloads for that event
- Not shared across events
- Reused by multiple tabs for presence deduplication and ballot uniqueness
- Not treated as authentication or personally identifying information

A reset changes the server-side event generation, so the same browser token may submit again in the new run without rewriting browser storage.

## 9. Authorization model

### 9.1 Public audience functions

Audience functions receive a public slug and return only the minimum data needed for the current audience state.

They must never return:

- Host-secret hashes
- Full question sequences
- Prior question results
- Host-only edit metadata
- Storage IDs when a resolved image URL is sufficient

### 9.2 Host functions

Every host query and mutation receives:

- Public slug
- Raw host secret

A shared server helper:

1. Loads the event by public slug.
2. Hashes the supplied host secret.
3. Compares it to the stored digest without exposing the stored value.
4. Returns the authorized event or a structured authorization error.

The URL itself is the credential. The app should avoid third-party scripts on host routes and should use a restrictive referrer policy so the host URL is not leaked through outbound requests.

### 9.3 Error contract

Expected failures use structured error codes, including:

- `EVENT_NOT_FOUND`
- `HOST_ACCESS_DENIED`
- `QUESTION_NOT_FOUND`
- `QUESTION_NOT_OPEN`
- `ALREADY_VOTED`
- `INVALID_SELECTION_COUNT`
- `INVALID_CHOICE`
- `CHOICE_ARCHIVED`
- `STALE_EVENT_GENERATION`
- `INVALID_REORDER`

Clients branch on codes rather than matching human-readable error strings.

## 10. Convex function boundaries

Function names are organized around user operations rather than generic CRUD endpoints.

### 10.1 Events

- `polls.create` — atomically create a poll and optionally start it
- `polls.save` — atomically save a question with all active options, attach uploaded images, and optionally start it
- `polls.start` — select a saved question and open voting together
- `events.create` — create an event from a client-generated host secret
- `events.getHostWorkspace` — return host-authorized event settings and sequence summary
- `events.updateDetails` — update title and description
- `events.reset` — increment generation and reset live state
- `events.cleanupPreviousGeneration` — internal bounded cleanup of ballots and obsolete counter keys

### 10.2 Questions and choices

- `questions.create`
- `questions.update`
- `questions.removeOrArchive`
- `questions.reorder`
- `questions.resetResponses` — close the question, increment its response generation, clear current-generation closure state, and schedule bounded cleanup
- `questions.cleanupPreviousResponses` — internal bounded cleanup of obsolete ballots and counter keys
- `choices.create`
- `choices.update`
- `choices.removeOrArchive`
- `choices.reorder`

Each function verifies host access and entity ownership. Passing a valid question ID from another event must never authorize cross-event reads or writes.

### 10.3 Presentation control

- `presentation.getDeck` — host-authorized reactive deck data
- `presentation.setSlide` — change deck position only
- `presentation.openVoting` — atomically close any prior question and open the selected question
- `presentation.closeVoting` — close the current question
- `presentation.getQuestionResults` — stable host-only result shape
- `presentation.getFinalePage` — a bounded page of question winners in sequence

### 10.4 Audience

- `audience.getCurrentState` — current public audience state and live current-question results
- `ballots.submit` — validate and insert one immutable ballot

The audience state query returns a discriminated union so the UI handles every state explicitly:

```ts
type AudienceState =
  | { kind: "notFound" }
  | { kind: "waiting"; eventTitle: string }
  | {
      kind: "question";
      question: AudienceQuestion;
      existingBallot?: SubmittedBallot;
    }
  | { kind: "finished"; eventTitle: string };
```

An audience question includes `votingState: "open" | "closed"`; `votingOpenedAt` is optional and only supplied while open. A ready question remains private.

The respondent token may be supplied to identify an existing ballot on the current question. The query returns that browser's submitted selection but never another respondent's token or ballot.

### 10.5 Images

- `images.generateUploadUrl` — host-authorized upload URL generation
- Question and choice update mutations attach returned storage IDs
- Replaced or removed files are scheduled for deletion only after verifying they are no longer referenced

Storage URLs are resolved during reads and are never persisted in application tables. The editor previews selected files locally and uploads them on save. Image IDs are attached in the same transaction as the question and options, before opening voting. On the homepage, image uploads first create a private event for host-authorized upload URLs; failed uploads retain that event for retry. Switching question tabs saves the draft without changing the presented question or opening voting.

## 11. Result calculation

For one question, the server:

1. Loads choices in display order.
2. Reads the exact generation-scoped ballot counter.
3. Reads the exact generation-scoped counter for each choice.
4. Treats an absent counter key as zero.
5. Calculates percentages using the ballot counter as the denominator.
6. Marks every choice tied at the maximum positive count as a winner.
7. Returns no winners when the ballot count is zero.

```ts
type ChoiceResult = {
  choiceId: Id<"choices">;
  label: string;
  imageUrl: string | null;
  archived: boolean;
  selections: number;
  respondentPercentage: number;
  winner: boolean;
};

type QuestionResults = {
  questionId: Id<"questions">;
  prompt: string;
  imageUrl: string | null;
  ballotCount: number;
  votingState: "ready" | "open" | "closed";
  choices: ChoiceResult[];
};
```

Percentages may sum above 100 for multiple-choice questions. The UI labels them as “percent of respondents.”

The finale is paginated at no more than 10 questions per query. The projector accumulates the bounded pages needed for the active sequence rather than asking one Convex function to read every counter for a maximum-sized event. The enforced 20-choice limit bounds each question's counter reads.

## 12. Reactive subscriptions

The intended subscription pattern is:

- Audience tab: one `audience.getCurrentState` subscription plus presence
- Control room: one host workspace/deck subscription plus presence count
- Projector: one `presentation.getDeck` subscription plus bounded finale-page subscriptions while showing the finale
- Stable result page: one `presentation.getQuestionResults` subscription

Mutations update Convex data; affected subscriptions rerun automatically. The application does not add interval-based result polling, refetch buttons, or manual cache invalidation.

The only client interval is visual timer rendering from an authoritative timestamp; it performs no network request.

## 13. Authoring validation

A question may be saved while incomplete, but it cannot be opened for voting unless:

- Its prompt is non-empty.
- It has at least two active choices.
- Every active choice has a non-empty label or an image.
- Selection limits are valid for the active choice count.
- Its configured countdown is valid.

This lets hosts draft questions incrementally without allowing an invalid ballot contract to go live.

## 14. Discoverability controls

All pages use conservative indexing controls:

- Global `robots.txt` disallows crawling.
- Audience, host, and result pages emit `noindex, nofollow, noarchive`.
- Host pages set a restrictive referrer policy.
- No sitemap contains event routes.
- No public endpoint lists events.
- Public slugs are random and non-sequential.
- Host secrets have materially more entropy than public slugs.

These are discovery deterrents, not security guarantees.

## 15. UI behavior and resilience

### Audience

- Mobile-first layout
- Large touch targets
- Selection count guidance such as “Choose 2–3”
- Submit disabled until minimum selections are met
- Duplicate response converted into a stable submitted state rather than a generic failure
- Reconnecting devices recover their current state from Convex and local token storage

### Control room

- Compact ordered sequence on the left or top
- Focused question editor in the main panel
- Persistent live controls separated visually from destructive editing controls
- Explicit confirmation for reset and destructive archival
- Clear distinction between slide position, voting status, and timer state

### Projector

- High-contrast typography and chart colors
- Layouts that remain legible at distance
- No host secret, controls, or internal identifiers rendered in the visible content
- A deterministic empty-results state
- Graceful image placeholders without broken-image icons

## 16. Scale and operational boundaries

The first version targets approximately 250 concurrent audience devices per event.

At this scale:

- Ballot submission updates sharded ballot and selected-choice counters transactionally.
- Result queries read exact sharded counters, never cumulative ballots.
- Finale data is requested in pages of at most 10 questions so maximum-size decks remain within per-query read limits.
- Reordering all questions or choices in one mutation remains bounded.
- Presence should use the existing component instead of a custom heartbeat table.
- Event and question resets switch generations immediately; ballot and counter cleanup is always batched.
- An event is limited to 100 active questions and a question to 20 active choices. Creation mutations enforce these limits, and list queries use `.take(limit + 1)` rather than an unbounded `.collect()`.

If measured usage grows materially beyond this target, the first review points are:

- Shard-count tuning if observed write contention or read amplification becomes material
- Result payload and read counts
- Presence update volume
- Large final-slide query size
- Bounded image and cleanup operations

## 17. Design acceptance criteria

The design is internally complete when implementation can satisfy all of these without adding another product decision:

1. Public and host capabilities are represented by distinct random values.
2. The control room can drive a separate read-only projector window.
3. The sequence editor provides both list and focused detail views.
4. A respondent identity is isolated per event.
5. Exactly one question per event can accept ballots.
6. Duplicate ballots are prevented transactionally.
7. Slide navigation cannot accidentally reopen voting.
8. Timer zero cannot silently close voting.
9. Every result surface uses one shared calculation contract.
10. Reset makes old responses immediately invisible without an unbounded mutation.
11. Audience queries cannot enumerate the event sequence or historical results.
12. Presence remains approximate and independent of ballot eligibility.
13. Result queries are bounded by enforced question and choice limits, never cumulative voter count.
14. Resetting one question is generation-based and never synchronously deletes all of its ballots.
