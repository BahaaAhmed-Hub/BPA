# BPA — UI Unification: full brief for Claude Code

> **How to use:** save this file in the repo as `docs/ui-unification.md`, then tell Claude Code:
> *"Read docs/ui-unification.md and do the next phase that isn't marked done in its Progress table."*
> Everything Claude Code needs — the task, the rules, the files, and how to test — is in this one file.

Repo: `BahaaAhmed-Hub/BPA` (read at `main`, 2026-10-19). Every finding below was found by reading the source; the file:line references are from that read and may drift a few lines — always re-locate with `rg`.
This is **not** a redesign. It removes inconsistencies so the later redesign has one clean system to build on. Don't change layouts or features unless a phase says so.

---

## 0. Instructions for Claude Code (read first)

**The loop for every phase**
1. `git checkout main && git pull`, then `git checkout -b ui/<phase-id>` (e.g. `ui/p0-1-type-floor`).
2. Read the root `CLAUDE.md`, `.claude/rules/shell.md`, `.claude/rules/harness.md`, and the `.claude/rules/<area>.md` of every area you touch.
3. **Before editing, run the tests in §T and save the output** as the baseline/control (`/tmp/ui-before-<phase>.txt`, plus screenshots).
4. Apply exactly what the phase says. Find every match with `rg`; don't hand-pick files.
5. Run the full test suite in §T again. All of it has to pass, and the guard for this phase has to go from failing (before) to passing (after). That before/after pair is the proof.
6. Commit with the `ui:` prefix, push, open a PR titled `UI <phase-id> — <name>`. In the PR description include: files changed, the guard's before→after counts, ink-audit results for all 4 themes, and before/after screenshots.
7. Mark the phase **done** in the Progress table at the bottom of this file, in the same PR.
8. **Stop and report.** Do not start the next phase until the owner says go.

**Never**
- Change layout, copy or behaviour beyond what the phase lists.
- Add new `--sb-*` tokens without saying so in the PR (P0.3 allows one, `--sb-avatar-ground`, if the audit needs it).
- Use `pkill -f vite` (it kills your own shell — see harness.md).
- Mark a test passed if the screen it checks never opened (see "vacuous pass" in CLAUDE.md).

---

## Ground rules (from the repo's own CLAUDE.md — keep them)
- Read the matching `.claude/rules/<area>.md` before touching an area.
- After any token/colour change: `node scripts/ink-audit.mjs 5199`, across all four themes (`sunlit-bento`, `warm-minimal`, `evergreen`, `glass-depth`).
- `npm run build` must pass (`noUnusedLocals`).
- One phase = one branch/PR. Commit message prefix `ui:`.
- Measure, never read: prove each fix with `getComputedStyle` / screenshots, plus a control.

---

## P0 — Foundations (touches every screen; do first)

### P0.1 Type floor — nothing under 12px
Today: `--sb-t-micro 10px`, `--sb-t-meta 11.5px`, `--sb-t-body-s 12.5px`, `--sb-t-body 13.5px` (`src/index.css:196-201`), plus ~120 hard-coded `fontSize: 9 | 9.5 | 10 | 10.5 | 11 | 11.5`.
1. In `src/index.css` set: `--sb-t-micro: 11px` (caps only, it's tracked +.12em), `--sb-t-meta: 12px`, `--sb-t-body-s: 13px`, `--sb-t-body: 14px`, `--sb-t-label: 14px`. Leave h3/h2/h1/display.
2. Replace every numeric `fontSize` literal ≤ 13 in `src/modules/**` and `src/components/**` with the nearest token:
   - 9 / 9.5 / 10 (uppercase, tracked) → `var(--sb-t-micro)`
   - 10 / 10.5 / 11 / 11.5 (normal case) → `var(--sb-t-meta)`
   - 12 / 12.5 → `var(--sb-t-body-s)`; 13 / 13.5 → `var(--sb-t-body)`
   - SVG `fill` text in charts (`ReflectionScreen.tsx:184,191`, `GoalTimeline.tsx:302,347`) → 11px minimum.
   Find them with: `rg "fontSize: (9|10|11|12|13)(\.5)?\b" src`
3. Worst offenders to check visually afterwards: `calendar/CalendarIntelligence.tsx` (3240–3571), `calendar/CalendarRail.tsx` (32,171,182,216,324,413), `calendar/IdealWeekModal.tsx`, `finance/screens/ShoppingScreen.tsx`, `finance/shopping/*`, `settings/Settings.tsx` 4125–4270, `tasks/ImageDumpDialog.tsx`.
4. Update the scale comment in `src/lib/type.ts` to match.
Acceptance: `rg "fontSize: (9|10|11)(\.5)?\b" src` returns 0. No text renders under 11px, and no lowercase text under 12px.

### P0.2 Ink — three readable levels, not four
`--sb-ink-3 #6C6553` and `--sb-ink-4 #7C7565` are hard to tell apart and both are used for captions.
1. Keep the `--sb-ink-4` token (themes depend on it), but stop using it for anything you are meant to read: `rg "sb-ink-4" src/modules` → change text uses to `--sb-ink-3`. Leave `--sb-ink-4` only for disabled states, placeholders and dividers.
2. Fix the stale table in CLAUDE.md ("Ghost ink `#9B9180`" — the real value is `#7C7565`).
Acceptance: ink-audit clean in all 4 themes. `sb-ink-4` appears only on placeholders/disabled/borders.

### P0.3 One palette — delete per-screen colour copies
Local `const C = {…}` palettes: `calendar/NewEventPanel.tsx:36`, `finance/screens/GoalsScreen.tsx:41`, `ReportsScreen.tsx:112`, `ShoppingScreen.tsx:19`, `TodayScreen.tsx:21`, `finance/shopping/BoardView.tsx:27`, `ItemFields.tsx:25`, `StoresTab.tsx:19`, `inbox/Composer.tsx:36`.
1. Create `src/lib/palette.ts` exporting a single `C` whose values are **only** `var(--sb-*)` strings (ink1–3, card, field, border, hairline, accent, accentDeep, pos, neg, warn, info).
2. Replace each local `C` with `import { C } from '@/lib/palette'`. Where a local key has no token, map it to the closest one — don't add new tokens without asking.
3. Replace raw hex in modules with tokens:
   - `IdealWeekModal.tsx:473-474` `#E74C3C` → `var(--sb-negative)`; `:577` `#C62828` → `var(--sb-negative)`; `:920` `#E67E22`/`#C56A00` → `var(--sb-warning)`; `:531` `#ffffffCC` → `var(--sb-ink-on-fill)`.
   - `ImageDumpDialog.tsx` — all fallbacks like `var(--sb-ink-4, #9B9180)` → drop the fallback; `#B4523A` → `--sb-negative`; `#1D9E75` → `--sb-positive`; `#6C6553` → `--sb-ink-3`; `#FFFFFF` on ink → `--sb-ink-on-dark`; `#F5D14E` → `--sb-accent`.
   - `BrainDumpRail.tsx:309` `#D4A827` → `var(--sb-accent-deep)`.
   - `AssistantAvatar.tsx:67` `#F3EAD2` → `var(--sb-accent-tint)` (or a new `--sb-avatar-ground`, if the audit needs it).
   - `IdealWeekModal.tsx:103,107` fallback `#7F8C8D` → `var(--sb-ink-3)`.
Acceptance: `rg "#[0-9a-fA-F]{6}" src/modules` returns only data defaults (company/category colours the user picks). Glass-depth theme renders those screens without white or light patches.

### P0.4 One meaning per task priority
The four task priorities are coloured differently in different places: `tasks/ImageDumpDialog.tsx:12-15` (#7C3AED, #7F77DD, #1D9E75, #888780) vs `dashboard/ExecutiveDashboard.tsx` (info / ink-2 / positive / ink-3).
1. Add a single source, `src/lib/quadrants.ts`: `{ do: { label:'Do now', color:'var(--sb-negative)', Icon: Zap }, schedule: { 'Schedule', 'var(--sb-info)', Calendar }, delegate: { 'Delegate', 'var(--sb-positive)', ArrowRight }, eliminate: { 'Eliminate', 'var(--sb-ink-3)', Ban } }`.
2. Use it in `EisenhowerBoard.tsx`, `TaskCard.tsx`, `TaskRow.tsx`, `ImageDumpDialog.tsx`, `ExecutiveDashboard.tsx`, `KanbanBoard.tsx` and anything else matching `rg "'do'|'schedule'|'delegate'|'eliminate'" src/modules`.
Acceptance: the same quadrant has the same colour and icon on every screen.

### P0.5 Emoji out of the interface
Use lucide icons (`ICON.sm`, `STROKE.rest`) instead of emoji in:
- `dashboard/ExecutiveDashboard.tsx:279` ("On fire! 🔥" → "7-day streak"), `:374-377` (Quick Access labels).
- `habits/HabitsModule.tsx:1085` ("All habits complete! 🎉" → "All habits done today").
- `inbox/SmartView.tsx:97,121` (✅ → `Check`, 📅 → `CalendarDays`).
- `tasks/SmartDayPlanner.tsx:985,1069` (📅 / 🔥 / 🕐 → `CalendarDays` / `Flame` / `Clock`).
- `tasks/ImageDumpDialog.tsx:19-25`, `tasks/TaskCard.tsx:22`.
- `planning/PlanningAssistant.tsx:416`, `finance/screens/ShoppingScreen.tsx:528` (📅), `:1131` 📋, `:1302` 🛒 (empty states → a 24px lucide icon in an ink-3 circle).
- `wizard/steps/Step1Welcome.tsx:119-120`, `Step2Accounts.tsx:161,210`, `Step6Done.tsx:39-40,62`.
- `settings/Settings.tsx:2212` ("⚠ Access lost" → `AlertTriangle` icon).
- `modules/assistant/AssistantPanel.tsx:192` — the assistant's instructions allow emoji in its replies; decide (recommendation: none).
**Keep** emoji where the user picks them: `finance/components/IconPicker.tsx`, the habit icon set, the shopping group icons.
Acceptance: `rg "[🔥📋☀📅🔁🛒✅🎉🕐]" src/modules` matches only pickers, user data, and comments.

### P0.6 No browser pop-ups for confirm / input
Replace each `window.confirm` / `window.prompt`:
- Destructive actions → do it immediately and register an undo (`@/lib/undo`, already shown by `UndoBar`): `NewEventPanel.tsx:770`, `GoalsScreen.tsx:970`, `ReflectionScreen.tsx:1247,1659`, `EisenhowerBoard.tsx:217`, `SmartDayPlanner.tsx:892`.
- Actions that can't be undone (Google calendar deletes, the bulk fixes in `Settings.tsx:3784,3817`, `BudgetScreen.tsx:1408`, `CalendarIntelligence.tsx:2280`) → a new `src/components/ui/ConfirmDialog.tsx`: card surface, `T.h3` title, `T.body` text, `danger` + `secondary` buttons, Esc closes, focus starts on the safe button.
- Text input (`Composer.tsx:274`, `TaskDetailPanel.tsx:473`, `AdminPanel.tsx:111`) → a small anchored popover with one field, or `ConfirmDialog` with a text field.
Acceptance: `rg "window\.(confirm|prompt|alert)" src` returns 0.

---

## P1 — Screens that break or look unfinished

### P1.1 Hide anything unfinished
- `wizard/steps/Step5Tasks.tsx:74-78` shows "Set VITE_TODOIST_CLIENT_ID in .env" to end users → hide the Todoist tile when `!TODOIST_CONFIGURED`.
- `Step5Tasks.tsx:123-129` Trello "Coming Soon" → remove.
- `settings/Settings.tsx:4104` "Team seats (coming soon)" and `:4471` "Integrations coming soon" → remove, or put behind the admin flag.
- `dashboard/ExecutiveDashboard.tsx` Inbox card is hard-coded `"—"` / "Connect Gmail" → wire it to the Gmail unread count, or remove it.
- `components/layout/TopBar.tsx` — the Search and Bell buttons have no `onClick` → Search opens `CommandPalette`; remove Bell until notifications exist.

### P1.2 Loading states
Replace the plain "Loading…" text (`CalendarIntelligence.tsx:3643`, `morning/DayPlanner.tsx:543`, `inbox/InboxModule.tsx:1871`, `wizard/steps/Step5Tasks.tsx:88`) with a shared `src/components/ui/Skeleton.tsx` (rounded `--sb-field` bars with a 1.2s opacity pulse that respects `prefers-reduced-motion`). Inbox "Load more emails" → load on scroll with an IntersectionObserver, and keep the button as the fallback.

### P1.3 Narrow-window layout (only Library adapts today)
Add `src/lib/useNarrow.ts` (copy the matchMedia pattern from `library/LibraryModule.tsx:30`, with a breakpoint of 760px). Then:
- `ExecutiveDashboard.tsx:225` and the 3- and 2-column grids → `repeat(auto-fit, minmax(220px, 1fr))`.
- `Settings.tsx:4140` plan cards → `repeat(auto-fit, minmax(240px, 1fr))`.
- 7-column day grids (`PublicBooking.tsx:178`, `TodayScreen.tsx:171,180`, `RepeatPicker.tsx:188,222`, `SchedulePopover.tsx:267`) → keep 7 columns, but `minmax(0,1fr)` with 36px minimum tap targets. **PublicBooking is the only screen outsiders see — test it at 375px.**
- The calendar week view below 760px → default to the day view.

---

## P2 — Structure (needs product decisions — confirm before building)
These are the big wins, but they change navigation. Do them after P0/P1, one at a time, each designed here first:
1. **One day-planning screen.** Dashboard, `morning/TodayPage`, `MorningBrief`, `DayPlanner`, `tasks/SmartDayPlanner` and `planning/PlanningAssistant` overlap. Proposal: Today = brief + plan + agenda; Dashboard becomes a one-line summary at the top of Today, or goes away.
2. **Split Settings** (`Settings.tsx`, about 305 KB) into a left-menu page with one file per section.
3. **Finance navigation**: 8 areas plus Shopping. Group them as Money (Today, Balance, Budget), Plan (Goals, Forecast), Review (Reflection, Reports), and move Shopping to its own place in the main menu.
4. **Tasks views**: Matrix, Kanban, List and Smart Planner → one default view and a single segmented switcher (`components/ui/Segmented.tsx`).
5. **Setup wizard** from 6 steps to 3 (accounts → companies → done); set up habits and tasks inside the app later.

---

## Suggested order and size
| Phase | Est. files | Risk |
|---|---|---|
| P0.1 Type floor | ~40 | Low (visual only) — run ink-audit |
| P0.2 Ink levels | ~30 | Low |
| P0.3 Palette | ~15 | Medium — test all 4 themes |
| P0.4 Priority colours | ~7 | Low |
| P0.5 Emoji | ~15 | Low |
| P0.6 Dialogs | ~12 + 1 new | Medium — undo paths need tests |
| P1.1–1.3 | ~20 | Medium |
| P2 | — | Design first, here |


---

## T. How to test (Claude Code builds these once in phase T0, then runs them for every phase)

### T0 — build the test tools first (its own small PR: `ui/t0-guards`)
Create two scripts. Follow `.claude/rules/harness.md`: `playwright-core`, Chromium at `/opt/pw-browsers/chromium` with `--no-sandbox`, dev server `npx vite --port 5199 --strictPort`, `scripts/session.mjs` for the stub user, `scripts/settled.mjs` for waiting (never a fixed sleep).

#### T0.1 `scripts/ui-guard.mjs` — code scan (no browser needed)
Reads every `.ts/.tsx` file under `src/` and counts violations per rule. Exits 1 if a rule that's turned on has any. Usage: `node scripts/ui-guard.mjs [--only=type,ink,hex,quadrant,emoji,dialog,unfinished,loading] [--json]`.

| Rule id | Fails on | Allowed (whitelist) |
|---|---|---|
| `type` | `fontSize:\s*(9\|10\|11\|12\|13)(\.5)?\b` (numeric literals) | none |
| `ink` | `--sb-ink-4` used in a `color:` property | placeholders, `disabled` styles, borders — mark the line with `// ui-guard: ink-ok` |
| `hex` | `#[0-9a-fA-F]{6}\b` or `#[0-9a-fA-F]{8}\b` in `src/modules/**` or `src/components/**` | lines marked `// ui-guard: user-colour` (defaults for colours the user picks), `src/index.css`, `src/lib/accent.ts`, `src/lib/moneyColors.ts` |
| `palette` | `^\s*(export )?const C = \{` anywhere except `src/lib/palette.ts` | — |
| `quadrant` | an object literal with `v: 'do'` or `key: 'do'` plus a `color:` outside `src/lib/quadrants.ts` | — |
| `emoji` | `\p{Extended_Pictographic}` inside JSX text or a string literal in `src/modules/**` | `finance/components/IconPicker.tsx`, `habits/HabitsModule.tsx` icon array, `finance/screens/ShoppingScreen.tsx` `GROUP_ICONS`, `finance/shopping/shoppingDb.ts`, `finance/categoryIcons.ts`, comments |
| `dialog` | `window\.(confirm\|prompt\|alert)\(` | — |
| `unfinished` | `/coming soon/i`, `VITE_[A-Z_]+` inside JSX text | — |
| `loading` | the JSX text `Loading…` or `Loading...` | — |

Output, for example:
```
type        112  ✗   (src/modules/calendar/CalendarRail.tsx:32, …)
dialog       14  ✗
emoji         0  ✓
```
Add `"ui:guard": "node scripts/ui-guard.mjs"` to `package.json`.
**Self-test (required):** add a fixture file `scripts/fixtures/ui-guard-bad.tsx` with one violation per rule, and `--self-test` mode that asserts every rule catches its fixture. A guard that can't fail proves nothing.

#### T0.2 `scripts/ui-render.mjs` — what the browser actually shows
Opens the app at 5199 with the stub session and visits every module through `[data-side-rail] button[aria-label="<module>"]` (same approach as `ink-audit.mjs`). Also checks the public booking page, with `shell: null`. On each screen it measures:

1. **Proof the screen opened** — record the module's own root selector and the number of visible text elements; fail if under 10 (no vacuous pass).
2. **Type floor** — for every visible element with its own text, `parseFloat(getComputedStyle(el).fontSize)`. Fail if any is under 11px, or under 12px when `text-transform` isn't `uppercase`. Report the selector and text.
3. **Emoji in visible text** — `/\p{Extended_Pictographic}/u` on text nodes, excluding `[data-user-content]` (add that attribute to user-entered names/icons as you go). Fail on any match.
4. **Native dialogs** — `page.on('dialog', d => { fail(d.message()); d.dismiss() })` for the whole run.
5. **Narrow layout** — repeat 2 at a 375×812 viewport. Fail if `document.documentElement.scrollWidth > 375`, i.e. the page scrolls sideways. (Gated: only enforced once P1.3 is done — use `--narrow`.)
6. **Tap targets** (with `--narrow`) — every visible `button, a, [role=button]` must be at least 36×36 px.
7. **Screenshots** — `screenshots/ui/<phase>/<theme>/<module>.png`, for the PR.

Run it for each theme with `INK_THEME=<id>`, like ink-audit. Usage: `node scripts/ui-render.mjs 5199 [--narrow] [--phase=p0-1]`. Add `"ui:render"` to package.json.
**Control (required):** run it once with `--inject-bad`, which uses `addInitScript` to append a 9px span holding "🔥" to `body` and to call `window.confirm`. All three checks must fail. Put that output in the T0 PR.

### The full suite — run before and after every phase
```bash
npx vite --port 5199 --strictPort &   # leave running
npm run build
npm run lint
node scripts/ui-guard.mjs
for t in sunlit-bento warm-minimal evergreen glass-depth; do
  INK_THEME=$t node scripts/ink-audit.mjs 5199
  INK_THEME=$t node scripts/ui-render.mjs 5199 --phase=<phase-id>
done
node scripts/completion-sticks.mjs      # existing regression harnesses that touch edited files
node scripts/mail-action-sticks.mjs
```
Also run any existing `scripts/*.mjs` that imports or targets a module you edited (`rg -l "<module>" scripts`).

### What "done" means for each phase
| Phase | Code-scan rule must be 0 | Browser check must pass | Extra proof |
|---|---|---|---|
| P0.1 | `type` | type floor, 4 themes | screenshots: Calendar, Shopping, Settings → Plan, Image dump |
| P0.2 | `ink` | ink-audit clean, 4 themes | ink-audit diff before/after |
| P0.3 | `hex`, `palette` | ink-audit clean; Glass theme screenshots of Ideal Week, Image dump, Shopping, Composer show no light patches | — |
| P0.4 | `quadrant` | a new check in ui-render: on Tasks and Dashboard, the "Do now" colour read with `getComputedStyle` is identical | — |
| P0.5 | `emoji` | emoji check on every screen | — |
| P0.6 | `dialog` | no native dialog fired; a new script `scripts/undo-replaces-confirm.mjs`: delete a goal, an entry and an event → item gone → press Undo → item back, and the stubbed server gets the matching restore call | control: same script on `main` sees `window.confirm` fire |
| P1.1 | `unfinished` | Top bar: Search opens the command palette; no Bell button unless notifications exist | — |
| P1.2 | `loading` | delay the Supabase stub by 1500ms; skeleton (`[data-skeleton]`) visible, then replaced; with `prefers-reduced-motion` set the pulse animation is `none` | — |
| P1.3 | — | `--narrow`: no sideways scroll, tap targets ≥ 36px, on every screen; PublicBooking at 375px | screenshots at 375px |

If an existing harness breaks because it matched old text (e.g. "On fire! 🔥" or a `window.confirm` handler), update the harness in the same PR and say so in the description — don't delete the assertion.


---

## Progress
| Phase | Status | PR |
|---|---|---|
| T0 Test tools | done | branch `claude/next-incomplete-phase-niej9p` (PR not opened yet) |
| P0.1 Type floor | done | branch `claude/next-incomplete-phase-niej9p` |
| P0.2 Ink levels | done | branch `claude/next-incomplete-phase-niej9p` |
| P0.3 One palette | done | branch `claude/next-incomplete-phase-niej9p` |
| P0.4 Priority colours | done | branch `claude/next-incomplete-phase-niej9p` |
| P0.5 Emoji | todo | |
| P0.6 Dialogs → undo / ConfirmDialog | todo | |
| P1.1 Hide unfinished | todo | |
| P1.2 Loading states | todo | |
| P1.3 Narrow layout | todo | |
| P2.x Structure | blocked — design first | |
