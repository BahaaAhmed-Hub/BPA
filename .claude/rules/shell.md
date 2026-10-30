---
paths:
  - "src/App.tsx"
  - "src/main.tsx"
  - "src/components/**"
  - "src/index.css"
  - "src/lib/ink.ts"
  - "src/lib/companyFocus.ts"
  - "src/lib/companyLogo.ts"
  - "src/lib/palettes.ts"
  - "src/lib/linkPreview.ts"
  - "src/lib/fillsTheWindow.ts"
  - "src/lib/liveSync.ts"
  - "src/store/uiStore.ts"
---

# The shell — the rail, one ground, ink, overlays, companies, the lens

Loaded when a file this rule's `paths` names is read or edited — it is not
in context on every turn, which is the whole point. The root `CLAUDE.md`
holds what is true everywhere; this holds what is true here.

## One ground — the app is not a card floating in a window
The calendar drew itself inside `.cal-panel`: a box in **the page's own
colour**, with a 28px radius and `0 30px 80px -30px rgba(25,23,18,.5)` under
it — the same colour as the ground it sat on, lifted off that ground by a
heavy shadow. The result reads as a framed slab in a window rather than as
the page, and nothing else in the app did it. It is transparent and flush
now; the padding stays, because content still needs air, and so does
`overflow: hidden`, because the grid inside scrolls against it.
- **The rail lost its surface for the same reason.** It was two white cards
  with a border and a frame shadow. Beside a module that no longer draws its
  own slab, the only boxed objects left on screen would have been the menu —
  so the icons, the active pill and the company circles float on the page's
  ground, and the two groups are separated by the gap between them rather
  than by two frames.
- **A logo is a circle** (`border-radius: 50%`), not a rounded square: beside
  a column of round glyphs a rounded square reads as a different kind of
  object, and every other avatar in the app is round. The chosen one's ring is
  `box-shadow: 0 0 0 2px var(--sb-page), 0 0 0 4px var(--sb-accent-deep)` —
  drawn **outside** the circle with a gap of the page's own colour, so it is a
  halo rather than something eating into the colour that identifies the
  company. A border would have taken 2px off the fill.
- Measured rather than assumed: the panel computes `rgba(0,0,0,0)` / `0px` /
  `none`, every rail group computes transparent with no border and no shadow,
  and a tile computes `50%`. The ink audit matters here because the rail's
  icons moved from `--sb-card` to `--sb-page` — a different ground — and
  re-runs at 22 screens x 4 themes, 0 failing pairs.

## The rail — the main menu, and the company you are looking at
`components/SideRail.tsx` replaces the header. Two floating pills down the left
edge: the modules, then the companies you are part of. They are deliberately
**two objects** rather than one list with a rule between them, because they
answer different questions — *what am I looking at* and *whose is it* — and the
second changes what the first shows without changing which module is open.
- **A column has as much room as the window is tall.** The old header's own
  notes record seven labelled pills, a search box, a bell and an avatar never
  fitting one row: it dropped the search wording at 1180px and the nav labels
  at 1080px, and below that the right-hand group was drawn *over* the nav, so
  "Dashboard" was unreachable from 1100px down. `useNarrowerThan` and both
  measurements are gone — neither question is asked of a column.
- **Search, the bell and the avatar are not in the rail at all, and they own a
  row.** None of the three is navigation: they are *you* and what has just
  happened, which is the corner the eye goes to for status rather than the
  foot of a column of modules. Search went with them — it is a thing you reach
  for, not a place you go, and beside two round controls a worded field is a
  third kind of object. `YouCluster` in `App.tsx` is the three of them, and it
  occupies a **48px row at the top of the content column** rather than
  floating over it: `position: fixed` drew it on top of whatever each page
  puts in its own top-right corner — Today's dark ON FIRE / CARRIED OVER
  banner, most visibly — and no `z-index` answers that, because the problem is
  two things wanting one box rather than one being underneath. A row costs
  48px, less than the header this replaced, and nothing can be under it on any
  page, including ones nobody has written yet. The account menu opens below
  the avatar (`top: calc(100% + 8px)`, `right: 0`), where there is now room.
  `SideRail` takes no `footer` prop any more: a prop nothing passes is a
  second design still in the file.
  **The ink audit reached Admin through that avatar**, so moving it turned
  `Admin · users` into a screen measuring nothing — caught by the audit's own
  blindness warning, and the selector is scoped to `aria-haspopup="menu"`
  rather than to where the avatar happens to sit.
- **The two lozenges are centred down the window**, with `margin: auto 0` on
  the pair rather than `justify-content`, so a rail taller than the window
  still scrolls to both ends instead of clipping its first group. Pinned to
  the top edge they sit against the window's corner, which is the one place
  nothing else is; centred they read as floating beside the page.
- **Two lozenges that float, on one continuous ground.** Making them
  *transparent* was an over-correction: the rail then disappeared into the
  background rather than floating on it. What had to go was the tinted box
  round the **module** — against a box, two white lozenges read as the one
  thing left outside it; against one shared ground they read as floating.
  `--sb-overlay`, not `--sb-card`: this is drawn over the page, and overlay is
  the one surface token opaque in every theme (Glass's card is a 5% wash that
  would leave the rail see-through on its own dark page). `borderRadius: 999`,
  because at 64px a lozenge and a rounded rectangle read quite differently.
- **A company tile is `CompanyMark`** — the real logo where there is one
  (Settings → Accounts & companies sets it), and otherwise a disc tinted with
  its colour carrying two letters in ink. One drawing, shared with the picker
  that sets it, so the two cannot drift.
  Putting the colour in the *glyph* on a white disc was measured and failed its
  own purpose: `#3B82F6` on white is ~3.1:1, so `inkOnKeeping` fell back to
  `--sb-ink-1` and Teradix's mark came out `rgb(20,18,14)` — the same near-black
  as a company with no usable colour, so two of three discs looked **identical**,
  which is the one thing a company tile must never do. A white disc is also a
  5% wash in Glass. So the disc is `color-mix(<colour> 20%, var(--sb-overlay))`
  and the letters are `--sb-ink-1` measured against that tint — the pairing the
  app already uses for `--sb-ink-4` on `--sb-accent-tint`. Identity in the
  ground, legibility in the ink, neither doing the other's job.
- **The chosen tile is ringed, not tinted**, and `ALL` appears beside it only
  while a lens is on. It is the only thing on screen explaining why
  three-quarters of the page has gone quiet, so it has to read as *on* from
  across the room — and a lens you cannot see is one you report as missing data.
- **A lens pointing at a company that is gone clears itself.** Deleting or
  hiding the company in Settings would otherwise dim the whole app with no tile
  left to press.

## Companies — a logo, and the three things that were in the way
`lib/companyLogo.ts` + `components/CompanyMark.tsx`. A `DynamicCompany` carried
`name`, `color`, a domain, an account and a calendar and **no logo**, so every
tile in the rail and every card in Settings drew a tinted disc with two
initials. That was right while there was nothing to draw — *nothing is
invented* — and this is the way to give it the real one. Settings →
Accounts & companies: the circle at the head of each company card **is** the
control (press, drop or paste), and Remove is a word in the caption's slot,
never a ✕ pinned to the picture's corner — the mistake the habit record made
and had to undo.
- **What is stored is a data URL, not a link.** A link is a request to
  somebody else's server on every render, it dies when their path changes, and
  most marks sit behind a sign-in. A data URL rides in the `companies` row, so
  it travels to every device the way the colour does, with no bucket to police
  and nothing to fetch.
- **What is stored is pixels, never markup.** An SVG is rasterised like
  everything else, so nothing drawn from this field can be markup — one shape
  in, one shape out — and a 50KB SVG with a font in it costs what a 128px
  bitmap costs.
- **No logo is ever refused for being big, and the ladder is why.** Measured in
  Chromium on the densest thing a 128px box can hold (pure RGB noise) and on a
  flat mark: PNG 75,574 / 65,458 / 1,186 bytes, WebP at 0.85 39,000 / 10,000 /
  800. PNG is the first rung because it is lossless and, for the flat marks
  most logos are, *smaller*; WebP is the second because **noise is the bound by
  construction** — nothing of a fixed pixel count compresses worse than maximum
  entropy — so 39KB is this ladder's ceiling and the 48KB cap sits above it
  rather than in front of anybody. A 96px rung and a "that image is too big"
  refusal were both written before the measurement and both were unreachable;
  unreachable guards are worse than none, so they went. Quality moves it far
  less than it looks: 0.9 measured 41KB, 0.85 measured 39KB, because what costs
  the bytes is the entropy, not the quantiser.
- **`CompanyMark` is one drawing, used by the rail's tile and by the picker**,
  so what you set in Settings is the thing you press in the rail. The disc
  carries the colour and the mark carries the letters — the measured pairing;
  the other way round made two of three discs identically near-black.
- **The stored square is what the circle shows, edge to edge**, and getting
  that wrong is what a screenshot of the rail reported: a navy app mark drawn
  as a *square floating in a circle*, and a white wordmark as a little card.
  `contain` plus a 10% pad inside a circular clip is the one arrangement that
  cannot look right, because a mark's own ground stops at its own edges and
  the tint shows round the corners. A mark has one of two kinds of ground and
  they want opposite things, so `logoFromFile` asks which — at upload, so
  `CompanyMark` draws every logo the same way and there is no second rule:
  - **transparent** (a cut-out PNG) — the company's tint *is* its ground, so
    it is drawn at 84% and the tint fills the rest of the circle.
  - **opaque** (its background baked in) — that background is the ground, so
    the canvas is filled with it first and the mark drawn over at full size.
    A square logo comes out unchanged; a wide one gets its own colour either
    side rather than white bars or a crop. **Nothing is ever cropped** — the
    alternative, `cover`, would cut the ends off exactly the wordmarks that
    need them.
- **`groundOf` takes the colour nine of twelve border points agree on**, not
  all twelve. Unanimity was the first rule and it is too strict for a real
  logo: a mark that merely reaches the middle of an edge — which plenty of
  wide marks do — puts its own colour under a sample point, the image reads as
  having no ground, and the square is back inside the circle. Found by a
  fixture that did exactly that. One **transparent** sample still answers
  `null` outright, because that is a cut-out by definition, and a photograph
  answers `null` because its border has no nine points within a hair of each
  other.
`scripts/company-logo-fills-the-circle.mjs [opaque|wide|cutout|control]` — 34
assertions, and the measurement is the point: the tile is **screenshotted, the
PNG decoded back inside the page**, and the colour read on a ring just inside
the circle's rim. No DOM assertion can answer this — `objectFit` and `padding`
are the thing under test and the question is what the pixels come to. The two
grounds are the control pair: a mark with its own background fills the rim
(`[16,24,92]` all the way round), a cut-out must not and the tint reaches it
instead (`[216,230,253]`). And the shipped arrangement, restored on the very
same element — one property pair — puts the tint back at the rim under the
navy mark, which is the reported screenshot, measured.
- **`logo_url` is `COMPANY_OPTIONAL`** (`20260025`), so a project that has not
  run the migration keeps the logo in the browser and still writes every other
  column — and `mergeCompanies` refuses to let the server's blank beat it.

Two faults were in the way, both bigger than the feature:
- **Settings' `saveCompanies` announced nothing.** `professor-companies` is read
  by the rail's tiles, the calendar's company resolution and `mailCompany`'s
  cache, each of which listens for `professor:companiesUpdated` — and the one
  screen that edits companies never fired it. `storage` does not fire in the
  tab that wrote, so a rename, a colour, an account link or a logo set here
  reached nothing until a reload. The one writer announces the write, the shape
  `saveRules` → `finance:budgetRulesChanged` already has.
- **Settings held a second company merge, written by hand**, carrying only
  `users` and `hidden` forward from the browser — then `saveCompanies(merged)`.
  So opening Settings wrote the server's blank over `account_id`,
  `email_domain`, `calendar_id` and the logo: the exact failure
  `mergeCompanies` exists to stop (*link an account, refresh, gone*) surviving
  in a copy one file along, with App's own loader protecting the key that this
  screen then overwrote. It goes through `mergeCompanies` now; the
  `professor-company-users` restore stays on top, because that is a different
  question rather than a second field merge.
`scripts/company-logo-sticks.mjs [set|shrinks|remove|no-column|dense]` — 56
assertions over the real picker with a real PNG made in the page: the logo
reaches the store, the row and the rail **with no reload**; a 900×300 wordmark
is stored 128 square and under the cap with **both its ends intact** — a
marker at each far edge of the source, which is the only way to assert
"nothing was cropped" about an image whose own ground now reaches the corners
(counting empty space only worked while a contained image left transparent
bars); Remove clears the column rather than leaving the old one; a dense
image falls through to WebP with nothing asked of anybody; and on a project
without the column the write is refused once, the row still lands with its
name, colour, calendar and people, and the browser keeps both the logo and the
calendar link across a reload. The fixture's own first version re-seeded
`professor-companies` on every navigation and so wiped the very thing that
reload was measuring — the init-script trap, for the third time in this file.

## The ink audit was measuring Sunlit four times, under four names
Two faults, found in one afternoon, both of them the *vacuous pass* this file
has a section about already:
- **`INK_THEME` was taken on trust**, written into `professor-ui`, where an id
  the app does not know falls back to Sunlit. The theme is called *Glass &
  Depth* and its id is **`glass-depth`** — so `INK_THEME=glass-and-depth` ran
  the whole audit against Sunlit and reported *0 failing pairs* under a Glass
  label. Reported here as four clean themes, twice, before it was caught. The
  id is now checked against the list, and the **ground is measured on the
  page** (`--sb-page` differs in all four) rather than trusted: a theme that
  did not apply exits 2 and names what it found.
- **The init script rewrote `professor-ui` before every navigation**, so the
  Settings visit — which sets `activeModule` and reloads — had its own write
  wiped by the reload, and the app came back up on the default module. That is
  why `Settings`, `Settings · Appearance` and `Settings · Accounts & companies`
  had measured **nothing** since the file was written; the note under the count
  said that predated the rail work, which was true, and the cause was one line
  in this file all along. It merges now.
Reaching those three screens found **four real failures on text nobody had
ever measured**, each a token swap of the kind that section prescribes:
- the two **meeting-buffer pill rows** — `--sb-accent` on the accent at 12%,
  **1.42:1**, a label that is simply not there. `--sb-accent-deep`; the border
  stays the accent, being a line rather than text.
- the primary account's **Active** chip — `--sb-positive` on its own 10% tint,
  4.06 at 10px → `--sb-positive-deep`.
- **Delete account** in the danger zone — Evergreen's `#B4574A` on its own 8%
  tint, 4.1 at 12.5px → `--sb-negative-deep`.
All four themes now read **0 failing pairs over 22 screens with no blind
screens at all**, which is the first run of this file that has been true of.

## The lens matched almost nothing, because a company is rarely linked by calendar
"I click a company logo and it doesn't show its events and tasks." Both halves
were the same mistake: **reading one field when the data has always lived in
several.**
- **An event** was matched only on `company.calendarId === event.calendarId`.
  `calendarId` is *optional* on a `DynamicCompany` and most are linked by
  **account** instead, so that answered "nobody" for nearly every real event —
  and under a lens "nobody" is dimmed, so the whole week went quiet and the
  filter looked broken rather than empty. Three ways now, in order: the company
  names the calendar, the company owns the **account** the calendar is on, or
  the calendar is **named** for the company.
- **A task** was matched on `companyId` against company **ids**. But `dbSync`
  writes *any* non-static `company_tag` into `companyId` verbatim, so a task
  tagged with the company's **name** arrives with that name sitting in
  `companyId` and the string `personal` in `company`. `companyIdOfTask` in
  `types/index.ts` tries **both fields against both ids and names** — the rule
  `isTaskHidden` already had to learn, now named once so the two cannot drift.
- **The header says what the lens matched** — `3 events · 1 Teradix Ltd`, or
  `none here is Teradix Ltd's`. Without it a company whose events cannot be
  resolved is indistinguishable from a company with nothing on this week: every
  card quiet, the same sentence either way. That ambiguity *is* how this was
  reported, so the count is the fix as much as the resolution is.
- **The fixture is what was wrong, not just the code.** The first one gave
  every company a `calendarId` and every task a dynamic `companyId` — shapes in
  which the bug cannot occur. It now links the second company by account to a
  calendar that is neither named for it nor carries its id (a real connected
  account, told apart by bearer token), and files its task under the company's
  *name*. Control, on the shipped resolution: both of those dim.

## The company lens — one answer, every module
`lib/companyFocus.ts`. Pressing a tile dims everything that is not that
company's, on whatever screen is open — the calendar, tasks and mail alike,
because "whose is this?" is one question whatever module is drawing.
- **Dimmed, never hidden.** Removing the rest would make a filtered screen
  indistinguishable from an empty one — *a reload is not an empty ledger*
  pointed at a lens instead of a load — and the shape of the week behind the
  company you are reading is most of why you looked. Hover brings one back:
  a lens, not a lock, so no `pointer-events: none`.
- **This file never resolves a company.** Each module already knows how to name
  its own row's — the calendar from the calendar id, a task from `companyId`,
  mail from `companyOfMail`'s counterparty-first rule — so it takes that id and
  answers only *is it in focus*. A second resolver here would be a second
  answer about the same row.
- **`!important`, and it is the one place that earns it.** A card sets its own
  opacity inline — an event at 0.35 while it is a drag source, a task while it
  is finished — and an inline style beats every stylesheet rule. Measured
  exactly that way mid-build: the class was on the right element, the rule was
  in the sheet, and the computed opacity was still **1**. A lens is by
  definition an override of what each card says about itself. Control: with the
  `!important` dropped, the suite fails on the two cards that should have gone
  quiet and on nothing else.
- **Not knowing and not matching are the same answer here.** A row with no
  company — mail from a stranger, an unfiled task — is dimmed under a lens,
  because the question being asked is "show me this company".
- The lens survives a reload (per browser, like every other view preference),
  which is only safe because the rail is on every screen with the tile ringed.
- **The ink audit navigated by `header nav button` and had to be repointed.**
  It reported *0 failing pairs over 22 screens* while **15 of them never
  opened** — the exact vacuous result that file's own note was written about.
  It clicks `[data-side-rail] button[aria-label="<module>"]` now, which depends
  on neither an icon nor the rail's position.
`scripts/you-cluster-owns-its-row.mjs [today|calendar|rail|control]` — 26,
and the measurement had to be rebuilt twice because each first attempt
answered a question next to the one being asked. A rect-against-rect sweep of
`<main>`'s descendants reported **11 collisions on a clean calendar**: the grid
is a scroll container, so a row scrolled out of view keeps a rect above the
viewport that intersects anything up there while painting nothing. And
hit-testing the cluster's own box *through* the cluster answers the cluster at
every point, however empty the page behind it — so the control passed for the
wrong reason. The hit-test is taken with the cluster standing aside
(`pointerEvents: 'none'`), only a hit inside `<main>` counts, and the
structural claim — that the two boxes do not intersect at all — is asserted
beside it. Control: `position: fixed` put back on the very same element, one
property changed, and **7,008px²** of Today is underneath with **55 of 55**
points landing on the Morning Brief.

`scripts/company-lens-dims.mjs [rail|calendar|tasks|clear]` — 30 assertions,
measured as `getComputedStyle().opacity` on the real cards rather than as a
class name, since a class assertion passes with the rule missing from the
sheet. A third event on a calendar no company owns is what stops "dim
everything" passing; the dimmed cards are asserted to still have a box.

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

## What is drawn but not wired — nothing, by rule
`components/ComingSoon.tsx` (`Soon`, `NotYet`) used to dim a block that was on
screen for its shape. UI-unification P1.1 removed the last use: a control that
reaches nothing is **not drawn**, rather than drawn at half opacity with a
label. Settings → Integrations lost its illustrative Notion/Asana/Trello/Apple
Notes half; the setup wizard shows Todoist only when the build has its client
id (and no Trello tile); the dashboard has no Inbox card until it can show a real
unread count; the plans list has no "coming soon" line. `ui-guard`'s
`unfinished` rule (a "coming soon" string, or a `VITE_*` name shown to a
person) keeps it that way.

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
**22 screens** × four themes, every text against the background it is
*actually* drawn on. 21 failing pairs when written, none now. Re-run it after
touching a token or a palette.
- `visit(label, go, floor = 40)` — `floor` is the element count below which a
  screen is called blind. 40 suits the app's own dense screens; the stranger's
  booking page is 32 elements and all of them real, so it says its own.

## Ink — a hex is a token's *value*, not a licence to write one
A calendar week-view redesign wrote **54 raw hexes** into
`CalendarIntelligence.tsx` — every one of them a Sunlit Bento value typed out
rather than referred to. It looked right, because it *was* right in the theme
it was designed in. The audit found **1 failing pair in Sunlit and 6 in Glass**,
the worst being `#191712` ink on Glass's near-black page at **1.1:1** — text
that is simply not there. Each hex went back to the token it was standing in
for (`#A29C88` → `--sb-ink-4`, `#8A6A1E` → `--sb-accent-deep`, `#E4572E` →
`--sb-negative`, `#FAF8F2` → `--sb-field`, …), two became mixes of tokens, and
`1px solid` became `var(--sb-border-width) solid` — a border's weight is a
token too, and the same file already said so in fifteen places.
Two of the failures were not spelling, and neither could have been fixed by
swapping one hex for one token:
- **A card's ground is a colour nobody chose from the palette, so its ink
  cannot be a token either.** An event card's fill is the calendar's own hue at
  24%: `--sb-ink-3` on a pale violet reads 4.42, and in Glass `--sb-ink-1` is
  *light*, which on that same fill is 2.3. `lib/ink.ts` is the answer that
  already existed — `useInkOn()(evBg)` for the title, and
  `useInkOnKeeping()('var(--sb-ink-3)', evBg, 4.5)` for the time, so muted
  stays muted where muted can be read. The time on a *selected* card is the
  accent over `--sb-ink-1`: 9:1 on Sunlit's amber, **3.66** on Warm Minimal's
  terracotta, which is the mid-tone that theme's own note says cannot carry 4.5
  either way.
- **Mixing a hue into a wash gives a mid-tone, and a mid-tone carries neither
  ink.** `color-mix(… 24%, var(--sb-card))` is a white mix in three themes and,
  in Glass, a mix into `rgba(255,255,255,.05)` — which composites over the dark
  page to a mid grey-violet where white measured 2.71 and near-black worse. No
  choice of ink fixes that; the *fill* was wrong. `--sb-overlay` is the one
  token opaque in every theme (Glass: `#1C1B26`, its own card colour
  composited onto the page), so the mix goes there and the three light themes
  are unchanged by construction.
Four themes, 22 screens, 0 failing pairs after — and the behaviour suites that
drive that file (meeting outcome 65, booking hours 46) re-run unchanged.

## Links — a pasted URL should show what it is
`lib/linkPreview.ts` + `components/LinkPreviews.tsx`, under three boxes: the
event composer's **Notes and more**, a task's **Notes**, and the meeting
outcome's **Outputs**. All three are places people paste a recording, a doc or
a notebook, and all three drew 94 characters of query string you have to read
to recognise.

Two answers, and **which one is in force is on the card** (`data-from`):
- **Derived** — a pure function of the URL. A YouTube thumbnail is
  `i.ytimg.com/vi/<id>/hqdefault.jpg`, which the id in the link already names,
  so the picture is there the instant you stop typing, with **no request of any
  kind**. There is no CORS question to lose, because an `<img>` *renders* a
  cross-origin image without permission to *read* it — and that is the whole
  reason the derived set is expressed as a URL rather than as a lookup. Google
  Drive is the other one (`drive.google.com/thumbnail?id=`).
- **Read** — the `link-preview` edge function fetches the page and returns its
  `og:` tags. A browser cannot do this; the same-origin policy is strictest
  about exactly this, and no care in the client changes it. Anything that is
  not a derivable id needs a server or it gets a favicon and its host.
- **Nothing is invented.** No title is guessed from a path and no description
  is written for a page nobody has read: a link that answers neither way is
  drawn as its host and its own last path segment, which is true. A pasted
  NotebookLM link is that case even *with* the server — the page needs a
  sign-in, so there are no `og:` tags for anyone to read.
- **A derived URL is a guess the image settles for itself.** `onError` swaps
  the card to the site's mark rather than leaving a 76px grey rectangle, which
  is what lets the derivation be bold without a request first.
- **Words are held, pictures are not.** The derived half is a pure function of
  the text and appears as you type; only the half that needs the server waits
  700ms — the pause the calendar composer already holds words for.
- **A card never edits what you typed.** In the outcome box the lines *are* the
  tasks, so a preview that reworded, added or dropped one would be writing
  tasks nobody asked for. Asserted: two links, two cards, still two lines.

**`alive.current` was set false by StrictMode and never set back.** The ref was
written as `useEffect(() => () => { alive.current = false }, [])` — cleanup
only. StrictMode mounts, unmounts and mounts again, so from the second mount on
it was false for the life of the component and **every answer the server sent
was dropped on the floor**: the request went out, the reply came back, the card
never changed. Invisible to `npm run build`, invisible to a reading of the file,
and found on the first browser run.

### The fetcher is an SSRF hole unless it is nailed shut
`link-preview` fetches a URL somebody hands it, from inside the project's
network, beside a service-role database. Five guards, in order:
1. **It is not open** — a valid signed-in user or nothing happens, and it keeps
   the gateway's JWT check in `deploy-functions.yml` (the only function there
   that does), because `--no-verify-jwt` would publish a fetch proxy at a
   guessable address.
2. **http(s) only.**
3. **No private ground** — loopback, link-local, the three RFC1918 blocks,
   CGNAT, multicast, `.local`/`.internal`, and `169.254.169.254`, the metadata
   address that turns a preview card into credentials. Checked on the literal
   host and on the resolved A records where the runtime allows a lookup; a
   lookup that is refused leaves the literal guards standing rather than
   refusing everything.
4. **Redirects are walked by hand** (`redirect: 'manual'`, 3 hops, each one
   re-guarded). Following them automatically hands the guard's answer to
   whoever controls the first hop: a public URL that 302s to the metadata
   address sails through a check made only on what was typed.
5. **Bounded** — 6s, 256KB, `text/html` only, and the read stops at `</head>`.

**`[::ffff:127.0.0.1]` walked straight through on the first run.** `new URL()`
rewrites a v4-mapped address into hex before anything sees it — the hostname
arrives as `[::ffff:7f00:1]` — so the dotted-quad branch could never fire. The
guard reads both forms now. That is a hole a reading of the code does not show,
because the code looks exactly right.

`scripts/link-preview-is-not-a-proxy.mjs [addresses|dns|redirect|control]` —
the guards **lifted out of the real file** by regex and de-typed with `tsc`
(there is no Deno here), 18 private addresses refused and 5 public ones
allowed, a public name resolving to loopback refused, and the redirect walk
stopping at 3 hops without ever fetching the inward one. Control: a
scheme-only guard refuses **2 of 18** and reaches the metadata address.
`scripts/pasted-link-shows-itself.mjs [task|event|meeting|dead-thumb]` — 10
assertions in a real browser, and the claim that matters is a **pair**: the
YouTube link draws its picture and **the server is never asked about it**,
while the link no browser can read is the one that asks. Either half alone
proves nothing. `meeting-outcome-becomes-tasks.mjs links` measures picture 2
through the real door and re-runs its other four modes at 65.

## One shape for every module's menu — the flying bar
`LOZENGE` (exported from `SideRail.tsx`) is now the shape of **five** bars, not
one. A module's own menu is the same kind of object as the main menu, and
every one of them was drawn differently: a full-bleed band with a rule, a bare
row with no shape at all, or a title floating loose above the content.

| Module | What it was | `data-` hook |
|---|---|---|
| **Calendar** | title + controls, a bare row at `padding: 0 4px` | `data-cal-header` |
| **Today** | a full-bleed `--sb-header` band with a bottom rule — the finance slab's twin | `data-today-bar` |
| **Tasks** | Filters / Board-Matrix-List / Plan my day / New task, no shape at all | `data-tasks-bar` |
| **Habits** | title + the day's share on the left, Segmented + New habit on the right | `data-habits-bar` |
| **Finance** | the tab bar (done first; this is the rule it set) | `data-finance-tabs` |

**Deliberately not given one**, and the reason is the same each time — a
lozenge round a single control is a box round a pill, which reads as two
nested rounded things rather than one object:
- **Mail's `Mail / Smart` switcher** is one `Segmented` alone on its row. Its
  real toolbar below it is already one `Card` and keeps its own documented
  shape.
- **Dashboard** has no control row: the survey found no element near the top
  of its column carrying two or more buttons.
- **Settings** has its own rail and a page header that spans above it, which
  is a different arrangement rather than a menu bar.

### The calendar's stats line is gone, and the lens sentence is not
`32 events · 2 clashes · next in 1h` was a row of numbers nobody acts on — the
grid underneath draws every one of those events and a clash is already drawn
on the two cards it sits between. `clashCount` and `nextInMin` were read by
that line and nothing else, so both memos went with it (`noUnusedLocals` would
have insisted anyway).
- **What was kept is the half that is not a statistic.** The same `<span>`
  carried the company lens's own count, which `the lens matched almost nothing`
  above records as *the fix* — a company whose events cannot be resolved is
  otherwise indistinguishable from a company with nothing on this week, and
  that ambiguity is how the lens was reported broken. It now draws **only while
  a lens is on** and says only what the lens matched.

`scripts/flying-bars-match-the-rail.mjs [bars|stats|control]` — 25 assertions
over the five bars, each measured **against the rail's own lozenge in the same
page**: radius, ground, shadow, a border that is the same all the way round
rather than a rule underneath, and a real inset off both edges of `<main>`. A
hard-coded `999` passes a one-sided assertion and drifts the day `SideRail`
changes. Control, the old values restored on each very same element: **18 of
25 fail**. The ink audit re-ran at **0 failing pairs over 22 screens in all
four themes** — four of these bars changed the ground their text sits on, and
in Glass `--sb-header` is a 3.5% wash against `--sb-overlay`'s opaque `#1C1B26`.

**The `stats` mode passed vacuously on its first run and said so.** `go(mod)`
wrote `activeModule` into localStorage *before the first navigation*, while the
page was still `about:blank` — which has no origin, so the write threw into its
own try/catch and the app came up on the default module. `[data-cal-header]`
was therefore absent, `innerText` was `''`, and "no event count" / "no clash
count" / "no next in" all passed against an empty string. The positive
assertions beside them — the date range is still there, the controls are still
there — are the only reason it showed, and the suite now asserts the element
exists **before** testing what it does not contain.

## The mark, the mail switch, and two screens that said it twice
Four changes that are really one idea: a screen should say each thing once,
and the app should wear its own badge.

### Mail is one view, and its bar is a lozenge
- **The `Mail / Smart` switch is gone** and Smart is the view. The flat list's
  branch is still in `InboxModule` and is now **unreachable from the screen** —
  the folders, the class filters, sort, swipe and the bulk bar went with the
  switch. It is left standing rather than deleted in the same breath: taking a
  thousand lines out is its own decision and this one was about the control.
  `mode` is `'smart' as const` rather than state nothing can change, and
  `mail-mode` is no longer read or written.
- The **Last 30 days** bar was a `--sb-field` box at `--sb-r-nav` — a *card*
  shape for a menu — and is now the rail's `LOZENGE` like the other five.
  `data-mail-bar`.
- **And the four views are in it.** They were a rail of their own underneath,
  while the bar carried a LAST 30 DAYS eyebrow and a sentence about the pass —
  so the row that decides what you are looking at sat *below* a row that
  decides nothing, and the bar itself was mostly empty. The views are the
  control the screen is steered with, so they get the bar. What the pass is
  doing is said in the one place that is about the pass: the spinner on **Check
  now**.
  The statement that went with them said how many people are waiting on you,
  which is true and is the one thing the counts in the rail do not say. It is
  gone rather than moved — there is no room for both, and a view you have to
  scroll past to find is worse than a fact you have to open a view to read.
  `flexWrap` goes with it: the rail scrolls sideways inside `flex: 1` +
  **`minWidth: 0`**, which is what stops a flex item refusing to shrink below
  its own content, so the bar is one line at every width.
- **The fade at the rail's edge is one measurement, in `lib/railOverflow.ts`.**
  It lived in `InboxModule` — twenty lines of `ResizeObserver` and
  `data-overflow`/`data-at-end` — so the smart view's *identical* rail, with
  the same stylesheet rules behind it, had no fade at all. Now that it is in
  the bar beside two buttons it is a box that can genuinely run out of room.
  The hook also listens for `scroll` on the element, which the original only
  did through an `onScroll` prop on its own JSX — so `data-at-end` is now
  right for both rails rather than for whichever one remembered to wire it.

### The mark sits above the rail (third move, and the one that stuck)
Top-right, then the first item of the content column — and that second place
floated 11px off the cards and over neither the rail nor anything else. It is
**52px, centred over the rail's pill, in the window's top-left corner**: a
64px row (`MARK_ROW` in `App.tsx`) above `TopNav`, which is also `YouCluster`'s
height, so the mark and search/bell/avatar share one centre line (32px).
`scripts/mark-and-the-stats.mjs mark` measures it: 0px off the pill's centre,
52 inside a 62px pill, not in `[data-you]`, centre line 32 = 32. Control —
the mark put back in the row at 76px — fails 4 of 7 (101px off the rail).

### The mark owns the top-left corner, not the top-right
It was the last item in `YouCluster` at 51px. It is the **first** item now, at
**76px** — 1.5x again, sized to the empty space it sits in rather than to the
34px controls, which is the whole reason it moved: the top-left of the content
column is the one spot nothing else claims, and the corner a badge has always
been in. `marginRight: auto` pushes the three controls back to their own end,
which is the same thing a spacer element says with one property instead of a
node. The row grew **60 → 84**, because an object taller than its row hangs out
of both ends of it, and the two paddings are now equal (18) so the mark's left
edge sits as far off its end as the account menu does off the other.

### Habits said the day twice, a line apart
The header read `HABITS TRACKER · 33% of today done · 3 of 9 finished · 1d
streak · 5% this week` and the card **directly beneath it** drew 33% as a ring,
3 of 9 in words, the streak, and the week as seven bars. One question, two
answers, 60px apart.
- The card is the better of the two — it *draws* the week rather than stating
  it — so it moves **above** the controls, and the bar keeps only what it alone
  has: how you are looking, and the way to add one.
- `todayDone` / `completionPct` were read by that sentence and nothing else, so
  both went; `todayTotals` stayed, because the all-done banner at the foot of
  the page still fires on it.

### The mark owns the top-right corner
`BeLogo` existed and was drawn **once, on the sign-in screen** — the app itself
wore no badge. It is now the last item in `YouCluster`, which is the top-right
corner of the content column, in the same `amber` colourway the sign-in screen
uses so the two are one object at two sizes.
- **51px: 1.5× the 34px controls beside it** — and the row grew **48 → 60px**,
  because a 51px object in a 48px row hangs a pixel and a half out of each end.
  The row is what gives way; `alignItems: center` then puts every item on one
  centre line, which is what "aligned vertically" has to mean when the items
  are three different heights.
- `aria-hidden`, no `title`: it is decoration between two controls that do
  things, and a screen reader announcing "Be" there is a stop with no
  information in it.

`scripts/mark-and-the-stats.mjs [mark|mail|habits|control]` — the mark is
measured as **four** claims, since a size assertion alone passes with the mark
hanging out of the row or sitting at the wrong end of it: 76 within half a
pixel of 1.5 × 51, every item in the row sharing a centre line to **0.0px**,
the mark inside the row's own bounds (4 → 80 in 0 → 84), nothing drawn to its
**left**, its left edge on the row's 18px padding, and 1,316px of row still to
its right — or "moved left" would be satisfied by a row with everything piled
on one side. **Control: the old arrangement restored on those very elements**
— 51px, `order: 9`, the auto margin dropped, the row back to 60 — and it fails
6 of 11, with 12 elements then drawn to the mark's left. Mail asserts the pills
are **inside `[data-mail-bar]`** and that there is exactly **one** filter rail
on the page, before asserting that "Last 30 days" is nowhere on it, because an
absence is also true of a blank page; and that the bar is still 46px, which is
one line of 27px pills rather than two. Mail asserts the switch's absence
**and** that the Smart view is what draws, because an absence is also true of a
blank page. Habits reads the two rects' own y order (card 82, bar 179) rather
than source order. `flying-bars-match-the-rail.mjs` covers six bars now.

**Two fixtures were wrong before the code was.** The habits mode seeded no
habits at all, so there was no stats card to be above anything and the case
failed about an empty page; and the card was selected on the text `of the day
done`, which it only says **through the middle of the range** — at 0 it reads
"Nothing logged yet today" and at 100 "All habits complete! 🎉". That second
one also broke `deleted-habit-stays-deleted.mjs`, whose whole measurement is
the share before and after a delete: it read the removed header's sentence, and
repointing it at the card's words then failed at exactly 100%, which is where
two of its three assertions sit. The card carries `data-day-pct` now and the
suite reads the **number**, which is stated in every state. 0 failing pairs
over 22 screens in four themes.

## The Dashboard is folded into Today (P2.1)
Today (`modules/morning/TodayPage.tsx`) is the one screen that answers "what is my
day". The Dashboard repeated it — open tasks, meetings, habit progress — and was
the module the app opened on.
- **`TodayGlance`** (`morning/TodayGlance.tsx`, `[data-today-glance]`) is a row of
  four chips under the brief bar: Do now (the quadrant glyph, `data-quadrant="do"`),
  Open tasks, Meetings today, Habits today. Each is a door to the module that owns
  the figure. Counts only; the day itself is the cards below.
  Rules: **Do now and Open tasks count `isOpenTask`** (a finished task never counts);
  **Meetings are timed events** (`start.dateTime`), not all-day ones; Habits is
  `dayTotals(...).pct`.
- **Dashboard left `NAV_ITEMS`; the app opens on Today** (`uiStore` default `morning`).
  `RETIRED_MODULES` in `App.tsx` sends a persisted `activeModule: 'dashboard'` to
  Today — every existing user has one, and without it they land on a page with
  nothing lit in the rail.
- **Kept, deliberately unreachable**: `modules/dashboard/`, `morning/MorningBrief`,
  `morning/DayPlanner`, `planning/PlanningAssistant` (still mounted under module id
  `planning`, which is in no menu) and `components/layout/Sidebar.tsx`. Nothing
  imports the first four's UI from a reachable path; they stay in the tree until
  the new experience is signed off, then they can go in one commit.
- **Today read the habit logs once, on mount**, so on a first load (a new device)
  the server's arrived after it and every habit figure read 0%. It now listens to
  `professor:habitLogsUpdated`, as the Habits page does. Control: without the
  listener the strip read 0% with a done habit on the server.
- "Do now is one colour everywhere" (`ui-render`) is now measured on **Today and
  Tasks**; the Dashboard's matrix card was the other half before.
- `scripts/today-is-the-day.mjs` — 14 assertions: no Dashboard in the rail, a saved
  `dashboard` lands on Today, the four figures against a fixture where each wrong
  rule gives a different number (a finished urgent task, an all-day event), and
  the doors. `supabase/functions/_shared/appGuide.ts` no longer lists Dashboard
  (an edge-function file: deploys with the functions workflow).

## The look follows the account, not the address — and the size is not part of it
The accent is a **synced** preference that arrives *after* boot: `initAppearance()` has already
painted from an empty `localStorage` on an address the browser has never seen (a new device, the
move to `www.be2.life`), so it re-reads the appearance on `professor:prefsRestored`.
- **The page's size is not a preference.** It used to be `professor-compact`, a synced toggle,
  off by default — on a new address the app came up 11% bigger ("the fonts feel bigger, the whole
  experience is different") until a second reload. It is `appScale()` now — 90%, or 100% on a
  phone — always; see the root `CLAUDE.md`. The old key is read by nothing (a device may still hold `0` or `1`), and the
  `compact` column in the settings table is vestigial.
- **Deliberately not synced, so they start from defaults on a new address:** the theme
  (`professor-ui`), the calendar's view (`cal-view`), and the finance passkey
  (`finance-lock-device`; a passkey is also bound to the address it was made on, so it is
  re-registered there — Settings → Finance → Security). These are choices made *on a device*;
  changing that is a decision, not a bug fix.
- `node scripts/appearance-follows-prefs.mjs 5199 [accent|control]` — a fresh origin whose account
  has an accent saved must reach it with no reload; with nothing saved it stays amber.
