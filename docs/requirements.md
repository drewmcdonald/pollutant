# Audience Polling App Requirements

## 1. Product model

The default experience starts with **one poll**: enter a question and at least two options, choose **Start poll**, then share its voting link or QR code. No event title or presentation setup is required. **Save draft** keeps a poll private until it is started.

An event remains the underlying container. Its initial title comes from the question. Hosts can add more questions later and optionally use the projector.

Each event contains:

- An event title
- An optional description
- An ordered sequence of questions
- A public audience URL
- A separate secret host URL
- One live presentation state
- One set of responses for the current run

The app supports multiple independently saved events. “Only one question at a time” means **one active question per event**; separate events may run concurrently.

An event supports up to 100 active questions. This is a deliberate operational bound, not a recommended presentation length.

## 2. Question model

Each question has:

- Prompt
- Optional question image
- Two or more answer choices
- Optional image for each choice
- Configurable minimum selections
- Configurable maximum selections
- Optional countdown duration
- Position within the event sequence

A single-choice question uses:

- Minimum selections: 1
- Maximum selections: 1

A multiple-choice question may use any valid minimum and maximum within its available choices.

A question supports up to 20 active choices. Archived choices do not count against that authoring limit.

## 3. Host administration

Anyone possessing an event’s secret host URL may administer it. No account or password is required.

The host can:

- Create an event
- Edit its title and description
- Add, edit, archive, and reorder questions
- Add, edit, archive, and reorder choices
- Configure selection limits under Options
- Configure countdown durations under Options
- Upload, replace, and remove images
- Preview questions
- Start the presentation
- Open and close voting
- Move forward or backward through the deck
- Explicitly reopen a closed question
- Reset one question’s responses
- Reset the entire event for reuse

The host is allowed to edit questions and choices after votes have been received. Existing ballots retain references to the choices originally selected, meaning changing a choice’s text or image also changes how those existing votes are presented.

### Host workspace

- One editor saves the question and all active options together; options have no separate save buttons.
- Start poll also selects the question for presentation and opens voting in the same transaction.
- Single-answer voting and no timer are the defaults. Multiple-answer limits, countdowns, ordering, and the question image live under Options. Each answer always has an image picker to the left of its text input, including before the first save.
- The live screen includes results, vote count, the public voting link, QR code, and End voting.
- Prominent numbered question tabs show the selected question. Switching tabs while editing saves the current text and images before opening the selected editor; a failed save keeps the current draft in place.
- Add another question is available on the homepage and while editing. It saves the current draft without starting voting, then opens a fresh question editor. Present opens the optional projector.
- Private host links, event details, presentation controls, and resets live under Manage poll.
- Editing choices preserves existing IDs and votes. A stale editor cannot silently remove options another host has added.

### Archival behavior

A choice with existing votes is archived rather than permanently deleted:

- It is excluded from future ballots.
- Its historical selections remain intact.
- It remains visible in results.
- It remains eligible to be a winner.
- It may still be edited by the host.

Changing selection limits does not invalidate ballots that were already accepted.

## 4. Local host dashboard

Because there are no accounts, the app provides a browser-local host dashboard.

The dashboard:

- Remembers events created or opened in that browser
- Stores the corresponding secret host links locally
- Allows the host to return to those events
- Allows locally remembered events to be removed from the dashboard without deleting them

The dashboard is only a convenience index:

- Clearing browser storage removes its remembered event list.
- Bookmarked secret host URLs continue to work.
- A host may share a secret host URL with a co-presenter.
- There is no global event-recovery or account-based ownership system.

## 5. Presentation deck

The host-facing presentation behaves like a slideshow:

1. **Welcome slide**
   - Event title
   - QR code
   - Short audience URL
   - Approximate currently connected audience count

2. **One slide per question**
   - Question prompt and optional image
   - Choices and optional choice images
   - Live response count
   - Live bar chart
   - Countdown when configured
   - Voting status

3. **Final winners slide**
   - Every question in sequence
   - Its winning choice or choices
   - Associated question and choice imagery
   - Final counts and percentages
   - A “No responses” state where applicable

Every question has a stable, host-only results URL and remains part of the event’s ordered deck.

## 6. Question lifecycle

Each question can be:

- **Ready:** selected but not accepting votes
- **Open:** accepting votes
- **Closed:** no longer accepting votes

The presentation’s current slide and a question’s voting status are separate pieces of state.

Consequently:

- Navigating backward does not automatically reopen a question.
- Navigating forward does not implicitly accept late votes.
- Reopening a closed question requires an explicit host action.
- Only one question per event may be open at a time.

## 7. Countdown behavior

When the host opens a timed question:

1. The countdown starts.
2. The remaining time is displayed consistently to the host and audience.
3. At zero, the host receives a prominent prompt to close voting.
4. Voting remains open until the host explicitly closes it.
5. The deck does not advance automatically.

The timer is therefore a presentation cue, not a hard deadline.

## 8. Audience experience

Audience members enter through the public event URL or QR code.

The audience experience:

- Requires no account
- Registers the browser as a joined device
- Reactively displays the current open question
- Allows one final ballot submission
- Validates the configured minimum and maximum selections
- Confirms successful submission
- Shows live results for the currently active voting screen
- Automatically moves to the next voting screen when the host advances
- Keeps final results visible for the current closed question, including to late arrivals
- Shows a waiting state for an unstarted question or welcome slide

Audience phones do not follow the complete presentation deck:

- They do not browse previous results.
- They do not access stable question-results pages.
- They do not display the final winners slide.
- Those presentation features remain host-only.

## 9. Ballot integrity

Each browser receives a persistent random respondent token.

A ballot is uniquely identified by:

- Event
- Question
- Respondent token

The backend must atomically enforce at most one submitted ballot for that combination.

A ballot contains one or more selected choice identifiers. Once accepted:

- It cannot be changed.
- A duplicate submission is rejected.
- Simultaneous submissions from multiple tabs cannot create two ballots.
- Client-side validation is repeated by the backend.

This is lightweight abuse prevention, not strong identity enforcement. A person can vote again by using another browser, another device, private browsing, or cleared browser storage.

## 10. Live results

Convex reactive queries provide live updates without application-level polling.

For every choice, the chart shows:

- Number of submitted ballots selecting that choice
- Percentage of respondents selecting that choice

The percentage is:

$$
\frac{\text{ballots selecting the choice}}
     {\text{total submitted ballots for the question}}
\times 100
$$

For multiple-choice questions, percentages may total more than 100%. The UI must communicate this clearly rather than implying a chart-calculation error.

The chart updates while voting remains open and settles on its final values when voting closes.

## 11. Winner calculation

A winner is any non-archived or archived choice tied for the largest number of ballot selections.

Rules:

- A single highest-scoring choice is the winner.
- All tied highest-scoring choices are co-winners.
- Archived choices remain eligible because their votes remain valid.
- A question with no submitted ballots has no winner.
- The final slide displays all co-winners and their associated images.

## 12. Audience connection count

The welcome slide should show approximate currently connected audience devices.

Convex has an existing `@convex-dev/presence` component suited to this, so live presence is reasonable without hand-rolling the full heartbeat lifecycle. Presence remains inherently approximate because browsers can sleep, disconnect abruptly, or delay heartbeats.

The count should:

- Count audience devices, not host/presentation tabs
- Deduplicate tabs using the browser’s respondent token where practical
- Expire inactive devices
- Be labeled as joined or connected, not as a guaranteed attendance total
- Not affect voting eligibility

## 13. Reset and reuse

Resetting an event permanently clears:

- Ballots
- Joined-device state
- Timer state
- Open/closed question state
- Current presentation position

It preserves:

- Event metadata
- Questions
- Choices
- Images
- Question order
- Timer configuration

Previous runs are not retained. If historical results are needed later, that would be a separate product capability.

## 14. Images

Images may be attached to:

- Questions
- Choices

Images use Convex file storage. The database stores durable storage identifiers rather than temporary delivery URLs.

The UI should support:

- Upload progress
- Replacement
- Removal
- Sensible file-size and image-type validation
- A layout that remains usable when only some choices have images

## 15. Access and discoverability

The app is intentionally obscure rather than strongly secured.

Required measures:

- Non-guessable event slugs
- Stronger non-guessable host secrets
- No public event directory
- No sequential public event identifiers
- `noindex, nofollow` metadata
- A restrictive `robots.txt`
- Audience QR codes containing only the public audience URL
- Host credentials never included in audience responses or client-visible audience data
- Host-only results URLs inaccessible without the host secret

These measures reduce accidental discovery and indexing but do not protect against deliberate access by someone who obtains a URL.

## 16. Explicit non-goals

The first version does not require:

- Respondent accounts
- Strong prevention of repeat voting
- Account-based host ownership
- Host-link recovery
- Historical run retention
- Public event discovery
- Free-text answers
- Moderation
- Exports or advanced analytics
- Automatic slide advancement
- Projector control from a separate authenticated remote
- Serious role-based access control
- Guaranteed-exact online presence

## Acceptance criteria

The product requirements are met when a host can:

1. Create an event and arrange single- and multiple-choice questions.
2. Open its welcome slide and display a working audience QR code.
3. See an approximate live connection count.
4. Open exactly one question for voting.
5. Receive one immutable ballot per browser token.
6. Watch counts, respondent percentages, and bars update live.
7. Reach zero on a timer without automatically closing or advancing.
8. Close voting manually.
9. Navigate backward without reopening the question.
10. Advance through every question.
11. Finish on a slide showing all winners and ties.
12. Reset the event and run the same sequence again without retaining prior responses.
