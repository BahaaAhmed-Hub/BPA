---
paths:
  - "scripts/**"
---

# The harnesses — how a claim is measured here

Loaded when a file in `scripts/` is read or edited. The root `CLAUDE.md` holds
the discipline; this holds the machinery.

## The shape of one
`playwright-core` (not `playwright` — it is what is installed), Chromium at
`/opt/pw-browsers/chromium` with `--no-sandbox`, against a **dev server on
5199**: `npx vite --port 5199 --strictPort`. Never `pkill -f vite` — it matches
the shell running the command and kills it (exit 144).

- `scripts/session.mjs` exports the stub `user` and `session`.
- `ctx.route('**://placeholder.supabase.co/**', …)` is the server. A stub reply
  needs `Access-Control-Allow-Origin` and an OPTIONS branch, or
  `functions.invoke` cannot read it.
- `**://www.googleapis.com/**` is Google; intercepting it is how a write to a
  calendar is proven to have gone to the right one, by bearer token.
- `addInitScript` runs **in the page**. A Node variable is not in scope there —
  a `MODE` branch inside one throws, seeds nothing, and the case passes by
  testing the same path twice. Pass what it needs as an argument.
- `localStorage` belongs to an origin, and `about:blank` has none. A `go()`
  helper that writes `professor-ui` before its first navigation throws into its
  own try/catch and the app comes up on the default module — which is how a
  mode once passed every assertion against an empty string.
- The app hydrates and **replaces** each store's list, so seed the shape the
  **server** sends, not the store's persisted copy, or the screen empties a few
  seconds after it settles.

## Three things that make a harness fail for a reason that is not the code
- **The page and the mouse use different units at 90%.** The app is drawn at 0.9 and
  `lib/zoomSpace.ts` makes everything the *page* reports (`getBoundingClientRect`, `innerWidth`,
  `elementFromPoint`) read in the app's own units, while Playwright's `mouse.*` and
  `boundingBox()` work in screen pixels. A rect read inside the page must be multiplied by
  `window.__zoomSpace ?? 1` before it goes to the mouse (and a screen position divided before it
  goes to `elementFromPoint`); a hard-coded `1280` compared with a page position must be
  `innerWidth`. Ten scripts mixed them and silently clicked 11% off target.
- **A dev server that has hot-updated a file gives a harness a second copy of the store.** A
  harness that does `import('/src/store/…')` inside the page (`assistant-calendar-habits.mjs`)
  passes 4 out of 4 on a freshly started server and fails 3 out of 3 after a `touch` of a file
  it depends on. Restart the server after editing, before you trust a failure there.
- **`localStorage.setItem('bpa-wizard-done', '1')`** in every init script: the setup guide
  (PR #62) covers a brand-new stub account's page, and a click is "intercepted" by it.
- **A stub that answers every read with the same rows cannot show a paging bug** — and hides a
  paging loop. Honour `limit`/`offset`/`order` and cap at 1,000, as the server does.

## A pure harness over the real loaders — `scripts/reads-past-1000.mjs`
No browser and no dev server: the real files are bundled with `rolldown`, with only `supabase`
(and `liveSync`) replaced by a fake that **behaves like the server** — a 1,000-row ceiling, `range`
/ `order` / `in` / `eq` / `gte` / `lte` / `gt` / `is` / `not`, every delete recorded, a page that can
fail. `SRC=<path to a worktree>` runs the same claims against other code, which is the control
(`git worktree add <dir> <sha>` and symlink `node_modules`). Copy it for the next loader.

## Waiting: `scripts/settled.mjs`, not a number
Every harness used to sleep 5–7s after boot — **354 seconds of fixed
`waitForTimeout` across the directory**, about eleven of a twelve-second mode.
A number is too long on a fast boot and, on a slow one, is a vacuous pass: the
assertions run against a page that has not arrived.

`settled(page, traffic, cap, { shell, want })` waits for the condition instead —
the shell, then what the suite is about, then the boot's own reads having
**stopped arriving**. `watchTraffic(page)` must be installed *before* the first
navigation, or the counter misses the boot. `cap` is the old sleep kept as a
ceiling, so no suite can become slower than it was; `SETTLE_DEBUG=1` prints
what it waited for and whether it hit the cap.

- **A request that never finishes must not define "settled".** The first
  version sat on the full cap every time, and it was
  `oauth2.googleapis.com/tokeninfo` — `googleScopes` asking Google what a token
  may do, a host these harnesses do not stub, hanging against the egress proxy.
  A Realtime websocket and any long-poll are the same shape, so a request older
  than `STALE_MS` stops counting.
- `shell` defaults to `[data-side-rail]`, which is on every signed-in screen. A
  harness measuring the sign-in gate or the **public booking page** must pass
  its own, or `shell: null` — that page deliberately makes no request at all,
  and `seen === 0` answers at once, which is the right answer.
- Four scripts still carry their own sleep: `accounts-come-back`,
  `planner-leaves-no-events`, `planner-my-calendars` (each builds its page
  differently) and `mail-action-sticks` (its wait is not after a navigation).
  Converting them is the same two lines when somebody wants it.

## The ink audit
`node scripts/ink-audit.mjs 5199` — 22 screens x 4 themes. `INK_THEME=<id>` for
one; the ids are `sunlit-bento`, `warm-minimal`, `evergreen`, `glass-depth`, and
a wrong id used to run Sunlit under another theme's name and report it clean, so
the id is checked and the **ground is measured on the page**.
- It navigates by `[data-side-rail] button[aria-label="<module>"]`, which
  depends on neither an icon nor the rail's position. It reported *0 failing
  pairs over 22 screens* once while **15 never opened**; every visit now records
  what it looked at and a screen that came up empty is named under the count.

## Lifting a Deno file
There is no Deno here, so an edge function's own code is **lifted out of the
real file by regex and de-typed with `tsc`** rather than restated — a second
copy is the thing being tested. `declare const Deno: {…}` satisfies the type
checker and emits nothing, so the runtime stub is still what runs. **The first
assertion is that the file parses at all**: a backtick inside a template
literal once closed the system prompt and turned the rest of a bot into
nonsense, which `npm run build` cannot see because no edge function is in the
Vite build.

## Is the memory still all there?
`node scripts/memory-is-all-there.mjs` — every `##` section of the old
4,392-line `CLAUDE.md` must appear **verbatim, exactly once**, across the root
file and `.claude/rules/`. It reads the old file out of git history at
`f2c2ef6`, the last commit that held all 132 of them. **A sha, not a tag**: a
tag reads better and this session's git proxy refuses to push one, so from a
fresh clone the check would fail for a reason that has nothing to do with the
memory. Run it after moving anything between the root and a rule file, and
pass another ref to compare against a different point in history.

## The UI guards — `ui-guard.mjs` and `ui-render.mjs`
Built for the UI-unification phases in `docs/ui-unification.md` (read its §T
for what each phase must move).
- `node scripts/ui-guard.mjs [--only=type,dialog] [--json]` — a code scan, no
  browser. A rule fails the run only when it is in `ENFORCED` (each phase adds
  its rule in the PR that takes the count to zero) or named with `--only`; the
  rest are counted and shown with `·`. `--self-test` runs every rule over
  `scripts/fixtures/ui-guard-bad.tsx` (outside `src/`, so it is not in the
  build): each rule must catch its marked violation and let its `allow:` line
  through. `type` reads the whole `fontSize:` expression, so a ternary
  (`tight ? 11.5 : 12.5`) is caught, not only a bare number. The brief's plain
  regex found 0 where there were 9.
- `node scripts/ui-render.mjs 5199 [--narrow] [--phase=<id>] [--inject-bad]` —
  every rail module, Settings and `?book=bahaa` in each theme (`INK_THEME` for
  one), measured from `getComputedStyle`: type floor, emoji in visible text,
  native dialogs, and with `--narrow` sideways scroll and 36px tap targets. A
  screen counts as opened only if the rail marks it `aria-current` **and** it
  has 10+ visible text elements. `--inject-bad` is the control: a 9px flame and
  a `confirm` are injected and all three checks must fail, or it exits 1.
  Screenshots go to `screenshots/ui/<phase>/<theme>/` (git-ignored). The stub
  answers every read with `[]`, so screens are in their empty state — the same
  on every run, which is what makes a before/after pair comparable.

### What the UI-unification phases added to those two
- `ui-guard`: all nine rules are in `ENFORCED` now, so a bare `node scripts/ui-guard.mjs`
  fails on any regression. Markers: `// ui-guard: ink-ok` (a disabled-state
  `--sb-ink-4` text colour), `user-colour` (a default for a colour a person
  picks), `type-ok` (SVG user units), `emoji-ok` and `emoji-start`/`emoji-end`
  (emoji a person picks, a preset list, text written into Google). A marker
  after a JSX element renders as text, so put one only on a line that ends in `,`.
  Emoji defaults and fallbacks live in `src/lib/glyphs.ts`, outside `src/modules/`.
- `ui-render` also asserts: "Do now" is the same computed colour on Tasks and
  the Dashboard (`data-quadrant`), the top bar's Search opens the command
  palette, and — with `--narrow` — the calendar opens on Day, the public
  booking page's **day grid** (one tap in) fits, and no page scrolls sideways.
  `--narrow` emulates a phone (`hasTouch` + `isMobile`), so `(pointer: coarse)`
  holds and a `.sb-hit` control counts its hit pad toward the 36px floor.
  `UI_VERBOSE=1` lists every failing target instead of the first four.
- `undo-replaces-confirm.mjs` — a goal and an entry delete with no native
  dialog, the server receives the DELETE, Undo sends the upsert; the
  ConfirmDialog opens as an alertdialog, focus starts on Cancel, Escape answers
  false. Control: on the code before P0.6 it sees the native dialog fire.
- `skeleton-shows-while-loading.mjs` — Google's events held 1.5s: a
  `[data-skeleton]` shows, then the event; `prefers-reduced-motion` stops the
  pulse. `HOLD=never` is the control (the skeleton must not leave by itself).

### Splitting a big file without changing it (the Settings split)
- `node scripts/split-module.mjs <file.tsx> <plan.json> [--dry]` moves named
  top-level declarations into new files **from the AST**: each moves with the
  comment above it, in order; a moved name anything else uses gets `export`; each
  new file gets exactly the imports it uses (type names as `import type`);
  the source re-exports what outside modules import. It **refuses** — naming both
  sides — when a moved declaration uses something that stayed behind (circular) or
  two new files would import each other. It matches by identifier name, so it
  over-counts imports: run `node scripts/prune-imports.mjs` after, which removes
  exactly what `tsc` reports unused. Neither is a refactoring tool — a `let` that
  another file assigns (`onAIPush`) needs a setter first; `tsc` finds it.
- `node scripts/settings-snapshot.mjs 5199 --save=<f>` / `--compare=<f>` hashes
  the markup of all 15 Settings sections (clock times and React ids normalised).
  Controls: two runs on the same code agree; changing one visible string flips
  exactly the page that holds it (a *theme* change flips nothing — it is CSS
  variables, so it is not a control). A section counts as opened only with
  300+ chars of markup. Match nav entries by visible text — "Integrations" carries
  a count badge and "AI" an icon with its own accessible name.
