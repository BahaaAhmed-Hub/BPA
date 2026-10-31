---
paths:
  - "src/modules/habits/**"
  - "src/store/habitsStore.ts"
  - "src/lib/habit*.ts"
  - "src/lib/healthLink.ts"
---

# Habits — logs, the record, Apple Health

Loaded when a file this rule's `paths` names is read or edited — it is not
in context on every turn, which is the whole point. The root `CLAUDE.md`
holds what is true everywhere; this holds what is true here.

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

## Habits — "I can't find my logs for the last 5 days" was the server's 1,000-row ceiling
`loadHabitLogsFromDB` and the stale-row check inside `saveHabitLogsToDB` read `habit_logs` with
one plain select. PostgREST answers one request with at most 1,000 rows, oldest first, so an
account with more than 1,000 logged days got a record with its **newest days missing** — and
`habitsStore.loadFromDB` does `saveLogs(logs)`, replacing the device's own logs with that answer,
so even a device that had the last five days showed them gone after the next sync. The ticks were
still on the server (the save upserts and deletes only against what it read); a new address or
browser just never fetched them. Both reads use `readEvery` now (see the root `CLAUDE.md`), and
**a failed read throws** so the store keeps what the device has — before, it returned `{}`, which
the store wrote over the local logs (measured: three local ticks became `[]`).
`node scripts/habit-logs-past-1000.mjs [cap|flaky|deaf]` — six habits × 200 days, the stub capping
a read at 1,000 and recording deletes: the whole record arrives (1,200 of 1,200, the newest 30
included) and nothing is deleted; a page that fails keeps the device's own ticks; a server that
ignores the range is asked twice, not for ever. Controls: on the code before, 1,000 of 1,200 and
the last five days missing for every habit; with the old `return {}`, the local ticks are gone.

## Habits — a deleted habit came back, and brought its history with it
`professor-habits-deleted` in `habitsStore.ts` — the same hole as
`professor-tasks-deleted`, one store along, and the same three-part fix.
Deleting a habit takes it out of the list and leaves the push 1.5s behind;
`dirty` cannot record it, because the habit is not in the list being pushed at
all. Meanwhile `loadFromDB` builds its merge from **every** row the server
sends, so any reload inside that window brings the habit back — **and its whole
history with it**, since the logs are keyed by habit id. Every figure on the
screen counts `habits`, so the habit is back in the stats.
- `rows` is the server's answer minus what was deleted here, and it is what
  `merged`, `dbIds`, `onServer` and the `changed` test all read. The guard stays
  on the raw `dbHabits.length`: "the server replied with nothing" and
  "everything it sent was deleted here" are different facts.
- `scheduleHabitsSync` lifts a tombstone for every habit in the list it is
  about to write — a habit being pushed is by definition not deleted — which is
  also what would make an undo work if habits ever grew one.
- Refusing the row makes `all.length !== rows.length`, so the push runs and
  `saveHabitsToDB` finally deletes it server-side: the failed delete, retried.
- `clearAll` does **not** tombstone — that path is the account switch.
`scripts/deleted-habit-stays-deleted.mjs [refused|push]`: two habits, one
logged today, so the headline reads 50% with both and 100% with one. Control,
on the code before the fix: the habit comes back and the headline drops from
**100% to 50%** — the deleted habit counting in the stats, as a number.

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

## Habits — every day in the record is editable, from the square
The 13-week heatmap was a `div` with a tooltip. The record drew a quarter of a
year of history and the only day you could correct was whichever one the week
strip happened to point at, seven at a time — so remembering a missed Tuesday
three weeks ago meant walking the strip back to it. The square is the way in
now: a button that aims the whole screen at that day (`onPickDay` → the ring,
the counter, the tick and the strip all read `selectedDay`), so nothing here
needs an editor of its own.
- **The window is anchored to the real today, never to the day being edited.**
  `heatmapDays` was built from the `today` *prop*, which is `selectedDay` — so
  picking a cell slid the whole quarter backwards while the axis under it still
  said "Today" on the right, and you could walk back for ever with no way
  forward. The window is the last 13 weeks of the habit's life; which day you
  are editing is a **mark on it**, not its edge.
- A `future` guard written alongside this was unreachable once the window ends
  at today, so it went: dead code that cannot be exercised is worse than none.
Verified in Chromium: 91 reachable cells, each a real button; the window ends
at today and does not move when a cell is picked; the picked day is the one
ringed; +2 on a quantity habit lands on **that** day and not on today; a
boolean habit's past day ticks the same way; and neither writes to today by
accident.

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

## Habits — the five prayers (a built-in habit with its own card)
Prayer times are a different kind of habit: five fixed times a day, worked out for where the person is, each ticked on
its own — not a counter. `lib/prayer.ts` (pure) works the times out on the device (Fajr/Isha by sun angle per method —
Egyptian by default — Asr standard or Hanafi, the timezone's offset taken for the day so summer time moves them), holds the
5-bit day mask, and `maskFromCount` — **the rule the person set**: 1 → Maghrib, 2 → Dhuhr + Asr, 3 → Fajr + Dhuhr + Asr,
4 → + Maghrib, 5 → all five. `lib/prayerState.ts` is the one write path (`writeDay`).
- **No schema change.** The habit is an ordinary quantity habit (goal 5, unit "prayers") so streaks, the day's share, Today and
  the Dashboard work untouched; `habit_logs.quantity` is the **count**. *Which* prayers rides in the shared pref key
  `professor-prayer` (`days: date → mask`, plus enabled / habit id / method / school / place), like `professor-habit-steps`.
  `dayMask` reads a day: the stored mask if it agrees with the count, else the count by the rule — so a day written by an older
  build or another device, or a counter's history, is always readable.
- **Switch on** in Settings → Habits → Prayer times (`PrayerBlock`). If a habit is already kept under a prayer's name
  (`prayerLikeHabits`) the person is asked: **Convert** keeps the same habit — id, name, picture, history — and makes it five
  a day; **Start a new one** leaves it alone. With none, the built-in habit (🕌 "Prayers", picture changeable like any) is made.
  The starter list and the setup wizard's "prayer" template switch it on rather than copying a plain habit.
- **Where:** the browser's location (asked on a tap, never at load), else a city (`prayerCities.ts`, which also sets the
  region's method). Times are for the place's timezone; "now" is the device clock.
- **The card** (`PrayerCard`) sits above the Table / Wall / Fill views and replaces the habit's row in them (it still counts in
  every total). A prayer opens when its time begins and stays open all day, so a missed one can be marked; the next day is closed.
  Locked tiles use `--sb-ink-4` (disabled), not opacity.
- Assistant / Telegram / Siri: `log_habit_completion` writes a count, which `dayMask` reads by the rule — a prayer by name
  ("I prayed Asr") is **not** wired into the three doors yet.
- **Not verified against a source:** Fajr's 19.5° and every other published timetable differ by minutes — `prayer-times.mjs`
  holds Fajr to a window, not a minute. The person should compare with their mosque's timetable once.
`node scripts/prayer-times.mjs` (pure, 25 claims), `prayer-habit.mjs [on|off]` (browser, clock fixed), `prayer-migrates.mjs
[convert|new|fresh]`.

### Where the prayer habit is offered (it was invisible)
It shipped switched off, behind a switch at the **foot** of Settings → Habits, so nobody saw a thing: "I can't see the
prayer times configuration or the UX". Now: (1) `PrayerOffer` is a banner on the Habits page itself, above the views —
it names a habit already kept under a prayer's name and offers Convert / Start a new one, or offers the built-in one;
"Not now" is remembered per device (`professor-prayer-offer-dismissed`); (2) `PrayerBlock` is the **first** thing in
Settings → Habits. A feature behind a switch needs a door where the person already is.
`scripts/prayer-offer.mjs [convert|new|dismiss|none]`.
