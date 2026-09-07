# BPA — Professor AI App · Project Memory

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

## Key Files
| File | What it does |
|---|---|
| `src/modules/settings/Settings.tsx` | All settings — nav groups, section components |
| `src/modules/tasks/TaskCard.tsx` | 3-row task card (9A design) |
| `src/modules/habits/HabitsModule.tsx` | Habits table + 10B side detail panel |
| `src/modules/finance/screens/BudgetScreen.tsx` | Budget + 20E envelope drill-down overlay |
| `src/App.tsx` | Router / shell |
| `src/store/`, `src/lib/` | Zustand stores, DB sync, Google OAuth |
| `src/lib/liveSync.ts` | Cross-device live sync (Realtime push + poll fallback) |

## Cross-device sync
Habits, tasks and finance stay in step **while both devices are open** — no reload.
`startLiveSync(userId, handlers)` (App.tsx, 3 auth call sites) asks the owning store to
reload; it never applies row deltas. Woken by Postgres change events (~1s, needs
`20260004_realtime.sql`) and by a poll + visibility/focus/online pull (45s alone,
5 min once Realtime is confirmed). Finance had no `loadFromDB()` caller at all before this.

Three rules any change here must keep:
- **`markLocalWrite(domain)`** on every write path, or a reload pulls the old row back
  over an edit in progress. Stores call it; `financeDb.ts` calls it in its 11 helpers.
- **Dirty sets** (`professor-habits-dirty`, `professor-tasks-dirty`) answer "is this
  device's copy newer?" A row missing from the server is *deleted elsewhere* unless it
  is dirty — otherwise every delete undoes itself. Seeded with all local ids on a device
  that predates the key.
- **Push the hydration merge back only when it differs from what the server just sent**,
  or two open devices trade writes forever.

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

## Calendar — dragging an event
`CalendarIntelligence.tsx` moves events with dnd-kit and a `DragOverlay`. The
overlay is what follows the pointer, so the source card must **not** take
`transform` from `useDraggable`. dnd-kit's transform carries a scale reconciling
the source's rect with the overlay's fixed 130px box — applied to a card sized in
percent and pixels it came out as `scaleY(24)`, stretching it into a streak down
its own column. The card stays where the event is, dimmed to 0.35, and the overlay
does the moving. Resizing needs no live transform either: it is worked out from
`delta` in `handleDragEnd`.

## Finance — how money is written
`src/modules/finance/format.ts` is the only place that decides this.
- **Accounting convention.** A negative is bracketed and drops its minus —
  `(EGP 67,650)`, never `−EGP 67,650` — and a positive never carries a `+`.
  `acct(n, { currency, zero, decimals })` for a signed figure, `outflow(n)` for a
  magnitude that is money leaving (the Financials expense rows), `group(n)` for a
  bare separated number. A labelled magnitude ("48,250 held") stays as it is.
- **Inputs carry their separators.** `components/MoneyInput.tsx` wraps every money
  field (transaction, budget rule, account balance, bill, goal target). It holds the
  *text*, so a half-typed `1,2` survives, and restores the caret by digit count —
  reformatting on each keystroke otherwise throws it to the end of the line.
  Don't reach for `<input type="number">` for money; it cannot show separators.

- **Every total converts first.** `fx.ts` holds a hand-set rate per currency;
  `toBase(amount, currency)` returns `null` where nobody has given one. Never add
  `Math.abs(tx.amount)` straight into a total, and never fall back to the raw
  number when `toBase` is null — drop the row and name the currency on screen.
  This applies to budget *rules* too: a sub-category budget carries its own
  currency and has to be converted before it is added to its parent's.

## Finance — bulk entry and duplicate review
- `modals/BulkEntryModal.tsx` — a line is **Starts / Ends / Every / payee / category /
  amount**. `Ends` mirrors `Starts` until it is touched (`toTouched`), and `Every` is
  empty by default, so a line is one entry unless deliberately made a repeat. The
  footer counts *entries*, not lines.
- `duplicates.ts` — same type, amount, currency, account, category and normalised
  payee, ignoring the date. Two on one date → `day`; two in one month → `month`; the
  same thing in a *different* month is a recurring payment and is never flagged.
  Surfaced by `DuplicateMark` in the Today, Balances and drill-down feeds, and as the
  "N to check" chip on Financials. Detection itself never edits anything, but the
  chip's list is where a duplicate is dealt with: a row opens the entry (the panel
  closes first, or it floats behind the editor) and a trash button deletes it after
  a confirm naming it.
- **A line says whether it was paid.** `paid` + `paidOn` per line (the payment date
  mirrors `Starts` until touched, like `Ends`), with a batch-level Paid / Not paid
  that sets them all. Unpaid means **no `paidAt` at all** — that is what every screen
  reads — and `isCleared` follows it. A line that repeats is paid on each occurrence's
  own day, so a hand-set payment date applies to a single entry only.
- **Every figure is filed by the day the money moved.** `whenPaid(tx)` in
  `unpaid.ts` decides the month or day: the Budget year chart, envelopes and
  drill-down; the Today calendar cells, its feed and In/Out/Net; the Reports range.
  A salary due in January and paid in March is March's. The calendar and the feed
  under it read the same date, or a cell shows a figure and taps through to nothing.
  Unpaid entries fall back to their own date, so they stay visible where they were
  filed (and out of every total).
  **Financials is the exception** — its due/paid toggle is exactly this question,
  and "when it is due" is the default.
- **A note shows on the row, in brackets.** `noted(tx.note)` in `format.ts` renders
  it as an aside on the second line — "6 Sep · Cafe (with Omar)" — in all four
  feeds, truncated with the whole thing on hover. Brackets are what stop it reading
  as another field.
- **An unpaid entry is in no figure.** `settled(txs)` in `unpaid.ts` drops what has
  no payment date, and every total goes through it: account balances
  (`balances.ts`, which also returns `pending` per account so a row can say what is
  waiting), the Today calendar cells and In/Out/Net, the Budget envelopes and year
  chart, and Reports. The entry is still *listed* everywhere, marked. The one
  deliberate exception is Financials **when it is due**, whose whole purpose is to
  count what is owed; its sibling view already left the unpaid out.
- **Unpaid entries carry a dotted red border.** `unpaid.ts` is the only place that
  decides it: `isUnpaid(tx)` and `unpaidRow(bool)`, spread *after* a row's own style
  (the `border` shorthand has to replace the row's bottom hairline). Used by all four
  feeds — Today, Balances, and the Budget and Financials drill-downs.
  Where the server has no `paid_at` column at all (`20260006` not run), no entry is
  marked: every row comes back without one and nothing can ever be written, so the
  claim would be about data nobody has. `setPaidAtSupported` on each load decides it,
  and Settings → Finance → PAYMENT DATES names the migration.
  The old load-time repair is now a button in that same block
  (`markAllPaidOnDueDate`): `loadUnpaidTransactions()` reads every year at once —
  the normal load's year bound would leave the rest of the ledger untouched — writes
  `paid_at = date` for each, and reloads the year on screen.
  `loadFromDB` stamps **nothing** paid on the way in. The old repair for entries
  that predated the two dates has done its job, and it read a deliberate "not paid"
  as missing data. Scoping it to devices that had not run it was not enough — the
  flag is per-browser, the rows are shared, so a second device stamped an entry
  someone had just marked unpaid and pushed it back over everybody.
- **Financials reads a year two ways.** *When it is due* files each entry in the month
  it belongs to, paid or not; *when it was paid* files it in the month the money moved
  and leaves out anything with no `paidAt` (saying how many). One `filedOn(tx)` decides
  it for the rows, the totals and the drill-down alike. Settings holds the default,
  `finance-financials-basis` what was last looked at.
- **Every figure in Financials opens what it was summed from.** A cell click stops
  propagation (the row's own click hides it) and passes the exact id set the figure
  used — a hidden part is out of both. The panel deletes and edits through the store,
  so the table behind it recalculates.
- **Rows are reordered by dragging them.** The grip at the right of the name column
  moves a row among *its own siblings* — the top-level rows of one section, or the
  parts of one category — and the set it may be dropped into is fixed when it is
  picked up. Pointer events, not HTML5 drag: `dragstart` never fires for a finger,
  and this table is reordered on an iPad. The drop writes positions (`sortOrder`
  0..n) for the whole sibling list, and `justDragged` swallows the click that would
  otherwise hide the row it landed on.
- **Exchange rates are a setting.** Settings → Finance owns them; screens that find
  unconvertible money say so and link there.

## Finance — what an account holds
`balances.ts` is the only thing that answers this. `account.balance` is the **opening**
figure; the live one is that plus every entry filed against the account, so nothing
ever writes back to the row. Sign convention: positive is held, negative is owed —
spending on a card takes it below zero, paying it brings it back up.
A **transfer carries `toAccountId`** (`20260007`): out of `accountId`, into
`toAccountId`. Without it, paying a card was money leaving and arriving nowhere.
`saveTransaction` drops **only the column the error names** and retries if the
migration has not run — dropping all four optional columns meant one missing one
took `paid_at` with it, so a payment date could never be written — and
`transferTargets.ts` keeps the destination locally so the payment is not lost on the
next load. `creditLimits.ts` does the same for `credit_limit` (`20260008`). In both
the server's value wins wherever it has one.

## Finance — an entry keeps its own currency
250 USD is stored, listed and edited as 250 USD. Conversion happens only where the
figure is added to something denominated differently:
- `balances.ts` converts into the **account's** currency (`convert(a, from, to)` in
  `fx.ts`, which goes via the base — rates are held against the base, so EGP→USD is a
  divide). No rate → the entry is left out and the row says "USD not counted".
- Financials / Reports / Today convert into the **base** currency.
- A new entry defaults to the currency of the account picked and follows it, until the
  currency is set by hand — after which the choice stands.

## Finance — Balances screen
- **A card has a ceiling.** `Account.creditLimit` (`20260008`, `credit_limit`) drives the
  usage bar and "X left of Y" on the row. `saveAccount` drops the column and retries if
  the migration has not run.
- **A transfer has no category.** It moves money between two accounts rather than
  spending it; the Category row is hidden for transfers and `categoryId` is dropped on
  save. Which card it lands on is the **To** field. An expense filed under a card-ish
  category offers the crossing.
- **Settling a card lives here, not in the entry panel.** A card row with a debt gets a
  **Settle** button that opens a transfer already carrying the outstanding figure, the
  card as its destination and a payee. The entry panel only records an amount — the
  account pickers name what each account holds so the right card is picked, and nothing
  in there previews or clears a debt.
- **Clicking a row picks the account**, narrowing the feed to it; a transfer belongs to
  *both* ends, so it shows for the account it came from and the one it went to. The
  pencil opens the editor — one gesture each.

## Finance — a sub-category pill fills as it is spent
`BudgetScreen` gives each child pill a fill behind its label, the way the ring
above it works. `byChild` in the envelope build keeps each part's spend apart
(converted into the envelope's currency, so it compares with the budget written
beside it). The denominator is the part's **own** budget where it has one, and the
**envelope's** otherwise — that is the limit its spending actually comes out of.
Amber under, red over, nothing at all where nothing was spent; capped at 100% so
an overspend cannot run past its own pill. The title says which limit it used.

## Finance — goals are planned, not wished
`goalPlan.ts` turns a target and a date into a plan out of the ledger already there.
- **`capacityFrom(accounts, txs, bufferMonths)`** answers what there is: `held` (live
  balances, converted, net of card debt), `buffer` (months of typical spending held
  back), `free` = held − buffer − what is committed, and a **median** month of income
  and expense over the last `WINDOW_MONTHS`. Median, not mean — one bonus or one
  boiler must not reset the plan. Months with nothing in them are dropped, or a
  ledger that starts halfway through the window halves its own median.
- **`planGoals(goals, capacity, policy)`** pours it down the ranking. Spare cash goes
  down the ladder first under both policies — a lump is not a flow to be shared.
  Then the monthly surplus: **ladder** fills rank 1 before rank 2 sees anything (a
  goal with a deadline takes only what that deadline asks, so it does not starve the
  one behind it); **share** splits by 1/rank so everything moves at once.
- Each goal comes back with `lump`, `monthly`, `required` (to hit its deadline),
  `eta` and `onTime`, and the screen says which of those is the problem in a sentence.
- **Rank is stored** (`20260010`: `rank`, `deadline`, `currency`) and set by dragging
  a row — same pointer-event drag as the Financials table. `goalPlanning.ts` keeps
  the three locally until the migration runs; the server's value wins.

## Finance — a budget with a day writes the entry
`budgetEntries.ts`. `BudgetRule.dueDay` + `dueAccountId` (the **Paid on** row) means
the money leaves on that day, so the entry goes in the ledger on that day, **unpaid**
— out of every balance and total, dotted red in the feeds, counted by Financials
"when it is due". Ticking Paid is the whole gesture that turns a plan into a fact.
- **`occurrencesFor(rule)`** follows the rule's own interval and keeps the phase its
  `starts` month set — a quarterly rule starting in February is Feb/May/Aug/Nov.
  Weekly steps 7 days; a day of the month means nothing to it.
- **What stops a second copy is the ledger**: an entry already filed against that
  category on that day is the entry, whoever wrote it. No flag to lose if `tags` is
  missing, and recording the rent by hand suppresses the generated one.
- Only dates inside `currentYear` are written — only that year is loaded to check
  against. The rest arrive when the year turns.
- The `budget` tag is the flag (`isBudgetEntry`, `BudgetMark` in all four feeds).
  A day removed takes its **unpaid future** entries with it; anything paid stays.
- It used to make tasks. `runReminders` deletes any `money-reminder:budget:*` task
  it still finds, and nothing makes them any more. Hand-made money reminders in
  Settings are untouched and still make tasks. The task goes
into the **schedule** quadrant with a `dueDate`, which is what `TaskCommand` already
pushes to Google Calendar — nothing here knows about calendars.
- Each task carries `links: ['money-reminder:<ruleId>:<monthKey>']`, so a rule finds
  the task it made and **moves** it rather than adding a second one.
- `finance-money-reminders-made` remembers what was ever made, so a task deleted by
  hand is not put back. A rule turned off deletes its unfinished *future* tasks only.
- Configured in Settings → Finance (MONEY REMINDERS); `App.tsx` runs it on load, on
  `professor:moneyRemindersChanged`, and every 12h.

## Finance — a year at a time
`loadTransactions(year)` fetches `date` between Jan 1 and Dec 31 and `loadFromDB`
**replaces** the list with what it fetched. So an entry dated outside `currentYear`
is saved, is in Postgres, and is on no screen in the app — the panel closes and
nothing moves, which reads as though it was thrown away.
- `followYearOf(txs)` runs **after** the write: one year, not the current one → go
  there. Both add paths use it, so a saved entry is always somewhere you can see.
- `upsertTransactions(txs)` writes a whole batch in **one** request. Sent one at a
  time, any load landing mid-batch (the 45s poll, a year change, the tab coming
  back) replaces the list with what the server has *so far* and drops the rest.
- The bulk footer names the years a batch will land in before it is written.

## Finance persistence
All nine finance tables are real Postgres (`20260001`, plus `finance_budgets` in `20260005`).
`financeStore.loadFromDB()` is authoritative — writes go through `financeDb.ts` immediately,
there is no debounce and no merge.
- `currentYear` decides what gets fetched. It is **not persisted** (`partialize` + `merge`),
  because a stored copy meant a store created in one year kept asking for that year forever.
  `setYear()` is the only way to change it and it reloads.
- `professor-finance-seeded` guards the one-time adoption of bills/goals/budgets that were
  local-only before they had DB code. An empty table means "not yet" until the local set is
  *confirmed* on the server — set it on a started push and the second sign-in load deletes
  everything the first was still uploading.
- `loadBills/loadGoals/loadBudgets` return `null` on a failed read and `[]` for a genuinely
  empty table. The two lead to opposite decisions; don't collapse them.

## Settings — Section → Component Mapping (CONFIRMED CORRECT as of latest commit)
| Nav group | Section id | Title shown | Component rendered |
|---|---|---|---|
| YOU | `profile` | Profile | `ProfileSection` |
| YOU | `billing` | Billing | `BillingSection` (plan tile, payment, invoices) |
| CONNECTED | `accounts` | Accounts & companies | `CompaniesSection` (company cards + people) |
| CONNECTED | `professor` | AI | `ProfessorSection` (model, autonomy, toggles, tone) |
| CONNECTED | `schedule` | Schedule rules | `ScheduleSection` |
| CONNECTED | `blocking` | Integrations | `IntegrationsSection` (Notion/Asana/Trello + Google OAuth + calendar sync) |
| WORK | `tasks` | Tasks | `TaskStatusesSection` |
| WORK | `habits` | Habits | `HabitsSection` |
| SYSTEM | `automation` | Automation | `AutomationSection` (7 rule cards) |
| SYSTEM | `notifications` | Notifications | `NotificationsMatrixSection` (Push/Mail/Digest per event + quiet hours) |
| SYSTEM | `appearance` | Appearance | `AppearanceSection` |
| SYSTEM | `behavioral` | Behavioral OS | `BehavioralSection` |
| SYSTEM | `companies` | Data & privacy | `DataPrivacySection` |
| SYSTEM | `finance` | Finance | `FinanceSection` |

## Design Screen → Implementation Status
| Screen | Status | Notes |
|---|---|---|
| 9A Task card | ✅ Done | 3-row layout, company dot, owner initials badge, daysOpen() |
| 10B Habit detail panel | ✅ Done | 272px side panel, heatmap, stats, cadence |
| 11A Profile + Billing | ✅ Done | Profile section + BillingSection with plan/invoices |
| 11B Accounts & companies | ✅ Done | CompaniesSection mapped to `accounts` id |
| 11B AI settings | ✅ Done | ProfessorSection with model picker, autonomy, tone |
| 11C Tasks + Habits | ✅ Done | TaskStatusesSection + HabitsSection |
| 11D Integrations | ✅ Done | IntegrationsSection with Notion/Asana/Trello/Apple Notes |
| 11F Automation | ✅ Done | AutomationSection with 7 rule cards + run log |
| 11F Notifications | ✅ Done | NotificationsMatrixSection Push/Mail/Digest matrix |
| 11G Finance settings | ✅ Done | FinanceSection with envelope/figures/dates fields |
| 20E Envelope drill-down | ✅ Done | 520px right overlay, period selector, tx flags |

## Automation Rules (11F — stored in localStorage `professor-automation-rules`)
1. Write the morning brief · WHEN every day at 06:40, before you wake
2. Draft replies for NEEDS YOU mail · WHEN a thread is marked needs-you and sits over 4 hours
3. Block focus time for P0 tasks · WHEN a P0 task has no calendar block by 09:00
4. Distribute the dump · WHEN the brain dump passes 12 tasks
5. Roll unfinished tasks forward · WHEN a scheduled task ends the day untouched
6. Archive newsletters · WHEN a thread is promotional and nobody replied in 3 days
7. Close the week · WHEN Sunday 20:00, if the review has not been opened

## Common Patterns
```tsx
// Toggle component (used everywhere in Settings)
<Toggle checked={bool} onChange={(v: boolean) => ...} />

// FieldRow (label + right-aligned control)
<FieldRow label="..." sub="optional sublabel">
  <Toggle ... />
</FieldRow>

// Sunlit card wrapper
<div style={{ background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 14,
  padding: '22px 24px 24px', boxShadow: '0 1px 3px rgba(25,23,18,0.06)' }}>

// Section eyebrow
<div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em',
  color: '#6C6553', textTransform: 'uppercase', marginBottom: 4 }}>SETTINGS</div>
```

## Settings — 11A artboard primitives
`Settings.tsx` has a shared set of design primitives used by every artboard-accurate section:
`PILL_BASE`, `GhostPill`, `PillValue`, `DRow` (label+sub left / control hard-right),
`Segmented`, `pillSelectStyle`, `VisaBadge`. Prefer these over `FieldRow`/`inputStyle`
when bringing a section up to the artboards.

Layout: the page header (eyebrow + title + `Setup wizard`/`Export`) spans full width
**above** the rail. The rail is a floating 250px card; the active nav item is a solid
black pill (`#191712` bg, white text). Cards use `alignSelf: 'start'` so they size to
content — the content column scrolls, not each card.

Profile fields **autosave** (1.2s debounce → `saveProfileToDB`); `profileHydrated` ref
swallows the write-back that DB hydration would otherwise trigger.

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
