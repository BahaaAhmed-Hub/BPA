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

## Plan
0 rules file · 1 migration, types, store, sync (no UI) · 2 rail tab, cards,
create/edit · 3 project page, Tasks tab, task panel picker · 4 milestones and
timeline, calendar markers · 5 calendar links · 6 mail links and suggestion ·
7 finance, habits, books links · 8 AI templates and planning (preview, then
confirm) · 9 project filter in the lens.
