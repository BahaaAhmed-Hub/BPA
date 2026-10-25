# Projects — product and technical reference

Status: shipped to `main` (PR #53). Migrations `20260042`–`20260045`. The engineering
rules and every measured claim live in `.claude/rules/projects.md`; this is the readable
summary of what the module is and how it is built.

---

# Part 1 — Product

## What it is
A **project** is one outcome with an end — "Launch the new website", "Renovate the
kitchen" — that gathers the work for it from the rest of the app. It does **not** replace
the task board, the calendar or mail. It *points at* their records, so nothing is copied
and nothing has two homes.

Two kinds, same data model:

| | Work | Personal |
|---|---|---|
| Belongs to | exactly one company (optional until chosen) | no company |
| Tabs | Overview, Tasks, Timeline, Calendar, Mail | the same, plus Money, Habits, Books |
| Money / Habits / Books | only if something of that kind is already linked | always offered (if the module is on) |

Status: **idea · active · paused · done**, plus **archived**. Colour is a stripe/fill only;
every word on screen uses ink tokens.

## What you can do

**Projects tab.** A grid of cards: progress bar, "3 of 9 tasks done · 1 overdue", dates,
status. Create/edit in a dialog (name, kind, company, colour, status, start/target dates,
notes). Deleting a project **keeps its tasks and orphans them** (they become ordinary
tasks); its milestones and links go with it.

**Project page.**
- **Overview** — progress, done/open/overdue counts, dates, company, notes.
- **Tasks** — add a task straight into the project (placed in *Do*, never the brain dump),
  tick it (through the same "what did you produce?" gate as the board), bring in an open
  task that is in no project, take one out.
- **Timeline** — milestones as diamonds on a proportional axis with today, start and
  target marked; rows are editable (name, date, done; Enter/blur saves, Escape cancels).
  A milestone dated after the target is flagged.
- **Calendar** — upcoming and earlier events: explicit links plus the calendar blocks of
  the project's tasks (shown once).
- **Mail** — linked threads, opening one lands on it in the reader.
- **Money** *(personal)* — Spent / Received / Still owed from linked finance entries, a
  **budget** card, an entry picker. Behind the finance lock.
- **Habits** *(personal)* — the last seven days as squares; a part-day is a part-fill and
  does not count as done.
- **Books** *(personal)* — progress from the Library's own sittings.
- **Plan** — see below. **Focus** — see below. **Edit**.

**Planning (templates and AI).** *Plan* offers five templates (launch, trip, renovation,
learn, move) or a free-text brief to the AI. Either produces a **draft you review**:
untick rows, rename, re-date; **nothing exists until Add**, and one Ctrl+Z removes the
whole plan. A template is stretched to the project's target date. A second tab, *Date my
open tasks*, asks the AI to propose dates for undated tasks inside the project's window.
Dated tasks reach the calendar as any dated task does; the footer says how many will.
Without an AI key the AI button is disabled with a note and templates still work.

**Linking things from where you already are.**

| Thing | Where you link it |
|---|---|
| Task | the task panel's **Project** field (and **Phase**); or the project's Tasks tab |
| Event | the event panel's **Project** row; the composer's **Project** row when creating |
| Mail thread | the reader's **Project** row; or press the dashed `Alpha?` chip on a row |
| Finance entry | the project's Money tab |
| Habit / Book | the project's Habits / Books tab |

One project per event and per thread (choosing another replaces). A task's calendar block
belongs to its task's project automatically — there is no second choice to contradict it.
Linking **never writes to Google or Gmail**.

**Seeing it everywhere.**
- **Focus** (button on the project page) dims everything in Tasks, Calendar and Mail that is
  not the project's — dimmed, never hidden; hover brings a row back. A chip in the rail
  shows it is on and clears it. It combines (AND) with the company lens.
- A **coloured dot** on calendar event cards names the project.
- A **dashed chip** on a mail row, and a line in the reader, say *"Looks like Alpha — its
  name is in the subject"*. It only ever offers; nothing is filed without a press, and `×`
  / "Not this" is remembered per browser. It stays silent on ties, finished/archived
  projects and already-filed threads — a wrong label is worse than none.
- Milestones appear on the calendar as a "Due" strip (week/day) and chips (month); a click
  opens the project, never an event panel. Nothing is written to Google.

**Budget.** One optional amount per project, in the currency it was set in (default: your
base currency). Spent is the ledger's own rule — settled expenses only; unpaid bills are
shown apart ("…would be left once the unpaid bill is paid"). Over budget reads "Over by …".
A currency with no exchange rate is **named, never guessed**. Lives in the Money tab, so it
is behind the finance lock.

**Plans and access.** Projects is a plan module like Tasks or Finance. If a plan lacks it,
the tab, every Project field, the lens and the data load all disappear, and a copy kept on
the device is emptied. Nothing is deleted server-side.

## Deliberate non-goals
Sharing between users (rows carry `user_id` and nothing more), per-milestone budgets,
budget alerts, a budget on the grid card (it is a figure and the grid is not behind the
lock), AI replanning of an existing project, per-user templates, opening a habit/book from
its row, linking shopping lists.

---

# Part 2 — Technical

## Architecture at a glance
```
                      ┌────────────── Supabase ──────────────┐
 projectStore ──push──► projects · project_milestones ·       │
 (Zustand,    ◄─load──  project_links (meta jsonb)            │
  persisted)          │ tasks.project_id / milestone_id       │  (no FK)
        ▲             └──────────────────────────────────────┘
        │ links (event|thread|entry|habit|book|list)
 calendar · mail · finance · habits · library  ──own their records, project points at them
```
Files: `src/modules/projects/*`, `src/store/projectStore.ts`, `src/lib/projectFocus.ts`,
`src/lib/projectStats.ts`; edits in `TaskDetailPanel`, `TaskCard/TaskRow/DumpCard`,
`CalendarIntelligence`, `NewEventPanel`, `SmartView/SmartReader/InboxModule`, `SideRail`,
`App`, `syncStatus`, `SyncGapBanner`, `liveSync`, `dbSync`, `taskStore`.

## Data model (migrations)
| Migration | Adds |
|---|---|
| `20260042_projects.sql` | `projects`, `project_milestones`, `project_links` (unique `project_id,kind,ref_id`), `tasks.project_id` and `milestone_id` (**no FK**), own-rows RLS, realtime |
| `20260043_project_link_meta.sql` | `project_links.meta jsonb` (snapshot) |
| `20260044_projects_module.sql` | module `projects`, `plan_modules` for every plan that lists anything, `has_module` in the three policies |
| `20260045_project_budget.sql` | `projects.budget_amount`, `budget_currency` (non-negative check) |

Types (`types.ts`): `Project` (`kind`, `status`, `companyId?`, dates, `notes?`,
`budget?: {amount,currency}`, `archived`), `ProjectMilestone`, `ProjectLink`
(`kind`, `refId`, `meta?`), and the snapshots `EventMeta`, `ThreadMeta`, `EntryMeta`.
Progress, health and timeline position are **derived, never stored**.

## Links and snapshots
- `refId` is the other module's own id (a string — Google event ids are not uuids). Threads
  use `mailbox|threadId` because a thread id is only unique within a mailbox.
- A link carries a **snapshot** (`meta`) because the project page cannot ask Google or Gmail
  and Finance holds one year at a time. The owning module **refreshes the snapshot whenever
  it has the item loaded**; equal snapshots write nothing (no ping-pong) and an item that is
  not loaded keeps what it had. "Not in Finance any more" is claimed only for the open year.
- Links are deliberately **not removed when the other record is deleted** — it is shown as
  deleted with an unlink, and an undo of the delete brings it back. Events are the exception:
  deleting an event drops its links and undo re-links to the event's **new** id.
- Tasks carry `projectId`/`milestoneId` on the record; deleting a project clears them
  locally (`taskStore.clearProject`) and on the server (`orphanProjectTasks`, a direct
  update that also reaches tasks this device has not loaded).

## Sync rules (same discipline as tasks)
- Rows push **by id**, never "everything not in my list"; deletes are explicit **tombstones**
  (`professor-projects-deleted`, 30 days).
- A **dirty** set (made here, may not be on the server) and an **edited** set (the only thing
  the field merge reads; never seeded) — `professor-projects-dirty/-edited`.
- `markLocalWrite('projects')` on every write; the hydration merge is pushed back only when it
  differs from what the server just sent; a link made on two devices dedupes on
  (project, kind, ref), the server's id winning.
- Optional columns (`task project_id`, `link meta`, `budget_*`) are sent **only when needed**
  and a refusal naming them retries without, so a database missing a migration still saves
  everything else. `toProject` emits an explicit `budget: undefined` when the row carries the
  columns and they are null (so a clear on another device clears here), and says nothing when
  the columns are absent (so a budget held here is not wiped).
- The sync-gap banner (`SyncEntity 'projects'`) says **tables missing** (run 20260042),
  **columns missing** (20260043 / 20260045) or the server's own error. A success clears only
  what it proves.

## Entitlement gate
`moduleIsOff('projects')` is asked by: the hydrate read, the live-sync handler, and
`projectStore.loadFromDB` (before **and after** its read — a warm boot starts on the cached
plan and the answer can land mid-flight). When off, the store is emptied on hydrate and on
every plan change, which hides every cross-module offer because each already says nothing
when there are no projects. `focusedProject()` reads null when off. A failed plan read keeps
the last answer (and everything on if there is none) — the project-wide rule.

## The lens
`lib/projectFocus.ts` holds `professor-project-focus` and an event; rows ask
`useProjectFocusClass()` → a task answers from its `projectId`, an event from event links plus
the `gcalEventId` of the project's tasks, a thread from thread links. It reuses the company
lens's `sb-out-of-focus` class (one fade; `!important` because cards set opacity inline) and
`companyClass || projectClass` gives the AND. A lens on a deleted project clears itself, but
only once the store holds projects (a cold start must not clear a valid lens).

## Planning internals
`projectPlan.ts` — templates, prompts, and **untrusted-output validation**: fenced JSON read;
blanks, non-objects and case-insensitive duplicates dropped; caps 8 milestones / 24 tasks;
titles to 120; impossible dates and unknown priorities dropped; a phase resolves by the model's
own index or title, else none; a dating proposal survives only if the id was asked about, the
date is real and inside the window, and it is the first for that task. Failures (500, prose,
empty-after-validation) say so and write nothing. `ProjectPlanner.tsx` writes only ticked rows,
places tasks with `placementForNew`, registers one `pushUndo` (plan) or one `_remember`
snapshot (dating).

## Money and the budget
`projectLife.moneyTotals` follows the ledger: `isUnpaid` keeps unpaid money out of Spent,
`sumInBase` sums in the base currency and **names** a currency with no rate rather than
guessing. `budgetStatus` converts the budget into base with `convert`; `unrated` if it
cannot. Everything is inside `ProjectMoney`, behind `useFinanceLock` (locked → nothing of the
ledger or the budget exists in the page).

## Design rules this module follows
Dimmed-never-hidden; text in ink tokens only (`-deep` tokens for semantic text; colour is
stripe/fill); markers are not events (nothing is written to Google); suggestions only offer;
outward/irreversible actions need an explicit press; every destructive path is undoable or
keeps the data.

## Verification
Every behaviour has a Playwright harness against a dev server on 5199 and a **control** that
removes the defence and must fail (rules in `.claude/rules/harness.md`):

| Harness | Covers |
|---|---|
| `project-sync` | create, elsewhere, refused, edit-wins, orphan, orphan-patch |
| `projects-tab`, `project-page` | grid, dialog, page, task panel field |
| `project-timeline` | axis, phases, calendar markers (week/month) |
| `project-events` | panel, page, snapshot sync, delete/undo, composing |
| `project-mail` | reader, chip, suggest, page, sync, rows |
| `project-life` | money, lock, module off, habits, books, work, budget* |
| `project-plan` | templates, ai, messy output, failure, no key, schedule |
| `project-lens` | tasks, calendar, mail, rail, dots |
| `project-module-gate`, `project-sync-gap` | plan gate, banner |
| `ink-audit` | `INK_ONLY="Projects\|Calendar · an event\|Calendar · composer\|Mail · reader\|Calendar · milestone"` — 21 screens × 4 themes, 0 failing pairs |

Known and unrelated: `company-lens-dims.mjs calendar` ("the header counts what is in focus")
fails without these changes too. Test-setup traps worth remembering: Vite appends `?t=` to an
edited module URL (take store URLs from resource timing); `INK_ONLY` filters on screen *name*;
the Anthropic SDK retries 5xx twice; an existing automation dates undated **P0** tasks to today.

## Operating notes
- Deploy: merge to `main` → `deploy.yml` (Pages) and `migrate.yml` (migrations by filename).
- If Project fields are missing in the UI: no live project exists, the plan lacks the module,
  a migration did not apply (banner), or a stale cached build — hard-reload.
