---
paths:
  - "src/modules/finance/**"
  - "src/lib/goalPlan.ts"
  - "src/lib/goalAdvice.ts"
  - "src/lib/forecast.ts"
  - "src/lib/balances.ts"
  - "src/lib/budgetEntries.ts"
  - "src/lib/financeTools.ts"
  - "src/lib/cardRewards.ts"
  - "src/lib/unpaid.ts"
  - "src/lib/duplicates.ts"
  - "src/lib/fx.ts"
  - "src/lib/lock.ts"
  - "src/lib/moneyColors.ts"
  - "src/lib/creditLimits.ts"
  - "src/lib/transferTargets.ts"
  - "src/lib/duplicateAcks.ts"
  - "src/lib/goalPlanning.ts"
  - "src/store/financeStore.ts"
  - "src/lib/financeDb.ts"
---

# Finance — the ledger, budgets, goals, the forecast and the lock

Loaded when a file this rule's `paths` names is read or edited — it is not
in context on every turn, which is the whole point. The root `CLAUDE.md`
holds what is true everywhere; this holds what is true here.

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
- **SUPERSEDED — the Budget screen reads every envelope as the month on screen,
  dated ones included.** `THE YEAR` / `SpanChip`, `span`, `yearBase` and the
  modal's `partsDated`/`subRules` are gone: a dated envelope shows spent *this
  month* against `monthlyAmount(rule, monthKey)` — the instalment that falls in
  it (0 in a month with none, drawn as `nothing due` rather than `set a budget`,
  via `nothingDue`). The year is the year chart's question; the month picker
  asks it of another month. The reasoning below on why a twelfth is wrong still
  holds: nothing divides — a month with no instalment simply has no budget.
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

## Finance — an entry keeps the exchange rate of the day it was added
`txRates.ts`. `fx.ts` holds one rate per currency, so changing USD from 48 to 50
re-priced every USD entry already in the ledger: July's rent, paid at 48, read as
50 in every total. A flow of money is a past event.
- **The rate is a tag on the entry** — `fx:USD/EGP=48` — as a budget entry carries
  `budget`: it travels with the row, needs no column and no sync key, and goes
  when the entry does. It names the currency **and the base**, so a stamp against
  another base (the base was changed) is ignored. An entry with no stamp converts
  at the current rate exactly as before, which is why nothing had to be migrated.
- **Stamped on the way into the ledger**: `upsertTransaction(s)` in the store runs
  every entry through `stamped(tx, { note: true })`, so the entry panel, bulk
  entry, a due-day budget's entries and the assistant are all covered by one
  place. A base-currency entry, or a currency nobody gave a rate for, is left
  alone — nothing is guessed. The rate is also written into the description
  (`rate 29 Oct 2026: 1 USD = 48 EGP`; the feeds add the brackets), for whoever
  reads the entry later. That text is a copy; the tag is what the arithmetic reads.
- **`changeRate(currency, rate)` on the store is the one way a rate changes**
  (Settings → Exchange rates and the assistant's `set_exchange_rate` both call
  it). Before the new rate takes over, **every foreign entry with no rate of its
  own is given the current one, in every year** (`loadEveryTransaction`, read in
  pages — a plain select stops at 1,000 rows) and written in one request; their
  notes are left alone. **If the ledger cannot be read the rate is not changed** —
  "could not look" must not become "re-price all of history". This replaced a
  load-time backfill: it does the same job at the only moment it matters, and
  needs no flag to remember whether it ran.
- **Every transaction-level total reads `txIn(tx, to)`** (and `txConvert(tx,
  amount, to)` for a signed amount, in `balances.ts`): Today, Reports, Reflection,
  Budget envelopes and drill-down, the budget panel, goals' normal month, months
  ahead, card rewards, category review, the calendar's expenses box and the
  assistant. Budgets and goals still convert by `toBase` — a budget is a plan,
  not a past event.
- **Balances are not flows.** A USD account or card is worth what a dollar costs
  *now*, so `liveBalances` per-account totals, a card's debt and the Balance screen
  keep converting at the current rate; an entry **inside** an account converts at
  its own stamped rate. Unpaid entries are stamped the same way when added and stay
  out of every total until paid, as before.
- **Not covered**: `projects/projectLife.ts` sums linked entries through
  `sumInBase` from a snapshot (`EntryMeta`) that carries no tags, so a project's
  USD totals still use the current rate. There is no field to edit an entry's rate
  (paying at a different rate than the day it was added is not representable yet).
  The Telegram bot and Siri cannot add ledger entries, so nothing to keep in step.
- `node scripts/tx-rates.mjs` (21 cases, no browser) and `scripts/tx-rate-frozen.mjs
  [change|assistant|unreadable]` (the real store against a stub that keeps what it
  is sent and can refuse reads). Control, the harness on the code before: the July
  entry reads **5,000 instead of 4,800**, nothing is written, and the new entry
  carries no rate (5 failures).

## Finance — a budget keeps the amount it had
`budgetSteps.ts` (pure, no React). A rule held one `amount`, so raising rent from
10,000 to 13,000 rewrote July too: 12,000 spent, over its limit at the time,
read as comfortably inside the new one. Now `amount` is the **base** — what every
month before the first change had — and `steps: [{ from: 'YYYY-MM', amount }]`
records each change with the month it took effect. A rule that never changed has
no `steps` and reads exactly as it always did; there is no migration, and the
field rides inside the `finance-budget-rules` prefSync value.
- **The rule, with no UI for it.** Typing a new amount in the panel applies it
  from **this month on**; every earlier month keeps what it had. There is no
  scope toggle and no timeline — it was drawn up and thrown out as more than the
  question needs. `withAmount(rule, n, monthOnScreen)` is the one function that
  records a change, and both the panel and the assistant's `set_budget_envelope`
  call it, so the two cannot differ.
- **Never earlier than this month.** `editMonth` is the later of today's month
  and the month on screen: looking back at July and typing a number must not
  rewrite July. The panel's amount field shows `amountFor(rule, editMonth)` —
  what an edit would change — so while looking at a past month the field reads
  the current figure and the "of X this month" line above it reads that month's.
- **The field saves on every keystroke**, so a change in the same month as the
  last one **replaces** it (1, 13, 130 … 13,000 is one change, and a typo
  corrected within the month leaves no trace); a change that lands on what the
  month already had is not recorded; and changes planned for later months are
  dropped, since "from now on" covers them. A rule that never had an amount is
  simply set — a first budget still runs every month, as a new one always did.
- **Only the amount is versioned, and only for a `repeat` budget.** Frequency,
  currency, bucket and due day stay global; `once` and `custom` carry their own
  dates and are written as before. There is no "all months" option: correcting
  an old month's budget is not possible from the panel. If that is wanted it
  belongs behind Settings, not in the everyday flow.
- **Read a month through `amountFor` / `monthlyAmount(rule, monthKey)`.** With no
  month `amountFor` means *now*, which is what the callers that never had a month
  in hand always meant. This sharpens the unqualified claim in the three-shapes
  section that `monthlyAmount` without a month is the year's average: that holds
  for the dated shapes; for a `repeat` rule it is this month's figure.
  `budgetEntries.occurrencesFor` writes each instalment at **its own month's**
  figure (weekly ones too), `reminderTitle` passes its month, the assistant's
  range totals sum each month's own budget (23,000 over a 10,000 and a 13,000
  month, not 26,000), and ShoppingScreen's envelope reads the current one.
- **The bots are not involved.** Telegram and Siri cannot read or set budgets
  (the Telegram prompt says so), so there is nothing to keep in step with the
  three-doors rule.
- `node scripts/budget-steps.mjs` — the pure rules, 32 cases, no browser.
  `scripts/budget-keeps-old-amount.mjs [edit|stored]` — the panel: typing 13,000
  records one change and last month still reads 10,000. `scripts/budget-steps-
  readers.mjs` — the entries, the assistant and the range totals. Controls, the
  same harnesses on the code before: the edit overwrites the base and last month
  reads 13,000 (5 failures); November's entry is written at 10,000, the
  assistant's write has no history, last month reads 13,000 and the range 26,000
  (7 failures).

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

## Finance — the Budget drill-down was behind the panel that opens it
Reached by **View all →** inside the category window, which is `fixed` at
`z-index: 1000`. The drill-down rendered at **200** — so it was drawn *behind
its own opener*, and every control in it was unreachable by a pointer: the
period pills, the three flag buttons on each row, and the row itself. It read
as working from the outside, because `innerText` has no opinion about stacking
and a scripted `element.click()` skips hit-testing. Only `elementFromPoint` at
a control's own centre gave it away — it answered a full-screen scrim that did
not contain the button. Now 1100; measured, the flag button goes from *not the
topmost element at its own centre* to being it.
- **Only the backdrop closes it.** `onClick={() => setDrillOpen(false)}` had no
  target check, so a click anywhere inside shut the panel you were working in.
  It takes the `e.target === e.currentTarget` guard `TransactionModal` uses.
- **The row opens the entry** (`setDrillTx`), the gesture the Today, Balances
  and Financials feeds all use, into the same `TransactionModal` they use. It
  used to call `setFlag` — which the three buttons in `trailing` already do, on
  that very row — so the one feed that could show you an entry was the one that
  would not let you correct it. The flags now `stopPropagation`, and the modal
  is wrapped in a positioned div at `z-index: 1200` because its own hard-coded
  1000 would otherwise put it behind the 1100 drill.
- **The real fault was in the window behind it, and a fourth fix was needed.**
  With the stacking corrected the flag button was topmost at its own centre and
  a real click *still* changed nothing. `BudgetRuleModal` carries a
  `document`-level `pointerdown` handler that closes itself on anything outside
  `box.current` — and the drill is rendered as a **sibling** of that modal, not
  a child. So every pointerdown in the drill closed the category window, which
  is what `selectedCat` hangs off, which unmounted the drill **under the
  finger** before the click completed. Nothing was inert; the panel was leaving.
  The handler now stands aside for `.sb-above-modal` (the drill, and the
  `TransactionModal` opened from it), and Escape does too — the drill closes
  itself, because Escape belongs to the topmost thing on screen.
  This is the exact failure `elementFromPoint` alone cannot find: the element
  *was* hit-testable. Only a pointerdown-to-click sequence, with the panel
  measured afterwards, shows it — a scripted `.click()` fires one event and
  never sends the pointerdown that did the damage.
Verified: the period pill changes state and the panel stays; a flag writes
`finance-tx-flags` and does not open the entry; the row opens the editor and a
saved edit reaches the server. The other three feeds still pass unchanged.

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

## Finance — the tab bar was the last slab on the page
A full-bleed `--sb-header` strip with square corners, running edge to edge
under a rule. It is the one thing left on screen still drawn as a slab after
`.cal-panel` gave its frame up and the rail became two floating pills — and
beside those pills a square strip reads as broken rather than as part of the
page, which is how it was reported.
- **It is the rail's own shape, imported rather than retyped.** `LOZENGE` is
  exported from `SideRail.tsx` — the four properties that are the *shape*
  (ground, border, `borderRadius: 999`, shadow) with no layout in them, since a
  column of icons and a row of tabs want different directions and padding.
  `PILL` spreads it. A hard-coded `borderRadius: 999` in the finance module
  would have looked identical today and drifted the day the rail's changed.
- **`--sb-overlay`, for the reason the rail has it**: it is the one surface
  token opaque in every theme. In Glass `--sb-header` is
  `rgba(255,255,255,.035)`, a wash that leaves the bar all but the page itself.
- **The rule goes with the slab.** A floating object does not draw a line
  across the page; the gap under it is the separation, so the border is now
  the lozenge's own, all the way round.
`scripts/finance-bar-is-a-lozenge.mjs [shape|floats|control]` — and the claim
is about **two** elements, so it reads radius, ground, shadow and border off
the tab bar *and* off the rail's lozenge and asserts they are equal; a
one-sided assertion passes with the two already drifted. Control, the old
values restored on the very same element: radius `0px`, ground `#FCFAF4`, no
shadow, a bottom rule, and the bar spanning 90→1500 — the full width of
`<main>`, which is the screenshot. The labels changed ground, so the ink audit
re-ran: **0 failing pairs over 22 screens in all four themes.**

## Finance — navigation is three groups, and Shopping left for the main menu
UI-unification P2.3. `FinanceModule` draws one lozenge with **three groups in a
fixed order**: Money (Today, Balance, Budget), Plan (Goals) and Review
(Financials, Reports). A caption and a divider mark each group; below 760px the
captions go and the divider alone remains (`.fin-group-cap`). The row is one
44px line at every width.
- **Forecast is not a screen** — it is the rules disclosure inside Goals, so
  Plan holds one tab. Do not add a tab for it without a screen to open.
- **Tabs are not draggable any more.** Dragging could only scramble the groups;
  `finance-tab-order` is no longer read (a stale value is harmless) and a saved
  `finance-active-screen` of `shopping` falls through to Today.
- **Shopping is a module in the left rail**, not a Finance tab: `shoppingPrefs.ts`
  (`shoppingEnabled`, `shoppingIsOff`, `useShoppingOff`) decides it — Settings →
  Finance → Shopping must be on **and** Finance must be on for the plan. The
  server has no `shopping` module row and does not need one: an unregistered id
  is never "off" (`moduleIsOff`), so the plan question is asked of `finance`.
- **It stays behind the finance lock.** `ShoppingModule` uses `useFinanceLock`
  and renders the same `LockGate`: the lists are priced and hold purchase
  history, and moving the screen must not move it out from under the door.
  `unlock()` now dispatches `finance:lockChanged`, so unlocking one door opens
  the other at once instead of at the hook's next 15s tick. *(Measured: Shopping
  shows the gate when locked. Not measured: the cross-door unlock, which needs a
  real password hash.)*
- `scripts/finance-nav-groups.mjs [groups|shopping|lock]` — group names, order,
  the one-line bar, the active tab moving; Shopping in the rail and in neither
  place when off (with the rest of the rail asserted present, so "absent" is not
  an empty rail); the lock gate. Control: the flat bar fails `groups`.

## Finance — money borrowed is cash in and debt out, and neither is income
`loans.ts` (pure, no React). Borrowing 10,000 puts 10,000 in an account you can
spend from and 10,000 on a ledger you will have to clear; net worth does not
move. Filed as income it inflated every "earned this month", and repaying it
read as a loss that was never a gain.
- **A lender is an account** (`accountType: 'loan'`, one per person, below zero
  while owed — `account_type` is plain text, so no migration), and **borrowing is
  a transfer** out of it into the account the money landed in. There is no new
  `TxType`: every total in the module already reads `income` and `expense` only
  (`typicalMonth`, `capacityFrom`), so a transfer is correct everywhere by
  construction. `liability_acq` / `liability_dis` are declared in `TxType` and
  used nowhere; they were left alone.
- **"Borrowed" is the fourth segment of the add window, a mode and not a type.**
  `TransactionModal` keeps `type: 'transfer'` and a `borrowed` flag; an entry
  whose source is a loan reopens in Borrowed (`isBorrowing`). It shows **Lender**
  (an existing one, or *Someone new…*, which makes the account on save — typed
  names match an existing lender case-insensitively, so "ahmed" is not a second
  account) and **Into** (payment accounts and wallets only). No Category row.
- **The lender's account is written before the entry that names it.**
  `finance_transactions.account_id` is a foreign key. `upsertAccount` used to
  fire its write and return; it now awaits it. The harness's stub refuses a
  transaction whose account is not there, as the server does.
- **A lender is not somewhere to spend from.** `spendingAccounts()` keeps loans
  out of the Expense/Income account picker, bulk entry, a budget's "pay from" and
  the calendar's Expenses box; the assistant's `add_transaction` refuses an
  expense or income against one. A **Transfer** still offers them — that is how
  one is borrowed from and paid back.
- **Currency.** The entry is in the currency typed; each end converts into its
  own account's currency (`deltaFor`), and the form shows what actually arrives
  (`borrowingEnds`: "EGP 24,000 arrives in CIB (1 USD = 48 EGP today)") and what
  is added to what you owe. A new lender is made in the currency borrowed. **With
  no rate for either currency the entry cannot be saved** — filed anyway, one end
  would be left out of its balance.
  *Known limit:* the rate is stamped on a non-base entry (`txRates`), so a USD
  borrowing keeps its 24,000 for ever. An entry **in the base currency** into a
  foreign account has no stamp and converts at today's rate, so that arrival
  moves with the rate — as any such transfer already did. An explicit "received"
  amount is the fix and is not built.
- **`txConvert` returned the wrong figure for an amount already in the currency
  asked for.** It always went by way of the base: stamped rate × amount, divided
  by *today's* rate of the target. 500 USD on a USD account (or owed on a USD
  lender) read 480 once the dollar moved from 48 to 50. Same currency now returns
  the amount. This was an existing bug in every foreign-currency account; the
  loan harness found it, and its three failures are the control.
- **The debt becomes a goal by itself.** `debtGoals` takes loans (`CAN_OWE`):
  "Repay Ahmed", target what is owed, ranked like a card. Under half a unit
  (`SETTLED_BELOW`, shared with Balances) is settled and has no goal.
- **Balances** gains **LOANS OWED** (and a *Loans* filter pill). A loan paid back
  stays in the ledger and folds behind "Show N paid back"; the heading's total is
  only what is owed. The account window has a **Loan** type: *Lender* for *Name*,
  no bank or card digits, and the opening figure is entered as what you owe
  (stored below zero).
- **Shown beside In, never inside it.** Today's month chips and cash-flow column
  get a neutral **Borrowed** figure (`borrowedIn`); **Net** is what you earned
  less what you spent and says it leaves the borrowing out. Feed rows carry a
  Borrowed / Repaid mark (`LoanMark`) and a line icon, and their amount keeps its
  sign but is neither the green nor the red — including seen from the account the
  money landed in, where a transfer is otherwise drawn as money coming in.
- `node scripts/loans.mjs` (46, no browser: the real files bundled with rolldown).
  Controls: the same 10,000 filed as income reads 15,000 in September; a loan not
  yet repaid has a goal and one repaid does not; with the old `txConvert` three
  assertions fail (480, 480.77, -480.77).
  `node scripts/loans-ui.mjs 5199 [new|rate|norate|existing]` — the account is
  written first and as a `loan`, the entry is a transfer with no category, the
  amount colour is read from `getComputedStyle` on both sides, Today's In stays
  at nothing; `norate` is the control for `rate` (Save disabled, nothing written).
  `INK_ONLY=loans node scripts/ink-audit.mjs 5199` — two screens with a lender
  owed, one paid back, a repayment and a salary; the audit now takes a **probe**
  (names an element and reports its ratio whether or not it passes), because it
  lists only failures and "nothing listed" cannot say a thing was measured. Every
  element this feature added is ≥ 4.5 in all four themes.
- **Found, not fixed (existing, shown up by a fixture with real balances):**
  Sunlit's positive group total (`EGP 20,000`, `--sb-positive` on `--sb-field`) is
  3.86, and Evergreen's `--sb-negative` is 4.31–4.43 on its card at 13–14.5px —
  every owed balance, a loan's or a card's. Both want a token decision.
- **Not built yet** (the plan's chunks 4–10): a payment plan on the loan and its
  budget line, funding the instalment first, Pay back from the goal or the
  balance row, optional interest, and borrowing/repaying through the assistant,
  Telegram and Siri — the three doors must get it in one change.
