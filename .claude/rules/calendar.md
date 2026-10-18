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
- **A drawn span keeps its end.** `cal-compose-memory`'s usual length applies
  only to a draft with no end of its own (`+ New event`, a seed): the grid sets
  `drawn: true` on the draft, and the panel skips the memory for it. Before, any
  drag opened as one hour once a duration had been remembered.
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

## Calendar — a drawn span keeps the end it was drawn to
`cal-compose-memory`'s usual length applies only to a draft with no end of its
own (`+ New event`, a seed). The grid sets `drawn: true` on the draft and the
panel skips the memory for it; before, any drag opened as one hour once a
duration had been remembered. **Duplicate Event** sets it too — a copy keeps the
event's own hours — and opens the composer through `seed` (title, calendar,
place, notes, guests), without replies or the Meet link.

## Calendar — the outcome window is a box per kind, and every record keeps its thread
`MeetingOutcome.tsx` is one 800px window with a box per kind of output; a box
opens **in place** and shows what is already related to the meeting, with the
tools to tick it, change it or add something new. **No box opens another
panel** — a panel would take the window and the rest of what was being filed.
All five boxes are built — **Tasks**, **Expenses**, **Habits**, **Books** and
**Events** — each on the same `OutcomeBox` shell (`outcome/shared.tsx`, one file per kind beside it).
**Any number of boxes can be open at once**, Tasks to begin with: it was an
accordion at first, which closed the box being worked on to show the next, and
the design draws two open side by side.
- **Everything writes as you go, and each row takes itself back.** The old
  type-lines → review → save form held work in a window that vanished when it
  closed. A tick is `toggleComplete`; an edit is `updateTask`; a new task is
  `addTask`; **Undo** on a row reopens a ticked one, or deletes one made here.
  Closing the window costs nothing, because nothing is waiting in it.
- **The thread is its own list, not a column on four tables**
  (`lib/meetingOutcomes.ts`, key `cal-outcome-links`, a prefSync key). Entry:
  meeting → record, `role: 'made'` (this window created it) or `'touched'` (it
  existed and was ticked or edited here). Both directions are a lookup —
  `linksForEvent`, `linksForRecord`. **A removal is a tombstone** (`gone`),
  because the list is *joined* across devices and a join only adds: an entry
  absent here would come straight back from the other. The later `at` wins.
  Undoing a tick removes the link that tick made; undoing one on a task *made
  here* keeps it, since the task still came from the meeting.
- **"This company's" is two fields.** A company made since the four legacy tags
  is `companyId`; Teradix, DX and the others of the four are the `company` tag
  alone with **no** `companyId` — the server keeps both in `company_tag`. The
  first cut asked only `companyId` and offered **nothing** for the company most
  people have. The harness seeded the server's real snake_case rows (`company_tag`,
  `due_date`) rather than the store's shape, which is what showed it.
- **A row must not change parent when ticked.** Linked rows were drawn first in
  their own array, so a tick moved the row between two lists, React remounted
  it, and focus fell onto `body` — a keyboard user ticked a box and lost their
  place. One list in date order does not move.
- **`gcalEventId` is never the meeting's.** A dated task earns a block of its
  own from App's auto-push and *that* id lands in it; what must not happen is
  the meeting's id there, which would hand the task the meeting's hour so that
  ticking one finished the other. The link to the meeting is `links: [htmlLink]`
  and the ledger.
- **Read my notes offers, never writes.** It reads the event's own description,
  or opens a paste box when there is none, and the action items come back as
  dashed rows inside the Tasks box with **Add** — the extractor failing leaves
  the box exactly as usable. Pasted links still draw `LinkPreviews` cards.
The old section above describes the type-lines-then-review form this replaced;
its script, `meeting-outcome-becomes-tasks.mjs`, is retired.
`scripts/meeting-outcome-hub.mjs [tasks|dismiss|links|followup|keys]` — against
a server serving its real row shape: the company's open task is offered and
**another company's and a finished one are not**; a tick completes it, writes
the link and moves the count, and Undo reopens it and tombstones the link; an
edit inside the row reaches the store and links; a new task carries the company,
date and a note of where it came from and links as `made`, and Undo on it
deletes the task and the link. Controls: the first run, on the code before the
`belongsTo` fix, offered nothing; before the single list, focus was `body`
after a tick.

## Calendar — what a meeting files stays on the meeting's calendar and account
Tasks made in the outcome window used to be `company: 'personal'` unless a company
had claimed the calendar by id, and carried no `calendarId` — so a follow-up to a
meeting on a connected account was scheduled to the default diary.
- **`taskFor` stamps `calendarId`** — only when `cachedCalendar()` says it is
  writable; a read-only calendar would be refused on scheduling.
- **`resolveTaskCalendar` finds the account from the calendar** when the company
  names none (`cachedCalendar` reads `cal-intel-cals-cache`). A company's account
  still wins; before, a task's own `calendarId` on a connected account was written
  with the primary token.
- **`companyForCalendar`** falls back to the one company bound to the calendar's
  account; two on one account stays unanswered rather than guessed.
- **Events box**: a read-only meeting calendar falls back to the main calendar of
  the **same account** first, then any account's.
`scripts/meeting-outcome-lands-on-calendar.mjs [task|ambiguous|readonly|claimed|primary|events]`
— 6 modes against a connected account (`ceo@teradix.com`, its own token) beside the
signed-in one. The task is read off `professor-tasks` and `resolveTaskCalendar` is run in
the page on it; the follow-up event is read off the edge-function body. Control: the same
harness on the code before the fix fails every mode — the task is `personal` on `primary`
with no account, the follow-up goes to `a@x.com`. It does not drive the scheduler's own
write (a dated task's auto-push), only the target every scheduler resolves.

## Calendar — the Expenses box files drafts, behind the lock
`outcome/ExpensesBox.tsx`. Money is the one kind with rules of its own, and each
of them is Finance's, not this window's:
- **An expense made here is an unpaid entry — a draft.** No `paidAt`, not
  cleared, so `unpaid.ts` keeps it out of every balance, envelope and report and
  the feeds draw it dotted. A figure typed into a calendar window is a guess
  about money; **Confirm** is the ledger's own "paid" gesture (`paidAt` = the
  entry's day, or today if that day has not come) and Undo on it makes it a
  draft again. It is written with `upsertTransaction`, which saves and follows
  the year — never the legacy `addTransaction`, which only touches the store.
- **The lock stands.** The budget left and the unpaid bills are exactly what the
  lock exists to hide, and a calendar window would be a way round it. Locked, the
  box says *Locked*, renders **nothing** of the ledger (measured: no payee, no
  amount, no account name) and asks for the same password or device check, in
  place; `useFinanceLock`'s own `unlock` and the `finance:lockChanged` event
  mean the rest of the app agrees.
- **A module that is off is not drawn** (`moduleIsOff('finance')`) and was never
  loaded — the harness asserts the box is absent **and** that no `finance_*`
  table was read.
- **No figure is claimed that cannot be checked.** "N left of M" is said only
  for a plain monthly budget in force that month (`loadRules`, `activeIn`,
  `monthlyAmount`, not `isDated`), counting **settled** entries by `whenPaid`
  across the category and its sub-categories, and only when every one converts
  (`convert` → null for a currency nobody has a rate for). Otherwise nothing: a
  wrong "left" is worse than none. The draft is not in it, so the line moves
  when you confirm, not when you add — the form says so.
- **"Near this day", not "for Teradix".** Entries carry no company, so the
  unpaid bills offered are those dated within a week of the meeting, said as such.
  The account and category open on what was last filed for this company
  (`outcome-expense-memory`, this device only).
- **`MoneyInput` commits the value its parent holds**, not what was typed — a
  row passing a fixed `value` wrote the *old* amount on blur. The row keeps its
  own draft amount. (Found by the harness: `[85]` where `[85, 95]` was meant.)
`scripts/meeting-outcome-expenses.mjs [expenses|lock|off|fx]` — against the
real row shapes (`account_id`, `paid_at`, `tx_type`…): the near unpaid bill is
offered and an old one, a paid one are not; a filed draft reaches the ledger
unpaid with the meeting's day and its origin; confirming writes the payment date
and the envelope goes from 580 left to 60 over, Undo puts it back; an edit
reaches the ledger; Undo on a made entry issues the DELETE. The lock mode is
its own control (the `expenses` run, unlocked, shows all of it), as is `fx`.

## Calendar — the Habits box logs against the meeting's own day
`outcome/HabitsBox.tsx`. A habit counted in the moment is counted; one
remembered at ten at night is guessed. Everything here is the Habits module's:
- **`commitHabitLogs` is the only write path**, and the Habits page reads its
  logs once on mount, so every write here also fires
  `professor:habitLogsUpdated`. A tick is a date in `professor-habit-logs`; a
  measured habit writes its quantity and is **ticked when the goal is met** —
  the same rule as the page's `setQuantity` — and one tap adds `stepFor(habit)`
  (1,000 for steps), never 1.
- **A habit has no meeting on it, so none is invented.** Nothing in a habit says
  it is about meetings, and guessing from a name would be a rule nobody agreed
  to. Every *active* habit is offered for the meeting's day; the ones **logged
  from another meeting before** (the ledger, `kind: 'habit'`) lead and say
  "from meetings". The order depends on that and the habits' own order, never on
  what was just ticked, so a row stays where it was. The fixture makes Stretching
  come first naturally and Networking only by the ledger, or the ordering claim
  would be vacuous.
- **The share leads, the tally supports** (`dayTotals`): "22% of Sat, 17 Oct",
  not "0 of 3" — 5,200 of 8,000 steps beside two unticked habits is a fifth of
  the day. A part-day is never drawn ticked.
- **A change is remembered as it was.** Undo — or flipping the control back by
  hand — restores the first state and takes the link the change made, so the
  meeting never claims a tick that no longer exists. The link is `touched`; only
  a habit **made here** is `made`, and its Undo deletes the habit *and its days*,
  as the page's own delete does.
- **A new habit is a done-or-not or a measured one**, daily/weekdays/weekly, with
  "count this day as done" for the first kind. Not drawn when the plan has no
  Habits (`moduleIsOff('habits')`).
`scripts/meeting-outcome-habits.mjs [habits|off]` — 37 assertions against the
real `habits` / `habit_logs` shapes: the log, the quantity and the goal tick on
localStorage; after the 1.5s debounce the server gets `completed: true` and
`quantity: 8200`; each Undo; a made habit reaching the server and then gone.

## Calendar — the Books box logs a sitting, because progress is derived
`outcome/BooksBox.tsx`. The Library's rules, not this window's:
- **Two switches, either turns it off** (`libraryIsOff()`: the plan and Settings →
  Library); an off Library is not drawn and nothing of it is read. While the shelf
  loads the box says "Fetching your library…", never "no books".
- **Logging pages is a reading session.** Progress is the furthest page any session
  reached and is never stored on the book, so **Undo is deleting that session** and
  nothing else needs putting back. A sitting needs minutes (the table refuses
  without), so the form carries them, **pre-answered with the length of the last
  sitting**; the day is the meeting's, capped at today. A page past the end is refused
  naming the page count and sends nothing. `+10 / +20` move the page from where you are.
  The first sitting on a want-to-read book starts it (the store does that).
- **A change is remembered as it was**, per book and per session: finishing keeps
  `startedOn` and dates `finishedOn`; **Undo finish** restores exactly the status and dates
  from before. The link is `touched` and goes only when nothing this window did to the book
  is outstanding — and **only after this window had changed something**. The first version
  removed it in an effect that also ran on mount, which would have deleted a link made in an
  earlier sitting.
- **A quote is its own record** (`OutcomeKind` gained `'quote'`): filed with its page,
  linked `made`; deleting a book made here takes its quotes' links with it, since the server
  cascades them.
- **Found the way the Library finds it** (`lookupBooks`, both catalogues). One down is
  named; both down says so and offers **Add "…" as typed**, never "not found". A book
  already on the shelf (`shelfMatch`) says so and offers **Start reading** rather than a
  second copy — and that path has to hand the book back so it is linked and undoable
  (the first version started it and linked nothing).
- **Optional migrations stay optional.** No sessions table: the pages form is replaced by a
  line naming `20260030`, and the box claims **no page** it cannot read off a log (asserted).
  No quotes table: the quote form is hidden.
- **Not built: "mentioned in your notes".** Read my notes extracts tasks; picking book titles
  out of prose is a second extractor and a guess about what counts as a book.
`scripts/meeting-outcome-books.mjs [books|missing|off]` — 55 assertions against the real
`library_*` row shapes with both catalogues faked and switchable.

## Calendar — the outcome window's ink, measured on every box and in the acted-on states
`scripts/ink-audit.mjs` has a screen for it (**Calendar · what came out of it**), and the
first honest run found three Glass failures the resting window had hidden:
- **A fixed text colour on a fill is only right where the card is opaque white.** I had used
  `--sb-card` as the text on every dark or coloured fill. In Glass the card is a 5% wash, so
  it read **1.01:1** on the ink fill, and `--sb-info` is a *light* blue there (1.04). The themes
  already declare the pairs: **`--sb-ink-on-dark` on `--sb-ink-1`**, **`--sb-accent-ink` on
  `--sb-accent`**, **`--sb-ink-on-fill` on a semantic fill** (positive, info). The primary
  button's own CSS says so; reaching for the card token was the mistake.
- **A tint mixed into `--sb-card` is a mid-tone in Glass.** The habit row's caption read 4.19
  and the box header's 4.48; mixing into **`--sb-overlay`**, the one opaque surface, fixed both
  (the rule `shell.md` already states, met again).
- **The first audit measured one box of four, and said 0 failing.** The window was an
  accordion, so opening Books closed Tasks, Expenses and Habits before the measurement. The
  screen now opens all four and **acts on each** (adds a task, drafts an expense, ticks a
  habit, saves a quote) so the states that only exist afterwards — a Draft with Confirm, a
  ticked row, a done task — are on the page. It prints what it did and what it could not, since
  a step that silently does nothing is the same trap again: the first run did one of four.
- **The audit serves no finance or habit data for any other screen**, so a small fixture is
  switched on inside this one visit only (`outcomeFixture`, then a reload because the stores
  load at boot). Every other screen is measured exactly as before.
- **`INK_ONLY=<text>`** runs only the screens whose name contains it and stops there: the later
  steps depend on the earlier ones, so filtering `visit` alone left them clicking in a page
  that had not got where they expected (the first attempt timed out on a Library tab).
Result: **0 failing pairs in all four themes**, with all four boxes open and acted on.

## Calendar — the Events box writes through a port, and inviting is the one thing that leaves the building
`outcome/EventsBox.tsx`, and `OutcomeCalendarPort` in `outcome/shared.tsx`. What a
meeting most often leaves behind is another meeting; this schedules it, moves the
next in the series, and takes back what it made, without leaving the window.
- **The window never builds a Google request.** The calendar hands it a port
  (`buildOutcomePort` in `CalendarIntelligence`: `find`, `later`, `target`,
  `create`, `patch`, `remove`) and every write goes the way the calendar's own
  writes go — a connected account through its edge function (its token is never in
  the browser), the primary account with its own. A rule added to those paths cannot
  be missed here. It is a **hoisted function**, not a `const`: the hook that takes
  it is called earlier in the component than the line that would define a const.
- **Guests begin off, and the form says what scheduling will do.** An event written
  with attendees is emailed by Google the moment it exists, and an email cannot be
  taken back. So the "Invite" row is switches that start **off** and reset after
  every schedule, the caption reads "Google will email 1 person the invitation" or
  "No one is invited unless you switch them on", and **you are never in the list**
  (`self` is filtered). The design drew them pre-switched on; an outward action
  should not be implied by a default.
- **Undo on an event made here is a real DELETE** — Google has no undelete — and for
  one with guests it is a cancellation they receive; the button's title says so. A
  delete Google refuses keeps the row and says it is still on the calendar. **Undo
  move** is a second PATCH putting the first state back. Closing the window undoes
  nothing, as everywhere here.
- **A refusal says why and writes nothing**: no row, no link, no count. The primary
  helper hands back `403: {"error":{…}}`, which is a response body and not a thing to
  put on screen, so `readableWhy` reads it ("403 Forbidden"); asserted.
- **Changing only the start keeps the length.** An event starting at 14:00 and still
  ending at 11:00 is one Google refuses, and "start it later" means the same length,
  later.
- **Read-only calendars are not written to.** The follow-up goes to the meeting's
  calendar when it can be written to, else to your own main one, and the form names
  which ("On Teradix Ltd" / "On a@x.com"); with neither, the form is not offered and
  says why. The first version would have tried the read-only one and been refused.
- **Only what is on screen is claimed.** The next occurrence of a series is offered
  when it is already loaded and labelled "in view, same series"; the box does not
  ask Google for the rest of the series. Rows are one list in date order, so a move
  does not change a row's parent (focus).
- **The footer's Next meeting is gone** — the box is the next meeting — and the
  composer is one press away as **Open the full form**, for what the quick form does
  not do (a Meet link, a repeat). It stays in the footer only for a window given no
  calendar port, so the way to a next meeting is never lost.
`scripts/meeting-outcome-events.mjs [events|fallback|readonly|full]` — 41
assertions with Google served and able to refuse: the POST read as the calendar sent
it (calendar, title, day and hours, location, attendees absent), an invite going out
as exactly the one person, an edit keeping the length, Undo as a DELETE, a move and its
undo as two PATCHes, a 403 leaving nothing behind, a read-only calendar falling back
to the main one, and none writable offering no form. The ink audit screen now opens
and acts on all five boxes, and is 0 failing pairs in all four themes.

## Calendar — the thread read from the other end: a chip on each record, a card on the meeting
`components/MeetingBacklink.tsx` (the chip) and `outcome/OutcomesCard.tsx` (the
meeting's list). The ledger (`meetingOutcomes.ts`) is written by the boxes and read
here; nothing about a record's own table changed.
- **One chip, five places, drawn only when there is something to say.** "From:" on a
  task (`TaskDetailPanel`), "Filed from:" on an entry (`TransactionModal`, in a row
  that itself only exists when there is a link — a label with nothing beside it says
  nothing), "Logged from:" on a habit (its record), "Saved during:" on a quote and
  "Worked on in:" on a book. It takes only a placement style from its caller, so it
  never leaves an empty box in a grid. A click is `focusOn` the calendar with the
  event id and **the day** — the ledger now keeps `eventDate`, so the click lands on
  the right week; a link made before that was kept still reads and just cannot jump.
- **The title is the one the meeting had then**, kept in the ledger, so "From: Client
  lunch" survives the event being renamed or deleted.
- **The meeting lists what it produced — in counts, never amounts.** The card is in the
  event panel, which is not behind the finance lock; "1 expense filed" says what happened
  and the figure stays where something asks who you are. Tasks are listed by title (and
  struck through when done, each opening the task); habits by name; books and quotes as
  counts. **Reopen** brings the window back: everything in it is derived from the stores
  and the ledger, so it shows what was filed — the session-only Undo buttons are not
  restored, because they are about *this sitting*.
- **Drawn for a meeting that is done, or has anything filed; absent otherwise.** A card
  saying "nothing yet" on every event would be noise on the busiest screen. A done
  meeting always has it, which is how the window is reopened after being closed. It is
  the **first** of the panel's extras, because the first placement (last) put it under the
  fold and under the assistant's button; Reopen sits beside the label for the same reason.
- **A refusal that is not a refusal crashed the grid.** The audit's Google answered a
  create with an empty body; `createCalendarEventWithToken` treats any ok response as an
  event, so `{}` went onto the grid and the render read `start.dateTime` of nothing — the
  whole screen went, and the audit reported it as "only 3 elements". The port now needs an
  **id and a start** before it believes an answer, and says "Google answered, but not with
  an event" (asserted: the page stays up, nothing is linked).
`scripts/meeting-outcome-backlinks.mjs [meeting|tasks|habits|library|finance]` — a linked
record per module with an unlinked control beside each, and a positive "the panel is open"
before every "has no chip" (the first finance run clicked the calendar cell's copy of the
payee, the form never opened, and the control would have passed for nothing). The ink audit
gained **Calendar · outcomes on the meeting** and **Tasks · a task made in a meeting**, and a
`pageerror` line, since a crash is the commonest reason a screen measures nothing and the
blindness warning only says that it did. `INK_ONLY` takes `a|b|c`. 0 failing pairs in all four
themes over the three outcome screens.

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
