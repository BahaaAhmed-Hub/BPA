---
paths:
  - "src/modules/settings/**"
  - "src/modules/admin/**"
  - "src/lib/prefSync.ts"
  - "src/lib/entitlements.ts"
  - "src/lib/admin.ts"
  - "src/lib/googleScopes.ts"
  - "src/lib/automation.ts"
  - "src/lib/notifications.ts"
  - "src/lib/professor.ts"
  - "src/lib/rankWatch.ts"
  - "src/lib/weekReview.ts"
---

# Settings, accounts, prefs, entitlements and automation

Loaded when a file this rule's `paths` names is read or edited — it is not
in context on every turn, which is the whole point. The root `CLAUDE.md`
holds what is true everywhere; this holds what is true here.

## Settings — the Model picker chose a *provider* and named a model
"I have a valid Anthropic key in Settings → AI and the bot still answers 401."
Three rounds of this went into the sync layer before anyone looked at the
control above the key field. `ProfessorSection`'s Model picker offered
**`Sonnet 4.5` / `Opus 4.1` / `Haiku`** — and the values behind those labels
are `anthropic` / `groq` / `haiku`. The value is not cosmetic: it decides
which field the key box underneath **edits and displays**
(`ai.provider === 'groq' ? groqKey : anthropicKey`). So picking the
best-sounding Claude selected **Groq**, the Anthropic key typed next was saved
as `groqKey`, and nothing in the app or either bot reads it there — they read
`anthropicKey`, which still held the revoked one. The field showed the good key
back to you the whole time, because it was showing `groqKey`.
- **A label must not name something its value cannot deliver.** Groq does not
  serve Claude at all, so "Opus 4.1" on the Groq option was not a loose label,
  it was a wrong one — and the one that decides where a credential lands. The
  options are the two providers that exist, `Claude` and `Groq`; which model is
  a separate question (`groqModel` already asks it on that side).
- **`haiku` was never in `AIConfig['provider']`.** It survived only the
  `v as AIConfig['provider']` cast on that handler, so TypeScript never saw it;
  `professor.ts` branches on `=== 'groq'` and treated it as Anthropic. A third
  option that is not in the union is a value nothing downstream can mean.
- **The misfiled key is named, never moved silently.** `misplacedAnthropicKey`
  reports an `sk-ant-…` sitting in the Groq field — unambiguous, since Groq's
  own keys begin `gsk_` — and the section says so where it happened with one
  button that sets `provider`, moves the key to `anthropicKey`, clears the Groq
  field and `notify`s what it did. A credential that relocates on its own is one
  nobody can account for.
- **`/key` in Telegram is the instrument this needed from the start.** It
  answers what the bot actually presents: the source (Settings or the function
  secret), the account row it read, the key **masked** to its first 11 and last
  4 characters, and its **length** — a trailing newline or a truncated paste is
  invisible otherwise. It never prints the whole key. Three rounds were spent
  guessing because nothing could answer that from outside the function.
`scripts/ai-key-field-is-the-right-one.mjs` — 17 assertions over the real
files: no option labelled with a model its provider cannot serve, every offered
value inside the union, the detector right on `sk-ant-` / `gsk_` / empty, the
repair setting all three fields and saying so, and `/key` naming its source and
masking. Control, on the code before the fix: **14 failing**, the first being
`value: 'groq', label: 'Opus 4.1'`.

## Prefs — the pull was timid and the push was not
`prefSync.ts`. The file's own header says the merge "fills in a key this device
has never had, and otherwise leaves it alone" — and that was true of
`pullSharedPrefs` only. `pushSharedPrefs` wrote `shared_prefs: bag`: **every**
shared key as that browser happened to hold it, replacing the lot. So the
politeness of the pull was undone by the push, and a device that had never
touched a key still asserted its own stale copy of it — on boot, seconds after
the pull, and again every five minutes.
- **That is why a new Anthropic key would not stay.** Paste it into Settings →
  AI on the phone; open the app on the laptop, which still has the revoked one
  in its localStorage; the laptop writes the revoked key back over it. The bots
  read that row, so Telegram went on answering `401` with a key you had already
  replaced — twice over, because the pull then refused the server's newer value
  on the grounds that "this device knows better".
- **`professor-prefs-seen`** is the missing claim: what this browser last
  pulled or pushed, per key. It is the same split as `professor-habits-edited`
  one store along — *absence of an edit is not evidence of one* — and it makes
  three cases out of what used to be one. A push now carries **only the keys
  whose local value differs from what was last synced**, and **merges** them
  onto the server's bag rather than replacing it, so a key this device has
  merely read is left alone. A pull now takes the server's value when this
  device has **not** changed the key since its last sync, keeps the local one
  when it has, and keeps an unexplained local value (no `seen` entry) so a
  fresh device still uploads what it has.
- **"No record at all" is not "no record for this key", and reading them as
  the same thing meant the fix's own first boot re-broke it.** Before `seen`
  existed no device had one, so the laptop's first sync on the new code saw an
  empty map, called its stale key an unexplained local value, kept it **and
  pushed it** — the revoked key back over the good one, one more time. That is
  what "I have a valid key in Settings and it still does not work" was.
  `everSynced()` separates the two: on a browser that has **never** synced the
  server's value is adopted, because before this every local copy either came
  *from* a pull or had been pushed, so the server's is at least as new and
  adopting it loses nothing. A key with no entry on a browser that *has* synced
  is genuinely new here and still pushes. The first harness missed this by
  syncing both devices on the new code before the edit, which seeds `seen` —
  a fixture has to start where the real device starts.
- **Only a write that landed is remembered as synced.** `update` returns an
  error rather than throwing, so the old code could not have noticed; recording
  a refused push would strand the change on that device for good.
- **Settings → AI pushes the moment it saves.** The ordinary push is a
  five-minute timer, so typing a key and messaging the bot straight away asked
  it with the old one — indistinguishable from the new key being wrong.
- `professor-prefs-seen` is cleared by `clearUserData`: it is a claim about one
  account's prefs and a stale entry that happened to match would suppress a
  push the next user needs.
`scripts/prefs-key-survives-another-device.mjs` runs the real module against two
localStorages and one shared bag: 10 assertions. The laptop no longer puts the
revoked key back, on boot or on the tick, and takes the new one for itself; a
real edit on the laptop still travels; a fresh account still uploads; a refused
push is retried. Control, on the code before the fix: **4 failing**, the first
being the server holding `sk-ant-REVOKED` again seconds after the phone set the
new key.

## Prefs — one push at a time, and the key field has no Save button
"I change the AI key to a valid one and click save, and after a refresh it did
not save." There is **no Save button** on that field — it writes as you type
(`setAI` → `saveAIConfig`) — and `saveAIConfig` called `pushSharedPrefs()` on
every change event. A 93-character key typed by hand was therefore **93
concurrent pushes**, each reading the server's bag, merging and writing it
back.
- **Measured with the UPDATEs completing out of order: the server ended
  holding a one-character key.** The first keystroke's write landed last, and
  last writer wins. The browser still had the whole key, so the field looked
  right — while the bots, and the next device, got a stump. That is "it did
  not save", from the one angle the screen cannot show you.
- **`pushSharedPrefs` now refuses to run two at once.** A caller arriving
  while one is in flight sets a flag and joins it; one more push runs when the
  first finishes, reading whatever localStorage holds *then*. Last writer
  still wins — there is simply only ever one writer.
- **And the field holds 700ms**, the same pause the calendar composer holds
  words for. Serialising alone makes the data right; the debounce is so that
  saying one thing costs one request rather than ninety-three.
- **It says whether it landed.** `pushSharedPrefs` answers `saved` / `nothing`
  / `failed` and the section draws it: *Saving…*, *Saved — on this browser and
  on your account*, or that it is saved here but did not reach the account, so
  it will not follow you to another device or to the bots. With no Save button
  the only previous evidence was opening the app somewhere else — which is how
  this gets reported about a key that may well have saved. `nothing` is
  deliberately not `saved`: a screen that says saved when nothing was sent is
  making a claim it cannot support.
`scripts/ai-key-survives-typing.mjs [typed|pasted|control]` — 11 assertions
over the real module with the server's completion order controlled, each batch
landing backwards. Control, on the shipped code: the browser holds 93
characters and **the server holds `"s"`**.
- **A second defence made that control a control of nothing.** The read-back
  loop added later heals a mis-ordered write on its own, so stripping only the
  serialisation stopped reproducing the stump: the control asserted the bug
  appears, the bug did not appear, and the suite reported a failure about code
  that was fine. A control has to remove **every** defence against the fault it
  demonstrates, or it measures whichever one somebody left in — so it now
  strips the retry too, and the server holds `"s"` again.

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
  keeps it in `professor-ai-config`;
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
- **It is not "on that browser and nowhere else"** — this said so and was
  wrong. `professor-ai-config` is one of `prefSync.ts`'s SHARED_KEYS, so it
  rides in `users.schedule_rules.shared_prefs`, which is what lets the key
  follow you to a second device rather than being retyped. It is in Postgres,
  behind that row's own RLS. Worth stating plainly rather than claiming an
  isolation the code does not provide.
- The bots have a **server-side** `ANTHROPIC_API_KEY` in Supabase secrets as
  their fallback, which is a different key in a different place and was not
  affected — but it is no longer the first thing they read (below).

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

## Accounts — `google_accounts` is where a connected account lives
Signing out and back in showed **no extra accounts**, and nothing had been
lost: all three rows, with live refresh tokens, were in Postgres the whole
time. Three stores, and only the weakest two were being read.
- **`google_accounts`** is the real thing — one row per account you connected,
  its token in `google_account_tokens`, and it is what every edge function
  reads. **`users.schedule_rules.connected_accounts`** is a jsonb *mirror* the
  browser writes. **`professor-connected-accounts`** is this browser's cache of
  that mirror, and the only one carrying tokens and the browser-minted id.
- `loadAllFromDB` read the mirror and the cache and **never the rows**.
  Sign-out wipes the cache (`clearUserData`), so an account whose mirror was
  empty — written under a different sign-in, never written, or overwritten with
  `[]` — came back as nothing at all. The one store that could have answered
  was not being asked.
- **The union is keyed by email**, the only identifier all three share — the
  same reason `serverAccountId()` matches on it. The id this browser already
  holds **wins**, because a company is linked by that uuid and swapping it for
  `google_accounts.id` would break the link. Tokens only ever come from local.
- **A failed read is not evidence.** `loadAccountsFromServer()` answers `null`
  for that (`googleScopes.ts`'s rule), and an empty result is never written
  over a list this browser has.
- **`saveAccountsToDB` refuses to write `[]` over a non-empty mirror.** Every
  caller hands it whatever `professor-connected-accounts` holds *now*, and that
  key is emptied by sign-out — one call a moment too early wiped the mirror for
  every device at once. Disconnecting the last account is the only legitimate
  empty write and goes through `removeAccount` and the edge function, which
  delete the row itself.
- **The account you signed in with is never in this key**, and the first pass
  put it there. `professor-connected-accounts` holds the *additional*
  accounts — `mailAccounts`, `companyForAccount` (which offers the signed-in
  one as the id `primary`) and Settings all say so, and Settings draws it as
  its own card above the list. Writing its `google_accounts` row into the list
  drew it **twice**: once as the active account, once as a connected one with
  a trash button beside it. Filtered by **address**, not by `is_primary` —
  that flag is about this user's own set of Google accounts and says nothing
  about which Supabase identity is signed in — and a cache written before the
  rule was enforced is cleaned on the next load rather than left to rot.
- **`scopes` is not a column on `google_accounts`**, and naming it in the
  select is a PostgREST 400 that fails the whole read. That is how the first
  attempt at this shipped and still showed nothing: the union finally asked the
  one store that knew, the request was rejected for a column nobody has,
  `loadAccountsFromServer` answered `null` — "could not look" — and on screen
  that is indistinguishable from the empty list it replaced. The base select is
  now the columns that exist and `scopes` is asked for separately, once per
  session, with the **drop-only-the-column-the-error-names** retry
  `financeDb.upsertRows` and `saveCompaniesToDB` use, so a migration adding it
  later is read without another change. One optional column must never cost the
  account list — and the badge measures a live token anyway
  (`googleScopes.ts`); this was only ever its fallback.
- **A stub that answers every select with the whole fixture cannot find that.**
  The first harness did exactly that, so a request naming a column nobody has
  looked identical to one that did: it passed, the real project 400'd, and the
  accounts were still missing after a deploy. `scripts/accounts-come-back.mjs`
  now holds `google_accounts`' **real column list**, measured against the
  project, and rejects an unknown column with the 400 PostgREST sends. A fake
  server has to be able to refuse.
Measured in Chromium against the real bundle, localStorage cleared the way
sign-out clears it: three rows and an empty mirror → **all three restored**,
and the request trace shows the `scopes` select refused and the retry
succeeding. The control — the same fixture on the code before each fix —
returns `[]` both times: once because the rows were never read, once because
the read was rejected. No rows → nothing invented. A mirror entry plus the rows
→ the mirror's browser-minted id is the one kept. A 500 → nothing written.
A cache already holding the primary — the state the first pass shipped — is
cleaned on the next load, and the extra beside it keeps its local id and its
token. The control there returns the signed-in address in the list, which is
what the duplicate card on screen was.
- **A fixture only tests what the page can actually see.** That `dirty` case
  branched on a `MODE` variable inside `addInitScript`, which runs in the
  *page* — Node's scope is not there, so the branch threw, nothing was seeded
  and the case quietly passed by testing the empty-cache path twice. Anything
  a page-side callback needs has to be passed in as an argument.
`scripts/accounts-never-empty.mjs` lifts `saveAccountsToDB` out of the file: 6
assertions, including that the rest of `schedule_rules` survives and no token
ever reaches the mirror.
- **`scripts/select-columns-exist.mjs` checks every `.select()` in `src`
  against the columns the project really has** — 52 of them, 0 wrong now. The
  `scopes` mistake is invisible to TypeScript: the column name is a string and
  the table it names lives in another system. One round trip finds it; a type
  checker never will.

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

## Settings — Section → Page Mapping (one rail item = one page = one title)
`nav.ts` is the source (`NAV_GROUPS`, `SECTION_META`, `pageFor`). The section **ids** are
unchanged because the palette and the budget screen write them to
`settings-active-section`; `pageFor` maps an id that is drawn inside another page.
| Group | Section id | Title shown | Page body |
|---|---|---|---|
| Account | `profile` | Profile | `ProfileSection` |
| Account | `billing` | Billing | `BillingSection` |
| Account | `companies` | Data & privacy | `DataPrivacySection` (the one Export lives here) |
| Workspace | `accounts` | Accounts & companies | `AccountsAndCompaniesSection` |
| Workspace | `blocking` | Integrations | `IntegrationsSection`, then blocks **Calendar blocking** (`BlockingRulesSection`) and **Sync rules** (`SyncRulesSection`) |
| Workspace | `schedule` | Schedule | `ScheduleSection` |
| Workspace | `tasks` | Tasks | `TaskStatusesSection` |
| Life | `habits` | Habits | `HabitsSection` |
| Life | `finance` | Finance | `FinanceSection` |
| Life | `library` | Library | `LibrarySection` |
| Intelligence | `professor` | AI | blocks **Model and autonomy** (`ProfessorSection`), **Voice** (`AIVoiceSection`), **Behavioral OS** (`BehavioralSection`) |
| Intelligence | `automation` | Automation | `AutomationSection` |
| Preferences | `appearance` | Appearance | `AppearanceSection` |
| Preferences | `notifications` | Notifications | `NotificationsMatrixSection` |
| *(none)* | `behavioral` | — | drawn on the AI page; `pageFor('behavioral') === 'professor'` |

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

## Settings — 11A artboard primitives
`Settings.tsx` has a shared set of design primitives used by every artboard-accurate section:
`PILL_BASE`, `GhostPill`, `PillValue`, `DRow` (label+sub left / control hard-right),
`Segmented`, `pillSelectStyle`, `VisaBadge`. Prefer these over `FieldRow`/`inputStyle`
when bringing a section up to the artboards.

## Settings — the shell: a floating nav card, one rounded panel, one scroll
`Settings.tsx` draws two objects beside the app's own rail. Both start at the same
height (measured: 72px / 72px) and sit on the page's one ground.
- **The nav is a 276px card of folding groups.** Account · Workspace · Life ·
  Intelligence · Preferences, each a button with `aria-expanded`; its items sit one
  level in under a hairline guide, an icon (16px) and a 14px gap before the title.
  The active item is the white pill from the app's own spec, not a black one.
  **Folded groups persist** in `settings-groups-closed` (default: Preferences). A
  link into a folded group (`groupOf(activeSection)`) opens it, so a deep link never
  lands on a page whose menu entry is hidden.
- **Search is real.** It filters on title, description and `SEARCH_KEYWORDS` — words
  people look for that no title carries ("calendar" is a setting on three pages and
  a title on none). It was a `<span>` reading "Find a setting".
- **The panel's header stays and only its body scrolls**, inside the panel's own
  border: the root is sized to `innerHeight − its own top` (a `ResizeObserver`
  re-fits it when the module is shown again — Settings stays mounted, hidden), the
  panel is `overflow: hidden` with the scroller inside it. Measured: header top
  unchanged after scrolling 400px; `main` and the window do not scroll; the scroller's
  right edge is one border-width inside the panel's. `SettingsModule` lost its 60px
  bottom padding for exactly this reason — spare pixels make the page scroll.
- **Rows**: `FieldRow` / `DRow` are label + help left, control hard right (max 440px
  column, content-sized — a fixed 280 squeezed sections that put a sentence of help
  under a control into a tall sliver; measured on the AI page). `Block` is a titled
  group in a white rounded card; **`bare` for a section that draws its own boxes**, so
  there is no card inside a card. A section is moved onto the row system by using
  `FieldRow`, not by restyling itself.
- **Every edit saves itself, and says so once** — the header's `role="status"`:
  *All changes saved* / *Saving…* / *Saved on this device only*. The per-card Save
  buttons are gone; Habits never needed one (its store pushes its own writes).
  `syncedKey` is the whole settings object as the server last agreed with it — set on
  hydration and after each landed save — and a change is "differs from that". The old
  `profileHydrated` flag swallowed the **next edit** whenever the server's copy equalled
  the local one, because nothing re-ran to clear it. Profile then prefs are written
  **in sequence**: both read-modify-write `users.schedule_rules`, so side by side one
  would overwrite the other.
- **Nothing is drawn that is not wired.** The rail's hard-coded `4` badge on
  Integrations is gone (a number somebody typed), and *Export all data* on Data &
  privacy now runs the real export instead of waiting 1.2s and downloading nothing.
- **Measured here**: 14 pages, none overflowing horizontally; fold/unfold + persistence;
  search ("calendar" → Accounts, Integrations, Schedule); a `behavioral` deep link →
  the AI page with its three blocks and Intelligence opened; an edit → *Saving…* →
  two `POST /rest/v1/users` → *All changes saved*; text contrast of the new surfaces
  ≥ 5.3:1 in all four themes. **Not measured**: a phone width (the shell is a desktop
  layout), `ink-audit` / `settings-snapshot` (they need the Linux Chromium the
  harnesses hard-code), and the **failed**-save state against a refusing server.
- **Not yet moved onto the row system** (they render inside the panel as before):
  Accounts, Habits, Finance, Tasks, Automation, Notifications, Billing, Integrations,
  Appearance's own sub-layouts. Moving one is a change to that section only.

Profile fields and every other setting autosave through the effect above (1.2s
debounce → `saveProfileToDB`, then `savePrefsToDB`).

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

## Settings — where things live now
`Settings.tsx` (the old 5,626-line file) is the **shell** only: `Settings()`, the
page routing (`PageKey`, `SECTION_TO_PAGE`, `PAGE_META`) and the `Card` /
`SectionCard` wrappers. Everything else moved, with no change in what renders —
`scripts/settings-snapshot.mjs` fingerprints all 15 sections before and after and
they are byte-identical.
- `model.ts` — `AppSettings`, `CompanyRow`, `DEFAULTS`, `ls`/`lsSet`, the load/save
  pairs, and the AI config (`AIConfig`, `loadAIConfig`, `saveAIConfig`,
  `cleanKey`, `maskKey`, `misplacedAnthropicKey`). `Settings.tsx` re-exports the
  AI names because `professor.ts` and the assistant panel import them from there.
  **`onAIPush` is assigned through `setAIPushListener`** — an import cannot be
  assigned, and the Professor section re-subscribes to hear when a key reaches
  Postgres.
- `nav.ts` — `SECTION_IDS`, `SECTION_META`, `NAV_GROUPS`, `loadSectionOrder`.
- `ui.tsx` — `Toggle`, `FieldRow`, `GhostPill`, `PillValue`, `DRow` and the AI nav
  icon; `pillStyles.ts` holds the pill constants. They are separate files because
  a file that exports both components and constants breaks Fast Refresh (lint).
- `sections/` — one file per section (`Profile`, `Billing`, `Schedule`,
  `Companies`, `Accounts`, `Habits`, `TaskStatuses`, `Ai`, `Appearance`,
  `BlockingRules`, `Library`, `Behavioral`, `Finance` with `FinanceSecurity`,
  `CardPoints`, `ShoppingSettings`, `Notifications`, `Integrations`, `SyncRules`,
  `Automation`, `DataPrivacy`). A section imports `model`/`nav`/`ui`, never the
  shell and never another section's internals except where one embeds another
  (`Accounts` embeds `Companies`; `Finance` embeds its three parts).
- **A harness that asserts on Settings *source* uses `settingsSource()`**
  (`scripts/settings-source.mjs`) — the whole feature as one string — so it keeps
  meaning "the feature says this" wherever the code sits. Three did before the
  split; `ai-key-field-is-the-right-one` had to be re-anchored to the `AIConfig`
  interface because the concatenation has more than one `provider:`.

## The setup guide — eight steps, new signups only, one desk
`modules/wizard/`. A full-page "morning desk": a real photo (`public/wizard/desk.jpg`),
a laptop whose screen is a live miniature of the app (`scene/`), and one framed
panel that asks. Steps (`steps.ts`): 1 You · 2 Accounts and companies · 3 AI key ·
4 Rhythm · 5 Automation and alerts · 6 Habits and tasks · 7 Finance · 8 Done.
**4–7 are optional** and each has a skip.
- **Shown to a new signup only** (`wizardGate.ts`): the account's `created_at` is
  within `NEW_SIGNUP_DAYS` (3). `gateAnswer` is `open` / `done` / `established` —
  an account that already has companies or habits is established and never sees it.
  A missing `createdAt` is *not new*. There is **no replay**: Settings lost its
  buttons and `professor:openWizard` is gone. The done flag is two keys, local
  `bpa-wizard-done` and the shared pref `professor-wizard-done` (in `SHARED_KEYS`),
  so finishing on one device keeps it shut on the next. `suppressWizardHere()` is
  local only — the gate marks an old account done on this browser without telling
  the account.
- **Each step writes when it is left with Continue** (`persist.ts`, `saveStep`), and a
  **skipped step writes nothing** — the Done summary says Skipped. Closing halfway
  keeps what was answered. Finance stores a hash, never the password; the AI step
  makes one real one-token request (`lib/aiKeyCheck.ts`).
- **The model step uses Settings → AI's own field**: `AIConfig.claudeModel` (empty = the
  app's default `ASSISTANT_CLAUDE_MODEL`, so a default that moves moves for everyone who
  never chose), read through `claudeModelOf` / `activeClaudeModel()`. Main added that
  field independently while this was in review; the wizard writes `''` when the default
  is kept, and a model typed into Settings stays selectable here. **Not covered: the
  Telegram/Siri/price-watch edge functions** still use their own model; the step says so.
- **Admin test = a dry run.** Admin → *Test setup guide* raises
  `professor:testWizard`; `App.tsx` re-asks `amIAdmin()` and renders
  `<SetupWizard testMode />`. In test mode `saveStep(…, dry)` writes nothing, the
  OAuth button is disabled, the theme is put back and the done flag is never set,
  so it can be run again. A banner says so.
- Fonts are the app's (`--sb-font-num` Outfit, `--sb-font-ui` Instrument Sans); the
  only fixed warm tones are on the photo itself (scrim, top bar).
- **Design vs app, deliberately different:** the design shows Outlook/iCloud rows
  (the app connects Google only), a PIN lock (the app's lock is a password) and a
  Run/Alert pair per helper (the app has seven rule switches plus three alert chips).
- `scripts/wizard-signup-flow.mjs [5199]` — 82 assertions: the gate (opens for a new
  signup; shut for an old account, one with habits, the done flag and the retired
  replay event), all eight steps writing (company POST, key, schedule, rules,
  habit rows, lock hash, both flags), the skip path writing nothing, and the admin
  dry run — no server write, no setting key, flag unset, theme restored, a
  non-admin's event ignored, then the review findings below, a phone-width pass over all eight steps, and keyboard focus. Control: the `dry` guard removed from one saver fails
  exactly the two write assertions. `scripts/first-run-prompts.mjs` keeps what the
  old three-step harness measured besides the wizard: the Habits starter and the
  Todoist prompt.
- **A vacuous pass found on the way:** the gate itself marks a year-old admin done
  on that browser, so "the done flag is unset" passed or failed on the gate, not on
  test mode. The harness clears both keys before opening the test.

### What the independent review found, each now a harness claim
- **A key test answers for the key it was asked about.** The result used to land on
  whatever the box held when the request returned, so an edit mid-flight blessed an
  untested key. Control on the old code: fails.
- **Continue is held for a key under the wrong provider** (`sk-ant` under Groq) and for
  one under 8 characters — the misfiled-key bug from "Settings — the Model picker"
  above, which the first-run path had reintroduced.
- **429 and 5xx are "busy", never "that key did not work".** Groq's rate-limit body
  contains the word "model", and a test for that word read as "model not offered".
- **`saveCompaniesToDB` deletes whatever it is not handed.** The wizard passed only its
  own rows, so a company on the server and not in the draft was deleted — measured:
  `DELETE …?id=in.(srv-only)`. The second review caught that passing the whole *local* list is no safer — the browser can be behind the server — so `saveCompaniesToDB(rows, { remove })` now upserts only the wizard's rows and deletes exactly the ids it removed. An existing company
  keeps its calendar, people and active flag; only a company this wizard added can be
  removed again (`isNew`; the set of added ids lives in sessionStorage `bpa-wizard-added`, so it survives the OAuth reload). Back from Google, the gate keeps the guide open when its own resume note is present, because the companies it just wrote make the account look established.
- **No secrets in `bpa-wizard-resume`.** The OAuth round trip parks state in
  sessionStorage; the keys and the finance password are now left out, and the gate clears
  a note the wizard is not going to use. Test mode neither reads nor clears it.
- **Rhythm shows what it saves**: stored hours are held to the sliders' ranges, and quiet
  hours end no later than work begins.
- **Contrast** (`ink-audit` now opens all eight steps through the admin button): the top
  bar's nav ink on the photo, the selected provider card's caption, and the test banner's
  button (inherited ink, since `--sb-ink-1` is light in Glass).
- **Keyboard**: `all: unset` had removed the focus ring from about a dozen control
  classes — restored — and the dialog now traps Tab. The panel footer is sticky, so the
  main button stays on screen on a long step on a phone.
- `ui-render` and `ink-audit` seed `bpa-wizard-done`: their stub account is brand new, so
  without it the wizard covered every screen they measure.
- **Not measured here**: real Supabase / Google OAuth / a real signup, and Groq (the
  sandbox's proxy refuses it). Anthropic was probed for real: a bad key answers 401,
  which is the `rejected` path. The model ids are the ones in `modelInfo.ts`.

## Settings → AI — "Which model" sits under the key, and asks the provider
`sections/ModelPicker.tsx`, mounted by `ProfessorSection` after the key field (it needs the key). The provider pills still
choose a *provider* and nothing else; the model is a separate row, per provider (`groqModel`, `claudeModel`), so neither can
land in the other's field. What it does and why is in `assistant.md` ("The model is the person's choice…"). The old
`GROQ_MODELS` export (it still offered Mixtral, long retired, and nothing read it) is gone. `settings-snapshot.mjs` will
show the AI section changed — that is this row.


## Settings → Integrations — the hub
`sections/IntegrationHub.tsx` (presentational) + `lib/integrationMarks.tsx` (the apps' own
colours, kept out of `src/modules/` where a raw hex is a `ui-guard` failure). The platform's mark
is centred and seven apps sit round it. **Connected** (a linked Telegram chat; any token for
Siri and MCP) is in colour with a 3s beam travelling its line to the centre; **not connected**
and **not available yet** (Notion, Asana, Trello, Apple Notes) are the same mark under one
`grayscale(1)` filter with no beam. Nothing in it is a button — a control that reaches nothing
is not drawn — and each node carries `aria-label="Telegram, connected"`.
- The beam is the MagicUI `AnimatedBeam` idea rebuilt in SVG (`stroke-dasharray` on `pathLength=100`
  with an animated offset): the registry component is Tailwind + `cn`, which this app has neither
  of. `prefers-reduced-motion` draws the beams and stops them.
- Marks are simplified drawings, not official artwork.
- "Connected" for Siri and MCP is "a token exists" — the one thing both present. It does not mean
  either has been *used*; `last_used_at` is there if that should be the test.
`scripts/integration-hub.mjs [none|connected|reduced]` — 15 assertions per mode, measured as
computed `filter`, the dash offset sampled twice (1.67px → -27.5px) and the logo's centre against
the hub's.

## A switch that is on must look on — the knob is `--sb-accent-ink`
`Toggle` drew its knob `--sb-card` when on. On Sunlit's amber that was 1.49:1 against the track and on Glass's lilac
**1.06:1** — a pill with no visible knob, which does not read as a switch. The knob is the theme's `--sb-accent-ink` now
(the colour it already guarantees against its own accent): 12.0 / 4.5 / 6.9 / 6.5:1 across the four themes.
`scripts/switch-knob-visible.mjs` opens Settings → Library, turns it on and measures the composited colours. Also: the
Library section no longer prints a "126 books · 11 lists" line — statistics are not a setting.

## Settings batch — logos, account marks, section breaks, Tasks defaults
- **Company logo** (Companies): the mark is the control; when there is a logo a small ✕ sits on its top-right corner
  (`data-logo-remove`, `.sb-hit`) — no "Logo" caption, no "Remove" word. `company-logo-sticks.mjs` asserts the ✕'s geometry.
- **Account marks:** the circle on each connected account is `ProviderMark` (Google's multicolour G; Microsoft's four squares for
  an outlook / hotmail / live / msn / office365 address). Every account connects through Google today, so Google is the default;
  brand colours live in `lib/providerBrand.ts` (outside the hex rule). The intro paragraph on the page is gone.
- **Section breaks:** `SECTION_BREAK` in `settings/ui.tsx` is the line between *sections* (2px, ink-3 at 32%, 30px above) — items in
  a section keep the hairline. Billing, Appearance, Finance (×2), FinanceSecurity, CardPoints, Integrations, Habits and the Prayer
  block use it. A page of settings should read as groups.
- **Calendar blocking and Sync rules** are on **Schedule** (Workspace), each its own block; Integrations keeps Connected tools.
- **Tasks → Defaults** (`TaskPreferencesSection`, `lib/taskPrefs.ts`, three more shared pref keys): default view (Last used / Board /
  Matrix / List — a fixed default is where Tasks *opens*; switching in the page is for that visit only), hide completed (the same
  `task-command-config.hideCompleted` the page's own menu uses), default calendar (the final fallback of `resolveTaskCalendar`,
  after the task's and its company's — never over them), and the **productivity framework**, moved from Profile with the same
  `framework` setting and no new behaviour. `scripts/task-defaults.mjs`. Hide-completed has no "off brings it back" control yet.
