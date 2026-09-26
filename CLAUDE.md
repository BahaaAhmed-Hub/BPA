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
  account / amount**. `Ends` mirrors `Starts` until it is touched (`toTouched`), and
  `Every` is empty by default, so a line is one entry unless deliberately made a
  repeat. The footer counts *entries*, not lines.
- **The account is per line, and so is the currency.** A batch used to be one
  account for all of it, which is right for a month of card spending and wrong
  for a page of receipts — those come off whichever card was in your hand. The
  pickers in the header are *setters*, the same contract the Paid control has:
  they fill every line and every line can then differ. A new line inherits the
  last line's account rather than the header's, or the sixth receipt from one
  card quietly lands somewhere else. The currency follows the line's own
  account, because an entry is stored in the money it was actually in, and the
  footer totals **per currency** — adding 250 USD to 4,000 EGP gives a number
  true of nothing. Every line that would be written needs an account: the count
  of those without one is what the footer says and what disables Add.
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
- **The header is one line, always.** It aligned on `flex-end`, which is only
  the same line while every item is the same height — the net figure is three
  lines and the pills are one — and the unpaid caption hung *below* the basis
  toggle in absolute position, so the row became two rows whenever it appeared.
  Everything shares one centre line now, the caption is a chip on that line
  (and clicking it switches to the basis that counts those entries), and the
  bar does not wrap: the title beside it gives way, and past that the bar
  scrolls sideways rather than stacking.
  `.sb-segmented` used to carry `align-self: start` to stop a column parent
  stretching it. That also overrode a row aligning on `center`, which is what
  put the pills on a different line from the figures. Only a parent that
  stretches is the problem, so it is fixed at that parent — the Goals policy
  picker sets `alignSelf` itself.
- **The "to check" panel is `fixed`, positioned from the button's own rect.**
  The bar it hangs off scrolls sideways so the controls stay on one line, and a
  scroll container clips its descendants — `overflow-x: auto` computes
  `overflow-y: auto` with it, so the panel was cut off at the bar's own 63px
  and the chip read as a button that does not open. A DOM-text assertion passed
  right through that: the panel was there, it was simply not *seen*. Anything
  that opens over the page from a control inside a scroller has to leave the
  clipping context, and the test for it has to measure the rect against its
  ancestors and `elementFromPoint`, not the text.
  Floating means it closes like a floating thing: pointer-down away from it, or
  Escape, with the button itself and `.sb-dupes-panel` exempt.
- **A duplicate can be acknowledged.** `duplicateAcks.ts`. Detection points at
  pairs and never decides; some pairs are real — a second tank of petrol, a
  bill paid in halves — and the list had no way to say so, so the chip sat at
  "10 to check" for ever, which is a count you learn to ignore. A tick takes
  one out of the list and out of the chip, the panel says how many were checked
  and offers them back, and nothing about the entry changes: it is a note about
  having looked, kept beside the other finance preferences.
  **The note is against the entry as it was when you looked at it** — the key
  carries the fields that made it a duplicate plus its date, so editing any of
  them brings it back rather than leaving an acknowledgement outliving the
  thing it was about.
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

## Finance — what a card earns, and why it is never money
`cardRewards.ts`. The ledger recorded 40,000 leaving on a card and no part of the
app could say that 2,000 of it came back. Two figures make the whole of it, and
they are two because banks state them separately and each moves on its own:
**earn** (points per 1 unit spent, per channel) and **pointValue** (what one
point is worth). Multiply for the return — `1 point per 10 EGP` at `0.50 a
point` is 5%. One blended percentage would be tidier and would leave you no way
to correct the half that moved.
- **Nothing is invented.** A scheme with no figures is *dormant*: it names what
  it is missing and contributes nothing, the same shape as a forecast rule.
  There is no default earn rate, because a made-up one puts a made-up figure in
  EGP on a screen full of real ones.
- **A looked-up figure is a suggestion until you say otherwise.**
  `rewardLookup.ts` asks the model what a bank's programme pays — it cannot
  reach the bank's website and says so. What comes back is `suggested`, every
  screen marks it, and touching any field makes it `yours`, after which nothing
  overwrites it. A bank it does not know, or a card it cannot tell from three
  others at the same bank, comes back `known: false` and the fields stay empty:
  a scheme half-filled with confident nonsense is worse than an empty one.
- **Cash never earns.** Not a low rate — zero, and not editable. A transfer
  *out of* a card is a cash advance (`isCashUse`): borrowed at the card's own
  rate from the hour it is taken, with no grace period. The entry panel says so
  while you are writing it; a transfer *into* a card is paying it off and is
  fine.
- **A monthly ceiling belongs to its month.** Points are worked out per month
  and capped there, or a cap of 5,000 a month silently becomes 5,000 a year and
  understates a heavy December. What was lost to the ceiling is named.
- **Only what has been paid counts**, filed by `whenPaid` — the same rule as
  every other figure here. A bank does not award points for an entry dated ahead.
- **The channel is stored, not inferred.** `finance-tx-channels` per entry
  (absent = `pos`), and the entry panel asks in one tap **only** where the card's
  two rates actually differ. A category cannot tell a card tapped in a shop from
  the same shop's website, and a rate applied to a guess is a figure nobody can
  check.
- **A card is not money, anywhere.** `capacityFrom` files a card *in credit* as
  `counts: 'card'` — headroom, neither cash nor asset — so the forecast rule
  that counts assets as spendable cannot sweep it up, which was the one route
  left by which a card could still fund a savings plan. A budget rule in the
  savings or investments bucket paid from a card says so. The assistant's
  `finance_overview` reports `credit_on_cards_not_cash` separately and its
  system prompt forbids adding either that or points to a balance, goal or plan.
- Per-card figures live on the card (Balances → the card → edit, the POINTS
  block). What is true of all of them — show points as money, the window, a
  point's value where a card does not say — is Settings → Finance → CARD POINTS.
  `finance-card-rewards`, `finance-rewards-settings` and `finance-tx-channels`
  are prefSync keys; there is no migration, the same choice `finance-credit-
  limits` made.

## Finance — what an account holds
`balances.ts` is the only thing that answers this. `account.balance` is the **opening**
figure; the live one is that plus every entry filed against the account, so nothing
ever writes back to the row.
- **"Not paid yet" is what is due by now, not the rest of the year.** Unpaid
  entries come back split at `asOf` (today by default): `pending` is dated on or
  before it — money you actually owe — and `ahead` is dated later. They used to
  be one figure, so a card carrying four months of instalments still to fall
  read as 324,550 outstanding when nothing was late. It was arbitrary as well as
  wrong: one year is loaded at a time, so that number grew every January and
  shrank to nothing every December. A row with nothing overdue says what is
  coming instead — *dated ahead*, in the muted ink, because it is a fact about
  the diary rather than a debt. Sign convention: positive is held, negative is owed —
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

## Finance — the open goal is one panel, not five cards
`GoalDetail` used to be five white cards loose on the page ground, each
spacing itself with a `marginBottom`. It is now **the calendar composer's
shell**, to the token: a panel in the page's own cream, bordered so it reads as
a box against a ground of the same colour, holding white cards whose separation
is that ground rather than a rule. Five banded sections in a column do not
scan, and five floating cards do not read as one thing.
- **The shell's `gap` spaces the sections**, so a card cannot be double-spaced
  by being both inside the shell and pushing its sibling.
- **Every section carries its eyebrow inside its own card, top left.** Some had
  one and some did not, which is most of why the column looked like parts of
  different pages stacked up. The two without now read *The goal* / *The card*
  and *Where it stands*.
- A section's ground says what kind it is: white for the ordinary ones, the
  positive/negative tint for the verdict, the accent tint for *What would
  change it* — which holds its own white cards a level down, at `--sb-r-nav`
  rather than `--sb-r-card`, so the nesting is legible rather than repeated.

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

## Shopping — an item is edited where it is
`shopping/ItemFields.tsx` is the whole of an item, in **one** component, drawn by
both views — the list's expanded row and the board's opened card. An item had
four editable fields (category, notes, max price, and a store picker that wrote
to a derived field); everything else was set once in the Add modal and could
never be corrected, its **name** included.
- **The contract is the calendar composer's.** A select, a pill or a tick is a
  decision and goes the moment it is made; words are held 700ms so a keystroke
  is not a request. `useHeldText` flushes on blur, on Enter **and on unmount** —
  closing the row is not how you lose the sentence you just typed — and takes a
  value arriving from outside only while nothing is half-typed, or another
  device's write lands on your caret.
- **The name is editable in the row header**, not only down in the editor: it is
  the field you most want to correct and it is the one you are already looking
  at. Escape puts it back.
- **A purchased item opens too.** What it actually cost is the thing most worth
  correcting and the confirm dialog asked once and then never again — so *Paid*,
  *Bought at* and *Bought on* are fields, and the tick is a toggle rather than a
  one-way door. Coming off `purchased` clears the three, or history shows a date
  for something that is back on the list.
- **The currency list is what you have rates for** (`fx.loadRates()` + the base +
  the item's own), never a hard-coded three — which is how a figure in a fourth
  currency becomes uneditable.
- **Stores are editable too** (`shopping/StoresTab.tsx`). `updateStore` was in the
  store from the first commit and no screen ever called it, so a typo in a URL
  meant deleting the store — which takes its price history with it, the
  snapshots being `on delete cascade` — and adding it again. A row opens on the
  same write-through contract, and says what each store is actually *doing*:
  how many live items it is checked for, or that its categories match nothing.

## Shopping — which stores an item is checked at
`storesToCheck(item, stores)` in `shoppingStore.ts` is the only answer, read by
the price watch, by *Optimize trip* and by the picker that draws it. **Your pick
wins where you have made one; where you have not, the category match stands in.**
- Those are two questions and used to be one field. The picker wrote
  `suggestedStores` — which `enrichItems` recomputes from `item.category` on the
  very next render and which no column ever held — and `refreshPrices` read
  neither, re-deriving the category match itself. So a pill lit, the next render
  put it back, and nothing about the price check ever changed. The control was
  drawn and connected to nothing.
- **`store_ids` is its own column** (`20260019`), written by `upsertItem` behind
  the same drop-only-the-column-the-error-names retry `financeDb` uses, and
  `storeIdsSupported()` lets the caption say when the choice is only being kept
  on this device. Empty means nobody has chosen, which is what every item
  written before the column already did — so nothing changes for them.
- **The caption says which of the two is in force**, and names the category when
  no store carries it. An empty row of pills read as "nowhere".
- `suggestedStores` stays, derived and documented as unwritable.

## Shopping — two views, and what each one answers
`shopping-layout` (`list` | `board`), a `Segmented` in the header beside the
Lists / Stores / History one.
- **List** files each list under the week or month it is scheduled for: it
  answers *when*. **Board** (`shopping/BoardView.tsx`) is a column per list with
  its items as cards, so a whole week's lists are side by side — which the list
  view cannot do once either list has more than a few items on it.
- **Week / Month is withdrawn on the board**, because it is a question about the
  list layout and the history and has nothing to say about columns.
- **Dragging a card to another column is how an item changes list** — the same
  thought as the List field in its editor, done with the hand. dnd-kit with a
  `DragOverlay` and the Budget screen's two sensors, because the board is used on
  an iPad and `dragstart` never fires for a finger.
- **"No list" is a column like any other and is always drawn**, or an item has no
  way *out* of a list. `NO_LIST` is not a group id and `handleAddItem` maps it to
  `undefined`, or the string would be written into a uuid foreign key.
- **The board measures its own height.** `height: 100%` is no use: the Shopping
  screen sits in a content-sized column, so its own 100% resolved to 269px of a
  1000px window — which the list view hides by flowing and a horizontal board
  cannot. A `calc(100vh - 212px)` would be a guess about every bar above it, the
  mistake the calendar panel made. `useFillsTheWindow` asks where the board
  actually starts and takes the rest, and asks again on resize.
- Both views and the stores page are in `scripts/ink-audit.mjs` now — the module
  was added without one.

## Boot — an account is pulled down once, not once per auth event
`hydratedFor` + `hydrate(userId)` in `App.tsx`. `loadAllFromDB` + `beginLiveSync`
hung off **three** call sites, and Supabase reaches all of them on one cold load.
Measured on a single boot, straight onto a screen:

```
SIGNED_IN · getSession · getSession · INITIAL_SESSION
· TOKEN_REFRESHED · TOKEN_REFRESHED · TOKEN_REFRESHED
```

Seven full loads of every table — the two `getSession`s are React StrictMode's
double mount — which came to **108 REST reads on one boot**, spread from 1.1s to
6.4s. A browser runs ~6 connections to a host, so the hundredth request waits
behind ninety-nine nobody needed, and every module fills slowly because of it.
- **Each pass *replaces* its store's contents** rather than merging, and the last
  three land seconds after you are already reading the screen. So a populated
  list goes empty and comes back — which is what "it takes ages and I have to
  refresh a few times" actually was. It was never one module's fault; Shopping
  was simply the one being looked at.
- **`TOKEN_REFRESHED` is the plainest case**: the token changed, the person did
  not, and nothing about their data can have moved.
- **Module scope, not a ref.** StrictMode's second mount gets fresh refs and
  would load again — that is two of the seven.
- **Sign-out calls `forgetHydration()`**, so signing back in (even as the same
  person) is a real load. It sits in the `!session` branch that already stopped
  liveSync and dropped the Google token.
- A different user id hydrates again by construction, so an account switch is
  unaffected.
Measured after: **24 reads**, every table once, and the window from 1.1s→6.4s
became 1.6s→1.7s. Shopping still reads twice in dev only — StrictMode mounts the
screen twice, and its own `loadAll()` is on that mount.

## Shopping — the Realtime channel, and the reload storm behind it
Three faults in one subscription, all of which made the module feel slow the
longer a tab stayed open.
- **`startRealtime` never tore the previous channel down**, though
  `beginLiveSync` does exactly that for liveSync two lines above the call to it —
  the shopping channel was bolted on beside it and did not follow the rule. Each
  call *overwrote* `_stopRealtime` with the newest channel's remover, so seven
  auth events left seven live channels and six unremovable ones. Every one of
  them answered the same change with its own `loadAll()` — two round trips each.
  It now calls `get().stopRealtime()` first; verified 4 starts → 3 removals,
  exactly one live.
- **A change is a reason to reload once, not once per row.** The four
  subscriptions share one debounced `nudge` (`RELOAD_QUIET_MS`, 400ms): a price
  refresh writing a snapshot per item used to be a full reload apiece. Verified
  20 events → 1 reload, and `stopRealtime` cancels one still pending.
- **`shopping_price_snapshots` cannot be filtered by `user_id`** — it has no such
  column, being owned through `item_id` — so that one is held to RLS and the
  debounce instead, and says so.
- **`addSnapshots` inserts the batch in one request.** One call per snapshot was
  the same storm on the write side, and each insert came back as its own
  Realtime event.

## Shopping — a reload is not an empty ledger
The list view rendered its empty state whenever the store was empty, so every
reload flashed **"No shopping lists yet"** about lists that were on their way —
the most misleading thing the screen could say. It now shows *Fetching your
lists…* while `loading` is true **and** there is nothing yet; once there is
something on screen a reload is silent, because flashing a spinner over data you
are already reading is worse than the wait. An account that is genuinely empty
still gets its empty state — verified both ways.

## Bots — a company calendar is not on the account you signed in with
`supabase/functions/_shared/googleCalendars.ts`, used by **both** the Telegram
bot and Siri. Each had its own copy of two stacked narrowings:

```
.from('google_accounts').eq('is_primary', true)      ← only the signed-in account
GET /calendars/primary/events                        ← only *its* default calendar
```

Teradix and DX are connected accounts, so neither bot could ever see them — and
a second calendar on the primary account was invisible too. The bots reported a
diary that was true of one calendar and said nothing about the rest, which reads
as "you have nothing on" rather than "I cannot see it".
- **`CalendarHub` answers "which calendars are mine"** the way the app does:
  every row in `google_accounts`, every calendar in each one's `calendarList`,
  minus anything hidden in `google_calendar_settings`, with your `display_name`
  winning over Google's summary. Capped at 12 calendars for one question.
- **One dead account is not an empty diary.** An account whose refresh token has
  expired is skipped and **named** in the reply; the others still answer.
  Returning nothing because the third account is stale is the same failure in a
  new costume.
- **An event id is only unique inside its calendar.** Reads hand back
  `eventId::calendarId`, which is what an edit needs; `locate()` also accepts a
  bare id and searches for it, because a model echoing a string back is not a
  channel to trust. A patch sent to `calendars/primary` for an event on Teradix
  is a 404 that reads as "the event is gone".
- **Writing says where it went.** `pickWritable(name)` matches a calendar
  loosely — "teradix" finds "Teradix Ltd", an address matches too — never picks
  a read-only one, and falls back to the signed-in account's own. The reply
  names the calendar, because with several in play "Created" alone does not tell
  you whether it went where you meant.
- Both system prompts now state that several calendars exist and how to name
  one; without that the model answers about "your calendar" as though there were
  one. `getGoogleToken` stays for **Gmail**, which really is one mailbox.

## Bots — "I got a bit confused" was usually a truncated answer
Both agents ran the tool loop and, for any `stop_reason` that was neither
`end_turn` nor `tool_use`, fell straight out to *"I got a bit confused — could
you rephrase that?"*. The commonest such stop reason is **`max_tokens`**: the
reply was cut off, often mid tool-call. Siri's ceiling was **512**, which a tool
call plus its sentence reaches easily — so it told you it had not understood a
question it had understood perfectly, and only sometimes, which is exactly how
it felt from the outside.
- `max_tokens` is now its own case: speak the partial text with an ellipsis, or
  ask for a narrower slice — never claim a misunderstanding.
- Ceilings raised: Siri 512 → 1024, Telegram 1024 → 2048 (a day across several
  calendars is a longer reply than it used to be). Siri's answers stay short
  because its prompt says so, not because the ceiling cuts them off.
- **An API failure says which kind.** 429, 5xx and everything else read
  differently and point at different fixes; "Sorry, I ran into a problem" for a
  rate limit sends you to rephrase a sentence that was fine.
- **401 and 403 are the one failure retrying can never fix**, and they were
  falling through to *"I could not reach the AI service"* — which points at the
  network and sends you off to try again for ever. The request arrived; the key
  on it was refused. The branch names it, and names **where that key lives**:
  the bots read `ANTHROPIC_API_KEY` from **Supabase function secrets**, which is
  a different secret in a different place from the web app's own key (Settings →
  AI, per browser) and from the GitHub secret the build once used. So rotating
  the key anywhere else leaves this one holding the revoked value, and the bot
  goes quiet with a sentence about the network. `if (!ANTHROPIC_KEY)` already
  covers an *unset* secret, so a 401 always means set-but-refused.
  Both bots keep their own copy of the branch; both were changed, and the test
  lifts the branch verbatim out of each file rather than restating it.

## Bots — Telegram's Markdown ate the variable name
The 401 message above arrived in Telegram as **`ANTHROPICAPIKEY`**. Every reply
goes out as legacy `Markdown`, where `_` is an italic marker, so
`ANTHROPIC_API_KEY`'s matched pair opened and closed emphasis around `API` and
**both underscores were consumed**. A sentence whose whole job is to name a
secret named one nobody has. Anything carrying a `_` is rewritten the same way —
a table name, a file, a tool name.
- **The identifier goes in a code span.** Inside backticks nothing is markup, so
  the underscores are literal, and Telegram makes a code span tap-to-copy, which
  is what you want to do with a variable name anyway.
- **The worse half: an *odd* marker threw the whole reply away.** Unbalanced
  markup is a 400 `can't parse entities`, and `tg()` swallowed every outcome —
  `.catch(() => {})` and no `res.ok` — so the message simply never arrived and
  nothing anywhere said so. The model writes free prose: one stray asterisk, or
  a lone `finance_transactions`, was a silently dropped answer.
  `reply()` now tries Markdown and, if Telegram refuses it, **sends the same
  text again as plain text**. Ugly beats absent. `tg()` returns whether it
  worked and logs the status and body when it did not.
- Siri sends no `parse_mode`, so none of this reaches it.
Verified against a stub that implements legacy Markdown's own rules, with the
real `tg`/`reply` lifted out of the file by index rather than restated: the old
string renders as `ANTHROPICAPIKEY` and the new one as `ANTHROPIC_API_KEY`; a
message carrying one underscore is retried without `parse_mode` and its words
arrive intact; a clean message is still sent once, with Markdown.

## Bots — nothing deployed them
`telegram-bot` and `professor-siri` were in **no** workflow. Between
`deploy-functions.yml` and `supabase-deploy.yml` only five functions ship —
`google-token-refresh`, `mail-smart-run`, `google-oauth`, `google-calendar-sync`,
`google-calendar-write` — and the bots were never added, so every change to them
since they were written went out by hand or not at all. A fix could be merged to
main, the workflow could run green on the very push that carried it, and the bot
would keep its old behaviour: the run deployed the five functions it knows about
and said nothing about the two it does not.
- Both now deploy with **`--no-verify-jwt`**, and neither is thereby
  unauthenticated: Telegram's webhook POSTs with no Supabase session and a Siri
  Shortcut is a plain URL, so the gateway would reject both before the function
  ran — each resolves a `prof_sk_` token of its own instead (the chat's linked
  token, or `?token=`/Bearer) and answers nothing without a valid one.
- Still not in any workflow, and still hand-deployed: `professor-mcp`,
  `health-ingest`, `shopping-price-watch`. Each has its own token or session
  check; adding them is the same two lines when someone wants them automatic.

## SaaS — plans, modules, and the admin who cannot read your ledger
`20260021_entitlements.sql`. Three questions that used to have no answer at all,
kept apart because they have three different ones: what modules exist
(`modules`), what a plan includes (`plan_modules`), and what *this* user gets
anyway (`user_modules`).
- **The override is a row's presence, not a nullable boolean.** Present-and-true
  grants a module the plan does not include; present-and-false revokes one it
  does; no row means inherit the plan — which is the commonest case by far,
  since most users are exactly their plan. `note` and `set_by` are not
  decoration: in four months the only thing that can explain why one user has
  Mail on a free plan is a sentence somebody wrote at the time.
- **`has_module(uid, mod)` is the only thing that resolves the three**, so an
  RLS policy, an edge function and the client cannot reach different
  conclusions about the same user. The order is the whole policy: **core** beats
  everything, then the user's override, then the plan, then no. An unknown
  module id resolves to false — a typo must never grant anything.
- **`core` is a module that cannot be revoked**, by a plan or by an override.
  Today and Dashboard are core, or a downgrade leaves somebody signed in with no
  home screen and no way to reach Settings — a support ticket rather than a
  plan.
- **Admin is its own table, never a column on `public.users`.** That table
  carries `for all … using (auth.uid() = id)` from `20240001`, so an `is_admin`
  column on it would be writable *by its own subject*: every user one UPDATE
  away from being an admin. `public.admins` has no write policy at all — with
  RLS on, that means nobody holding an anon key can write it, admins included.
  Rows go in by hand with the service role.
- **What an admin may do is deliberately narrow.** Switch any module for any
  user, edit what a plan includes, read `users`/`subscriptions`/usage. Not:
  rewrite a subscription (Stripe owns that, and a hand-edit puts the two out of
  step with the thing that actually bills), mint another admin, or read
  `finance_transactions`, tasks, habits or mail — **no admin policy exists on
  any data table**. Power over modules without the liability of someone's
  ledger. Grant it per incident if you ever truly need it.
- **A lapsed subscription is not a deleted one.** `plan_of()` reads any status
  outside (`active`, `trialing`) as free, and a user with no row at all is free
  too. Downgrade, keep the data.
- **Hiding the nav item is cosmetic** — the bundle is public and editable, so
  the gate has to be RLS on each module's own tables (`and
  public.has_module(auth.uid(), 'finance')`). The admin panel can live in the
  same app for exactly this reason: a non-admin who forces the route gets an
  empty page, because every query returns nothing.
- **A module that is off must never be LOADED.** `my_modules()` is one round
  trip for the whole resolved set, and it has to land *before* `hydrate()`: a
  store that loads into an RLS denial and replaces itself with nothing reads as
  "my data is gone" rather than "this is not on your plan" — the same trap as
  *a reload is not an empty ledger*, one layer down.
Verified on a throwaway Postgres 16: 14 resolver cases (plan, override both
ways, core beating a revoke, lapsed, no row, unknown id, signed out), 9
escalations blocked as the `authenticated` role (self-admin, self-upgrade,
self-grant, rewriting a plan, making a module core, reading another user's
overrides or profile), 9 admin cases, and three consecutive applies exiting 0
with no duplicated seed and no clobbered override.

## SaaS — the client reads what it may see, before it reads anything else
`lib/entitlements.ts`. `my_modules()` resolves the whole set server-side in one
round trip; this is the browser's copy of that answer and nothing more. It
decides what is **drawn** and what is **loaded**, never what is permitted —
the bundle is public and editable, so the boundary is RLS and this is a
courtesy to the person reading it.
- **Off means never loaded, not loaded-and-hidden.** A store that fetches into
  an RLS denial replaces its contents with nothing, and an empty Finance
  screen reads as *"my ledger is gone"* rather than *"this is not on your
  plan"* — the same failure as *a reload is not an empty ledger*, one layer
  down. So `hydrate()` settles the answer **before** `loadAllFromDB`, and each
  loader, each `liveSync` handler and Shopping's Realtime channel ask first.
  Shopping is a tab of Finance rather than a module, so it follows Finance.
- **A warm browser does not wait for it.** A cached answer for *this* user
  starts the load at once and refreshes behind; only a cold boot pays the round
  trip. Guessing is what this exists to stop, so with nothing cached it waits.
- **A failed read is not evidence that a module went away.** The last answer
  for this user stands — `googleScopes.ts`'s rule. With nothing cached at all,
  everything is on: locking somebody out of their own app over a dropped
  request is far worse than drawing a tab whose data the server declines
  anyway. An **empty** registry is treated as no answer, not as a user with no
  modules, so a project where `20260021` has not run behaves exactly as before.
- **The cache is keyed by user id**, so another account's answer can never be
  read as this one's. `clearUserData`'s hand-maintained key list has drifted
  before (14 keys against 34 the app writes); this does not depend on being
  on it, and `forgetEntitlements()` runs on sign-out regardless.
- **An id the registry has never heard of is not off.** `settings`, `review`,
  `behavioral` and `planning` are not modules, and a gate that read "not
  enabled" rather than "registered and disabled" would take the way into
  Settings with it. Verified on a plan holding only the two core modules.
- **`activeModule` is persisted**, so a plan that changed under a shut laptop
  reopens on a tab that is no longer there. The nav lands on the first module
  that is, rather than on a blank page.
Verified in Chromium against the real bundle, with `my_modules` stubbed:
Mail + Finance off → neither drawn, and **not one** of the nine `finance_*`
tables or `shopping_*` fetched, while `tasks` and `habits` were — the control
that makes the absences mean something. The mirror (tasks + habits off) fetches
all nine finance tables and neither of theirs; nothing off draws all seven.
A laptop reopened on a withdrawn Finance lands on Today, not a blank page.
**Every way into a module is one door.** `setActiveModule` and `focusOn` in
`uiStore` refuse a module that is off and **say why** — "Calendar is not on
your plan" — so the nav, the palette, Today's shortcuts, a task's calendar row
and the sidebar are all covered, including the ways in nobody has thought of
yet. Gating each caller covers only the ones somebody remembered. A refusal
that silently did nothing would be the dead button this replaced, and the
sentence is the upgrade prompt. `labelOf` reads the label `my_modules()`
already returns and falls back to the id: an id on screen is a bug report, an
invented label is a wrong answer. The command palette drops those results
outright — a hit you cannot open is noise in a list you are scanning fast.

## The AI key is the person's, and it is never in the bundle
`VITE_ANTHROPIC_API_KEY` was read at build time in six places and injected by
`deploy.yml`, which means Vite inlined it into a JavaScript file served to
everyone who opens a **public GitHub Pages site**. A key in a client bundle is
not a secret whatever the variable is called — `dangerouslyAllowBrowser` is the
SDK saying exactly that — and no amount of care elsewhere makes it one.
- **The app could already do this properly.** Settings → AI takes a key and
  keeps it in `professor-ai-config`, on that browser and nowhere else;
  `getAIConfig()` read it *first* and fell back to the build-time value. So the
  baked key was only ever a second answer to a question that already had one,
  and removing it leaves the right one.
- **There is no module-level client.** One built at import time captures
  whatever the config said then, and the key is a thing the person can change
  while the app is open. `anthropic()` builds one per call and throws a
  `config_error` naming Settings → AI when there is no key;
  `imageTaskExtractor.ts` imports `anthropicKey()` rather than keeping a second
  copy of the question.
- **The measurement is a canary, not a grep of the source.** Build with
  `VITE_ANTHROPIC_API_KEY=sk-ant-CANARY-…` set and search `dist`: **3
  occurrences before, 0 after**, with the variable deliberately present. A
  source grep proves what is written; this proves what is *shipped*.
- **A claim about exposure needs the deployed artifact, not the mechanism.**
  The canary proves the pipeline would inline a key; it says nothing about
  whether the secret had a value. The one reachable deployed bundle
  (`gh-pages`) compiled it to `apiKey:``` — empty — and its only `sk-ant` string
  is the placeholder in the Settings input. Those are two different questions
  and the first was reported as the second here once already.
- The bots keep their own **server-side** `ANTHROPIC_API_KEY` in Supabase
  secrets, which is a different key in a different place and is not affected.

## SaaS — the gate that actually enforces
`20260022_module_rls.sql`. Everything before it decided what to **draw** and
what to **load**, and both live in a JavaScript file served to the public — a
courtesy to the person reading the screen, not a boundary. This is the part
that answers somebody who edits the bundle and asks for the rows anyway: each
module's own tables gain `and (select public.has_module(auth.uid(), '<module>'))`
to the policy they already had. Ownership still decides first; this only narrows.
- **The scalar subquery is not decoration.** A bare `has_module(auth.uid(), …)`
  in a policy is re-evaluated **per row** — ten thousand calls on a ledger of
  ten thousand entries. Wrapped in `(select …)`, with arguments constant for
  the statement, Postgres hoists it into an InitPlan and runs it once.
- **`%I`, never `%L`, for a policy name in `format()`.** A policy name is an
  identifier (`"x"`), not a string (`'x'`); `%L` produces
  `drop policy if exists 'finance_accounts: own rows'` and a syntax error. The
  eight finance tables are driven by a loop, so the mistake hit all eight.
- **Shopping is gated on `finance`**, being a tab of it rather than a module —
  the same answer the client gives. `shopping_price_snapshots` has no `user_id`
  (it is owned through `item_id`), so its own clause is kept verbatim and only
  the gate is added beside it.
- **What is deliberately NOT gated**: `users`, `companies`, the Google account
  and token tables, `google_calendar_settings`, `weekly_reviews`,
  `energy_logs`, `health_links`, `user_tokens`, `telegram_links`. None is a
  module's data — they are who you are, what you have connected, and how other
  things reach you. Locking somebody out of their own connected accounts
  because a plan changed is a support ticket, not a downgrade.
- **This is the one that can lock somebody out, and the seeds decide who.**
  `20260021`'s backfill put every existing account on `free`, and the seeded
  `free` plan carries neither `finance` nor `inbox`. Applying this without
  moving either the plan or the account first makes a real ledger unreadable to
  its owner. Nothing is deleted — a module that is off is unreadable, not gone,
  and restoring the plan restores the data.
Verified on a throwaway Postgres 16 against the real policy shapes: a pro
account reads its own ledger and tasks; a free account reads **neither its own
ledger nor its own mail rows nor shopping nor the snapshots**, cannot write to
the ledger either, and still reads its tasks and its profile; an override opens
Finance on a free plan; and a pro account still cannot read anybody else's
ledger or profile, because ownership is unchanged. 12 cases, and a second apply
exits 0 with the same 20 gated policies rather than 40.
## SaaS — the admin panel, and what it deliberately cannot do
`lib/admin.ts` + `modules/admin/AdminPanel.tsx`, reached from the avatar menu
when `amIAdmin()` finds your row. Three tabs over `20260021`'s tables: **Users**
(who exists, their plan, how many exceptions they carry), **Plans** (what each
plan includes), **Audit** (the overrides themselves, newest first — a change
that left no row was undone, and the current state already says so).
- **The control is tri-state and has to be**: `Plan / On / Off`. "Inherit the
  plan" is the commonest state by far and a two-way switch cannot say it, so
  turning an override off would have to mean *revoked* — a different decision
  nobody asked for. Choosing **Plan** DELETEs the row rather than writing
  `false`, and On and Off each ask for a sentence, because in four months that
  sentence is the only thing that will explain the exception.
- **The resolved state is `has_module()` itself**, per module, not a second
  implementation of core→override→plan→no. Seven small calls for one open user
  is the right price for not having two answers to one question.
- **It lives in the same public bundle as everything else**, which is safe only
  because the security is RLS: a non-admin who forces the route gets a page of
  empty lists, and the panel says so rather than looking broken. Verified both
  ways — 19 assertions as an admin (including that clicking On writes the right
  user, module, flag, reason and `set_by`), and as an ordinary account no menu
  row, the empty state, and no other address anywhere on the page.
- **Every override control names its module** in its `aria-label`. Seven
  controls announcing "module override" tell a screen reader which *kind* of
  control it is and nothing about which one.
- **`listUsers` joins three reads in JS.** `subscriptions` and `user_modules`
  hang off `auth.users`, not `public.users`, so there is no foreign key for a
  PostgREST embed to follow. The tables are small and this is one screen.
- **There is no screen here for anybody's ledger, tasks or mail**, and no
  policy that would allow one. Power over modules without the liability of
  their data.

## The ink audit could not tell you what it never looked at
`visit()` swallowed a navigation failure and returned, and `AUDIT` reports only
the **failing** pairs — so a screen's name reached the output only when
something on it failed. A run at zero failures therefore printed no screen
names at all, which reads identically whether a screen was measured and clean
or never opened. Three faults hid under that, all of them found in one
afternoon and none of them by reading the code:
- **`Settings · Habits` was auditing the Habits module.** The section click used
  `.first()`, the header nav comes first in the DOM, and `Habits` is in both
  `NAV_ITEMS` and `SECTION_META`. It clicked the top nav, navigated out of
  Settings, threw nothing, and reported clean about the wrong page. `.last()`
  takes the rail.
- **The Admin screens were auditing Today.** Writing `activeModule` into
  localStorage and reloading does not reach a module outside the nav — the app
  came back up on the morning page. They are reached by clicking the avatar
  menu now, and the step **asserts it arrived** (`/Plans & modules/`) rather
  than assuming the click worked.
- **Settings' own three screens still measure nothing** and now say so. That
  one predates all of this — proven by running the same file with the Admin
  visits removed entirely.
Every visit records what it looked at; a screen that threw or came up empty is
named under the count, with the reason. `INK_THEME=<name>` runs one theme, so a
check costs a minute rather than fifteen.

## Mail — Arabic, and every other right-to-left script
`lib/messageDoc.ts` builds the document every mail body is drawn in. Three
screens each built their own by hand and had already drifted — different
padding, different colours, and two of them reaching for `var(--sb-ink-1)` and
`var(--sb-info)` inside a **sandboxed iframe**, which cannot see the parent's
custom properties, so those rules resolved to nothing and always had.
- **A mail body arrives with no `dir` on anything**, so the frame's own
  direction decided it — left to right — for all of it. Arabic rendered with
  its full stops at the *start* of the line and its markers on the wrong side:
  the characters were right, their order was not.
- **`unicode-bidi: plaintext` is not enough, and finding that out needed a
  browser.** It reorders the *text* inside a block correctly and stops there:
  the computed `direction` stays `ltr`, so everything the box hangs off that
  property — the list marker, the quote rule, `text-align: start` — is still
  left-handed. `dir` is the property those read, so `dir` is what has to be set.
- **One `dir="auto"` on `<body>` is not enough either.** It takes the first
  strong character of the whole document and applies that one verdict to all of
  it, and business mail here opens with an English heading — so every Arabic
  paragraph under it would stay broken.
- So `markDirection` gives **every block its own `dir="auto"`**, via
  `DOMParser`, which builds a tree without running a script or fetching a
  resource. A block that already carries a `dir` is left alone: the sender said
  what they meant. `text-align` is never set — its initial `start` already
  follows whatever each block resolved to, and overriding an inline
  `text-align: left` would break every deliberately left-aligned layout to fix
  the ones that said nothing.
- **First-strong is the rule, with its edge accepted.** A list item opening
  `"Vouchers / Certificates:"` and continuing in Arabic resolves LTR and keeps
  its marker on the left, while the Arabic block inside it flips. A
  majority-script heuristic would fix that case and be wrong the other way
  round on genuinely English-led content.
Verified in Chromium against the **module the dev server serves**, not a copy:
9 `dir="auto"` injected; the Arabic paragraph starts 753px into a 760px block
and the English one at 0px; list body, blockquote and paragraph all compute
`rtl`; the quote rule moves to the right. An earlier run of this test proved
nothing — it called `markDirection` in Node, where `DOMParser` is undefined and
the function returns its input untouched, exactly as its guard says.

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

## Habits — one ✕ in a header, and it closes
The habit record's header carried two: the panel's own Close, and the
picture's Remove pinned to its top-right corner. Remove was the **stronger**
of the two — solid `--sb-ink-1`, ringed in the card colour, sitting on the
photo — against Close's grey hairline glyph 200px to the right. So the ✕ that
draws the eye deleted the habit's photo and the faint one closed the panel,
which is the wrong way round for a destructive control and an unrecoverable
one for a picture.
- **Removal is a word, in the slot the column already has.**
  `HabitImagePicker` is a picture over a caption, and that caption is already
  "Photo" (no image, emoji picker) or "Picture" (no image, no picker). With an
  image it is now **Remove** — same place, same `--sb-ink-4` micro type — so
  every state of the picker says what it offers in one spot and the header has
  exactly one ✕.
- **The panel geometry was a second, separate bug — and measuring only wide
  windows missed it.** No child overflows the 288px panel, at any width. But
  the panel is `flexShrink: 0` and the fill view's cards carry hard `minWidth`s
  of 92 / 92 / 190, so under about 745px of window their minimums exceed the
  column they live in — and a flex row does not shrink past a min-width, it
  overflows. With no `overflow` on that row the spill was painted straight over
  the panel. Nothing said so: the page's own `scrollWidth` still equalled the
  viewport, so there was no scrollbar and no clipping, and only
  `elementFromPoint` at the panel's top-left corner gave it away, by answering
  *a habit card*. "Measured at 768 and above, no overlap" was reported here as
  "never overlaps"; 768 was simply the narrowest width that still fitted.
  `.habits-record-row` stacks the record under the views below 860px — the move
  `.mail-smart-reader` makes under 1000px — and the fill row scrolls inside its
  own column. Measured at 390 / 430 / 600 / 768 / 820 / 860 / 900 / 1024 / 1440
  in all three views: no card intersects the record by 4px².
- Close had no accessible name at all, and now has a title and an aria-label.
- **The same pinned-✕-on-a-picture still exists in Settings → Habits'
  add/edit form** (`Settings.tsx`), where it collides with nothing — that form
  has Save/Cancel, not a ✕. It is the one remaining copy of the pattern.

## Habits — a day is a share of itself, not a count
`lib/habitProgress.ts` has always weighted every habit equally and given a
measurable one `quantity / goal`, capped at 1 — and every figure on screen
still **led with the tally**. 1,000ml of 2,000 and 2,500 steps of 10,000
beside one ticked habit is 58% of the day; the screens said "1 of 3 done
today", which is 33%, and the ring drew an arc at 58% with the number **1** in
the middle of it. Two answers to one question, on one card.
- **The share leads, the tally supports.** The page headline, the ring's own
  label, the summary card, Today's habits card and the Dashboard tile. The
  count is still true and still printed one line down — "1 of 3 finished".
- **The all-done banner fires on the share** (`pct >= 100`), not on
  `done === total`. A day finished entirely by quantity never earned it.
- The week strip and the weekly percentage were already built on `fraction`
  and did not move.
- A **streak** still is not built on this, deliberately: a streak claims the
  thing was *done*, and a part-day does not extend one.
Verified on a fixture built so the two models disagree (tally 33%, share 58%):
the headline reads 58% and never 33%, the ring's arc is 210° = 58.3% matching
its label, the week strip is `[0,0,0,0,0.58,0,0]`, and Today and the Dashboard
both lead with 58%. Every goal met reads 100% and raises the banner.

## Finance — the module measures its own height
`ActiveModule` renders every module in a bare `<div>` with no height, so
`FinanceModule`'s `height: 100%` resolved against `auto` — a percentage against
an auto height is ignored — and the module fell back to its content. Measured:
891px inside an 824px `<main>`, and `<main>` is the one box in that chain with
`overflow-y: auto`, so **it** became the scroller for the whole screen.
Scrolling the Financials entries panel therefore took the table off the top
with it, and the panel's own `overflowY: auto` never fired, because its content
fitted the box it had grown to. Nothing about the panel was wrong; it had never
been given a height to be shorter than.
- **`useFillsTheWindow` is `lib/fillsTheWindow.ts` now**, promoted out of
  `shopping/BoardView.tsx` — it was written for exactly this one layer down,
  and two copies of an answer drift. It also watches the document, since the
  bars above a box can change height without the window doing anything.
- A `calc(100vh - …)` would be a guess about every bar above it, which is the
  mistake the calendar panel made.
Measured with 60 entries in one cell: the page does not scroll, `<main>` does
not scroll, the panel's inner list is 401px over 4,013px, a wheel over it moves
it 600px and the table's top does not move a pixel. The control — the same
harness with the module reverted — scrolls the table from 223 to **−534** while
the panel stays at 0. Today, Balance, Budget, Reports, Goals and Shopping were
each checked for content clipped with no way to reach it: none.

## Finance — the transaction modal's one destructive control is in its header
"Delete this transaction" was a full-width red bar under Save, at the bottom of
a form taller than a short window — so the one control you could not reach was
the destructive one, and a red bar directly under the commit button reads as a
third way to commit. It is a trash glyph beside Close now: the task detail
panel's arrangement, what you do *to* the thing and then the way out. A
different glyph from Close and no stronger than it, and `removeTransaction`
pushes an undo entry, so a slip costs one ⌘Z.
- **The scrollbar goes with it.** The action row is `position: sticky` at the
  foot of the scroll area, so Save and Cancel are always on screen; with
  nothing you need below the fold the bar is 15px of furniture down the side of
  a form, and `.sb-no-scrollbar` stops drawing it. It still scrolls.
- Measuring a scrollbar with `offsetWidth - clientWidth` also counts the
  border: net of it, 0px at 900 / 700 / 560px tall.

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

## Mail — one toolbar, built out of the app's own controls
Search, what kind of mail, and how it is ordered were three boxes stacked down
the column — two of which wrapped onto a second line of their own — so a third
of the list's width-worth of height went on controls before a message appeared.
They are one `Card` now, and **every control in it is a platform component**:
`Pill` for the class filters (a filter is on or off), `Segmented` for sort and
for grouping (each is one of a small fixed set). The hand-built `classTab()`
pill is gone.
- **The filter rail is one line that scrolls.** Seven classes wrapped and pushed
  everything below them down; `.mail-filter-rail` is `flex-wrap: nowrap` with
  `overflow-x: auto`. The scrollbar is hidden — 15px of furniture under a 27px
  row that appears and disappears as counts change — so a **`mask-image` fade**
  on the right edge is the only thing that says there is more. It is drawn
  **only while there is** (`data-overflow`, measured by a `ResizeObserver`) and
  **not once you have reached the end** (`data-at-end`): a permanent fade is
  just a dimmed last pill. A class with nothing in it stays drawn and goes
  quiet, so the row does not reshuffle as mail arrives.
- **Sort is one `Segmented`, not four pills.** Date / Sender / Company /
  Subject, with ↑ or ↓ on the active one; pressing the key you are on turns it
  round, so four keys and two directions cost one control rather than five.
- **The group control right-aligns with `margin-left: auto`, never a spacer.**
  On one line the two are identical; when the row wraps a flex spacer eats the
  rest of the first line and drops the control to the *left* of the second.
- **The toolbar measures itself, not the window.** `container-type: inline-size`
  and a `@container (max-width: 500px)` rule drops the SORT eyebrow — what
  decides whether the two controls fit is the width of the column they are in,
  which is 360px with a message open and the whole page without one.

## Mail — whose business is this
`lib/mailCompany.ts` answers it for one message, and the answer is the
**counterparty first**: the sender's domain matched against your companies, then
the other addresses on it, and only then the mailbox it landed in. A colleague at
one of your companies writing to your personal address is that company's mail
whatever inbox it reached; a client writing in from a domain you have never heard
of is about the business whose inbox they wrote to. Past that nothing is guessed —
a personal address into a personal mailbox has no company and the row says
nothing, because a label that is wrong some of the time is worse than no label:
you cannot tell which times.
- **The chip is on both views.** A coloured dot in the company's own colour plus
  its name, beside the sender, in the flat list and in the smart view.
- **The mailbox chip answers a different question** and stays: *where did it
  land* is not *what is it about*, and the two differ often.
- **Sort sits beside the filters, on their line.** It had a row of its own under
  them; a list's controls belong together rather than stacked. Under 470px of
  *the toolbar's own width* it drops underneath instead, because the sort
  control is a fixed ~250px and pinning them side by side at every width left
  the filter rail showing "All" and half of a second pill.
- **The list column grows with the window** — `clamp(340px, 36vw, 640px)`. It
  was pinned at exactly 360px, so on a 2200px screen the mail was a strip beside
  1700px of reading pane, and its toolbar could never fit both controls on one
  line whatever the screen.
- **Sort is Date / Sender / Company / Subject**; the one you are on turns round
  when pressed again, which is what a sortable column has
  always done and what a second control for it would be. Each says what its two
  directions mean in its tooltip, since "Date ↑" does not say which end is which.
  Mail belonging to no company of yours sits at the bottom **whichever way round
  the sort is** — it is a remainder, not a name.
- **There is no grouping control.** There was a `Flat / By company` switch, and
  it went: sorting **by** company already puts a company's mail together, so two
  controls were answering one question. (`components/ui/SectionCard.tsx` went
  with it — the smart view had already stopped using it for its own views, and a
  UI primitive nothing renders is worse in a shared index than absent.) Kept per
  browser in `mail-sort` and `mail-sort-asc`.

## Mail — why a thread you archived kept coming back
Two bugs, and the second undid the first:
- **`archived_at` was written on every archive and read by nothing.** The row
  left the screen, and the next pass loaded it straight back out of the store
  and put it where it was. `visibleThreads` now drops a thread whose
  `archivedAt` is at or after its newest message — the comparison is against
  `lastAt` rather than a flag, so a **reply** to something you archived brings
  it back, which is what Gmail does with the thread and the only behaviour that
  does not quietly swallow an answer you were waiting for.
- **`factsToRow` hard-coded `muted: false, archived_at: null,
  acknowledged_at: null`.** Every pass that re-stored a thread wiped all three,
  and the backfill re-stored *any* row with no summary — so muting something
  the nightly run had left blank destroyed the mute on the next open. It takes
  the cached row now and carries the marks forward. `handled_at` is the one
  deliberate exception: it means "dealt with for now", and the function is only
  called about a thread that has changed.
- `handled` is likewise read as a *moment*, not a flag: a message arriving after
  you marked it done un-marks it.
- Archive writes `archivedAt`, **not** `muted` — muting would hide the reply
  too, which is not what archiving promises. The Bin does set `muted`: that one
  is gone.

## Mail — the primary account's token, and the hour it stopped working
`eng.bahaa.a@gmail.com could not be read — Request had invalid authentication
credentials…` Three faults stacked:
- **`App.tsx` stamped an unverified token as fresh.** When Supabase had no new
  `provider_token` on a session restore it wrote `Date.now()` against the
  *existing* one — its own comment said "the token itself may still be valid;
  we just reset the staleness timestamp". A token Google issued three hours ago
  was therefore brand new to `isTokenStale()`, and the refresh ladder under it
  was never climbed once. **A stale stamp costs one refresh call; a false fresh
  one costs every request until the clock runs out.** The branch is gone.
- **`gmail.ts` never refreshed at all.** `accessToken` read `provider_token` off
  the session — only there in the minutes after an OAuth sign-in — and
  otherwise whatever was cached. It calls `refreshPrimaryToken()` now, the
  ladder the calendar has used all along, and `gFetch` retries **once** on a
  401 with a force-refreshed token. A token that comes back identical to the one
  Google just rejected throws immediately: forty threads would otherwise make
  forty identical requests.
- **`refreshPrimaryViaEdgeFn` posted to a relative URL** whenever
  `VITE_SUPABASE_URL` was unset — `as string ?? ''` catches undefined and yields
  the empty string — so the refresh hit whatever host served the page, got the
  app's own HTML, and looked like a refusal. It uses the client's own
  `supabaseUrl` now.
- **The banner says what to do.** Google's prose is addressed to whoever wrote
  the app; `isAuthReason` recognises it (and `MailAuthError`) and the row becomes
  "<address> needs signing in to Google again" with the button that fixes it.

## Mail — an announcement is not a person writing to you
`kindOf` used to call a thread a `reply` unless its **subject** proved
otherwise, so "Anghami installed on Hania's device" from `no-reply@google.com`
arrived in the list of things you owe an answer to, with a Draft button under
it. Nobody at that address is waiting. The order is the other way round now:
- **A no-reply address can never want a reply.** `NO_REPLY_SENDER` — the local
  part says so in so many words — is `security` if the subject is about a
  sign-in and `update` otherwise. Never `reply`: offering to write to a mailbox
  that discards it is a contradiction.
- **A role address is an announcement unless the thread is a conversation.**
  `ROLE_SENDER` (`events@`, `marketing@`, `support@`, `team@`…) demotes only a
  **first** message that does not name you and that you have never written in.
  A `Re:`, a thread of three, a message that says your first name, or one you
  have answered stays a conversation whatever the address — which is why a
  support ticket you are in the middle of is not filed as noise.
- **Information is information whoever it was addressed to.** `update` always
  lands in FYI. It used to go to *worth knowing* when addressed to you, which
  made that group the place everything automated ended up, beside the sign-in
  alerts that genuinely wanted acknowledging.
- **A campaign goes, and nothing else does.** The old second clause — discard
  automated mail where the row has nothing but a Draft button — was doing
  `kindOf`'s job from the spelling of one address, and threw away a support
  thread for it. Both implementations now say only `!looksCampaign`.
- **`in:inbox`.** The pass read All Mail, which is everything you have ever sent
  and everything you have ever archived — so a forward you wrote to yourself was
  a thing waiting on your answer, and archiving did not take a row out. Fixed in
  the browser adapter and in the nightly function together.
- **Personal is a tag, not an absence.** `tagOfMail` gives mail on a mailbox you
  have *not* marked as work the word **Personal**, in the muted ink. It is not a
  guess — you say which mailboxes are work in Settings. Mail on a *work* mailbox
  from a domain that is none of your companies still gets nothing: that is a
  client, and calling it personal would be wrong rather than merely unhelpful.
- **Hiding a company hides its mail here too.** `visibleThreads` filters through
  `isMailHiddenByCompany`, including rows the nightly run stored before it was
  hidden.
- **Dismiss and Mute are two controls**, because they were two promises under
  one bell: dismiss takes *this message* out and a new one on the thread brings
  it back; mute is the thread, for good.
- **The reader is `calc(100dvh - 118px)`, and the message frame has no ceiling.**
  `calc(100vh - 150px)` guessed at the chrome above it and came out short, and
  the frame was capped so the body scrolled inside a box inside a scrolling
  panel. The frame is now as tall as the message and the panel is what scrolls.
  It needs `allow-same-origin` to be measurable at all — safe **only** because
  `allow-scripts` is absent and always will be: nothing in a message can run, so
  same-origin grants it nothing and grants us a height.
- The reader carries the row's own decisions too — Make a task, Done, Mute, and
  RSVP or Acknowledge where the kind calls for them. Reading a message is when
  you decide what to do about it.

## Mail — the four are views, not sections
Four collapsible sections stacked down the page meant scrolling past the three
you were not working on to reach the one you were; folding them away traded that
for four headers and a memory of which you had shut. They are **views** — one at
a time, picked from the same `Pill` rail (`.mail-filter-rail`) the ordinary list
filters by class with — plus **All**.
- **All is a real answer, not a fallback.** The whole window in one list, in the
  order the pass gave it (what you are holding up first, then newest), so a row
  keeps its place whichever view you came from. Each row carries a
  **`SectionDot`** naming its group, which is what the section header used to
  say; the dot is drawn *only* in All, since anywhere else you have just asked
  that question by picking the view.
- **Each view says what it is.** "Worth knowing" and "On your radar" are not
  self-explanatory and nothing on screen said which was which. The blurb is on
  the pill's tooltip and again above the list you are reading.
- **A count prints even when it is 0.** Blank reads as *not known* where a nought
  reads as *none*, and telling those apart is the whole point of a count.
- **The header stopped repeating the rail.** It said the same four numbers a
  second time; it now says the one thing none of them does — how many people are
  actually waiting on you (`bottleneck && !handled`).
- **The reply state sits with the sender and the date**, not at the left of the
  actions row. There it had a whole line to itself whenever the buttons wrapped
  away from it — a four-line row for three lines of content — and it is a fact
  about the thread, like the date, rather than a thing you do.
- **3px between a row's lines, not 5**, and `9px 14px` of padding. A row is one
  thing said on three lines; spacing them like paragraphs made eight threads a
  page of scrolling.
- **The actions share the sentence's line**, at its right, which is where a mail
  client has always put them. They had a line of their own under everything
  else, so every card was four lines tall and a screen held six. The sentence
  gives way first — one line, ellipsised, the whole of it on hover — because a
  truncated summary beside a reachable button is a better row than a full
  sentence above one. It wraps rather than crushing below about 600px. A card
  is **93px** now against 112, and 164 against 183 with a draft on it.
- **The reader's envelope is labelled fields, not a notation.** `from@x → to@y ·
  cc z` is something you decode rather than scan: it gives Cc no more weight
  than an arrow and has nowhere to put Bcc at all. FROM / TO / CC / BCC down the
  left, each absent when empty — Bcc therefore appears only on your own sent
  copy, which is exactly where it is worth seeing.
- **A row shows the name or the address, never both.** `"Name" <address>`
  repeated down six recipients is a wall in which the names — the only part
  anybody reads — are the minority of the characters. `nameOf` falls back to the
  address where there is no name, and the raw header is on hover, so nothing is
  lost, only stacked.
- **Splitting that header on `,` invents people.** A display name may contain a
  comma and corporate directories are full of them: `"BahaaElDin
  Amar-AbdElSalam, Vodafone" <…>` is one person, and a naive split makes a
  second whose name is a company and who has no address at all. `addressList`
  separates only on a comma that is outside quotes **and** outside angle
  brackets (`<a,b@x>` is one address too).
- **And the names are joined with a middle dot, not a comma**, for the same
  reason read backwards: half of them already contain one, so a comma between
  them is the same character doing two jobs and five people render as eight.
  Checked on the real header: 5 parsed, 5 rendered, no address in the text.
- A row's *shape* belongs to the row: an FYI thread is one compact line whether
  you are looking at FYI or at everything. `mail-smart-view` remembers the view;
  changing it clears the selection, which was aimed at rows the next view does
  not show.

## Mail — the smart row, and the thread beside it
- **The title line is subject on the left, company on the right.** It used to
  be one wrapping row of subject, sender, date, company and the waiting flag, so
  the chip landed at a different x on every row and the column read as five
  things that had drifted. A label you scan down has to be pinned to an edge,
  not pushed along by whatever precedes it. Sender, date and *Waiting on you*
  are the second line.
- **The mailbox is named only when it says something the chip does not.** With
  the company resolved from that same mailbox the two were the identical word
  twice on one line.
- **The draft is in the row, not behind a button.** "Review the reply" meant the
  one thing the pass produces that saves any time was invisible until you asked.
  Two clamped lines sit in the mail's own area with **Send** (the only control
  in the view that sends), Edit (the composer, seeded) and Discard. A failed
  send keeps the words: losing what you wrote is the expensive half.
- **The composer lives in both views, or Edit is a button that does nothing.**
  `handleSmartDraft` set `compose` and the file's only `<Composer>` sat inside
  the *flat* list's selected-email panel, reading `selectedEmail.id` — which the
  smart view never renders. So Edit set state nothing drew. The smart branch
  renders its own, in the right-hand column with the reader hidden behind it
  (one column, not two), seeded To / subject-prefixed-once / the draft as
  paragraphs; sending does what the row's own Send does — acted, `forgetBrief`,
  `forgetWaiting`, `markHandled`.
- **An action is over once it is taken.** `SmartThread.acted` is a receipt for
  the gesture — session-only, deliberately unstored — and the row shows it in
  place of the buttons. Leaving *Make a task* lit beside a task that now exists
  invites a second one and says nothing about the first.
- **A task is named for the thing to do, not the thing it is about.**
  `taskTitleFor`: the triage's own sentence first, then the kind ("Answer the
  invitation: …"), and the subject last rather than by default — a board of
  tasks called "Fw: Re: SAWA Cloud Hosting request" says nothing a week later.
- **Every action reaches Gmail.** Archive removes INBOX, Delete moves to the
  Bin, the tick removes UNREAD (a thread you have dealt with is one you have
  read; leaving is what Archive is for), opening one marks it read. An archive
  the server refuses **puts the row back** and says so — a row that left here
  and not Gmail is a lie you will never look for again.
- **`SmartReader.tsx` — the thread, docked right.** Clicking a row used to
  switch to the other view and hand a *thread* id to a list indexed by *message*
  id, so it changed the whole screen and selected nothing. It is a column
  beside the list, not a modal over it: the list is the queue you are working
  down. Reply / reply-all / forward hand to the composer; archive, bin, mark
  unread and Open in Gmail act on the server. The whole thread is there with the
  newest expanded and the rest one line each, since every reply quotes what it
  answers. The body is a **sandboxed iframe with no `allow-scripts` and no
  `allow-same-origin`** — a message is somebody else's HTML — sized to its own
  content so the panel scrolls once. Width is `mail-reader-width` (clamped
  380–820); `.mail-smart-reader` in `index.css` takes it to 46% under 1280px
  and stacks it under the list below 1000px, because an inline width beats
  every stylesheet rule and a media query needs a class to argue with.
- **Opening the tab draws the stored rows before a single byte of mail is
  fetched.** `runSmartPass({ onCached })` fires with what Postgres already holds
  — that is what the table is *for* — and the pass adds to it. A reading also
  stands for five minutes (`SMART_STALE_MS`), so flicking between tabs costs
  nothing. `visibleThreads()` filters and sorts both the early paint and the
  final result, or the list would visibly reshuffle a second after appearing.

## Mail — the smart view, and what a thread actually wants
`lib/mailKinds.ts` answers *what kind of thing is this*, from headers and the
subject alone — no model call, so a row knows the instant it is drawn.
`invitation` / `cancelled` / `security` / `update` / `reply`, and the kind is
what the row offers:
- **A sign-in alert with a Draft button is how a list teaches you to stop
  reading it.** "Needs your attention" was carrying a renewal waiting on an
  answer, a meeting invitation, a login notice and a cloud status page, all
  with the same three buttons — and only one of the four wants words back. So
  the first group is split in two: `action` is what you owe somebody,
  `attention` is what you should know. Four sections, each collapsible, the
  open set kept in `mail-smart-open-sections`.
- **An invitation gets Yes / Maybe / No**, through the app's own RSVP
  (`respondToInvite`), because answering in prose tells the organiser's calendar
  nothing — a mistake this app made once already.
- **A machine's notice gets Acknowledge, and stays.** "Keep it while allowing me
  to acknowledge" is the whole request: the row is marked *Seen* and remains in
  the list. Archive or Ignore is how one leaves. Taking it out for having been
  read would mean the only record that you looked is that it is no longer there.
- **A machine is never a bottleneck.** `bottleneck` is gated on
  `canNeedAction(kind)` in both implementations — "waiting on you" over a status
  page is how the flag stops meaning anything on the rows where it is true. The
  same row drops the "No reply" chip and the Follow up button, which are true
  and useless about a status page.
- **What is discarded is stated once, the same way on both sides.** A campaign
  goes whatever its subject says (`looksCampaign` / `classifyMail`'s
  `newsletter`); other automated mail goes only where the row would have nothing
  but a Draft button to put under it — `canNeedAction(kind)`. That is what was
  throwing away every sign-in alert and every status notice.
- **Only a plain `reply` costs a model call.** The other four kinds say the same
  thing every time they arrive, so `KIND_NEED[kind]` writes the sentence and the
  tokens are not spent — in the browser and in the nightly edge function alike.
- The rules exist twice (Deno cannot import the app's bundle).
  `scripts/mail-rules-agree.mjs` runs 17 fixtures through both and fails on any
  disagreement, kept/discarded included. `20260017_mail_smart_kinds.sql` adds
  `kind`, `muted`, `archived_at`, `acknowledged_at` and widens the section check.

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
