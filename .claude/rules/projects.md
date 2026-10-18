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

## Plan
0 rules file · 1 migration, types, store, sync (no UI) · 2 rail tab, cards,
create/edit · 3 project page, Tasks tab, task panel picker · 4 milestones and
timeline, calendar markers · 5 calendar links · 6 mail links and suggestion ·
7 finance, habits, books links · 8 AI templates and planning (preview, then
confirm) · 9 project filter in the lens.
