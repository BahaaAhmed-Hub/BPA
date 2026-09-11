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
`20260004_realtime.sql`) and by a poll + visibility/focus/online pull (45s alone,
5 min once Realtime is confirmed). Finance had no `loadFromDB()` caller at all before this.

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
- **Rows are reordered by dragging them.** The grip is a **gutter down the left of
  the name column**, at the same x on a category and on a part of one, so the
  handles read as one column and a sub-category's is as findable as its parent's.
  It used to be pushed to the far right of the name cell by a `flex: 1` spacer,
  where it was a long way from the name it moved and looked like furniture. The
  16px a parent's chevron occupies is what indents a child, so the name still
  steps in under its category.
  Pointer events, not HTML5 drag: `dragstart` never fires for a finger,
  and this table is reordered on an iPad. The drop writes positions (`sortOrder`
  0..n) for the whole sibling list it lands in, and `justDragged` swallows the
  click that would otherwise hide the row it landed on.
- **One drag both reorders and re-parents**, because they are the same thought —
  *this belongs there* — and where in the target row the pointer sits is what
  says which. Near an edge the row lands **beside** the target, as its sibling;
  in the middle of a top-level row it goes **inside** it. So a part dropped
  beside a top-level row is also how you take it back out; there is no separate
  promote, and no second gesture to learn. Only rows in the **same section** are
  candidates — spending filed inside earning would make each section's total sum
  out of the other's rows. The three refusals are the Budget screen's, word for
  word, because both screens move the same categories: a category with parts of
  its own cannot become a part (one level is all the model has), income and
  expense do not mix, and a part takes its new parent's `txType` — and because
  it does, a category set to **both**, which is drawn in each section summing
  its own side there, would lose the other side's entries the moment it is
  nested: still in the ledger, in no total on the screen. That one is counted
  and named (`4 income entries`) rather than moved.
  A drop that would nest and cannot **says so while you are still holding it** —
  the row shows `HAS PARTS OF ITS OWN` instead of `INSIDE`, and the drop falls
  back to a reorder rather than quietly doing the other thing.
- **`parent_id: c.parentId ?? null`.** `undefined` is dropped on the way to JSON,
  so the upsert's `ON CONFLICT` never *set* `parent_id`: un-nesting reached the
  store and stopped there, and the next load brought the row back nested, which
  read as the move being refused. `CategoryRow.parent_id` is `string | null`, and
  the load maps `null` back to `undefined`, which is what every consumer tests
  for. The Budget screen's Promote button had the same hole.
- **The same year, as lines.** A table answers "what did this cost in March?"
  exactly, and cannot answer "which of these is climbing?" — twelve columns of
  figures hide a shape. `LinesChart` draws one line per row across the twelve
  months, and the header carries `Table / Lines` beside the due/paid toggle.
  - **Dotted, not solid.** A month is a reading, not a continuum: nothing
    happened *between* March and April, and a solid line claims it did. Dashed
    is spending, finely dotted is earning, so the two read apart on one axis.
  - **`Categories / Sub-categories`** decides what a line is. At the deeper
    level a category with no parts **keeps its own line**, or half the year's
    money vanishes when you ask to see the parts.
  - **The legend is the control.** A line is taken off by its own name, which is
    where you are already looking for it; the line itself is clickable too, via
    a transparent 14px stroke under the 2px one — a dotted hairline is nearly
    impossible to hit. It shares `hiddenIds` with the table, so hiding a row in
    one hides it in the other and every total still recalculates.
  - **`ticksTo` runs until it covers the largest reading.** Stopping at the last
    round number below it drew a 62,000 salary above the top gridline, outside
    the plot.
  - **`spread()` separates repeated colours.** A category's colour is its
    identity everywhere else so it is kept, but two categories may share one —
    free on a table, fatal on a chart. Each later one is lightened or darkened a
    step, alternating, so a third and fourth do not both fade into the ground.
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

## Companies — linking one to an account
`saveCompaniesToDB` used to answer *any* failed upsert by writing the row back
with base columns only, which dropped `account_id`, `email_domain` and
`users_data` together — so `hidden`, a column no migration ever added, cost each
company its Google account. The next load read those back empty and
`localStorage` was overwritten with them: link an account, refresh, gone.
- **Drop only the column the error names** (`COMPANY_OPTIONAL`, remembered per
  session), the same rule as `financeDb.upsertRows`, and report a sync gap.
- **`mergeCompanies(server, local)` on load** — the *list* is the server's, so a
  delete travels; a *blank field* from the server never beats a value this
  browser has.
- `20260011_company_hidden.sql` adds `hidden` (and re-asserts the three from
  `20240002`).

## Financials — a click selects, the pencil opens
A row click used to throw a modal over the middle of the table, hiding the row
you clicked and every figure around it that gives it meaning.
- **Click selects.** The row lights and the chart above narrows to that category
  and its parts. Clicking it again, or any empty space that is not a row, puts
  them all back (`.sb-fin-row` / `.sb-keep-selection` decide what counts).
- **The pencil opens it.** Eye and pencil (`RowTools`) are revealed on hover and
  stay put for a row that is hidden or selected, or the way back is invisible on
  a touch screen. The eye takes the row out of the totals.
- **The entries are docked right**, like the task panel beside its board, and an
  entry opens *in the same column* with a back arrow (`EntryFace`). The footer
  carries `paddingRight: 56` — the assistant's floating button is fixed to the
  viewport and sat on Add an entry.
- **The lines chart sits above the table, not instead of it.** A shape and the
  figures that make it are one question, and with the table gone there was
  nothing to pick. It is clipped to the last month there is an answer for: a line
  flat along zero through Oct–Dec says the spending stopped, when the year has
  simply not got there yet.
- **A `<select>` or month input under a styled label needs `showPicker()`.** The
  native calendar only opens from the (invisible) indicator otherwise, so both
  Runs pills in `BudgetRuleModal` read as dead controls.

## Finance — the envelope style is four real views
`finance-envelope-style` was written by Settings and read by nothing: every
choice drew the dial. `BudgetScreen` owns all four now (`loadEnvelopeStyle()`,
re-read on `finance:envelopeStyleChanged` and on `storage`, so another device's
choice arrives too), and each answers a different question:
- **dial** — the ring, plus `Spark`: what was spent on each of the last seven
  days. A limit says how much is gone, not whether it is slowing down.
- **ring** — `Ring` takes `prevPct` and draws last month inside this month,
  with "163% more than last month" under the figure. "Over" is not the only bad
  news.
- **slip** — `SlipRows`: monospace figures in one right-aligned column, so two
  envelopes compare in one eye movement.
- **mosaic** — `MosaicBoxes`: a **squarified treemap** (`squarify()`), so the
  card is tiled edge to edge and a cell's share of it is that category's share
  of the money. Wrapped squares could not do that — they leave gaps, and a gap
  means nothing. Inside each cell the envelope fills from the bottom as its
  budget is spent; past it the cell is rust and says "burst". Children take a
  strip along the bottom split the same way. Cells too small for text keep
  their glyph and their tooltip.
`StylePicker` in the Budget header changes it on the fly and writes the same
key and event as Settings, so the two never disagree.
All four keep click-to-select, drag-to-reparent, the due-day chip and the
currency badge — `Draggable`/`DropZone` take a `grow` prop for the views whose
rows span the card. The row build carries `prev` and `trend` for them.

## Finance — a sub-category pill fills as it is spent
`BudgetScreen` gives each child pill a fill behind its label, the way the ring
above it works. `byChild` in the envelope build keeps each part's spend apart
(converted into the envelope's currency, so it compares with the budget written
beside it). The denominator is the part's **own** budget where it has one, and the
**envelope's** otherwise — that is the limit its spending actually comes out of.
Amber under, red over, nothing at all where nothing was spent; capped at 100% so
an overspend cannot run past its own pill. The title says which limit it used.

## Finance — a normal month is a sum of medians, not the median of a sum
`typicalMonth()` in `goalPlan.ts`, and it is the figure the whole plan hangs off.
It used to be the median of each month's **total** spending. Real spending is
lumpy: some months carry a school-fee instalment and most do not, so the median
landed on a heavy month or a quiet one depending only on which month you opened
the app in. On one twelve-month ledger the same data reported anywhere between
**10,500 and 78,000** a month — a seven-fold swing, every reading wrong.
- **Each category is read on its own and the middles are added**, with nothing
  in between: a category in three of six months has a median of half its
  instalment, which is neither what a month costs nor what the instalment is,
  and which moves the moment the window slides. So a category is **regular**
  (it happened in *more* than half the live months → its median counts) or
  **lumpy** (it does not → it counts for nothing here and is charged as dates).
- **`capacityFrom` and `forecast.ts` both read through it.** Two medians of one
  ledger disagreeing is two answers to one question, and the screen showing its
  working was explaining a figure nothing else used.
- **A category charged on its own dates is subtracted from the monthly figure.**
  The old `already` set counted the collisions and wrote a sentence about them
  without ever subtracting one.
- **The `lumpy` forecast rule puts those costs back** on the month of the year
  they landed on, at the amount they were, repeated each year — otherwise they
  would simply stop existing and the plan would be richer than the ledger. It
  names them, says it read six months so only those months carry a charge, and
  points at dated budgets for the rest.

## Finance — goals are planned, not wished
`goalPlan.ts` turns a target and a date into a plan out of the ledger already there.
- **`capacityFrom(accounts, txs, bufferMonths)`** answers what there is: `held` (live
  balances, converted, net of card debt), `buffer` (months of typical spending held
  back), `free` = held − buffer − what is committed, and a normal month of income
  and expense via `typicalMonth` (above). Months with nothing in them are dropped,
  or a ledger that starts halfway through the window halves its own answer.
- **Spare is cash, not everything you own.** Only `SPENDABLE` accounts (`payment`,
  `wallet`) count toward `held`; gold, a flat, anything filed as an `asset` comes
  back as `assets` and is never spent by the plan. Counting it made every goal
  "fundable now" and left nothing to plan — 1.7M "spare" against a 3,160 card.
  What the goals already hold is `earmarked` and comes off `free` too, or the same
  pound funds two things. The header names all three, so a figure that dropped
  says why.
- **The plan is run forward, not divided once.** Dividing what there is once gets
  the first month right and every month after it wrong: under ladder everything
  goes to rank 1, so rank 2 read "left ÷ nothing" → **"nothing reaching it"** about
  a goal that starts being funded the moment the one above it lands. That is the
  question the screen exists to answer, and it was answering it with a division.
  `scheduleGoals()` walks month by month — spare cash first, then each month's
  surplus divided again among whatever still needs money, a finished goal handing
  its share to the next — and returns the rows, `landsIn`, `lump`, `monthly` and
  `startsIn`. `planGoals` takes its `eta` from that run, so every goal has a real
  date. Horizon 10 years; `unfinished` says when even that was not enough.
- Each goal comes back with `lump`, `monthly` (what **next** month puts in — zero
  for one still queued), `startsIn`, `required`, `eta` and `onTime`.
- **The screen shows its working.** `SchedulePlan` draws the run month by month —
  what goes into which goal, and where each lands — under the open goal and in
  place of the empty state. The detail adds *How it gets there*: "X now, then Y a
  month → there in March 2027", or for a queued goal the month the ones above it
  finish, plus a chip per month of its own funding. A queued goal's row says
  "starts Dec 2026" rather than nothing.
- **Rank is stored** (`20260010`: `rank`, `deadline`, `currency`) and set by dragging
  a row — same pointer-event drag as the Financials table. `goalPlanning.ts` keeps
  the three locally until the migration runs; the server's value wins.
- **A card with a balance is a goal with a target of zero.** The Plan screen
  drew a debt payoff on sample data beside this one; there was never a second
  problem. `debtGoals(accounts, txs, ranks)` makes one goal per account in the
  red — `debt:<accountId>`, "Clear CIB World", target the live balance, nothing
  saved — and it is ranked and funded like any other. `capacityFrom` therefore
  counts **positive balances only** in `held` and returns the cards' sum as
  `owed`; netting the debt off `held` *and* asking for it as a goal would count
  it twice. A debt goal cannot be edited or deleted here — the balance is the
  ledger's and moves from Balances (Settle) — and its rank lives in
  `finance-debt-goal-ranks` (prefSync) since it has no row. Unranked, a card
  goes to the front: its interest outruns anything below it. Plan tab, screen
  and icon are gone.

## Finance — three ways to split a month, and one of them is yours
`Policy` is `ladder` | `share` | `commit`, and the picker in the Goals header is
`Top first / Split / I decide`.
- **`commit`** reads `Goal.monthlyCommit` (`20260014`, `monthly_commit`, kept in
  `goalPlanning.ts` until the migration runs). Each goal takes the amount you
  set and no more, in rank order; what is left once every commitment is met runs
  down the ladder. The other two work the figure out from what is left over,
  which answers *when will this land* and cannot answer *I want 5,000 a month
  going into the car* — a decision somebody made rather than an outcome.
- **The header says whether it adds up**: committed against what a month leaves
  over, and either what runs down the list or that the ones lower down will not
  get theirs. It is the only mode that can be under- or over-committed.
- The **Each month** field only appears in that mode. A field that changes
  nothing about the plan on screen is one you have to be told to ignore.
- **A goal can be reached twice inside one month** — its commitment, then a
  share of what the commitments left over — so `put()` accumulates the first
  month's figure instead of keeping whichever call was first. Reported as 20,000
  when it is really 23,800, the "then each month" line is wrong and so is every
  date read off it.

## Finance — "never" is not an answer
`goalAdvice.ts`. The plan could say a goal lands in March 2031, or that nothing
ever reaches it, and stop — which hands the whole problem back. `adviseGoal()`
answers the next question, and every move is arithmetic on figures already on
the screen. Two rules hold it together:
- **Name the category, or say nothing.** "Spend less" is not a move. Cuts come
  out of `typicalMonth`'s regular categories, filled greedily in the order a cut
  is least painful — a budget's `guiltfree` bucket first, unfiled next, savings
  and investments after (moving those into a goal is not a cut, it is the same
  money differently aimed), `fixed` last. Each row says what *this combination*
  takes from it; a column of "not enough" against every row is true of each and
  useless about all of them.
- **Never propose what cannot be measured.** A gap larger than everything you
  spend regularly is not a category problem, so it says that and sends you to
  the date, the target or income. The earn move states the gap as a share of
  what you actually earn, **unclamped** — 112% and 100% are different decisions.
The moves: raise the commitment (first, in `commit` mode — the figure is the
thing you set), free up X a month, bring in X a month, find X once, hold one
month less of the cushion back, move it up the ranking, give it until the date
it really lands (first when there is one, being the only move that costs
nothing), aim at what it actually reaches. `ifFound()` re-runs the whole ranking
with the gap closed, so the card can name the other goals that come forward too.
`monthsUntil` is imported from `goalPlan`, or the advice and the verdict above it
disagree about the same goal on the same screen.

## Finance — the forecast, and why the goal dates move
`forecast.ts`. `capacityFrom` answers what a *normal* month leaves over, out of
the last six. That is the right answer to its own question and the wrong one to
plan a goal with: next year is not six flat copies of a normal month. School
fees land on four dates, a bonus arrives in one, a premium once a year — so a
plan built on the flat figure says the laptop arrives in May and then quietly
fails to buy it. This turns the ledger and the budgets into a **month-by-month**
picture, as a set of rules you can see and switch off.
- **Nothing is invented.** Every figure traces to the ledger, to a budget you
  wrote, or to a rate you gave. A rule that cannot find its figure goes
  **dormant** and names what it is missing — inflation stays off and says "no
  rate has been given" rather than assuming one.
- **A rule is a switch that means something.** Off, its effect is gone from
  every date on screen; that is the whole reason to show the working. **Your
  figure beats ours** — a corrected value is kept in `state.values` and marked
  `yours`, and nothing later overwrites it.
- **`scheduleGoals` takes the months rather than one flat figure.**
  `ScheduleOptions.surplusAt(m)` / `outflowAt(m)`, and the pot is **carried**: a
  month can bring less than nothing, the buffer covers it, and the months after
  pay it back before any goal is funded again. Without a forecast every month
  brings the same figure and nothing is ever left over, so carrying changes
  nothing — the old signature still works and all 23 planner tests pass
  unchanged. `MonthRow` gained `came` / `went` / `carried`.
- **Month 0 is charged nothing.** An instalment dated later *this* month is
  already an unpaid entry, which is what `committed` is, and the spare cash the
  plan starts from has had it taken off already. `dated[0]` is still filled in,
  because a screen drawing the year should show it.
- **A monthly budget rule is skipped**, because it is already inside the median;
  only `once` and `custom` shapes are added. What the median *already* carries
  is counted and said, so an instalment paid inside the window is not charged
  twice.
- `occurrencesFor` now reaches as far as it is asked to. Fixed at +2 years, a
  ten-year plan got three and read as a school that stops charging in 2029.
- `finance-forecast` is a prefSync key: which rules are off, which figures are
  yours, and your own rules (a raise, a car sold, a loan starting).

## Finance — Goals plans on a forecast, not a flat month
`forecast.ts` turns the ledger into a **month-by-month** picture; `GoalsScreen`
plans on it. `capacityFrom` answers what a *normal* month leaves over, which is
right for its own question and wrong for a year with school fees in it — four
instalments spread flat makes eight months look richer than they are and four
impossible, and every goal date comes out wrong in both directions.
- **`planGoals` takes the same options `scheduleGoals` does.** It used to take a
  bare `Policy`, so a forecast reached the run drawn under the goal and not the
  date on its row.
- **`GoalTimeline.tsx` — every goal on one timeline**, full width above the two
  columns. The ranked list says when each lands; it cannot say *why* the laptop
  waits, because the reason is always another month. **Stream** stacks what went
  into each goal above the line and hangs what left on a date of its own below
  it. **Bars** is one row per goal, one cell per month, and *the cell carries its
  own figure* — 48px, the width a five-figure number needs at 9.5px, scrolling
  rather than squeezing, because a bar you must hover to read cannot be compared
  to the one beside it. Every column of every lane opens the same month in full.
- **The axis is the line alone.** A label band between the line and the bars
  below it makes them look like they belong to something else.
- **`ForecastRules.tsx` — two disclosures, folded.** *What the forecast assumes*
  is the eight rules: each says when it fires, what it read and what it did with
  it, carries a switch, and takes a figure you type over — marked as yours, and
  nothing overwrites it. A rule with nothing to read goes quiet, names what it is
  missing, **and still takes a figure**, because typing one in is how you make it
  speak. *Your own rules* is a raise, a car sold, a loan starting: asked for
  rather than modelled, and kept apart from what was measured.
- Every rule moves the dates, measured on four dated instalments: dated budgets
  off moves the laptop Mar 2029 → Jul 2028; counting the gold makes the emergency
  fund fundable today; a 20,000 expense of your own pushes it to Jan 2031. Each
  puts itself back when switched off, and a corrected figure survives a reload.
- **The tab is one scrolling column.** With a timeline above them, squeezing the
  two columns into the viewport cut the open goal's detail off at the fold.

## Finance — what the assistant may do with the money
`lib/financeTools.ts`, merged into `ASSISTANT_TOOLS` and dispatched ahead of the
switch in `assistantTools.ts` (`FINANCE_TOOL_NAMES`). The assistant could read
your mail, calendar, tasks and habits and knew nothing about the one module
where being wrong is expensive. Four rules hold the file together:
- **The lock is the lock.** The panel opens over every screen, so reading the
  ledger aloud while Finance is locked would walk around the door. Every tool
  refuses while `isLocked()` and says so; the system prompt tells it not to work
  around that.
- **Names, not ids.** A model handed a uuid guesses, and a guess here files rent
  under school fees. `pick()` resolves by id, then exact name, then contains —
  and an ambiguous term is an **error naming the candidates**, never the first
  match.
- **The arithmetic is the app's own.** `liveBalances`, `toBase`, `settled` /
  `whenPaid` / `isUnpaid`, `findDuplicates`, `monthlyAmount` / `activeIn`,
  `capacityFrom` / `planGoals` / `debtGoals` — all imported. A second
  implementation that rounds differently is a second answer to the same question.
- **A write is one entry, it says what it did, and it can be taken back.**
  `delete_transaction` needs `confirm: true`; deletion goes through the store's
  undo; every write calls `notify()`.
Reading: `finance_overview` (the one-call answer — cash, owed, assets, this
month, unpaid, envelopes over, a normal month, spare, goals with dates),
`list_finance_accounts`, `list_transactions`, `spending_by_category`,
`list_budget_envelopes`, `list_goals`, `what_would_change_a_goal`,
`find_duplicate_entries`. Writing: `add_transaction`, `update_transaction`,
`set_transaction_paid`, `delete_transaction`, `add_goal`, `update_goal`,
`set_exchange_rate`, `set_budget_envelope`, `remove_budget_envelope`.
- **Every goal call reads `goalPolicy()`** — the split the Goals screen is set
  to — so the assistant quotes the dates that are on screen rather than its own.
  `what_would_change_a_goal` is `goalAdvice.ts` through the same door, and
  `add_goal`/`update_goal` take `each_month` for the `commit` split.
- **A budget was the one thing it could read and not change**, and an envelope
  *is* the budget — there is no second object to edit, so "budget Groceries at
  14,000" and "raise it" are one call. `set_budget_envelope` changes **only what
  it is named**, so raising an amount does not silently drop the due day, the
  bucket or the account the money leaves.
- **`saveRules` in `BudgetRuleModal.tsx` is the only writer of
  `finance-budget-rules`**, and it fires `finance:budgetRulesChanged` as well as
  `professor:moneyRemindersChanged`. `BudgetScreen` held the copy it read at
  mount, so a change made from the assistant panel — which opens *over* that
  screen — left the figure behind it unmoved, which reads as the change being
  refused. It now re-reads on that event and on `storage`, so another device's
  edit arrives too.
- **It refuses a dated budget rather than flattening it.** Four instalments
  cannot be described by one repeating figure, and turning them into a monthly
  average is exactly the thing the dated shapes exist to stop.
- **A due day with no account is refused**: the entry it writes has to leave
  from somewhere, or no balance can ever answer for it. Setting one writes the
  year's remaining unpaid entries; `remove_budget_envelope` (confirm-gated)
  takes them back out, through the same `runBudgetEntries` pass App already runs
  on `professor:moneyRemindersChanged`. Verified: a day of the 12th wrote Sept
  through Dec, and removing the budget left none.
- **One year is loaded at a time**, so `ensureYear()` switches the year for a
  range in another one and refuses a range that spans two — otherwise "nothing"
  is an answer about a year that was never fetched.
- **`unpaid_only` covers the whole year**, not the month to date: what is owed
  is mostly dated ahead, and stopping at today reported none of it.
- Amounts are magnitudes; `type` carries the direction, and a write that is
  handed a negative amount says so rather than filing it.

## Finance — Bills is gone, table and all
There were two places to write down a recurring payment and only one of them
did anything. A budget rule with a `dueDay` says what leaves and when **and**
puts the unpaid entry in the ledger, where every balance, envelope and feed
already knows what to do with it; the Bills screen kept its own list that
nothing else read. Tab, screen, modal, the `Bill` type, the store's CRUD, the
`financeDb` helpers and the `liveSync` table entry are all gone, and
`20260013_drop_finance_bills.sql` drops the table (out of the Realtime
publication first). Anything still in it is folded into budget rules by hand
before running it — the drop is not undoable.

## Finance — a budget has three shapes
A budget could only ever say "this much, every so often". School fees are four
instalments, on four different dates, for four different amounts — and forcing
that into one monthly figure makes eight months look poorer than they are and
four look impossible. `BudgetRule.schedule` (absent = `repeat`, so every rule
written before this reads unchanged):
- **`repeat`** — the original: `amount` every `frequency`, on `dueDay`.
- **`once`** — one `amount` on one `onDate`. It had no shape at all before: with
  no day-of-the-month and no interval it never reached the writer, so nothing
  was ever written for it.
- **`custom`** — `lines[]`, each a date and its own amount, with `linesRepeat`
  for a set that comes round every year (school fees) against one that does not
  (a build's payment plan).
- **`starts` is absent by default, and absent means every month.** It used to
  be filled in with whatever month the rule happened to be created in — never a
  choice anybody made — so stepping back from September to July showed a page of
  "set a budget" for budgets that were plainly sitting there, and every figure
  beside them was measured against nothing. A month is only a *start* when you
  say it is. Rules written before this still carry one, so the Budget header
  counts them for the month on screen (`startLater`) and offers to take it off
  them; a budget that should genuinely begin on a date keeps it.
- **A rule not in force this month is not a *dated* one this month either.**
  `ownDated = isDated(rule) && running`. Left ungated, an envelope whose budget
  did not apply still reported a whole **year** of spending — ten times the
  month's, with nothing beside it to say what it was.
- **A dated budget is never divided.** Four instalments of 45,000 are four
  instalments of 45,000; as a monthly figure they become 15,000 a month, which
  leaves the account on no day of the year — and measuring a month's spending
  against it measures against something nobody agreed to. `isDated(rule)` is
  `once` or `custom`; `budgetTotal(rule, year?)` is the **sum of its dates**,
  and such an envelope is measured against the **whole year**, its spending
  included. `SpanChip` writes `THE YEAR` beside the figure, because 132,000
  next to 6,000 otherwise reads as a category out of control.
- **The panel reads exactly what the envelope reads.** `BudgetRuleModal` filed
  by the entry's own date and counted the unpaid, while the envelope behind it
  filed by the day the money moved and counted only what had — `settled()` +
  `whenPaid()`. So a fee due in August and paid on 10 September was August's in
  one and September's in the other, and opening an envelope whose ring said
  179,000 showed a panel that disagreed. Both now use `settled` and `whenPaid`,
  and the panel takes `subRules` so each part is read over the span *it* is
  measured on rather than its parent's. Verified side by side: `20,000 of EGP
  25,000 this month` against a ring drawing 0.80, `179,000 of EGP 314,000
  across 2026` against one drawing 0.57.
- **A parent takes its parts' span with it.** With no figure of its own and
  dated parts, its budget is a year, so its spending has to be one too — the
  modal gets `partsDated` for the same reason.
- **Every aggregate stays a month.** The section total and the four-way split
  add `plannedMonth` / `actualBase`, which are always what *this* month asks
  for, dated rules included (`monthlyAmount(rule, monthKey)` — the real
  instalment, not a twelfth). Adding a year of school fees to eleven monthly
  envelopes would make the page's headline number mean nothing.
- **`monthlyAmount(rule, monthKey?)`** — without a month it is the year's
  average; with one it is what that month actually asks for. Every call site
  that has a month in scope passes it, so a custom schedule stops reporting a
  quarter of the year in a month with nothing in it. It is no longer what an
  envelope displays for a dated rule — `budgetTotal` is.
- `occurrencesFor` returns `{date, amount}` rather than dates, since a custom
  schedule gives each date its own; the writer takes the amount from there.
- The **Paid on** row is hidden for the two dated shapes — they carry their own
  dates, and leaving a day set would write a second entry every month beside the
  instalments.

## Finance — a budget belongs to one of four
`BUCKETS` / `bucketOf` in `BudgetRuleModal.tsx`. **Kind** used to be *fixed* or
*flexible*, which only ever answered whether one line could be moved — about one
line at a time, so nothing on any screen could add them up. The four are what a
month is actually shaped like: **Fixed costs**, **Investments**, **Savings**,
**Guilt-free spending**.
- `bucket` is the field; `fixedType` is kept and still read, so every rule
  written before this reads without being re-answered — `fixed` is fixed costs,
  `flexible` is guilt-free spending, which is what "money you steer" meant.
- **Four pills on one line, at 320px.** Two 42px pills had room for whole words;
  four do not. Short labels (`Fixed / Invest / Save / Guilt-free`), the real name
  in the `title`, a 34px pill, a dot in the bucket's colour, and the `Kind` label
  narrowed to 44px for that row alone. The caption under them names the chosen
  one in full, so nothing is lost to the abbreviation.
- **It is read, not just set.** The Budget section header draws the four-way
  split of what is budgeted this month — a 6px bar plus a percentage per bucket
  — in the same colours as the pills, so the control and the bar are visibly the
  same four things. A budget set *from its parts* is split across the parts' own
  buckets in proportion, since that is where the money is really filed.

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
- **The day is not the whole of it — the money on it counts too.** `wanted` was a
  set of `categoryId|date`, so it only ever answered "is there an entry that
  day?". An entry the budget itself wrote therefore stayed as first written:
  put a rule on the 15th at 44,000, switch it to dated instalments, and the
  15th of October kept its 44,000 for ever while the 135,000 the rule now asked
  for was never written — the date matched, so the day counted as done.
  `wanted` is a **Map to what the entry should be**, and the run is four passes:
  work out what the rules ask for, remove its own unpaid future entries that are
  unwanted *or wanted for a different amount or currency*, build `filed` from
  the ledger **minus what was just removed**, then write whatever is missing.
  `writtenThisSession` is keyed with the amount for the same reason — without
  it, a correction was blocked by the very write it was correcting.
  A **paid** entry is still never touched, and one typed by hand still
  suppresses the generated one: both are outside the "its own, unpaid, ahead"
  gate.
- **A line whose date has gone writes nothing, and the editor says so** — a tick
  instead of its number, dimmed, with the reason on hover. The ledger records
  what is owed; money due in June either moved, in which case it is already an
  entry, or it did not, which is not something a budget should invent in
  September. The line still counts in the total.
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

## Migrations — the runner remembers what it has applied
`scripts/migrate.mjs` used to read every `.sql` in `supabase/migrations` and run
all of them, every time, and `.github/workflows/migrate.yml` invokes it on any
push that touches that directory. So **adding one unrelated migration re-ran all
of them.** That is how a whole finance ledger was marked paid a second time:
`20260009` carried an unconditional
`update finance_transactions set paid_at = date, is_cleared = true where paid_at is null`,
and after its first run `paid_at is null` no longer means "logged before the
column existed" — it means **an entry somebody deliberately marked unpaid**. A
salary not yet received, a bill dated ahead, every future instalment
`budgetEntries.ts` writes. The file's own comment claimed it was safe to run
more than once, and the claim was the bug.
- **`public.schema_migrations`** (name, checksum, applied_at) is the ledger; the
  runner creates it before considering any file and skips anything whose
  checksum matches. A file whose contents *changed* runs again and says so —
  in this repo a migration is re-assertable DDL and editing one is how it is
  corrected — but that is now a visible decision rather than what silently
  happens to every file on every deploy.
- **A failure fails the run.** Errors used to print and then be followed by
  "✅ Done" and exit 0, so a broken migration deployed green.
- **`MIGRATE_ENDPOINT`** points it somewhere other than the real project, which
  is how the skip/re-run behaviour is tested without touching production.
- **Every `create` is guarded**, because a run whose result cannot be trusted is
  a run nobody reads — and that is what hid this. Three migrations had always
  failed on re-run (`create table public.users`, `create policy` on every finance
  table, and a `drop policy if exists` on a table `20260013` had already dropped
  — that form still needs the table). Nobody knew, because the old runner printed
  ✗ and then "✅ Done" and exited 0. `create table/index` take `if not exists`;
  `create policy` and `create trigger` have no such form, so each is preceded by
  a `drop … if exists` of the same name.
- **The runner proves the ledger round-trips.** Writing rows it cannot read back
  would report a clean run and then re-apply everything next push — invisible
  until a data migration fires a second time. `rowsOf` accepts the bare array the
  Management API sends and the usual wrappers, and the run fails loudly if fewer
  rows come back than went in.
- **No migration may repair data it cannot identify.** The three that did are
  fixed: `20260006` and `20260009` are DDL only now, and `20260003` clears a
  task's description only where it equals the `task_type` it just moved there.
  A one-time repair is something a person asks for once — Settings → Finance →
  PAYMENT DATES — not something a deploy does to them.
- **The way back** is `unmarkPaidInFuture()` beside it: money cannot have moved
  on a day that has not happened, so an entry marked paid on a future date is
  wrong with certainty and the stamp comes off. An entry dated in the **past**
  cannot be recovered — deliberately unpaid and genuinely paid on its due date
  are identical once stamped, and nothing recorded which it was — so those are
  left alone rather than guessed at.

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

## Finance — the pages ask who you are first
`lock.ts` is the whole policy; `FinanceLockScreen.tsx` is the door;
`useFinanceLock.ts` decides when it is shut. A fresh tab opens locked and it
locks again after a stretch of doing nothing (Settings → Finance → SECURITY).
- **Two ways through.** The device — WebAuthn, *platform* authenticator,
  `userVerification: 'required'`, so the browser will not assert without
  checking the person in front of it. Or a password, PBKDF2-SHA256 over 210k
  rounds with a random salt, hashed here and sent nowhere.
- **The lock cannot be turned on without a password.** A passkey lives in one
  device's secure element and cannot travel; a lock set with only a fingerprint
  would leave the next device signed in, locked, and with no way in.
- **The policy travels, the passkey does not.** `finance-lock` is a prefSync
  shared key; `finance-lock-device` never syncs — a credential id means nothing
  on another device. Each device registers its own.
- **Being unlocked is per tab** (`sessionStorage`), so a new tab starts locked
  and a closed browser leaves nothing behind. The gate renders *instead of* the
  module, not over it — there is no ledger behind it to screenshot.
- The settings that control it sit behind the same lock, or it is a toggle
  anyone holding the open laptop can flip. It is a lock on the screen, not on
  the data: it stops that person, not somebody with your sign-in.

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

## Accounts — a badge is a claim about a token, so it asks the token
`lib/googleScopes.ts`. The Calendar / Gmail / Drive badges under each connected
account were drawn from a **hard-coded list**, the same three strings typed out
at three call sites in `App.tsx`:
`scopes: ['calendar', 'calendar.events', 'gmail.readonly']` — which never
contained `drive`. So Drive read "not granted" on every account for ever, and
its **Grant** button sent you round the whole OAuth loop (with `drive.file` and
`drive.readonly` correctly in the request, which Google did grant) only to write
those same three strings back on the way home. Nothing about the grant was
broken; the badge could not be changed by one.
- **`readScopes(email, token)`** asks Google's `tokeninfo` endpoint and caches
  the answer for 6h against the address (`professor-google-scopes`).
- **`null` is not `[]`.** An empty list is a token that can do nothing; null is
  a question nobody could answer. The badge draws a third state for it — grey,
  a `?`, and **no Grant button**, because a button that cannot help is what sent
  us here. A failed read keeps the last measurement: losing the network is not
  evidence that a grant went away.
- **The primary row used to claim all three unconditionally** (`active` with no
  value). Signing in is not consent to everything, and a stale grant is exactly
  what the row should say.
- `setAccountScopes(email, scopes)` writes the measurement back onto the stored
  account, and `forgetScopes(email)` runs before a re-consent — what was
  measured is about the grant being replaced.

## Mail — several mailboxes, and the three ways of answering
`lib/gmail.ts` takes a `MailAccount` on every call (`accessToken(account)`: the
signed-in one from the session, a connected one from `tokenManager`). Nothing
here is "the app's mail" any more — it is always *an account's*.
- **`mailAccounts(primaryEmail)`** in `modules/inbox/mailAccounts.ts` is the
  whole set: the account you signed in with is not in
  `professor-connected-accounts`, so it is added here. `mail-account-view` holds
  `'all'` or one address.
- **All is the default.** Every mailbox is fetched in parallel and merged newest
  first; one that will not open names itself and the rest still arrive. Each row
  and the open message carry the mailbox, because otherwise a merged inbox is a
  list you cannot act on — you would not know where a reply leaves from.
- **`sendMail()` is the only sender.** Reply, reply-all, forward and new differ
  only in the fields. It does Cc/Bcc, HTML with a plain-text alternative,
  attachments (`multipart/mixed`), `In-Reply-To`/`References`, and RFC 2047
  headers so a non-ASCII subject survives.
- **Folders are queries.** Gmail has labels and a search language, so
  `FOLDER_QUERY` names the searches people mean — Unread / Inbox / Sent /
  Drafts / Starred / Archived — and `mail-folder` remembers the last one. Sent
  and Drafts show the *recipient* on the row; a list of your own name is not a
  mailbox view.
- **`Composer.tsx`** is that panel. From defaults to the mailbox the message
  arrived in. Reply-all drops **every** address of yours, not just that mailbox.
  A forward leaves the thread (no `threadId`, no `In-Reply-To`).

## Today — the mail card reads the mail and answers it
`lib/mailBriefs.ts` + `professor.briefInbox()`. The card used to show the first
140 characters of each message, which is a greeting and half a sentence. It now
shows **what the message is** and, where it wants an answer, **the answer**.
- **One call for the card, not one per message.** A morning inbox is six or
  eight threads; the model is better for seeing them together — it can tell the
  invitation from the thread the invitation is about — and it is one round trip
  instead of eight. `briefRun` (a ref keyed on the message ids) makes StrictMode's
  double effect, and any re-render, share the one call.
- **A brief is cached against the message, not the thread** (`today-mail-briefs`,
  7-day TTL). A new message in a thread is a new thing to answer; the same
  message read twice is not.
- **Never on the render path.** Rows draw the moment mail arrives; summaries land
  after. No key is the ordinary case on a fresh browser and is said once under
  the header, not down every row — and the header then counts what it honestly
  can ("3 addressed to you"), never "nothing wants an answer" about mail nobody
  has read.
- **The header counts by what each message wants, and the counts are the
  filter.** `MailStats` draws one chip per action — `to answer` / `to book` /
  `to decide` — and tapping one narrows the card to it. A count you cannot act
  on is decoration; the lit chip is how you know something is hidden, and
  `MailWaiting` carries the way back out. A filter whose chip drops to zero
  clears itself, or you are looking at nothing with no way back.
- **`MailWaiting` is the line that gets the card opened**: who has been waiting
  longest for an answer, by first name, and how long — "Hasan waiting 1d". No
  count ever did that. The informative totals sit after it in ghost.
- The 3px `MailMeter` is the action share, so a morning where everything wants
  you is nearly full and a quiet one nearly empty.
- **Nothing is sent from the card.** The draft area opens `DraftPopup` — To/Cc,
  the editable text, the original one click away, Rewrite, and the mailbox it
  leaves from named. A reply threads on the **RFC `Message-ID` header**, which is
  not the Gmail message id; `MailRow` carries both. A failed send keeps the text.
- Sending drops the row and forgets its brief. The `+` (add as task) left the
  row — the opened message still offers it.

## Mail — an invitation is an RSVP, not a reply
`lib/invitations.ts`. A Google Calendar invitation is an ordinary email carrying
a `text/calendar` part with `METHOD:REQUEST`. Answering it in prose sends the
organiser a pleasant note and **tells Google nothing** — your name stays in the
Awaiting column and the event never shows as accepted on your own calendar. So
an invitation row offers **Yes / Maybe / No / No, with a note** instead of a
drafted reply, and the draft is suppressed for it.
- **The calendar part is usually not inline.** Gmail puts an inline copy in the
  `multipart/alternative` *and* attaches `invite.ics`, and externalises whichever
  it likes — leaving `attachmentId` and no `data`. Requiring inline bytes meant
  every real invitation with an externalised part was missed, which is exactly
  what happened. `extractInvite` fetches the attachment, so it is async, and the
  read happens **after** the rows are drawn.
- **The invitations are keyed by message id, beside the rows, not inside them.**
  Written back into `mail` they were lost the moment the mail loaded again — and
  a run guard on the row set then refused to look a second time.
- **Every message in the thread is searched, newest first**, and every calendar
  part in each — a thread whose latest message is a reply still carries the
  invitation further up, and reading only the last one missed it.
- **`METHOD` is read from the part's content type as well as the body**, since
  senders set one or the other, and Gmail strips the parameters off `mimeType`
  so the body is usually the only one left. No METHOD at all still leaves a
  VEVENT with a UID, which is enough to answer.
- **Every event property comes out of the VEVENT** (`veventOf`), never out of
  the whole calendar. A Google invitation carries a `VTIMEZONE` *first*, and each
  DAYLIGHT/STANDARD block has a `DTSTART` of its own — the moment that rule
  starts, conventionally in 1970. Searching the file found Cairo's
  `19700424T000000` and every invitation rendered "Fri 24 Apr, 00:00". The same
  date on every row is the tell: it was not reading the event at all. `METHOD`
  is the exception — it belongs to the calendar, not the event.
- **A `DTSTART` with no `Z` is a wall clock in the zone its `TZID` names.**
  Reading it locally is right only by luck, for a Cairo event read in Cairo.
  `icsDate(raw, tzid)` takes the TZID off the property's own parameters and asks
  `Intl` for the offset *on that date*, so summer time comes from the browser's
  tz database rather than from the VTIMEZONE. An unknown TZID falls back to
  local rather than throwing.
- **`parseIcs` is exported so the parsing can be tested without Gmail around
  it.** The cases that matter: the Cairo invitation, a UTC time, a cancellation,
  an all-day date, London in summer and winter, a quoted TZID, a TZID that does
  not exist, and a folded SUMMARY — run with the clock set to several zones,
  because the answer must not depend on where it is read.
- **An invitation nobody could read says so.** Google's subject prefixes
  ("Invitation:", "Updated invitation:", …) tell "not one" from "one that went
  wrong", and the row names which — a silent fallback to a drafted reply is what
  sent us round this loop twice.
- **The answer is remembered against the UID** (`cal-invite-answers`, 30 days)
  and the message is **marked read**, so an answered invitation leaves a card
  that reads unread mail only. Component state alone lost the answer on the
  first refresh.
- **`UID` is the only shared identifier.** Google mints a different event id for
  every attendee's copy, so `findEventByICalUid` (`events.list?iCalUID=`) is the
  one way from the invitation to the row you can answer on. It asks `primary`
  first, then every writable calendar, because Google files it wherever the
  address is subscribed.
- **Only `self`'s `responseStatus` is patched**, and by PATCH, so nothing else
  on the event moves. `sendUpdates=all` lets Google tell the organiser — a
  second iMIP reply from us would be a duplicate with worse headers.
- **It never creates the event.** If Google has not put the invitation on a
  calendar there is nothing to patch, and the row says so and points at Google
  Calendar rather than inventing a copy the organiser's event knows nothing of.
- A `CANCEL`, or `STATUS:CANCELLED`, is not something to answer: the row says
  the organiser called it off. A `REPLY` is somebody answering an invitation
  *you* sent, so it is not treated as one at all.
- **A `[Cancelled] …` title counts too** (`titleSaysCancelled`). Plenty of
  organisers rename the event and send an update rather than cancelling, which
  leaves Google holding a live event that still wants an answer — so the row
  offered Yes/Maybe/No for a meeting its own summary said was off.
- **A cancellation removes nothing on its own.** Deleting a calendar row cannot
  be undone and the decision is yours, not the organiser's, so the cancelled row
  *offers* **Remove it from my calendar** (`removeFromCalendar` → find by UID,
  delete your copy only) and says "Off your calendar" once done.
- **"Not on any of your calendars" is a claim, and it used to cover failures.**
  `findEventByICalUid` returned `null` for a 403, an expired token and a dead
  network alike. `lookUpICalUid` returns the reason instead; `findOnCalendars`
  keeps the first one, and the message tells "we looked and it is not there"
  apart from "we could not look" — they point at different fixes. When Google
  genuinely has not filed it, that is the "Add invitations to my calendar"
  setting, and the row says so rather than sending you nowhere.
- **A series shows its next occurrence, not its first.** The DTSTART of an
  invitation to a weekly meeting is the day the series began, so "Bugs Review"
  read as a meeting in March. `parseIcs` reads the VEVENT's RRULE
  (`parseRecurrence`) and `nextOccurrence()` in `recurrence.ts` walks it — the
  first occurrence that has not *ended* at `now`, so one in progress still
  counts — and the row says "next Tue 15 Sept, 17:00 · every Tuesday", with
  the series start in the tooltip. A series that has run out keeps its first
  date and still says it repeated. The walk happens on the **event's own
  clock** (`lib/zones.ts`: a wall clock is a Date whose UTC fields carry the
  reading; TZID, `UTC` for a `Z` time, the reader's for floating), so a Cairo
  Tuesday is a Tuesday read in Tokyo and summer time moves the instant rather
  than the hour. `recur.mjs` runs the cases in four zones.
- An invitation always counts as **to book** in the header, whatever the model
  made of the wording.

## Habits — one way a log reaches the server
**`commitHabitLogs(logs?, quantities?)` in `habitsStore` is the only write
path.** Today's card wrote localStorage and stopped — no `markLocalWrite`, no
push — so the next load pulled the server's copy straight back over the tap:
"it reset on refresh" on one device, and never existed on a second. The Habits
page did it properly, which is why it looked intermittent — it depended on which
screen you tapped from. Today, Habits and `assistantTools.log_habit_completion`
all go through the one function now, and the 1.5s debounce lives there rather
than one copy per screen. It **re-reads localStorage at push time**: eight
glasses is eight taps and a later one may have landed.

**A row is written for every day with a tick *or* a quantity.**
`saveHabitLogsToDB` built rows from the ticked dates with `completed: true` by
construction, so three glasses of eight was written *nowhere* — it lived locally
until the next load and vanished. `completed` now says which kind of day it is,
and `loadHabitLogsFromDB` reads it back rather than ticking every row it finds.
A `quantity` of 0 is not a day.

## Habits — what one tap adds
`lib/habitSteps.ts`. A measurable habit was counted one at a time, which is
right for glasses and wrong for anything in real units: 200 ml at 1 ml a tap is
two hundred taps. `stepFor(habit)` answers it — the number set in Settings →
Habits ("Each tap adds"), or a guess from the unit and the target (200 ml → 100,
2,000 ml → 250, 10,000 steps → 1,000, 180 minutes → 15, anything ≤ 20 → 1).
Stored beside the habits in `professor-habit-steps` (a prefSync shared key)
because the `habits` table has no column for it, and a habit that cannot be
saved is worse than one that counts in ones.

## Habits — Apple Health, the only way it can work
A web page cannot read Apple Health: HealthKit is native to iOS, with no web
API and no OAuth. So the phone pushes. `lib/healthLink.ts` + Settings → Habits →
APPLE HEALTH make one link per habit: a metric and a secret token, and the URL
`/functions/v1/health-ingest?token=…` to paste into a Shortcut (Automation →
Time of Day → Find Health Samples → Get Contents of URL).
- **Offered only where it means something** — `isMovementHabit(name, unit)`
  matches walk/run/steps/km/… so "Read 20 pages" never sees it; `suggestMetric`
  picks steps vs distance vs minutes from the name.
- **The token is the whole credential** and feeds exactly one habit: it reads
  nothing, writes nowhere else, and unlinking revokes just that one.
- **The habit's own goal decides the tick.** The function writes `quantity` and
  sets `completed` from `habits.goal`, so 400 steps against 10,000 is a log, not
  a tick. Upsert on `(habit_id, date)` — the table's own unique — so a daily
  automation sending twice corrects the day.
- **"Check it" asks without writing.** `?dry=1` validates the token and finds
  the habit, then stops — so "not deployed", "address not recognised" and
  "wired up, nothing walked yet" are told apart. `ingestUrl` returns `''` when
  the build has no Supabase address rather than a relative one the phone could
  never reach.
- `20260012_health_links.sql` + the `health-ingest` function must both be
  deployed; the settings block says so when the table is missing.

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

## Automation — the seven rules have an engine
`lib/automation.ts`. `startAutomation()` (App, while signed in) ticks once a
minute, on wake, and five seconds after mount; `runAutomation({ force })` is one
pass and the **Run now** button in Settings. Each rule keeps its last run in
`professor-automation-last` so a daily rule fires once after its time, not on
every tick; a pass that did nothing writes nothing. `professor-automation-log`
(200 entries, `professor:automationRan` event) is the footer in Settings — what
ran, not a number somebody typed — and failures are in it as failures ("no AI
key"). Nothing here sends, deletes or moves money.
- **Write the morning brief** (06:40) — `writeMorningPlan()` in
  `morning/dayPlan.ts`, the plan builders moved out of `MorningBrief` so a plan
  can exist before the page is opened. Skips when today's is cached.
- **Draft replies** (every 30 min) — unread, addressed to you, not bulk, not an
  invitation, older than 4h, no draft yet → one `briefsFor` call (max 8). Drafts
  land in `today-mail-briefs`; Today reads it already, and Mail seeds its reply
  box from `cachedDraft(threadId, messageId)` on load.
- **Block focus for P0** (09:00) — a P0 that is placed, open and *undated* (or
  past) is dated today; `useTaskCalendarPush` then makes the block, as for any
  dated task. Dated ones the hook already handles.
- **Distribute the dump** (checked every 5 min) — over 12 → `suggestPlacement`
  / `suggestColumn` for each, one undo entry.
- **Roll forward** (00:05) — placed, open, due before today → due today. The
  calendar block stays where it was: moving an event unasked at midnight is not
  a thing to do.
- **Archive newsletters** (every 6h) — `in:inbox older_than:3d`, not starred,
  no message from you in the thread, `classifyMail` says newsletter → one
  `batchModify` per mailbox removing INBOX. Still in All Mail.
- **Close the week** (Sunday 20:00) — unless `wasReviewOpened()` for this week
  (`lib/weekReview.ts`; the Weekly Review page marks it on mount) → tasks
  shipped and slipped, the hours from the review page, habits from the logs →
  `weeklyInsight()` → `professor-week-insight-<monday>`, shown at the top of
  Weekly Review, and one `notify`.
There is no "New rule": a rule is a switch on an engine, and a switch with
nothing behind it is what the section used to be. Verified with the page clock
at 09:30 on a Wednesday: 13 in the dump distributed, an undated P0 dated and
its block created, yesterday's task rolled, the brief's failure named, the mail
rules quiet on an empty inbox, close-week untouched.

The rules (`professor-automation-rules`, a prefSync key):
1. Write the morning brief · WHEN every day at 06:40, before you wake
2. Draft replies for NEEDS YOU mail · WHEN a thread is marked needs-you and sits over 4 hours
3. Block focus time for P0 tasks · WHEN a P0 task has no calendar block by 09:00
4. Distribute the dump · WHEN the brain dump passes 12 tasks
5. Roll unfinished tasks forward · WHEN a scheduled task ends the day untouched
6. Archive newsletters · WHEN a thread is promotional and nobody replied in 3 days
7. Close the week · WHEN Sunday 20:00, if the review has not been opened

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

## Tasks — a date decides the quadrant
A task with a `dueDate` and no quadrant goes into **schedule** — deciding when to do
something is deciding about it, so it leaves the brain dump. `taskStore.updateTask`
does it (and `addTask`, for one created with a date already on it), so every path
gets it: the detail panel, the planner, the palette. Only from the dump — a task
already in Do stays in Do — and clearing the date sends nothing back.

## What is drawn but not wired
`components/ComingSoon.tsx`. A control that looks live and does nothing is
worse than no control. `NotYet` wraps a block — half opacity, `pointer-events:
none`, `aria-hidden`, a label top-right — and `Soon` is the label on its own.
Four places carry it, found by sweeping every module for elements with no React
click handler (that found the eight Billing buttons) and by reading for screens
built on sample data:
- **Settings → Billing** — no plan is read, no card stored; all eight buttons
  were handler-less.
- **Settings → Integrations** — Notion/Asana/Trello/Apple Notes accounts are
  illustrative and the switches reach nothing. Google, in the same section, is
  real and is *not* marked.
Everything else in all seven modules has a live handler. Settings → Automation
and Finance → Plan used to be on this list: Automation has an engine now
(below), and Plan is folded into Goals.

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

## Mail — the week's mail, sorted by what it wants
`lib/mailClasses.ts` decides the kind from the message itself — the list headers
(`List-Unsubscribe`/`-Id`/`-Post`), `Precedence`, `Auto-Submitted`, the campaign
headers the big platforms stamp on, the sending address and its subdomain, and
failing all that an unsubscribe line in the body. **No model call**, so the tabs
are there the instant the mail is and they are the same on every device.
- **Six classes, each implying a different action.** A split that does not change
  what you would do with the mail only costs you a decision, so "important / not
  important" is not one: `needs-you` → draft, `invitation` → RSVP (nothing here),
  `copied` → mark read, `notification` → archive, `newsletter` → archive,
  `other` → nothing. Order binds strongest-first: an invitation is one whoever
  sent it, a campaign is one even when it greets you by name.
- **Every tab is always drawn, counts and all**, so one that empties does not
  vanish and shift the ones beside it; an empty tab says what would live there.
- **Nothing is ever sent by drafting.** The class action and the message's own
  Draft button both do one batched `briefInbox` call (max 8) and fill the box
  under the mail — "DRAFT REPLY · NOT SENT" with Delete and Send. **Send is the
  only thing in the module that sends.** The list row carries a Draft pill, or a
  bulk draft across eight messages is invisible until you open each one.
- **Clicking the draft opens the full composer**, seeded with what is written,
  paragraphs kept (`<p style="margin:0 0 1em">` — the editor is a contenteditable
  with its own reset, so a bare `<p>` arrives with no spacing). The small box
  hides while that window holds the same text, and the triage card's
  "ready-to-send reply" does not sit under a draft that already is one.

## Mail — swiping a row, and acting on many
`SwipeRow.tsx` wraps every list row. Right marks read — or **unread**, since a
gesture that only works one way is a no-op half the time. Left pulls the row
aside and leaves Archive and Delete behind it until you pick one, swipe back or
tap elsewhere. Four rules it exists to keep:
- **Vertical scrolling survives.** The axis is decided once, past an 8px slop,
  and never revisited; `touch-action: pan-y` leaves the browser to scroll until
  the pointer is captured.
- **A swipe is not also a click.** A drag ending elsewhere still fires `click`
  on the row. Swallowed in the capture phase — but the gesture's own click and a
  real tap must be told apart by `moved`, or the click that *ends* the opening
  swipe closes it again in the same gesture and the swipe looks broken.
- **The action buttons are exempt from that guard** (`actions.current.contains`).
  Closing on a tap there stopped the click before its own button saw it: the
  buttons appeared and did nothing.
- **One row open at a time**, owned by the list. Pointer events, not touch —
  the same choice the Financials and goals drags made.

Selection: the avatar toggles a row, **shift-click takes the run** from the last
one picked. The bar offers Select all / Mark read (one toggle, not two buttons) /
Move / Archive / Delete.

**Every one of these is undoable** — both ways in are cheap enough to do by
accident. Gmail is the truth, so undo puts the labels back rather than restoring
a snapshot, and the row returns to the list with it.
- `byAccount(rows)` groups first: ids and token both belong to one mailbox, so
  an action over a merged inbox is one `batchModify` per mailbox.
- **Only labels every visible mailbox shares** are offered to move to, or half a
  selection moves and the rest fails.
- **Delete means the Bin**, and says so. `gmail.modify` cannot erase a message —
  that needs full `mail.google.com` — and a swipe should not destroy mail. No
  batch endpoint bins mail, so that one is a call each via `messages/trash`.

## Notifications — all seven kinds are worked out
`lib/notifications.ts`. Push is the only channel this app delivers (the list
under the bell), and every kind in the Settings matrix now produces something.
Three of them could not, because mail and a rank are not in localStorage by
themselves, so each reads a **note left by whoever does know**:
- **`needsyou`** — `lib/mailWaiting.ts` holds what the last read of the mail
  found (thread, sender, subject, mailbox, `needsYou`, and a `readAt`). Today's
  mail load and the automation's draft sweep both call `rememberWaiting(rows)`,
  which *replaces* the note: merging would keep answered mail alive. A note
  older than 3 days is ignored rather than shown — "Hasan has been waiting" is
  worth saying about mail read this morning, not about a snapshot from a laptop
  that has been shut all week. Sending, archiving, binning or answering an
  invitation calls `forgetWaiting(threadId)` in both Today and Mail. The
  threshold is the automation's own four hours: below that a reply is not late,
  it is recent. A thread that already has a draft is left to the next kind, or
  one thread is two notifications.
- **`draft`** — `pendingDrafts()` in `mailBriefs.ts`. The cache now keeps
  `fromName`/`subject` beside each brief so a draft can be named where the mail
  is not loaded. Sending calls `forgetBrief`, so what is left is exactly what is
  waiting on a click.
- **`rank`** — `lib/rankWatch.ts`. `evaluateRank` says what the rank *is*; a
  notification is about a **change**, so this keeps a history
  (`professor-rank-history`) and `checkRank()` appends to it when the rank
  moves. It runs on the bell's own tick in App, not only when the Behavioral OS
  page is open, or a promotion would be announced when you next visited that
  page. The first sighting is a baseline, never news, and it does nothing while
  Behavioral OS is off.
**A kind that is on and cannot speak yet says what it is waiting on**
(`dormantKinds` / `dormantWhy`, replacing `unwiredKinds`): "once the mail has
been read here", "needs Behavioral OS switched on". Shown in the bell panel and
as a chip on the Settings row. An empty bell for a reason is not a quiet day,
and "not wired yet" was the wrong thing to say about either.

## The assistant can be put aside
An arrow in the panel header slides it out and leaves a tab on the right edge;
the tab, or the floating button, brings it back. `minimised` lives in **App**
beside `open`, because the floating button has to return to its "open me" state
while it is aside. The panel is **slid out, never unmounted** — the thread, a
half-typed message, staged attachments and an answer still streaming all carry
on behind it, and the tab shows a pulsing dot while one is arriving. Closing is
still closing: it clears the conversation.

## The assistant takes files
`lib/chatAttachments.ts` + the composer in `AssistantPanel`. A screenshot of an
invoice or a PDF statement is the fastest way to tell the assistant something,
and it had no way to receive one. Three ways in — the clip, a paste (a
screenshot goes straight from the clipboard), a drop on the composer — and three
kinds out, because there are three things a model can be given:
- **image** — Anthropic base64 blocks; Groq a data URL, vision models only.
  Anything longer than 1568px on an edge is drawn down a canvas to JPEG first,
  which is Anthropic's own ceiling and takes the token cost with it. A small PNG
  keeps its encoding: re-encoding a screenshot as JPEG smears the text in it.
- **pdf** — a `document` block. **Groq cannot read one at all**, so
  `unsupported()` says so before the request rather than dropping it silently,
  which would read as the model ignoring what you just handed it.
- **text** (CSV, MD, JSON, logs) — inlined into the message between
  `--- name ---` fences so the model knows what it is looking at, truncated at
  200 KB and told when it was.
Caps: 5 MB an image after scaling, 24 MB a PDF, 24 MB the message. A file with
no message is a message — dropping a receipt in asks the obvious question — so
Send is live with an empty box. The chips above the input remove one at a time,
and the sent bubble lists what went with it, or the thread shows a question
about a document nobody can see was handed over. Verified by intercepting the
API: image, document and text blocks all arrive, the tools still ride along, and
the reply renders (the mock has to *stream*, or the SDK ends "without sending
any chunks").

## Overlays — a modal is not a card
`--sb-overlay` and `--sb-scrim`. Every modal panel used to be painted with
`--sb-card`, which in Glass & Depth is `rgba(255,255,255,.05)` — a wash that is
legible only when the blur behind it lands. A modal's job is to *hide* what is
under it, so on an iPad the New transaction form and the calendar were drawn on
top of one another.
- **`--sb-overlay` is opaque in every theme.** Glass gets `#1C1B26` — its own
  card colour composited onto the page, so it still reads as that surface
  without being see-through. Cards *on* the page keep `--sb-card` and the glass.
- **`--sb-scrim` is a shadow, not an ink.** It was `color-mix(--sb-ink-1 45%)`,
  and ink-1 in a dark theme is near-white, so the dim was a 45% white veil.
Used by 11 modal panels and 10 scrims across 17 files. Reach for these, never
`--sb-card`, for anything drawn over the page.

## Finance — the lock, on a second device
A passkey lives in one device's secure element and never travels, so a second
device has none — which the lock screen *stated* and then left you with: the
only way to enrol was to unlock with the password and find Settings → Finance →
SECURITY. That is why it worked on a laptop and not on an iPad.
The offer now happens where it means something — **right after the password
proves who you are**: "Use Touch ID or Face ID on this iPad?" / Set it up / Not
now. Registration runs **from that tap**: WebAuthn needs the gesture and cannot
be done for you afterwards. A refusal names what the platform actually said and
opens the finances anyway — the password already answered that question.

## Ink — the colour of text is derived, not declared
`lib/ink.ts`. A theme token cannot say what reads on a **colour somebody chose**
— an avatar's swatch, a habit's, a company's, the accent behind a chip. Those
come from `palettes.ts` or from Google, they do not move when the theme does,
and one fixed `--sb-ink-on-fill` over a palette of a dozen hues is unreadable on
some of them. `--sb-ink-on-fill` stays right for a *theme* fill (the primary
button, the solid nav pill), where the fill is a token too and the pair was
chosen together.
- **`inkOn(bg)`** measures both candidates and takes the better. Not a luminance
  threshold — "over 0.5 is light" is wrong through the middle of the range,
  which is exactly where a mid-tone accent sits.
- **`inkOnKeeping(preferred, bg, min)`** keeps a colour that is there on purpose
  where it can still be read: the assistant's mark is the accent at 9:1 on
  Sunlit's near-black fill and 2.3 on Evergreen's.
- **`color-mix()` does not compute to `rgb()`.** Chrome answers
  `color(srgb 0.68 0.58 0.98 / 0.31)` — 0..1, not 0..255. Miss that and every
  tint resolves to nothing and falls back, which is how a pale pink got white
  ink. `aa-theme.mjs` learnt this once already.
- **The ground is a stack.** Glass's `--sb-field` is `rgba(255,255,255,.035)`,
  so a 28% accent mix lands at alpha 0.31 on a card that is itself translucent.
  `solidify()` composites down to the theme's base; one layer gives a pale
  answer on a dark violet.
- **The answer expires.** The theme picker, the accent picker and the behavioral
  mode all go through `applyThemeVars`, so that is where the cache drops and a
  version bumps. Use `useInkOn()` for anything resolved through a `var()`; the
  bare function is fine for a fixed hex.
- **Decoration is exempt and says so.** `aria-hidden` on Today's quote mark —
  the same mark that stops a screen reader announcing furniture is how the audit
  knows not to hold it to 3:1.

`node scripts/ink-audit.mjs <port>` against a dev server is the measurement:
nine screens × four themes, every text against the background it is *actually*
drawn on. 21 failing pairs when written, none now. Re-run it after touching a
token or a palette.
