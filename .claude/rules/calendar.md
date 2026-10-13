---
paths:
  - "src/modules/calendar/**"
  - "src/modules/booking/**"
  - "src/lib/calendarEvents.ts"
  - "src/lib/googleCalendar.ts"
  - "src/lib/recurrence.ts"
  - "src/lib/zones.ts"
  - "src/lib/googleDrive.ts"
  - "src/lib/taskEventLink.ts"
---

# Calendar and booking — the grid, the composer, open hours

Loaded when a file this rule's `paths` names is read or edited — it is not
in context on every turn, which is the whole point. The root `CLAUDE.md`
holds what is true everywhere; this holds what is true here.

## Calendar — moving an event to another calendar
`handleMoveEvent` uses Google's `/move` endpoint, which keeps the event's id and
its guest list. Two rules it has to respect, both of which used to fail silently:
- **A connected account's token is never in the browser** — every write to one goes
  through the `google-calendar-write` edge function, `move_event` included
  (`efMoveEvent`). The primary account still uses its own token.
- **Google moves an event between calendars, not between accounts.** Within one
  account it is `/move`; across two the event is written again on the far side and
  the original deleted, behind a confirm naming what that costs (a new id, a new
  organiser, guests carried but not their replies, one occurrence of a series
  becoming a one-off). Each half uses whichever route its own account has. If the
  write fails nothing is deleted; if the delete fails the panel says both copies
  exist. The picker labels a calendar with its account when it is not this one's.
`onMoveCalendar` resolves to `null` on success or to *why not*, and the panel shows
it — the old boolean was discarded and the picker just snapped back.

**A connected account has two ids**, and only one of them works. The browser
mints its own uuid in `professor-connected-accounts` when you connect an
account; `google_accounts.id` is the row's. The edge function looks the account
up by id, so every write sent with the browser's got `403 Account not found or
not owned by user` — reads went through because they use a token, writes did
not. `serverAccountId()` in `googleCalendar.ts` maps one to the other by
address (cached, cleared on `professor:accountsUpdated`), and every `ef*` call
sends `account_email` as well so the function can resolve it either way.

**supabase-js throws the reason away.** Any non-2xx from a function becomes
"Edge Function returned a non-2xx status code"; the body — which names the
calendar, the account, or what Google objected to — is on `error.context`.
`efFailure()` reads it, so a failed write says what happened.

## Calendar — the event panel and the composer are one component
`NewEventPanel` draws both. `existing` is the only difference: absent, it is
composing and there is a Create button; present, it is editing and **every
control writes straight through** (`onPush`), with words held 700ms so a
keystroke is not a request. `EventPopup` — 790 lines of a second design — is
gone, and with it the last of `--sb-ev-type`.
- An occurrence of a series carries no RRULE of its own, so `seriesRules` is
  fetched for one and the Repeats row opens on the right answer.
- What is only true of an event that exists arrives as props: `clashes`,
  `alertMinutes`/`onAlert`, `onAddMeet`, `onMoveCalendar`, `onDelete`, and
  `extra` for prep and "Open in Google Calendar".
- **The provider is read, not asked.** Which conferencing an account uses is
  settled when the account is connected; a "your workspace provider" picker in
  the composer asked you to answer a question the app already knows. The Meet
  button mints the link — on an event that exists, now (`onAddMeet`); on one
  being composed, on create, because there is no event to hang a conference on
  yet.
- **Every row is one line.** Place *and* call share one: both glyphs, then the
  field of whichever you last touched — two fields cannot share a 400px row and
  stay usable, and a glyph stays lit while its side has something in it, so you
  can see there is a place while the link is open. Date, from, to and All day
  are one row, and All day *dims* the times rather than removing them, so
  turning it back off is not starting again. Repeats and Alert are one row each,
  in When, with no rule between them: Alert is a fact about the time, not a
  section of its own. **Every box in the card starts at the card's own left
  edge** — the glyph sits inside the field and there is no label gutter, since
  a label sized to its own word ("Repeats" against "Alert") starts each field
  at a different x and the card reads as rows that have drifted. The value
  carries what the label carried: "Never repeats", not a bare "Never".
- **Ends belongs to Custom.** Choosing a preset after it means the preset, so
  the fields go and what they held goes with them — a stale "after 8 times"
  hanging off a plain Monthly is a rule nobody asked for.
- **A bare click on the grid no longer creates anything.** Drawing a span says
  when it is and how long it runs; a click says neither, and a panel opening
  under every stray click is one you spend the day closing. The two ways in are
  drawing a span and **+ New event** in the header — which is the only one a
  finger has, since touch cannot draw.

## Calendar — both event panels are the task detail panel
`NewEventPanel.tsx` holds the shell and every primitive; `EventPopup` (the panel
for an event that exists) and the composer (for one that does not) are the same
object on screen. `ComposerShell` is that shell: **a cream panel holding white
cards**, the separation between sections being that ground rather than a rule —
eight banded sections in one column do not scan. Its box is **the task detail
panel's**, to the value — bar the width, which is `clamp(289px, 30.6vw, 400px)`
because a shell holding cards carries two more edges than a panel of rows and
needs the room for them: `--sb-r-card`,
`--sb-shadow-control`, `--sb-t-h2` title / `--sb-t-body-s` rows /
`--sb-t-meta` captions, `--sb-h-pill` controls, sections separated by a
hairline. Measured side by side, the two panels differ in nothing but content.
- **Completed and Cancelled are glyphs**, solid in their own colour when set —
  a tint on a 28px circle is not a state you can read. In edit mode they call
  `onStatus`, because the only thing that ever sent `status` was the Create call
  an existing event never makes.
- **A time field has a floor of 84px** and its row wraps rather than crushing
  it. A native time input clips inside its own shadow DOM, so nothing on the
  page reports it — at the narrow end of the clamp they had shrunk to 37px and
  measured as perfectly fine.
- **Docked, never floating.** A modal over the grid hides the one thing you
  need while editing an event. It is a column beside the grid, the way the
  task panel sits beside the board.
- **`maxHeight: 100%`, not a viewport offset.** `calc(100vh - 212px)` did not
  know how tall the calendar's own header was and put the footer 4px below the
  fold. The row has a definite height; this is the row's.
- **The sticky footer keeps the bottom-right corner clear** (`padding-right:
  56px`). The assistant's floating button is fixed to the viewport and sat on
  top of Cancel.
- **One listener decides dismissal, with a 400ms guard.** A touch screen
  replays a tap as a synthetic `mousedown` a moment after `pointerup`, at
  coordinates that are by definition outside a panel which did not exist when
  the finger went down — so an `onMouseDown` on anything outside opened and
  closed the composer in one gesture on an iPad.
- **The radii are theme tokens.** The spec's 28 / 22 / 14 are exactly Glass &
  Depth's `--sb-r-frame` / `-card` / `-nav`, so following the tokens draws Glass
  to the spec and gives the other three their own corners (Warm 8/6,
  Evergreen 16/10).
- **`--sb-ev-type` has a default of 1 in `index.css`.** It used to be set only
  as an inline style on the old narrow panel, so any of that panel's text drawn
  outside it had an invalid `calc()` — text that is simply not drawn.
- The detail panel is no longer `zoom: 0.75` in a 240–330px column, and
  nothing multiplies its type: `EV_SCALE`, `EV_TYPE`, `EV_PANEL_W`, `EvPanel`
  and every `--sb-ev-type` reference are gone. Every capability stays — write-through edits, place lookup, clash "move
  clear", alerts, series RRULE, move-to-calendar, prep, attendees, delete.

It is a **pre-answered form**: everything arrives with an answer in it, so the
work is editing rather than filling.
- **A cream shell holding white cards** (680px, radius 28, padding `24px 22px 22px`,
  gap 14; cards radius 22, padding `18px 20px`). The separation between cards is
  that ground, not a border.
- **`cal-compose-memory`** remembers the length you usually give this, the venue
  and the kind, so the next one opens with them. The WHEN line says which it used
  — "your usual for this" or "as drawn".
- **The spec is written in hexes and every one is a Sunlit Bento token**; the `C`
  object at the top maps them, and mixes the three with no exact token.
- Repeats carry an **Ends**: a date, `After N times` (the N is an input in the
  pill), or Never — `Recur.count` → `COUNT=` in `recurrence.ts`, which `UNTIL`
  excludes. Attendees can be made **optional** (Google's own `optional` flag).
  Completed / Cancelled in the header set the status the moment the event has an id.
- **Attachments upload.** A calendar attachment is a Drive file and nothing else,
  so a drop or the Upload pill goes through `uploadToDrive()` (`googleDrive.ts`,
  multipart, `drive.file` scope — the narrowest that lets a file in) and the
  event's `attachments` then points at it. Every calendar write sends
  `supportsAttachments=true` — the primary paths, the token paths, and the
  edge function — because without it Google drops the field silently. In edit
  mode each upload or removal pushes the whole list; composing carries them on
  Create. A token minted before the scope was asked for gets a 403 and the row
  says to sign in again. Sharing the file with guests is Drive's decision, and
  Google Calendar asks about it itself.

## Calendar — overlap, and the hex that came back with it
The week view's stacking is a **connected component split into greedy columns**:
events that start together sit side by side, one that starts later inside
another cascades over it. A cascaded card needs `zIndex` of
`(level * 3) + lane` — `lane` alone puts a card under the one it overlaps — and
the 3px spacer that separates it from the card beneath is
**`var(--sb-card)`, never `#FFFFFF`**: it stands in for the grid's own surface,
which is white in the three light themes and a dark wash in Glass, where a hard
white line is the one thing that cannot be there. The rail is resizable
(`--cal-rail-w`) *and* the booking panel takes its column — `data-panel` reads
`selectedEvent || newEventDraft || showBooking`, since the divider and the panel
are not alternatives.
- **This file is where two sessions meet**, and both times the conflict was a
  behaviour change and a colour in one line. A merge that takes one side whole
  loses the other: the overlap work arrived carrying `#FFFFFF` a week after the
  54 hexes in this same file had been converted, and the ink audit is the only
  thing that would have said so. Re-run it after any merge that touches here —
  `npm run build` is blind to a colour that is simply wrong.

## Calendar — dragging an event
`CalendarIntelligence.tsx` moves events with dnd-kit and a `DragOverlay`. The
overlay is what follows the pointer, so the source card must **not** take
`transform` from `useDraggable`. dnd-kit's transform carries a scale reconciling
the source's rect with the overlay's fixed 130px box — applied to a card sized in
percent and pixels it came out as `scaleY(24)`, stretching it into a streak down
its own column. The card stays where the event is, dimmed to 0.35, and the overlay
does the moving. Resizing needs no live transform either: it is worked out from
`delta` in `handleDragEnd`.

## Calendar — a meeting that is done asks what came out of it
`MeetingOutcome.tsx`, opened by `toggleStatus` — the one funnel every door to
"done" already went through (the tick on the block, the context menu, the
panel's own glyph). Marking an event done recorded nothing about what was
agreed in it.
- **The event is done before anything is asked.** Not a gate: the status is
  written first and the prompt opens after, so closing it costs the outputs
  nobody typed and never the tick. `DeliverablePrompt` made the other mistake
  once already.
- **A line is a task, with no model involved.** `MeetingFollowUpPopup` — the
  one popup that already asked this, for a *task* of a meeting kind — could
  only reach its editable rows through `breakdownMeetingNotes`, so with no AI
  key there was no way to write down a single follow-up: the extractor was the
  only door to the form. Here the lines you type **are** the tasks, and reading
  prose is an accelerator beside that which can fail without taking the form.
- **An unanswered box is `placementForNew`'s answer**, and moves as the row is
  filled in — a P0 due tomorrow lands in Do — so the pill always shows where
  the task will go. `suggestPlacement`/`placementForNew` were widened to a
  `Placeable` of the four fields they read, rather than a second copy here.
- Tasks are filed to the company that owns the meeting's calendar, link back to
  the meeting, and **never take its `gcalEventId`**: that field means "the event
  this task made", and writing it here would hand a task the meeting's hour —
  ticking either would then finish the other.
- **The next meeting is one of the actions**, handed to the calendar's own
  composer seeded with this meeting's people, calendar and place, a week on at
  the same hour. `NewEventPanel` gained a `seed` prop, read only while
  composing; no replies and no Meet link travel, because nobody has said yes to
  a meeting that does not exist and a conference belongs to the event it was
  minted for.
Two guards came out of measuring it, each with its own control:
- **`ComposerShell` no longer treats a dialog over it as "outside".** Every
  pointerdown in the prompt closed the event panel underneath and took the
  selected event with it — the Budget drill-down's fault, one module along.
- **Delete/Backspace stands aside while a dialog is open.** A pill is not a
  text field, so one Backspace after picking a box **deleted the meeting from
  Google**; the control sends a real DELETE.
`scripts/meeting-outcome-becomes-tasks.mjs [tasks|dismiss|followup|keys]` — 65
assertions. Control: the tick writes the status and asks nothing.
- **There were two of these for a while.** A parallel session built
  `MeetingOutcomesModal.tsx` — task drafts with a due date and a priority, a
  company off the calendar, everything filed to Schedule, and its own little
  form for the follow-up event — and wired it at each of the three call sites
  that mark an event done. Merged, one tick opened **two** dialogs. The modal
  is gone, kept by hand are none of its parts: `toggleStatus` was already the
  funnel all three of those call sites went through, which is why asking there
  covers the doors nobody has thought of yet.

## Booking — letting somebody outside put an hour on the calendar
Two things, kept apart because they answer different questions. **Meeting
plans** (`meeting_plans`) are the predefined calls an outsider picks from —
each with its own length, buffers, notice and target calendar. **Open hours**
(`booking_windows`) are the hours you are willing to be booked in, and
**nothing is open until you draw it**. What is offered is the intersection:
the hours you opened, minus everything on the calendars the plan names, minus
buffers and notice. An open hour that stops being free stops being offered.
- **The anon key is in a public bundle, so the client cannot be the boundary.**
  `20260024_booking.sql` gives the booking tables no policy for anybody but
  their owner — gated on the `calendar` module — and the `book-me` edge
  function with the service role is the entire public surface. Verified on a
  throwaway Postgres: an anon role reads nothing, another account sees none of
  it, and `booking_hits` has no policy at all.
- **The slot index is the race guard, not the application code.**
  `unique (user_id, start_at) where status <> 'cancelled'`, keyed on the
  *owner* rather than the plan — two plans must not sell one hour twice — and a
  cancellation frees it. Control: with the index dropped, 11:00 sells to two
  people.
- **A window is a wall clock; busy time is instants.** 09:00 Cairo stays 09:00
  across a summer-time change while the instant under it moves, so each
  occurrence is converted at the offset in force on *its own* day. Control: a
  fixed offset gets 4 of 7 weeks wrong, in both directions. `_shared/slots.ts`
  is pure (no Deno), so the test runs the real module, in five zones.
- **A diary it could not read is never answered as an empty one.** `freeBusy`
  returns `{busy, failed}` and any failure refuses the whole answer — the gap
  is exactly where the meeting it could not see is sitting. The page says "the
  diary cannot be read just now" rather than showing a stranger an empty month.
- **`/freeBusy`, not `events.list`:** one request per account instead of one
  per calendar, and **no title ever leaves Google** — the right default for an
  endpoint answering the public. The cost is that an event you declined, or one
  marked cancelled in this app (that status is localStorage), still counts as
  busy.
- **Nothing the client says about *when* is trusted.** Every write recomputes
  the offer from the windows and the live diary; a 409 carries the fresh list,
  because "that one has just gone" is only useful beside what is still there.
- **The public page never mounts the app.** The branch is in `main.tsx`, not
  beside the sign-in gate: React runs every hook before the first `return`, so
  a check inside `App` would already have fired the auth listener, `hydrate()`
  and every store load on behalf of somebody with no account. `?book=<handle>`
  is the only deep link that survives a hard load — there is no router and
  Pages has no SPA fallback. Measured: **not one `/rest/v1` read** from a
  stranger's browser. Control: before the branch, that URL is the sign-in
  screen.
- **The same drag means two things**, so which one is in force is on screen the
  whole time: a strip above the grid while marking, and bands in the positive
  tint behind the events. Control: out of the mode the identical drag opens the
  composer and writes no window; in it, it writes a window and nothing reaches
  Google.
- **A window you draw may repeat**, and that is the only way anything recurs —
  there is no invisible default pattern, so a week you never touched offers
  exactly what you put there. One occurrence is taken back with a `skips` date
  rather than an overrides table; changing one occurrence's hours is a skip
  plus a one-off window.
- **Times are shown on the visitor's clock**, with a zone picker built from
  `Intl.supportedValuesOf('timeZone')` — never a hard-coded three, the mistake
  the shopping currency list made. `zoneOffset` is rounded to whole minutes for
  display, or the label reads `GMT+01:59.99695`.
- **Two failures, two variables.** "The page could not read the diary" replaces
  the picker; "that time has just gone" must leave it standing — sharing one
  variable meant the message asking you to pick again took away the thing you
  would pick from.
- Google sends the invitations (`sendUpdates=all`), so there is no mail service
  and no new secret. A booking the calendar refuses is deleted again rather
  than left as a row nobody can see; a cancellation that Google refuses does
  **not** mark the row cancelled, because a row that says cancelled beside an
  event still sitting on your morning is the one state nobody can act on.
- `book-me` is in `deploy-functions.yml` with `--no-verify-jwt`. Function names
  there are hand-written, not globbed — which is how `health-ingest`,
  `professor-mcp` and `shopping-price-watch` are still hand-deployed.
`scripts/booking-sql-holds.sh` (23, on a throwaway Postgres 16),
`booking-slots.mjs` (21 × 5 zones, plus `--control`),
`booking-page-is-public.mjs` (37 over four modes),
`booking-hours-draw.mjs` (46 over four modes). The ink audit covers the panel,
the marking mode and the public page — 22 screens, 0 failing pairs in all four
themes.

## Booking — an open hour is a box on the week, and what is booked sits in it
Open hours were drawn **only while marking them**, so leaving the mode made
every one invisible: the single screen that could answer *what am I offering
this week?* showed nothing unless you happened to be editing. They are drawn
always now, as a box with the card's own radius and border in the positive
tint — a container, not an appointment — and the windows are **loaded with the
grid** rather than when the panel opens, or "always drawn" means "drawn once
you have opened the booking panel", which is worse than not drawing them.
- **Out of the mode the box is inert** (`pointerEvents: 'none'`). It lies
  across the column at `left:0 right:0`, so interactive it swallows the drag
  that draws an event over those hours — the one gesture the grid exists for.
  Control: made interactive, `elementFromPoint` answers the box **and the
  composer never opens at all**. In the mode it is clickable, as before.
- **A booking is nested inside the border it was booked into.** `insetFor`
  answers in pixels and rides on `EventLayout.inset`; the lane stays a
  percentage, so the two cannot be one value
  (`calc(${left}% + ${inset}px)`). "Inside" is the event's own minutes within
  the window's, a minute of slack either side — an event that **overruns** the
  window is not nested, because that is not an hour the window offered, and
  that case is what stops "everything is inset" passing. Control: without the
  inset the booking's left edge is the box's own, to the pixel (552 vs 552).
- **The panel lists the windows rather than counting them.** "3 windows open"
  cannot be checked against what you meant to open; a wrong one is only found
  by reading it. Each row carries its hours, whether it repeats, and the next
  date it **actually** falls on — `nextDatesOf` walks the rule and the `skips`
  the way the server does, because "every week from the 14th" does not say
  when it next opens. A row takes the week to that day.

## Booking — an open hour says what it is for, and can be closed from the list
Two gaps in the same feature. The boxes on the week said only "OPEN" — to the
owner, who knows, and to nobody else it ever has to mean anything to; and the
panel listed the windows but the only way to take one away was to switch into
marking mode, find its box on the right week and press **Close these hours**.
- **The box says what it offers, and is dashed.** An event is a solid card; an
  open hour is space still on offer, so the border is dashed (the left rule
  stays solid) and the text is `09:00–17:00` / **Open to book** / *Calls &
  meetings*, with a booking glyph. Lines appear as the box has height for them
  (≥40px, ≥64px) so a 30-minute window keeps its time and glyph. **A button
  centres its content**, so a tall box had its label floating mid-box until it
  was made a top-aligned column. The second line is the same solid
  `--sb-positive-deep` as the first: a fade (`opacity: .85`) on a tint is how a
  pair slips under 4.5.
- **Each row in the panel has a trash, armed by one press and confirmed by a
  second** ("Close?" / "Close every week?"). A repeating window is every week at
  once, a one-off is a single stray click away from gone, and the calendar's own
  popover has no confirm because you opened it on purpose. Moving on disarms it
  (`onBlur`). The calendar owns the list, so `onDeleteWindow={dropWindow}` — the
  same function the popover uses, so there is one delete, not two.
- Two adjacent boxes in a screenshot are usually **two day columns**, not two
  windows in one day; the list is where that is settled.
`scripts/open-hours-are-visible.mjs delete` — 10 assertions: a trash on every
row, one press arms it and sends **nothing**, clicking elsewhere disarms it, the
second press sends exactly one DELETE for that window, its row and its box go
and the other window is untouched. `shows` gained the label and the dashed
border; all five modes pass, and the ink audit reads 0 failing pairs over 22
screens in all four themes.

## Booking — "nothing can be booked here just now" was a plan that was never saved
The owner's panel showed a call; the visitor's page said nothing could be
booked. Both were right. **Add one** pushes a row into *local state* with
`id: ''`, and until Save lands there is no row in `meeting_plans` — while the
card rendered identically to a saved one ("30 min · you approve"). `doProfile`
reads the table (`user_id`, `active`), gets nothing, and the page says its
empty sentence. Two screens disagreeing with nothing to explain it.
- **An unsaved plan says so** — *"Not saved yet — press Save, or nobody can
  book it"*, in the negative ink, in the slot that held the duration.
- **The active switch was the one write that bypassed `save()`**, and its error
  was discarded (`void onSave(...)`), so a refusal was indistinguishable from a
  success. On an unsaved plan it now says to save first; on a saved one it
  reports what came back.
- **The panel asks the public endpoint the visitor asks** (*Check what a
  visitor sees* → `loadPublicProfile`). The owner reads the tables as
  themselves; the stranger reads `book-me` through the service role with its
  own `active` filters, and the two can disagree. A claim about what a stranger
  sees is worth nothing beside a measurement of it, and this panel was the one
  screen that could not make one.
- **The first diagnosis was wrong and the harness is what caught it.**
  `savePlan` branches on `row.id` being falsy to insert, and sends the whole
  object — so it looked certain that `id: ''` reached a
  `uuid primary key default gen_random_uuid()` and was refused. The stub was
  built to **refuse an empty uuid with PostgREST's own 22P02** (the
  `accounts-come-back.mjs` rule: a fake server has to be able to refuse) and
  the insert passed, because the call site already writes
  `id: next.id || undefined`. The theory died on a measurement rather than in
  production.
`scripts/plan-actually-saves.mjs [save|unsaved|visitor|switch]` — 30, the
visitor's own `doProfile` filter asserted against what was stored;
`open-hours-are-visible.mjs [shows|inert|nested|panel]` — 23, each with the
control above. `booking-hours-draw.mjs` re-runs unchanged at 46.

## Calendars — a colleague's calendar is not one of mine
`isMyCalendar` + `myCalendarAddresses` in `lib/calendarEvents.ts`, behind the
planner's **My calendars only** switch. A DX event appeared only with the
filter *off*: DX's own main calendar was falling out along with the colleagues'
shared ones, because nothing downstream could tell them apart.
- **The data was cached and the reader threw it away.**
  `CalendarIntelligence` has always written `primary` and `accessRole` into
  `cal-intel-cals-cache`; `calendarEvents.ts` declared its own narrower
  `CachedCal` — id, summary, colour, account — and dropped both. Everything
  that reads calendars through it, the planner included, was therefore blind to
  whose a calendar is.
- **A person has one main calendar per account**, and inside an account may be
  given other people's. Those are a fact about *access*, not about your day, so
  "my calendars" is `primary` across **every connected account** — not the
  signed-in one's alone, which is exactly the shape the bug had.
- **`accessRole: 'owner'` is not a test for "mine".** Sharing a calendar with
  *Make changes and manage sharing* grants `owner` on somebody else's, so the
  role says what you may do and nothing about whose it is. The **id** is what
  separates them: a person's calendar is their address. So — `primary` wins;
  an id that is an address is that person's unless the address is one of mine;
  a generated `…@group.calendar.google.com` id is mine only if I own it.
- **The case Google cannot answer**: a team calendar *I* created is `owner` on
  a generated id, indistinguishable from a personal one — there is no creator
  field on a calendar. It counts as mine, which is the better default, and
  `cal-intel-hidden` is the way out for the few that should not be.
- **The fallback is already narrower than the filter, and refusing it emptied
  the day.** `fetchVisibleEvents` answers an empty candidate list by calling
  `fetchWeekEvents`, which asks for `primary` and nothing else — the signed-in
  account's own main calendar, mine by definition. This first shipped guarding
  against a leak that cannot happen, and the guard cost every person whose
  `cal-intel-cals-cache` has not been built their whole grid: the filter would
  have been the thing that emptied the day. Caught by the planner's other
  suites dropping from 7 and 8 assertions to 2 — a fixture with no cache is
  exactly that person.
- **Not filtered after the fact — never requested.** The candidate list is
  narrowed *before* the fetch, so nobody else's day is read to draw mine.
- The chip says which set it counted (`3 events (my calendars)`): the same
  number is a different fact on each side of the switch, and a count without
  its set is not one. Both switches are now real `role="switch"` controls with
  names and keyboard handling; neither had either.
Verified in Chromium against a fixture built so the wrong rule cannot pass —
two accounts' own calendars, a colleague's calendar **on which I hold owner**,
a colleague's read-only one, a group calendar I own and a team one I do not:
13 assertions. Mine shows three, and only those three are requested; off shows
six and requests six. The control — the same files before the change — fails
the default, both colleague cases and the team calendar.
