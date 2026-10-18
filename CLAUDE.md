# BPA — Professor AI App · Project Memory

## Where the rest of this lives
This file is read on **every turn**, so it holds only what is true everywhere.
Everything else is in `.claude/rules/`, one file per area, each loading only
when a file it names is read or edited — which is why this file is ~250 lines
rather than 4,392.

| Read this before touching | File |
|---|---|
| the ledger, budgets, goals, the forecast, the finance lock | `.claude/rules/finance.md` |
| shopping lists, the board, stores, the price watch | `.claude/rules/shopping.md` |
| the calendar grid, the event composer, booking and open hours | `.claude/rules/calendar.md` |
| mail — the smart view, kinds, invitations, the reader | `.claude/rules/mail.md` |
| the task board, quadrants, the planner, undo | `.claude/rules/tasks.md` |
| habits, logs, the record, Apple Health | `.claude/rules/habits.md` |
| edge functions, the bots, migrations, the deploy workflows | `.claude/rules/server.md` |
| Settings, accounts, prefs sync, entitlements, automation | `.claude/rules/settings.md` |
| the assistant panel, its face, name and voice | `.claude/rules/assistant.md` |
| the Library — shelf, quotes, reader, discover, tracker, releases | `.claude/rules/library.md` |
| the rail, one ground, ink, overlays, companies, the lens, link previews | `.claude/rules/shell.md` |
| projects — milestones, links across modules, project page | `.claude/rules/projects.md` |

**If you are about to work in one of those areas and its file is not already in
context, read it first.** The glob should load it; a pointer you can act on is
the belt to that braces. `@imports` are deliberately not used — they are
expanded at launch, so they would move the text without moving the cost.

A rule file is dropped by `/compact` and reloaded on demand; anything that
must survive compaction belongs **here**, which is why the three cross-cutting
sections below are in this file and not in an area's.

**`.claude/rules/` is tracked on purpose** — `.gitignore` carries `.claude/*`
with `!.claude/rules/`. Ignored, as it was for one commit, 123 of these
sections existed on one machine only: `main` held this root file and nothing
else, and a cloud session clones the remote rather than a working copy.
`node scripts/memory-is-all-there.mjs` is the check, and it has to be run
**against a fresh clone** to mean anything — against the working copy it
passed, because the files were sitting on disk.

## How a change is proven here
Every claim in those files was measured, and the method is the point:
- **Measure, never read.** A DOM assertion passes with the rule missing from
  the sheet; `innerText` has no opinion about stacking; a scripted
  `.click()` skips hit-testing. Read `getComputedStyle`, `getBoundingClientRect`,
  `elementFromPoint`, the store, or the request trace.
- **Every claim gets a control** — the same fixture on the code before the fix,
  or one property reverted on the very same element. A control has to remove
  **every** defence against the fault it demonstrates, or it measures whichever
  one somebody left in.
- **A vacuous pass is the hazard this project keeps hitting.** A screen that
  never opened, a selector that matched nothing, an `addInitScript` branch
  reading a Node variable, a fixture in a shape where the bug cannot occur.
  Assert the thing **exists** before asserting what it does not contain, and
  put a positive claim beside every absence.
- **A fixture that cannot fail is the bug.** A stub server has to be able to
  refuse.
- `scripts/*.mjs` are those harnesses — `.claude/rules/harness.md` is how they
  are written and why they no longer sleep.
- `node scripts/ink-audit.mjs 5199` after touching a token, a palette, or the
  **ground** any text sits on. `INK_THEME=<id>` runs one theme;
  the four are `sunlit-bento`, `warm-minimal`, `evergreen`, `glass-depth`.
- `npm run build` before pushing. It is blind to a colour that is simply
  wrong, and to anything in an edge function.

## Stack
- **React 19 + TypeScript + Vite + Zustand**
- Branch: `claude/professor-web-app-dev-tnj0uk` (current dev branch; older work was on `claude/build-professor-ai-app-sDbyz`)
- Always run `npm run build` to verify before pushing (strict `noUnusedLocals`)

## Design System — Sunlit Bento
| Token | Value |
|---|---|
| Page bg | `#F7F4EA` |
| Rail/nav bg | `#FCFAF4` |
| Card bg | `#FFFFFF` |
| Field bg | `#FAF7EC` |
| Border | `#E8E1CE` |
| Hairline | `#F0EBDC` |
| Primary ink | `#191712` |
| Muted ink | `#6C6553` |
| Ghost ink | `#9B9180` |
| Amber accent | `#F5D14E` |
| Positive (green) | `#0C8140` — `POSITIVE` in `src/lib/moneyColors.ts` |
| Negative (red) | `#C62828` — `NEGATIVE` in `src/lib/moneyColors.ts` |
| Active nav pill | `#FFFFFF` bg + `box-shadow: 0 1px 3px rgba(25,23,18,.16)` (NOT amber) |

Typography: `Outfit` headings, system-ui body. Section titles: 28px Outfit 600, `letter-spacing: -0.03em`.

## Contrast — the four themes are AA clean
Every text/background pair in all seven modules is at or above 4.5:1, measured
with `aa-theme.mjs` (compositing alpha, and reading Chrome's `color(srgb …)`
form of `color-mix` correctly — as 0..1, or a pale tint audits as near-black).
Two tokens carried every failure:
- **`--sb-ink-4`** — darkened in the three light themes, lifted in Glass, each
  by the minimum that clears 4.5 on **its worst ground**, which is a *tint*
  (`--sb-accent-tint`, `--sb-positive-tint`) rather than the card. Solving
  against the card alone leaves the "per year"-style captions failing.
- **Warm Minimal's `--sb-accent`** — `#C4633F` → `#B05939`. The primary button
  is a label on this fill at 12.5–13.5px/600, which WCAG counts as normal text.
  A mid-tone terracotta cannot carry 4.5 either way — the specified off-white
  read 3.78, pure white 4.04, near-black 4.39 — so the fill had to move. The
  tints, the border and `--sb-accent-deep` are separate tokens and did not.

## Key Files
| File | What it does |
|---|---|
| `src/modules/settings/Settings.tsx` | All settings — nav groups, section components |
| `src/modules/tasks/TaskCard.tsx` | 3-row task card (9A design) |
| `src/modules/habits/HabitsModule.tsx` | Habits table + 10B side detail panel |
| `src/modules/finance/screens/BudgetScreen.tsx` | Budget + 20E envelope drill-down overlay |
| `src/App.tsx` | Router / shell — `NAV_ITEMS` is the top menu (Mail included) |
| `src/store/`, `src/lib/` | Zustand stores, DB sync, Google OAuth |
| `src/lib/liveSync.ts` | Cross-device live sync (Realtime push + poll fallback) |

## Cross-device sync
Habits, tasks and finance stay in step **while both devices are open** — no reload.
`startLiveSync(userId, handlers)` (App.tsx, 3 auth call sites) asks the owning store to
reload; it never applies row deltas. Woken by Postgres change events (~1s, needs
`20260004_realtime.sql`) and by a poll + visibility/focus/online pull (3 min alone — it was 45s, 23 reads
each time — and 5 min once Realtime is confirmed; `scripts/live-sync-poll.mjs`). Finance had no `loadFromDB()` caller at all before this.

Three rules any change here must keep:
- **`markLocalWrite(domain)`** on every write path, or a reload pulls the old row back
  over an edit in progress. Stores call it; `financeDb.ts` calls it in its 11 helpers.
- **Dirty sets** (`professor-habits-dirty`, `professor-tasks-dirty`) answer "is this
  row missing from the server because it was made here?" A row missing from the server
  is *deleted elsewhere* unless it is dirty — otherwise every delete undoes itself.
  Seeded with all local ids on a device that predates the key, because that question
  has to fail safe.
- **That seed is a claim about provenance, not about time — and habits used to read it
  as both.** One list answered "might not be on the server" *and* "my copy of these
  fields is newer", so on a device that had never edited a habit in its life every
  habit counted as newer here: an edit made on the laptop never appeared on the iPad,
  and the iPad then pushed its untouched copy back over it. Two devices, one right,
  and the wrong one won. `professor-habits-edited` is the second list: written only by
  `addHabit`/`updateHabit`/`deleteHabit`, cleared on a successful push, **never
  seeded**, and it is the only thing the field merge may read. Absence of an edit is
  not evidence of one. `professor-tasks-edited` is the same split in
  `taskStore`, where it was worse: `scheduleDbSync(tasks)` marked the **whole
  list** dirty on every edit, so touching one task on the iPad claimed all of
  them. It now takes the ids the change actually touched —
  `scheduleDbSync(next, [id])` — with `[]` for the two pushes that are not
  edits: the hydration push-back, and a reorder (order is not a column, so
  nothing about a task travels when it moves).
- **Coming back to the tab pulls a domain only if it has not been read in the last
  minute** (`WAKE_MIN_GAP_MS`). A pull is one read per table — 23 — and `focus` fires on
  every alt-tab, so each used to re-read the whole account. `online` is exempt: whatever
  was missed offline has to be read. `scripts/live-sync-wake.mjs` — five alt-tabs went
  from 115 reads to 0, and a return after a minute still pulls.
- **A server that is failing is left alone** (`src/lib/serverStrain.ts`). The Supabase
  client's `fetch` notes every answer from `/rest/v1/` and `/auth/v1/`; a 5xx, 408, 429 or
  dropped connection starts a wait — 15s, doubling to 5 minutes — and `liveSync.run` queues
  its pull behind it, one domain at a time, so recovery starts as a probe rather than 23
  reads. **A round of failures counts once** (a failed pull is 23 failures at the same
  moment), and any other answer resets it. A 402/403 is a refusal, not strain, and edge
  functions are not counted. Writes are never held. `scripts/server-backoff.mjs`.
- **Push the hydration merge back only when it differs from what the server just sent**,
  or two open devices trade writes forever.

## An action that reverts a minute later — one shape, two modules
"I mark a task done and it comes back", "I act on mail and it reverts after
30–60 seconds". The same shape both times: **a local change with no claim on
it, overwritten by a reload that replaces wholesale.** Neither needed a failed
write — both were measured with the server accepting everything.

**Tasks.** `toggleComplete` and `setStatus` called `saveTasksToDB` *directly*
rather than through `scheduleDbSync`. Writing at once is right — the comment
says so, and a 1.5s debounce really can lose the change to a refresh — but
`scheduleDbSync` was quietly doing two other things on every caller's behalf:
- **`markTasksDirty(next, [id])`** puts the id in `professor-tasks-edited`, and
  that list is the only thing `loadFromDB`'s merge consults —
  `edited.has(id) ? {...fromDb, ...t} : {...t, ...fromDb}`. Without it the
  **server wins every field**, `completed` included.
- **`markLocalWrite('tasks')`** arms liveSync's 3s quiet window. Without it a
  poll, the pull when you come back to the tab, or another device's Realtime
  event (~1s) reloads *while the write is still in flight*.
`pushTasks` now holds the push and its bookkeeping, `pushDbSyncNow` writes
immediately with the edit claimed first, and `scheduleDbSync` keeps the
debounce over the same push. `scripts/completion-sticks.mjs` — the server
stores what is upserted but takes a realistic moment to accept it, and the
reload lands in that window. Control: the tick reads as done,
`professor-tasks-edited` is `[]`, and the reload puts `completed` back to false.

**Mail.** `runSmart` resolves with `setSmart(r)`, which **replaces** the whole
result, and `markSmart` only ever patched React state. So every mark made while
a pass was in flight was discarded when that pass landed — and on a real inbox
a pass takes tens of seconds: every mailbox listed, every changed thread
fetched, the model asked. Open Mail, start clearing rows, and half a minute
later they are all back, because the pass was built from rows read before you
touched anything. **That is the 30–60 seconds.**
- `localMarks` is the claim, keyed `accountEmail|threadId`, and `withLocalMarks`
  re-applies it over whatever a pass brings back — the mail analogue of
  `professor-tasks-edited`.
- **A mark is dropped only when the server's row already agrees with it.** That
  is what "pushed" means, and it self-clears. A write that landed answers for
  itself on the next pass; one that silently failed — every outcome but `42P01`
  is swallowed in `mailSmartDb`, and mail reports no sync gap at all — keeps
  your decision on screen rather than snapping the row back with no
  explanation.
- **It cannot pin a row hidden for ever.** The re-applied marks go through the
  same test `visibleThreads` uses, so an archive is still compared against the
  thread's newest message rather than treated as a flag: a reply brings it
  back. Asserted, because that is the way this fix could over-reach.
- Session-only, deliberately: a reload reads the server afresh.
`scripts/mail-action-sticks.mjs` — stored rows drawn, a slow pass, a row
archived *during* it. Control: 3 shown → archive → 2 shown → the pass lands →
**3 shown**, the action undone.

## Editing — every module's own records, proven in a browser
One harness per module, each seeding the shape the **server** sends rather than
the store's persisted copy — a store hydrates and *replaces* its list, so a
localStorage seed is overwritten a few seconds after the page settles and the
screen looks empty for reasons that have nothing to do with the code.
- **Finance** — an entry opens and saves from all four feeds: Today, Balances,
  Financials and the Budget envelope drill-down (which needed the four fixes
  above). 3 assertions each, plus the drill's flags.
- **Tasks** — the detail panel's title and notes both write through to the
  store *and* to `tasks` on the server. 8 assertions.
- **Calendar** — the event panel edits write straight through to Google
  (`PATCH`, held 700ms), measured by intercepting `www.googleapis.com`.
- **Habits** — any of the last 91 days from the heatmap square (above).
- **A task's activity log is deliberately not editable.** `TaskActivity` is
  machine-written — `created`, `moved`, `status_changed`, `field_updated`,
  `attachment_added`… — and carries no user-authored entry. Making it editable
  would be a way to falsify the record of what happened, which is the one thing
  an audit trail exists to prevent. The things a person *wrote* — the title, the
  notes, the checklist, the dates — are all editable in the panel above it.

## Git Push Pattern
```bash
git add -A
git commit -m "feat: ..."
git push -u origin claude/professor-web-app-dev-tnj0uk
```

## Build Gotchas
- `noUnusedLocals: true` — every declared variable must be used. Prefix unused params with `_`. For unused module-level functions/consts, delete them or export them.
- Pre-existing unused vars scattered in `finance/screens/` — fix by prefixing or deleting if truly dead code.
- `npm run build` = `tsc -b && vite build` — both must pass.
