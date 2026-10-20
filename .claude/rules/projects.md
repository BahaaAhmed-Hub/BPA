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
  module URL once its file has been edited, so `import('/BPA/src/store/x.ts')`
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
- **Not done:** a project dot on the event cards in the grid, and linking while *composing* a new
  event (the composer has no `extra` slot; link it once it exists). Recurring series link per
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
- **Not done:** a suggestion marker on the *rows* (it is in the reader only — on the list it would
  be the noise the kinds work removed), thread links on the flat list's unreachable branch, and
  filing several selected rows at once.
- **Controls** (each removed, the named assertion fails): name phrase, tie picks first, archived
  suggested, filed re-suggested, correspondent rule, dismissal, replace, page order, other projects'
  threads, no refresh, chip on every row, no focus door. Ink: 0 failing pairs over thirteen
  Projects/calendar/mail screens in four themes; unreadable colour fails at 1.51 on the Mail tab and
  the suggestion line.

## Plan
0 rules file · 1 migration, types, store, sync (no UI) · 2 rail tab, cards,
create/edit · 3 project page, Tasks tab, task panel picker · 4 milestones and
timeline, calendar markers · 5 calendar links · 6 mail links and suggestion ·
7 finance, habits, books links · 8 AI templates and planning (preview, then
confirm) · 9 project filter in the lens.
