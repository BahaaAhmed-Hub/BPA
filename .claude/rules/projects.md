---
paths:
  - "src/modules/projects/**"
  - "src/store/projectStore.ts"
  - "src/lib/projectStats.ts"
  - "supabase/migrations/*_projects*.sql"
  - "scripts/project-*.mjs"
---

# Projects — a goal with an end, across modules

Loaded when a file this rule's `paths` names is read or edited. The root
`CLAUDE.md` holds what is true everywhere; this holds what is true here.
Built in chunks (see the plan at the bottom); each chunk is its own commit.

## What a project is
One outcome that gathers items from several modules. It does not replace the
task board, the calendar or mail — it points at their records.
- **`kind: 'work' | 'personal'`.** Work: one company, tasks, calendar, mail.
  Personal: tasks, calendar, finance envelope, habits, books. The kind decides
  which link types the page offers; it does not change the data model.
- **Exactly one company**, never several (`companyId`, same meaning as on a
  task — see `companyIdOfTask`). Personal projects have none.
- **Status:** `idea | active | paused | done`, plus `archived`.
- **Sharing is later.** Rows carry `user_id` and nothing else is built for it.

## Data model
- `projects` — id, user_id, name, kind, color, status, company_id, start_date,
  target_date, notes, archived, created_at, updated_at.
- `project_milestones` — id, project_id, title, due_date, done, sort_order.
- `project_links` — project_id, kind (`event | thread | entry | habit | book |
  list`), ref_id. Everything but tasks links here.
- **Tasks carry `projectId` (and optional `milestoneId`) on the record** — they
  are the bulk, and the board filters on them. The task **keeps its quadrant and
  every other view**; the project is one more field, not a new home.
- **Progress, health and timeline position are derived, never stored.**

## Deleting a project
Its tasks are **kept and orphaned**: `projectId` is cleared and nothing else
changes. Never cascade-delete tasks. Links rows and milestones go with the
project. An orphaned task is an ordinary task.

## Sync — the same three rules as tasks
`markLocalWrite('projects')` on every write path; a dirty set (made here, may
not be on the server) and an **edited** set (the only thing a field merge may
read, never seeded); push the hydration merge back only when it differs from
what the server sent. A task's `projectId` rides the existing task push, so
`scheduleDbSync(next, [id])` must name the task it touched.

## Chunk 1 — what exists, and what was measured
`20260042_projects.sql`, `modules/projects/{types,projectDb}.ts`, `store/projectStore.ts`,
`scripts/project-sync.mjs [create|elsewhere|refused|edit-wins|orphan|orphan-patch]`.
- **Rows are pushed by id, never by "everything not in my list".** `saveTasksToDB`
  deletes whatever is missing from the list it is handed; a device that has not
  finished loading could use that to wipe the account. Projects push the dirty
  rows and delete only tombstoned ids (`professor-projects-deleted`, 30 days).
- **No foreign key on `tasks.project_id`.** Tasks push on their own debounce, so a
  task can arrive before its project and a key would reject the whole task push.
  Orphaning is the app's job: `deleteProject` clears the task locally
  (`taskStore.clearProject`) and on the server (`orphanProjectTasks`, a direct
  update — the one path that also reaches a task this device has not loaded).
  `projectOfTask()` reads a task whose project is gone as unassigned.
- **The task columns are sent only when needed** (a task holds a project, or a row
  has come back carrying `project_id`), so a database without 20260042 keeps saving
  every task; a rejection naming the columns retries without them, losing only
  those two rather than falling to the pre-20260003 base.
- **Links dedupe on (project, kind, ref)**, not id: two devices linking one thing
  mint two ids, and the server's wins on reload.
- **Not done yet:** the sync-gap banner (`SyncEntity` has no `projects`), the plan
  entitlement gate (own-rows RLS only), and any screen.
- **Measured, with a control per defence** (remove it, the named assertion fails):
  tombstones (orphan: resurrection), the dirty set (refused/elsewhere: the project
  is read as deleted elsewhere), the edited set (edit-wins: server's name returns),
  `clearProject` (orphan), the direct server update (orphan-patch — task pushes are
  refused in that mode, so nothing else can clear the row). 37 assertions.
- **The harness trap, hit on the first controls:** Vite appends `?t=<n>` to a
  module URL once its file has been edited, so `import('/src/store/x.ts')`
  returns a *second copy* of the store — one the app never reads and liveSync never
  reloads. The controls then mutated the app's copy while the harness drove the
  original and "passed". `project-sync.mjs` takes the URL from
  `performance.getEntriesByType('resource')` and asserts it found it.
  Likewise assert the reload really happened (`reads.projects` rose) before
  claiming anything survived one.

## Chunk 2 — the tab, the grid, the dialog
`modules/projects/{ProjectsModule,ProjectCard,ProjectDialog}.tsx`, `lib/projectStats.ts`,
`scripts/projects-tab.mjs [create|cards|narrow]`, three `Projects · …` screens in `ink-audit.mjs`.
- **The rail entry is `projects` in `NAV_ITEMS`**, after Tasks, with a stacked-layers glyph.
  Not entitlement-gated yet: `moduleIsOff` answers false for an id the registry has
  never heard of, so it shows for everyone until a `modules` row exists.
- **The bar is the rail's `LOZENGE`**, asserted against the rail's own pill in the page
  (radius and ground), not against a copy of the values.
- **Progress is derived from the tasks pointing at the project** (`projectStats`):
  cancelled tasks count as neither done nor left, and the card says "1 of 3 tasks done ·
  1 overdue". The bar's width is asserted as a measured fraction of its track, beside the
  `aria-valuenow`, because an attribute can agree with itself and be drawn wrong.
- **A cancelled task is stored as `deferred`** (`statusToDb`). The first fixture wrote
  `cancelled` to the server, which reads back as an ordinary open task — the "cancelled
  is excluded" assertion failed for a reason about the fixture, not the code.
- **Colour is stripe and fill only; every word is an ink token.** A colour somebody chose
  cannot be promised to carry text in all four themes. Overdue / "Was due" use
  `--sb-negative-deep`. The audit passes all four themes over the three screens, and
  fails on this screen when the status chip is given `#d8d2c0` (1.41) — so it can see it.
- **A card opens the edit dialog for now.** Chunk 3's project page takes the click and
  the dialog stays for create and for editing from the page.
- **The dialog saves with the button, not live** (a half-typed name is not a name).
  Personal clears `companyId` in the stored row, not only in the form. Delete is a second
  step that says how many tasks stay. Escape closes without saving.
- **`minmax(280px, 1fr)` overflowed at phone width** (card at x=114, 394px wide in a
  390px window — the rail and padding leave 252). `minmax(min(280px, 100%), 1fr)`.
  Found by the `narrow` mode, which measures the card's box against the viewport.
- Segmented renders `role="tab"`, not `radio` — a harness that clicks the wrong role
  waits the full 30s and fails about the harness.
- **Controls** (each removed, the named assertion fails): save guard, personal-keeps-
  company, cancelled-counted, archived-not-separated, grid min width, the delete
  sentence, the Escape handler.

## Chunk 3 — the project page, and the field on the task
`modules/projects/ProjectPage.tsx`, the Project cell in `tasks/TaskDetailPanel.tsx`,
`scripts/project-page.mjs [page|panel]`, three more `Projects · …` screens in `ink-audit.mjs`.
- **A card opens the page** (Overview: progress / done / open / overdue, dates, company, notes;
  Tasks: add, tick, bring in, take out). The edit dialog is behind **Edit** on the page and
  still serves create. `ProjectsModule` holds `openId`; a project deleted while its page is
  open (here or on another device) is a grid again, not a blank screen.
- **A task added from the page is PLACED** (`placementForNew` → `do`, never the brain dump),
  carries the project, and takes the project's company when it has one.
- **Ticking goes through `useDeliverableGate`**, the same door the board uses, so a typed
  `do` task still asks what it produced. The page does not own a second rule.
- **"Bring in an existing task" offers only open tasks in no project.** Moving one between
  projects is done from the task's own Project field.
- **The Project cell in the task panel is one more field — it never moves the task.**
  Quadrant and board are untouched (asserted against a task that is really placed: the first
  fixture wrote `schedule` as the quadrant, which the database does not use —
  `important_not_urgent` — so every task loaded as unplaced and the "untouched" claim was
  vacuous until the control failed to fail). Choosing a different project clears the
  milestone, since phases belong to a project.
- **Live projects are offered; the one the task is already in always is**, so a finished
  project cannot make its own tasks unselectable. The cell is hidden when no projects exist.
  Its arrow sends you to the page through `focusOn({ module: 'projects', id })`, the same
  door a task's calendar row uses.
- **Row components are called, not rendered** (`TaskLine({ t })`): defined inside the page
  they would be a new type every render and every row would remount on every store change.
- **A dated task added to a project is pushed to the calendar by the existing rule** — the
  harness shows a "not signed in to Google" notice for it. That is `useTaskCalendarPush`
  doing what it always does, not the page.
- **Controls:** cancelled-as-open, add without the project, add into the brain dump, offer
  finished tasks, unlink does nothing, page survives deletion, overdue uncoloured, panel
  resets the quadrant (needed the corrected fixture), current project not kept in the
  choices. Ink: 0 failing pairs over six Projects screens in four themes; an unreadable
  caption colour fails at 1.51 on the overview. The audit's blindness warning also caught
  its own stale "delete confirmation" step once the card stopped opening the dialog.

## Chunk 4 — milestones, the timeline, and the calendar markers
`modules/projects/{ProjectTimeline,MilestoneMarkers}.tsx`, the Timeline tab in `ProjectPage`, a Phase
cell in `TaskDetailPanel`, a strip and chips in `CalendarIntelligence`,
`scripts/project-timeline.mjs [timeline|phase|calendar|calendar-none|month]`.
- **A milestone is not an event.** Nothing is written to Google, nobody is invited, it has no
  hour. The calendar draws it as a marker on its day and a click opens its **project**
  (`focusOn({ module: 'projects', id })`), never an event panel. Asserted: no non-GET request
  to `googleapis.com` in week, month or a week with nothing due.
- **Week/day: a "Due" strip under the day headers, only when the week has one** — the same
  rule as the All-day strip, capped at 68px with the same scroll. Month: two markers a cell
  at most, and `stopPropagation` so a marker does not also open the day. Archived projects and
  undated milestones draw nothing. Done ones draw a tick and are struck through.
  The company lens does **not** dim markers yet (they carry a project, not a company).
- **The axis is measured, not trusted.** Markers sit at their dates in proportion (15 of 55
  days to within 1.2%), in order, with today and the start/target ticks where the dates put them;
  labels alternate above and below, and are clamped to the card so an end label is not cut off
  (the diamond is never moved). The range always holds every drawn date plus today while the
  project is live; a single-day range is widened to a fortnight. `axisOf` is the one function.
- **Rows commit on blur / Enter; Escape cancels.** Escape blurs the field and blur is what saves,
  so a cancel flag is needed or the half-typed name is committed on the way out — shipped that
  way first and caught by the harness. An empty name reverts.
- **Deleting a milestone keeps its tasks in the project and clears their phase** — locally
  (`taskStore.clearMilestone`) and on the server row. A task's phase is offered only from its
  own project, from the page row and from the panel; changing project clears it.
- **"After the target date"** is flagged on a milestone dated past the project's target.
  It has a fixed 128px slot so the date columns line up whether or not a row has a note.
- **Controls** (each removed, the named assertion fails): non-proportional axis, undated first,
  delete leaving the phase, phases from every project, project change keeping the phase,
  archived drawn, month uncapped, marker click falling through to the day, strip always drawn.
  Ink: 0 failing pairs over nine Projects/calendar screens in four themes; an unreadable marker
  colour fails at 1.51 in the week strip. The audit's calendar visits first used buttons for the
  Month/Week switch — they are `role="tab"` — and its blindness warning said so.
- **Known, not mine:** `company-lens-dims.mjs calendar` fails "the header counts what is in
  focus" (reads "New event") on the calendar *without* these markers too.

## Chunk 5 — events and time blocks belong to a project
`20260043_project_link_meta.sql`, `modules/projects/{EventProjectRow,ProjectCalendar,eventLinks}.ts(x)`,
the Calendar tab in `ProjectPage`, a `Project` row in the calendar's event panel, a snapshot refresh
and delete handling in `CalendarIntelligence`, `scripts/project-events.mjs [panel|page|sync|delete]`.
- **The link lives in `project_links` (kind `event`, `refId` = the Google event id), never on the
  event.** Linking writes nothing to Google — asserted in every mode, as a non-GET count of 0 —
  so no scope, no invitation, no round trip, and it works on a read-only calendar.
- **A link carries a snapshot (`meta`: title, start, end, allDay, calendarId)** because the project
  page cannot ask Google: only the calendar holds events, and only the week it is showing. The
  calendar **refreshes the snapshot whenever it has the event loaded**; equal snapshots write
  nothing (no ping-pong), and an event that is not loaded keeps what it had — it is never blanked.
  `meta` is a separate migration and `projectDb` keeps working without it (sent only when a link
  holds one or a row has come back carrying it; a rejection naming the column retries without it).
- **Two defences overlap**, and a control has to remove both: the panel writes the snapshot on link,
  and the calendar refreshes it. Removing only the first still passes (the refresh fills it in);
  removing both fails — which is why the first control "passed".
- **One project per event.** Choosing another *replaces* (`removeLinksByRef` then `addLink`); "No
  project" removes. Offered: live projects, plus the one it is in.
- **A task's block belongs to its task's project and says so** ("Launch the site · via its task"),
  with no select — a second, competing answer would let the two disagree. Pressing it opens the
  project. On the page it is listed as **Task block**, and an explicit link to the same event shows
  once, as the task's. A block takes its hours from the task (`dueDate`, `plannedTime`, `duration`).
- **The Calendar tab**: Upcoming (soonest first) and Earlier (latest first), a row each with day,
  hours, title, **Task block / Linked**, an *open in calendar* arrow (`focusOn` calendar with the day)
  and, for an explicit link only, an unlink. Another project's events are not listed.
- **Deleting an event drops its links, and undoing the delete puts them back on the event's NEW
  id** (the undo writes the event again; Google has no undelete). Without the second half an undo
  quietly lost the project.
- **A harness trap that cost a file:** `open(p,'w').write(open(p).read())` truncates before it
  reads. A throwaway "touch" line emptied `CalendarIntelligence.tsx`; it came back from git, and
  the edits were reapplied. Never write a file you are still reading in the same statement.
- **Not done:** (dot on cards and composing-time linking have since been added — see the follow-ups) Recurring series link per
  occurrence, since each has its own id.
- **Controls** (each removed, the named assertion fails): snapshot (both defences), replace, task
  block select, double-listing, other projects' links, order, no refresh, delete leaving links, undo
  not re-linking. Ink: 0 failing pairs over eleven Projects/calendar screens in four themes; an
  unreadable colour fails at 1.51 on both the new tab and the panel row.

## Chunk 6 — mail threads belong to a project, and Mail offers one
`modules/projects/{ThreadProjectBar,ProjectMail,threadLinks}.ts(x)`, the Mail tab in `ProjectPage`, a
Project bar in `SmartReader`, a chip on `SmartView`'s row, a snapshot refresh and a focus door in
`InboxModule`, `scripts/project-mail.mjs [reader|chip|suggest|page|sync]`.
- **A thread's link is `project_links` kind `thread`, `refId = "mailbox|threadId"`** — a thread id is
  only unique inside one mailbox, the same key mail's own marks use. Filing writes **nothing to
  Gmail** (asserted: no non-GET beyond the existing mark-read on open) and works on any mailbox.
- **The link carries a `ThreadMeta` snapshot** (subject, sender, when, mailbox), refreshed by
  `InboxModule` whenever the list holds the thread — the same shape as the event snapshot, and the
  same three rules: equal writes nothing, a thread the list does not hold keeps what it had, and a
  link with no snapshot yet reads "A conversation" rather than guessing.
- **One project per thread**: choosing another replaces. The row says it is filed — a small diamond
  chip beside the company chip — and only that row (a control that drew it on every row failed).
- **"Looks like Project X" is deterministic, explainable and quiet.** No model: instant, free, and it
  can say why. Three tiers, and it offers only when **exactly one project wins the best tier**:
  1 its whole name is in the subject; 2 every distinctive (≥4 letters) word of a name of two or more
  is in it; 3 the sender is on ≥2 threads already in that project and on none in any other. A tie
  (Budget / Budget review), an archived or finished project, an already-filed thread and a
  correspondent who writes about two projects all get **nothing** — a wrong label is worse than none.
  It only ever **offers**: nothing is filed without pressing Link; **Not this** is remembered per
  browser (`project-suggest-dismissed`) and survives a reload.
- **A vacuous control, caught:** the "two projects → no pattern" case opened a thread that was
  *already filed*, so the early "already has a project" exit answered and the rule under test never
  ran; the control for it passed. The fixture now has an unfiled fourth thread and asserts it is
  unfiled before asserting the absence.
- **Mail has a focus door now** (`focusOn({ module: 'inbox', id: 'mailbox|thread' })`): the project
  page's open arrow lands on that thread in the reader. Before this nothing could send you to a
  thread. A control with the door removed fails on "a reader is open", asserted first so the absence
  claims below it are about something.
- **Fixed on the way: `ReplyChip` used raw semantic tokens as text.** "No reply" was `--sb-negative`
  on an opened row's accent tint — 4.05 in Evergreen. Text takes the `-deep` tokens (`Replied` too);
  nothing had measured an opened row, and the audit's new reader visit is what found it.
  `--sb-warning` has no `-deep` and is left as it was.
- **Not done:** (the row marker has since been added — see the follow-ups) thread links on the flat list's unreachable branch, and
  filing several selected rows at once.
- **Controls** (each removed, the named assertion fails): name phrase, tie picks first, archived
  suggested, filed re-suggested, correspondent rule, dismissal, replace, page order, other projects'
  threads, no refresh, chip on every row, no focus door. Ink: 0 failing pairs over thirteen
  Projects/calendar/mail screens in four themes; unreadable colour fails at 1.51 on the Mail tab and
  the suggestion line.

## Chunk 7 — money, habits and books for a personal project
`modules/projects/{ProjectMoney,ProjectHabits,ProjectBooks,projectLife,useEntrySnapshots}.ts(x)`, three tabs in
`ProjectPage`, `scripts/project-life.mjs [money|locked|money-off|habits|books|library-off|work]`.
Linking is done **from the project page** (a picker per tab), not from Finance / Habits / the Library:
all three are local stores the page can list from, unlike events and threads. No other module's
screen or delete path was touched.
- **Each tab is behind the gate of the module it reads.** Finance off → no Money tab and **no finance
  table read** (`reads.finance` is empty — asserted beside "the page is open" so the absence means
  something); the Library off (either switch, `libraryIsOff()`) → no Books tab and no library read;
  Habits off → none. A personal project offers all three it may; a **work project offers none unless it
  already holds one of that kind**, so changing a project's kind never hides what is linked to it.
- **Money is behind the finance lock.** Locked, the tab draws a box that asks to be unlocked in place
  (the Expenses box's own `Unlock`, now exported) and **nothing of the ledger exists in the page** —
  no stat tile, no entry row, no payee or figure in its text. A wrong password opens nothing and says so.
- **Money follows the ledger's own rules, not its own.** `isUnpaid` from `unpaid.ts`: spent is settled
  expenses only; an unpaid expense is "Still owed", with its count; settled income is "Received" and is
  never in Spent; a transfer or asset movement is neither. Everything is summed by `sumInBase`, and a
  **currency with no rate is named and left out, never guessed**.
- **An entry link carries a snapshot** (`EntryMeta`: payee, amount, currency, date, paidAt, type),
  because Finance holds **one year at a time**. `useEntrySnapshots` (mounted by `ProjectsModule`)
  refreshes it whenever the entry is loaded; equal writes nothing; an entry from another year keeps what
  it had and is **not** called missing. "Not in Finance any more" is said only when the entry's year is
  the loaded one, Finance is not loading, and the entry is absent.
- **A deleted habit / book / entry is shown as deleted, with an unlink — never silently dropped.** Links
  are deliberately *not* removed on delete: removing them in each module's delete path would have touched
  three modules, and an undo of the delete (which restores the same id) brings the link back for free.
- **Habits**: the week is seven squares, oldest first, from `dayProgress` — a measured habit's part-day
  is drawn as a part-fill and **does not count as a done day** ("5 of 8 glasses" is 0.63, not 1). Asserted
  on computed `backgroundColor` / `backgroundImage`, not on the `data-p` attribute. Only active, unarchived
  habits are offered.
- **Books**: progress is the Library's own `progressOf` (the furthest page any sitting reached), derived,
  never stored; a book with no sittings says "No pages logged yet" rather than 0%.
- **Two vacuous fixtures, caught by controls that passed**: no income entry was linked, so "income counted
  as spent" could not fail; and two assertions failed only by *timing out* rather than asserting. Both now
  assert existence first. An existing-state fixture has to be able to make the claim false.
- **Not done:** (the budget has since been added — see the follow-ups) opening a book or habit from its row (the Library has no focus door), linking from the
  other modules' own screens, and shopping lists (`list` links).
- **Controls** (each removed, the named assertion fails): unpaid-as-spent, income-as-spent, unrated
  currency unreported, lock ignored, Money with Finance off, no snapshot refresh, missing ignoring the
  year, week order, part-day-as-done, retired habits offered, book progress ignoring sittings, Books with
  the Library off, personal tabs on a work project. Ink: 0 failing pairs over twelve Projects screens in
  four themes; unreadable colour fails at 1.51 on the money figures, the habit count, and the book lines.

## Chunk 8 — a plan from a template or from words, and dates for the undated

`ProjectPlanner.tsx` (Plan button on the page; a prompt card on an empty Overview), `projectPlan.ts`
(templates, validation, prompts). Two modes: **plan** (a template, or a description to the AI) and **date my
open tasks**. Both end in a **draft you review** — nothing is written until Add / Date.
- **No request until pressed; no write until confirmed.** Opening the dialog, choosing a template, Back and
  Cancel write nothing and ask nothing. `scripts/project-plan.mjs` counts both (store, server rows, and the
  Anthropic stub's request log).
- **Model output is untrusted.** `normalizeDraft` / `normalizeProposals` run on every answer: fenced JSON is
  read; blanks, non-objects and case-insensitive duplicates dropped; caps 8 milestones / 24 tasks; titles cut
  to 120; impossible dates (`2026-02-30`) and unknown priorities dropped; a phase named by index or by title
  resolves, a phase that does not exist leaves the task with none. A proposal survives only if the id was
  asked about, the date is real and inside [today-or-start, target], and it is the first for that task.
  Prose, a 500 and an answer empty once validated each say so and write nothing; the next press works.
- **Templates are stretched to the target** (last milestone = target, tasks dated before their phase); no
  target means a default spread from today. Personal projects are offered personal templates first.
- **Only ticked rows, with their edits, are written.** A task whose phase is unticked goes in with no phase,
  and says so. Tasks are placed with `placementForNew` (never the brain dump). One `pushUndo` removes the
  whole plan (tasks, then milestones); dating uses the task store's `_remember` snapshot, so one undo also
  puts back the quadrant a first date moved it out of.
- **Dated tasks reach the calendar** (`useTaskCalendarPush`), so the footer says how many will.
- **No key:** `aiConfigured()` disables the AI button with a note; templates still work.
- **Harness gotchas:** the Anthropic SDK retries a 5xx twice by itself (one press = 3 requests); the
  calendar scheduler and the assistant call the same endpoint, so count only the planner's prompts; an
  existing automation dates any undated **P0** task to today, so a P0 in a fixture is dated behind your back.
- **Controls** (removed, the named assertions fail): draft caps/dedupe/blank filtering; proposal id, window and
  one-per-task validation. Modes: templates, ai, messy, fail, nokey, schedule.
- **Not done:** AI replanning of an existing project, estimating effort, per-user templates.

## Chunk 9 — the project lens, beside the company one

`lib/projectFocus.ts` (the lens: `professor-project-focus`, an event, `useProjectFocus`),
`modules/projects/useProjectFocusClass.ts` (what a row asks), a **Focus** button on the project page, a chip in
the rail, `scripts/project-lens.mjs [tasks|calendar|mail|rail]`.
- **Same rules as the company lens, deliberately:** dimmed never hidden (the shared `sb-out-of-focus` class and
  its `!important`), hover brings a row back, a row that is not demonstrably the project's is out, and the way
  out is always drawn. The two lenses **AND**: `companyClass || projectClass`, one fade, so with both on a row
  has to be in both.
- **This file never decides what belongs to a project.** A task answers from its own `projectId`; an event from
  the project's `event` links **plus the calendar blocks (`gcalEventId`) of its tasks** — the project's own
  Calendar tab lists those too, so dimming them would contradict it; a thread from its `thread` links, keyed
  `mailbox|thread` like everywhere else. Wired in `TaskCard`, `TaskRow` (the List view *and* the matrix rows),
  `DumpCard`, the calendar's `EventBlock`, and `SmartView`'s row.
- **The rail chip** is drawn only while the lens is on, ringed in the project's colour, glyph in ink; it names
  the project in its label and clears the lens. **A project that is deleted while it is the lens clears it** (the
  same self-clean as a vanished company), but only once the store holds some projects — a cold start must not
  clear a lens that is about to be valid.
- **Not covered, on purpose:** Today, Finance, Habits, the Library, milestone markers on the calendar. Money,
  habits and books have their own tabs on the page; the lens is for the three modules that hold the project's
  working items.
- **Found on the way, fixed after:** the List view's rows are `TaskRow` and the pile beside it is `DumpCard`, and
  **neither had ever dimmed under the company lens** (only `TaskCard` did). Both now wear both lenses.
  `company-lens-dims.mjs tasks-list` measures *every* node showing the title: the first version found the first
  match, which is the pile, so removing the line from `TaskRow` still passed — each component's control now fails
  on its own node.
- **Measured as drawn opacity** — the element's and every ancestor's multiplied — and the dimmed rows are
  asserted to still have a box. **Controls** (each removed, the named assertion fails): the lens class on the
  list row, task-block ids, the mailbox half of the thread key, the self-clear on delete.
  Ink: 0 failing pairs over sixteen Projects screens in four themes.

## Follow-ups after the plan (one commit each)

### The plan gate — Projects is a module like the others
`20260044_projects_module.sql`, `project-module-gate.mjs [on|off|warm-off|lapsed]`.
- **Registered as the module `projects`** for every plan that lists anything (the `20260039` lesson: a plan
  that was not named lost the module), and `has_module(…, 'projects')` is in the three tables' policies.
  **Tasks are not gated here**: `project_id` rides the task row under the `tasks` policy, so a plan without
  Projects keeps every task and its pointer (read as unassigned, since no project loads).
- **Off means never loaded** (`entitlements.md` rule): the hydrate read, the live-sync handler and
  `projectStore.loadFromDB` each ask first. `loadFromDB` asks again *after* its read, because a warm boot starts
  on the cached plan and the answer can land mid-flight; applying that read would put back what the plan took.
- **A kept copy is not drawn.** The store persists to localStorage, so a device that had Projects still holds
  them. When the module is off the store is emptied (on hydrate and on every plan change), which hides every
  cross-module offer at once — the task panel's Project and Phase cells, the event and mail rows, the lens —
  because all of them already say nothing when there are no projects. The project lens also reads as null.
- **Measured:** cold boot with Projects off → none of the three tables read while tasks are (the control);
  warm boot on a stale "on" → emptied; plan lost while open → the tab goes and the next sync reads nothing.
  The stub **refuses like RLS** (`NO_RLS=1` stops it), and a control has to remove *every* defence: removing
  only the hydrate skip still passed because `loadFromDB`'s own guard answered.

### The sync-gap banner says when Projects cannot save
`SyncEntity` has `projects`; `scripts/project-sync-gap.mjs [ok|tables|columns|error|recovers]`.
- Until now a missing table, a refused write and a missing column all went to `console.warn`: rows stayed
  dirty and retried, and the other device simply never saw the project. Three voices, one banner paragraph
  (the habit/task sentences talk about pictures and notes, so projects have their own):
  **`tables`** (42P01 / PGRST205, from a push *or* the first read) — "only on this device … run 20260042";
  **`columns`** (`project_links.meta` refused, the existing silent fallback) — "saving, but what a linked event,
  thread or entry looks like stays on this device … run 20260043"; **`error`** — the server's own words.
- `projectDb` throws an Error that still carries the server's `code` (it used to flatten it to a message, so
  nothing downstream could tell a missing table from a refusal).
- **A success clears only what it proves.** `clearSyncGap('projects', ['tables','error'])`: a push that landed
  says the tables are there, not that a column still being left out has appeared.
- Controls (each removed, the named assertion fails): the push-path report, the load-path report, the meta
  report, the clear. Healthy server: no banner and the rows landed.

### A project dot on the calendar's event cards
`modules/projects/useEventProject.ts` (one memo for the grid), `EventBlock`'s `project` prop,
`project-lens.mjs dots`. A 9px dot top-right, the project's colour with a ring in `--sb-overlay` so it reads
on every fill; **the name is its label** (`role="img"`, `aria-label`, title) — colour alone identifies nothing.
- **Same answer as the event's panel:** a task's block belongs to its task's project, any other event to the
  project it is linked to. Archived and finished projects still own their events.
- Drawn on the grid's cards only (not the drag overlay); nothing for an event in no project. Not text, so the
  ink audit has nothing to measure on it — the claim is the computed colour, the box inside the card, and
  the count (three dots for three owned events, not one per card). Controls: task blocks left out, link kind.

### A suggestion marker on mail rows
`SmartView`'s row, `project-mail.mjs rows`. The reader already offered "Looks like Alpha"; the list now offers
the same thing, **quietly**: a dashed chip `◇ Alpha?` beside where the filed chip would be, and a `×`.
- **The same function answers** (`suggestProject`), so the row and the reader cannot disagree. It appears only
  when exactly one project wins the best tier — a tie, an archived or finished project, an already-filed
  thread and a correspondent who writes about two projects all get nothing, so a list of mail stays a list of
  mail. (That was the objection to doing this at all; it is dashed, 10px and ink-2 for that reason.)
- **Pressing the chip files it** (with the thread snapshot, nothing written to Gmail) and `stopPropagation`s;
  `×` is the reader's "Not this" and shares its per-browser memory, so a dismissal in either place holds in both.
- **Two guards overlap** — the row skips a filed thread, and `suggestProject` does too — so the control removes
  both; with only the row's removed it still passed. A "row click falls through" assertion was dropped: only the
  subject button opens a thread, so there was nothing to fall through to and it could not fail.

### Linking an event while composing it
`ComposerProjectRow`, `ComposerResult.projectId`, `project-events.mjs compose`. The composer has a Project row
(new events only; the existing-event panel keeps its own). It **only holds the choice**: with no event there is
no id to link, so `handleCreateEvent` links it after Google has answered, using the id Google gave and a
snapshot of the event. A refused create therefore leaves **no link** (the control that linked on the temp id
left one for an event that never existed). Nothing about the project is sent to Google. Live projects only,
and the row is absent when there are none.
- **The audit filter trap:** `INK_ONLY=Projects` only runs visits whose *name* contains it, so the calendar,
  mail and composer visits were silently skipped by it — the earlier "0 failing over 16 screens" did not include
  the mail row chip or the event row. Use `INK_ONLY="Projects|Calendar · an event|Calendar · composer|Mail · reader|Calendar · milestone"`
  (21 screens, 0 failing in four themes).

### A project budget
`20260045_project_budget.sql` (`budget_amount`, `budget_currency`, nullable, non-negative), `Project.budget`,
`BudgetCard` in the Money tab, `budgetStatus` in `projectLife.ts`, `project-life.mjs budget*`.
- **Decisions.** The budget keeps **the currency it was set in** (default: the base currency): "base" is a per-person
  setting that can change, and a bare number would quietly mean something else the day it does. It is compared in
  base using the ledger's own rates (`convert`); a budget in a currency **with no rate says so and compares nothing**
  (`unrated`) — never a 1:1 guess. One budget per project; none is normal and draws "No budget".
- **What counts as spent is the ledger's rule, not a new one**: settled expenses only. Unpaid bills are shown apart
  ("…would be left once the unpaid bill is paid"), and a linked entry with no rate makes the figure "at least".
- **It is in the Money tab, so behind the finance lock.** A budget and how much of it is gone are exactly what the
  lock exists to hide; locked, no budget card exists in the page (control: the card drawn in the locked branch fails).
  Consequence: a project with no money links and not personal has no Money tab, hence no budget — by design.
- **Over is text in `--sb-negative-deep` and a fill in `--sb-negative`** (colour is fill, words are ink); the bar's
  width is asserted as a measured fraction of its track beside `aria-valuenow`. The audit's Kitchen fixture is
  over-budget on purpose so the red text is on a screen it measures (1.51 when made unreadable).
- **Sync.** Columns are sent only when a project has a budget or the table has shown it carries them, and a refusal
  naming them retries without (`projects.budget` gap, banner names 20260045). `toProject` gives an **explicit
  `budget: undefined` when the row carries the columns and they are null**, so clearing on another device clears
  here; a row *without* the columns says nothing, so a budget this browser holds is not wiped by a database that
  cannot store it. Row comparisons use the same `budgetColumnsUsable()` so a missing column does not make every
  load look different (the ping-pong guard).
- **Controls** (each removed, the named assertions fail): guessing a missing rate, owed counted as spent, plain
  negative text, clearing as silence, columns always sent, the card in the locked branch.
- **Not done:** per-milestone budgets, budget alerts, a budget shown on the project card (it is a figure, and the
  grid is not behind the lock).

## Plan
0 rules file · 1 migration, types, store, sync (no UI) · 2 rail tab, cards,
create/edit · 3 project page, Tasks tab, task panel picker · 4 milestones and
timeline, calendar markers · 5 calendar links · 6 mail links and suggestion ·
7 finance, habits, books links · 8 AI templates and planning (preview, then
confirm) · 9 project filter in the lens.

## The project add / edit form is a right-hand panel, not a centred dialog
`ProjectDialog` was a fixed, scrimmed, centred modal — the one add panel in the app that did not dock. It is an
`<aside data-project-dialog>` in the task panel's shape (card clips, header and footer pinned, the form scrolls) and
the caller puts it **in a row beside the page**: `ProjectsModule` and `ProjectPage` are `display: flex; flex-wrap: wrap`
with the page as a `flex: 1 1 420px` column and the panel after it (sticky, 300–400px). Nothing dims the page and it is
not `aria-modal`. On a phone it wraps under the page and scrolls itself into view. Name kept, so the Escape handler,
`data-project-dialog` and the harnesses still find it. `scripts/projects-tab.mjs` now asserts the geometry (panel left
edge at or past the page's right edge, inside the window, no full-window scrim) in place of "above the page it dims".
