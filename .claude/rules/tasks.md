---
paths:
  - "src/modules/tasks/**"
  - "src/store/taskStore.ts"
  - "src/lib/taskAutoSchedule.ts"
  - "src/lib/undo.ts"
  - "src/types/index.ts"
  - "src/lib/behavioralEngine.ts"
---

# Tasks — the board, the quadrants, the planner and undo

Loaded when a file this rule's `paths` names is read or edited — it is not
in context on every turn, which is the whole point. The root `CLAUDE.md`
holds what is true everywhere; this holds what is true here.

## Tasks — where a task stands
Two different things were called status and neither could be changed from the
task itself. `TaskDetailPanel` shows both, as **buttons, not a select** — three
states is not a menu, and a menu you must open to see what is possible is the
wrong shape for either:
- **Its own state** — two switches in the panel header, beside expand/delete/
  close: a tick (done) and a ban (not doing it). Open is neither being on, which
  is what open means. No row of buttons in the body and no select.
- **Its column** is the board's business — you move a task by dragging it there,
  so the panel does not repeat it.
Choosing a column on a finished task *is* the reopen: `completed: false`,
`status: 'open'`, `completedAt` cleared. The tick could only toggle and the
board hides what is finished, so a task done by accident had nowhere to go back
to. `updateTask` logs which happened.

**"On your calendar" is checked, not assumed.** A task keeps a `gcalEventId`
and nothing else, so the row was a claim about a string: delete the event in
Google and the task said it for ever. `verifyTaskEvent()` looks it up
(`lookUpEvent` / `efLookUpEvent`, the latter through the edge function's new
`get_event`), shows the time Google actually holds, and offers **put it back**
when the id is dead. A network failure is not evidence — it stays quiet.

**The grid opens at the earliest thing on it**, not at a fixed 07:00 —
a task blocked at 04:00 was drawn, above the fold, and read as never scheduled.
The panel's "On your calendar" row is a button: it sends you to that day with
the event selected (`focusOn({module:'calendar', id, date})`).

**A date on a task is not an event in Google.** The board's auto-push only fires
for `quadrant === 'schedule'`, so a dated task in Do has nothing on the calendar.
The panel says which, and `scheduleTaskToCalendar` puts it there on request from
any quadrant. Nothing anywhere removes an event when a task is completed.

## Undo — taking it back
`src/lib/undo.ts` holds one stack; `components/UndoBar.tsx` shows the last entry
in the corner and binds ⌘Z / Ctrl-Z. Three rules:
- **Register before the change, and store a snapshot, not a diff.** A diff has
  to be right about every field it does not mention. `taskStore._remember(label)`
  keeps the whole task list plus activities; the calendar keeps the event's old
  times; finance keeps the entry itself.
- **⌘Z never fires over a text field** (`inTextField`) — inside one the
  browser's own undo knows about the caret. Panel edits that touch only words
  coalesce under `task-text:<id>` for 2.5s, so one ⌘Z takes back the sentence.
- **A bulk action is one entry.** `_remember(...)` once, then `suppressUndo(fn)`
  around the many writes — Distribute all, Archive all. Forty ⌘Zs is not an undo.
Covered: every task mutation (add, edit, move, reorder, complete, status,
delete, clear), calendar delete / move / resize, finance entry delete.
There is **no redo** — it would need an inverse of every inverse.
`notify(text)` puts a line in the same corner for anything that is not an undo.

## Tasks — a date is a calendar event, from any quadrant
`useTaskCalendarPush()` (`lib/taskAutoSchedule.ts`, called in **App**, not in the
Tasks page — a date given from Today, the palette or the planner counts too).
It used to require `quadrant === 'schedule'` *and* the board to be open, so a
dated task in **Do** was never pushed and nothing said so. It now pushes any
task that is **placed** (not still in the brain dump), **not finished**, dated
**today or later**, and has no `gcalEventId`. Older dates are asked for by hand
from the panel's calendar row, so turning this on does not fill a calendar with
history.
- **A failure is one `notify()` per reason**, never silence. The usual one is
  real: a company linked to a connected account whose token cannot be refreshed
  — "<email> needs reconnecting before its calendar can be used".
- The panel's row **names where it is going** (`resolveTaskCalendar`): "add it
  to Teradix", "On Teradix's calendar". A task with a company goes to that
  company's calendar on that company's account.
- **The account you signed in with is not in `professor-connected-accounts`** —
  that key holds the *additional* accounts — so it was missing from Settings →
  Accounts & companies, and a company could not be linked to your own Google
  account. It is offered as the id `primary`, which every consumer already
  reads as "use the primary token" by finding no account with that id.

## Tasks — the planner has a door
`SmartDayPlanner` is opened by **Plan my day** in the Tasks header, beside New
task: one makes a thing to do, the other decides when. `showPlanner` was
initialised false and set true nowhere, so the whole planner was unreachable.
It closes on Escape — worth having, and unnoticed while nothing could open it.
**The grid opens at the earliest thing still on it** — a planned block or an
event that has not ended — or at the current hour when there is none. It used
to open at 12 AM with the whole morning empty above the fold and scrolled only
after Generate Plan. `autoTop`/`userMoved` in `SmartDayPlanner`: the auto
scroll re-runs as blocks and events land, and stops for good the moment the
person scrolls it themselves. Checked with the page clock fixed at 10:20 —
nothing → 10 AM, a meeting running since 9 → 9 AM, a meeting at 2 PM → 10 AM.

## Tasks — the planner wrote a client's block on your own calendar
Asked whether a scheduled task always lands on the right account's calendar,
the answer was **no, on one of the two doors**. `resolveTaskCalendar` was right
and `scheduleTaskToCalendar` honoured it — the detail panel and App's auto-push
refuse a company whose account cannot be opened. The planner's **drag** had its
own answer and it was this:

```ts
token: linked?.providerToken || getPrimaryToken() || null
```

Three mistakes in one expression. It read the stored token **raw** — no
freshness check, and not through the edge function that is the only route to a
connected account's token — and when that token was empty or an hour old it
**fell through to the account you signed in with**. A company bound to an
account but with *no calendar of its own* resolves to `calendarId: 'primary'`,
and `'primary'` written with the signed-in token is **your own diary**. So the
Teradix block landed on the personal calendar, with no error and no picker.
- **Measured, not read**: a real dnd-kit drag (PointerSensor, distance 5) with
  `www.googleapis.com` intercepted. Control, on the old code: `POST
  calendars/primary/events` bearing the signed-in token for a Teradix task.
  After: no POST at all, the block still planned locally, and the reason said
  out loud. A third case drags a task whose account *can* be opened and asserts
  the POST goes to `dx-cal@…` with DX's token — otherwise the fix would only
  have proved it stopped writing.
- **The control passes for the healthy account**, which is exactly why this was
  intermittent: the OR picks the right branch while the stored token is fresh,
  and only misfiles once it has aged out or sign-out cleared the cache.
- **`accountUnresolved` is the new half of `CalendarTarget`.** A company naming
  an account that `loadAccounts()` cannot find used to come back as an
  unqualified `'primary'` — indistinguishable from "no company at all". A
  caller that cannot open the named account must refuse, not fall back.
  `accountId: 'primary'` stays the sentinel for "use the primary token" and is
  deliberately not this.
- `calendarFor` is now async and goes through `getGoogleToken(accountEmail)` —
  the same door `scheduleTaskToCalendar` uses — so the panel, the auto-push and
  the drag give one answer. `removeBlock` reads the same refusal: deleting with
  the wrong account's token reaches a calendar where that event id means
  nothing, and it keeps the id and says so.
`scripts/task-lands-on-right-calendar.mjs [panel|planner|planner-ok]`.

## Tasks — the planner's ✕ takes the calendar event with it
Dragging a task onto the Smart Day Planner's grid writes a **real Google
Calendar event**. Taking it off used to drop the block, clear `gcalEventId`
and stop there — so the task came back to the list on the right while a block
with its name was still drawn on the grid. Not a rendering glitch: a real
event, on a real calendar, for work no longer planned. The grid draws two
layers and only one of them had been cleared.
- **Clearing the id was the worse half.** `gcalEventId` is the *only* handle
  to that event, so forgetting it made the orphan permanent — nothing in the
  app could find it again. `removeBlock` now deletes first and clears second,
  and **keeps the id when Google refuses**, saying so rather than orphaning it
  quietly.
- **`allTasks`, never `tasks`.** The right-hand list deliberately excludes
  anything already planned for today — which is every task that *has* a block
  — so `tasks.find(t => t.id === taskId)` inside `removeBlock` answered
  `undefined` for every restored plan, and the delete was skipped for exactly
  the case it exists for: a plan reopened after a refresh. The grid's own
  `taskTitle` read the same filtered list and lost a restored block's name
  with it.
- **`calendarFor(task)` is one answer to one question.** Creating and removing
  an event ask the same thing — which token, which calendar — and a second copy
  would delete from the wrong calendar the day a company's link changes.
- **An orphan already on the calendar is named and offered, never swept.**
  `isTaskEvent` (the 📋 and the note header) is the app's own mark, so a
  leftover can only ever be an event this app wrote; an event no task's
  `gcalEventId` still claims is drawn with a **LEFT OVER** chip and a ✕ that
  removes it after a confirm. A calendar delete cannot be undone and the event
  may be the only record the work was planned — the same posture a cancelled
  invitation takes. `claimedEventIds` reads **every** task's id, not just the
  planned ones, so a block moved to another hour is never called an orphan.
- Both ✕ controls had no accessible name at all; each now says which task or
  event it acts on.
Verified in Chromium against the real bundle, with `www.googleapis.com`
intercepted: removing a restored block sends exactly one `DELETE` for that
event id and takes it off the grid; a leftover event is marked, offered and
deleted; a **403 keeps the block on screen and says so** rather than claiming
it is gone. The control — the same file before the fix — takes the block off
the grid and sends **no DELETE at all**, which is the orphan on the calendar.
21 assertions.

## Tasks — the tick that asked a question and then forgot the tick
"I mark a task completed and it appears as incomplete." Not the revert above —
this one **never completed at all**. `useDeliverableGate.requestComplete`
opens `DeliverablePrompt` for a task whose type is in `DELIVERS` (`do`,
`deepwork`), and the gate asked `inferTaskType` when the task had no type of
its own. **`inferTaskType` falls through to `do`** — a title matching none of
its eight keyword patterns, "Water the office plants" included — and `do` is in
DELIVERS. So ticking almost any untyped task opened a dialog asking what it
produced, and Cancel, Escape **or a tap on the backdrop** left the task open
with nothing anywhere saying the gesture had been dropped. On a touch screen a
stray tap outside the dialog is how that happens without you knowing you did it.
- **An inferred type is a guess, and a guess must not block a tick.**
  `producesDeliverable` reads `task.taskType` only; absent means nobody said
  this task produces anything, which is not grounds for standing between the
  person and the thing they just ticked. An explicitly typed `do` or `deepwork`
  task is still asked — that is the whole feature and it is untouched.
- **Dismissal is a decision, so it is said out loud** — `notify('Left "X"
  open')`. Cancel meaning "leave it open" is correct; Cancel meaning *nothing
  visible* is indistinguishable from a broken tick, which is exactly how it was
  reported.
`scripts/tick-completes-the-task.mjs [dismiss|cancel|typed|typed-complete]`.
A plain-titled task ticks straight through with no dialog; an explicitly typed
one still opens it, Complete finishes it, and Cancel leaves it open **and says
so**. Control, on the code before the fix: the untyped task is still
`completed:false` after the dialog is dismissed and the screen says nothing,
while the two typed cases pass — they were always right, which is why this
looked intermittent and depended entirely on the task's title.

## Tasks — "ON FIRE 1" beside two burning cards
`isOpenTask` / `isOnFire` in `types/index.ts`. The banner counted and the card
drew, and they were answering two different questions with one field.
- **The flame was lit from `task.urgent` alone**, in `TaskCard` and `TaskRow`
  both, while the matrix draws **every** task in a quadrant unless you ask it
  not to (`hideCompleted` is false by default) and `TaskCard` dims only
  `completed`. So a task marked **done** or **cancelled** that still carried
  the flag sat there at full strength, burning, in no count on the page. The
  number was the half that was right.
- **"Open" had five spellings and three of them were wrong.** `TaskBanner` and
  Today's headline said `!completed && status !== 'cancelled'` — which misses
  `status === 'done'`, the state the detail panel's tick writes without
  touching `completed`, so a finished task counted as live work. Today's own
  `openTasks`, twelve hundred lines further down the same file, had the right
  one. `behavioralEngine` said `!completed && status !== 'done'` and therefore
  **scored cancelled tasks as the next thing to do**; Archive-all would have
  overwritten a `done` task's status with `cancelled`, losing the fact that it
  was finished rather than abandoned; the day planner offered abandoned tasks
  to plan; and `taskEventLink`'s reopen branch read a `done` task as already
  open and did nothing for it.
- One definition each, and `isOnFire` is `urgent && isOpenTask` — so the flame
  and the count cannot disagree again, because they read the same function.
  The flame stays a live control on a finished task (you can still clear the
  flag); it is simply not drawn as burning, and its tooltip says why.
Verified in Chromium on a fixture built so every wrong rule shows: four urgent
tasks — open, cancelled, done, completed — and one calm. Banner **1**, flames
drawn **1**, and it is the open one. The control, on the same fixture before the
fix: banner **2**, **four** flames, three of them on finished work — the user's
report with one more case in it. The first probe for *whose* flame walked up the
DOM for the first long line of text and answered `Meeting / Schedule` for every
one — the quadrant's own header — so the control passed three assertions
vacuously; it reads `[data-task-node]` and matches the fixture's own titles now.

## Tasks — a card typed into a column belongs to that column
`commitAdd` in `KanbanBoard.tsx` wrote the same two things whatever board you
were on: `boardStatus: column.id` and **`quadrant: null`**. Both are wrong, and
the second is the one you see.
- **`quadrant: null` is what the brain dump *is*** (`isDumped`), and the status
  board draws a dumped task in **Brain dump whatever its `boardStatus`** —
  `dumpedIds` is tested first. So a task typed into a column appeared there for
  one render and jumped straight back to the pile. It was never placed; it only
  looked placed.
- **The column means something different on each of the five boards** —
  a status, a company, an owner, a task type, or a date bucket. Writing
  `boardStatus` for a column that is a *company* files a company id in the
  status field and leaves the card in no column at all on Companies, Owners,
  Task types and Scheduled.
- The fix is the patch **a drop into that column already writes**
  (`handleDrop`), so there is one answer to one question: `boardStatus` /
  `companyId`+`company` / `owner` / `taskType` / `dueDate: bucketToDate(id)`.
  The quadrant comes from `suggestPlacement` on the task's own fields — the
  same call a drop out of the dump makes — and the **brain-dump column is the
  one place `null` is right**, because that is what capturing without deciding
  means.
Verified in Chromium on all five boards, reading the **store** rather than the
pixels (where a card is drawn is not which column it is in): the task is
created, carries the field its column stands for, and is not in the dump. The
control — the same file before the fix — returns `quadrant: null` on every
board and draws the card in Brain dump, which is the report. The Owners board
needed a company with a person on it to have a column that is not *Unassigned*;
there, "no owner" is the correct answer and proves nothing.

## Tasks — a deleted task came back, and the chart was the only place it showed
`professor-tasks-deleted` in `taskStore.ts`. Deleting a task took it out of the
store and left the push that deletes it on the server **1.5s behind**, and
nothing anywhere recorded that it had been deleted. `loadFromDB`'s `dbOnly`
pass appends **every** server row not present locally — so any reload inside
that window handed the task straight back, and the hydration push then wrote
the resurrection out again.
- **A completed task is hidden from the board**, so the only thing on screen
  that showed its return was `TaskBanner`'s six-day chart: *N closed* going
  back up by one for a task you had deleted. That is the report.
- **The ways it is lost are ordinary**: a refused push (offline, an expired
  token, an RLS denial), a tab closed inside the window, or a second device
  reloading before the push lands and pushing its own copy back. The last two
  lose the delete for good.
- **`dirty` cannot answer this.** It means "this row might not be on the
  server", and a deleted row is not in the list being pushed at all — so a
  third list is needed, of ids to **refuse** when the server offers them back.
  Entries carry the moment of the delete and expire after 30 days: an id is a
  uuid, so a tombstone can never block a task made later, and the expiry keeps
  the list bounded without waiting on a push that may never succeed.
- **A task in the list being written is, by definition, not deleted**, so
  `markTasksDirty` lifts any tombstone it finds there. That is how ⌘Z lifts its
  own: the undo snapshot carries the task back and pushes the whole list with
  it. Without that, undo would restore a task only until the next reload killed
  it again — worse than no undo.
- **Refusing the row also repairs the server.** `joined` is then shorter than
  `rows`, which makes `changed` true, so the hydration push runs and
  `saveTasksToDB` finally deletes the row — the failed push retried.
- **Not cleared by `clearUserData`**, and `clearAll` does **not** tombstone:
  that path is the account switch, and those rows belong to whoever was signed
  in before.
`scripts/deleted-task-stays-deleted.mjs [refused|push|undo]` is the
measurement, driven through the row's own trash in the list view and read off
the banner. Control, on the code before the fix: the task is gone and the chart
reads 0 closed, and nine seconds later it is back and the chart reads **1**
again.

## Tasks — a task made on purpose is not a capture
`placementForNew(task)` in `BrainDumpRail.tsx` is the one answer, and **both**
ways of making a task go through it: the column's **+ Add task**
(`KanbanBoard.commitAdd`) and **New task** in the Tasks header
(`TaskCommand.handleNewTask`). The second wrote `quadrant: null` — which is
what the brain dump *is* — and then opened the detail panel on it, so the one
gesture that says *I am deciding about this right now* filed it with the things
not yet thought about. Naming it, giving it a company, a priority or an owner
all left it in Brain dump; only a due date ever took it back out
(`updateTask`'s own rule).
- **`suggestPlacement` is not enough on its own.** It answers out of the task's
  fields, so a task with none of them yet lands in **Eliminate** — "do not do
  this", a decision nobody made about a task somebody has just chosen to write
  down. With nothing to read, `placementForNew` returns **schedule**: the same
  quadrant a date puts a dumped task in.
- Capture still has its own ways in — the rail's multi-line box, voice, mail —
  and the dump column itself is the one place `null` is right.
Measured with `scripts/new-task-is-placed.mjs` (header button, 5 checks) and
`scripts/kanban-add-stays-put.mjs <board>` (5 boards × 7). Control: before the
fix the header's new task read `quadrant=null` and stayed there after naming.

## Tasks — a date decides the quadrant
A task with a `dueDate` and no quadrant goes into **schedule** — deciding when to do
something is deciding about it, so it leaves the brain dump. `taskStore.updateTask`
does it (and `addTask`, for one created with a date already on it), so every path
gets it: the detail panel, the planner, the palette. Only from the dump — a task
already in Do stays in Do — and clearing the date sends nothing back.

## Tasks — no date is Do, a date is Schedule
`placementForNew` is now two rules: **no `dueDate` → `do`; a `dueDate` → `schedule`**
(badged PLAN, and where `useTaskCalendarPush` makes the company's calendar event).
It used to hand a bare task to Schedule, so every new task carried the PLAN
badge and looked planned. `updateTask` carries the other half: **the first date
a task is given** moves it from the brain dump *or from Do* to Schedule — New
task opens the panel on a task that starts in Do, so without this a date set
there left it in Do. A task in Delegate/Eliminate stays put; a second date
change or clearing the date moves nothing. Trade-off: a task deliberately kept
in Do moves to Schedule if it is first dated afterwards.
Not browser-measured; build only.

## One switcher for the Tasks views (P2.4)
Board, Matrix, List and the day planner are four tabs of one `Segmented`
(`role="tablist"`, label "View") in `TaskCommand.tsx`. The old "Plan my day"
button and its fixed-position overlay are gone; the older "the planner has a
door" section above describes that button and is superseded by this one.
- State is `stayView` (`board | eisenhower | list`, persisted in
  `localStorage['task-view-mode']`, default board) plus `planning`. `Plan` sets
  `planning` and **is never persisted**: a reload returns to the last real view.
  Any other tab clears `planning`. The Matrix's "open planner" calls
  `switchView('plan')`.
- `SmartDayPlanner` takes `inline`: a page view rather than a modal. No backdrop,
  no header ✕, no Cancel, and Escape does not leave it. "Apply Plan" stays and
  returns to the previous view. The Filters control is hidden on Plan.
- Its colours are chosen by people (calendar colours), so event text, the left-over
  label and the priority badge use `useInkOnKeeping` over the tint they sit on;
  the disabled Apply button is ink-3 on the field colour, not ink-4.
- `scripts/tasks-views-switcher.mjs` — 16 assertions, fails on the old code.
  `ink-audit` has a "Tasks · Plan view" visit, so the planner is now measured
  (48 screens; baselines Evergreen 8, Sunlit 3, Warm 2, Glass 1 are unchanged).
- `task-lands-on-right-calendar` modes `planner`/`planner-ok` fail
  "the drag actually planned it" — failing before this change as well.
