---
paths:
  - "supabase/**"
  - ".github/workflows/**"
  - "scripts/migrate.mjs"
---

# Edge functions, the bots, migrations and the deploy

Loaded when a file this rule's `paths` names is read or edited — it is not
in context on every turn, which is the whole point. The root `CLAUDE.md`
holds what is true everywhere; this holds what is true here.

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

## Bots — the key you typed is the key they use
The bots read `ANTHROPIC_API_KEY` from the function secrets and nothing else,
so typing a new key into **Settings → AI** fixed the web app and left the bot
presenting the revoked one. Two places holding one key, and no way to tell from
either screen that the other had drifted — which is the whole of why this took
four rounds to clear.
- **The key was already in Postgres.** `professor-ai-config` is one of
  `prefSync.ts`'s SHARED_KEYS, so Settings → AI already writes it to
  `users.schedule_rules.shared_prefs` — that is how it follows you to a second
  device. The bots were the only thing not looking at it.
- **`anthropicKeyFor(userId)`** in both bots reads that row — the user the
  caller has already resolved, and only that one — and falls back to
  `ANTHROPIC_API_KEY`, which still serves anyone who has never opened Settings.
  A read that fails logs and falls back; it never takes the bot down.
- Rotating is now one gesture: put the key in Settings → AI. No GitHub secret,
  no deploy. The refusal message says that first and the function secret
  second, because the first is the one you can do from your phone.
20 assertions across both bots, with the function lifted out of each file
rather than restated: the Settings key wins; exactly one row is read and it is
the caller's; empty / no prefs / no row / unparsable JSON all fall back; a
pasted key is trimmed; a thrown read falls back rather than propagating; and
no call site still passes the module constant.

## Bots — Telegram is a conversation, and it was answering one line at a time
A Telegram webhook is one HTTP request per message with nothing carried between
them, so `runAgent` was handed a single sentence: `messages` was literally
`[{ role: 'user', content: userMessage }]`. "Mark it done", "and the other
one", "what about tomorrow?", and every reply you send by tapping *Reply* on an
earlier message, arrived with nothing to resolve against.
- **The prompt already described the history it was never given.** It said, in
  so many words, *"History is ONLY for understanding references like 'that
  habit', 'the task I just added', 'mark it done'"* — a rule about a
  conversation that did not exist. Reading the file top to bottom is how that
  goes unnoticed: the instruction is right, the plumbing under it is absent.
- **`telegram_turns` (`20260023`) is the thread.** Per chat, the plain text of
  each side, the last 16 messages inside 24h and 12,000 characters, oldest
  first. The bot writes with the service role; a person may **read and delete**
  their own and nothing else — there is no insert or update policy at all, so
  nobody holding an anon key can put words in their own history or edit what
  was said. Verified as `authenticated` with the sequence deliberately granted,
  so the refusal is RLS's and not a missing grant.
- **Tool calls and results are deliberately not stored.** They are stale the
  moment they are written — a count from yesterday is not today's, which is the
  one thing the prompt forbids answering from — they are most of the tokens,
  and the API requires a `tool_use` block to be followed immediately by its
  `tool_result`, which a window truncated at 16 cannot promise.
- **Ordering is by `id`, never `created_at`.** Both rows of an exchange are
  written in one statement, so they share the transaction's `now()` — measured:
  same `created_at`, different ids. A timestamp cannot tell the question from
  its answer.
- **The exchange is stored as a pair, after the reply exists.** Writing the
  question first would leave a lone user turn behind any failure, and two user
  messages in a row is a 400 that takes the whole reply with it. `alternating()`
  is the belt to that braces: it opens on the user, merges a same-role run and
  drops a trailing user turn, so appending this message always alternates —
  checked on 400 random windows.
- **Telegram's own reply outranks recency.** `reply_to_message` names one
  specific message, and the one you are answering may be older than the window,
  so its text is quoted into the message itself as `↩ replying to: "…"` (a
  caption counts) rather than left to the thread. The prompt says what that
  marker means.
- **`/reset` puts a thread down**, and `/disconnect` takes the history with the
  link — otherwise what was said is handed to whoever connects that chat next.
- **A missing table is the old behaviour, not an outage.** If `20260023` has
  not run the read logs and returns `[]`, and the bot answers each message on
  its own exactly as before.
- **Siri still has no memory, deliberately untouched.** Its `messages` array is
  the same single-element one, and a Shortcut is a one-shot utterance rather
  than a thread; giving it this needs its own decision about what a "session"
  even is there.
`scripts/telegram-memory-check.mjs` — 37 assertions, every function **lifted out
of the real file** by regex and de-typed with `tsc` itself, since there is no
Deno on the machine to run the function.
- **The first assertion is that the file parses at all**, and it earned its
  place immediately: the prompt's `↩ replying to:` was first written in
  **backticks inside the system prompt's own template literal**, which closes
  it and turns the rest of the file into nonsense. Deno would have refused to
  load the function, the webhook would 500, and the bot would simply go quiet —
  there is nothing anywhere in the app that would have said why. `npm run
  build` cannot see it: no edge function is in the Vite build.

## Bots — the deploy asserts the key, and can never blank one
`deploy-functions.yml` re-asserted `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
on every run and **not** `ANTHROPIC_API_KEY`, which the Telegram bot and Siri
present to Anthropic. So that was the one secret set purely by hand: rotating
the key left it holding the revoked value while every other secret stayed
correct, and the bot answered "my key was refused" with nothing else looking
wrong. It is in the list now — one home for it, re-asserted on every deploy.
- **It is not the key that came out of the bundle.** That was
  `VITE_ANTHROPIC_API_KEY`, read by Vite at build time and inlined into a
  JavaScript file served on a public Pages site. This one is handed to the
  Supabase CLI at deploy time and never reaches a browser. Different variable,
  different consumer.
- **A missing GitHub secret must never wipe a working one**, and the old step
  did exactly that. `supabase secrets set X=` sets X to the empty string, and
  GitHub substitutes an empty string for a secret that does not exist — so the
  inline `${{ secrets.X }}` form ran `secrets set GOOGLE_CLIENT_ID=
  GOOGLE_CLIENT_SECRET=` whenever either was absent, blanking a live
  credential silently. Adding the Anthropic key to that form would have armed
  the same trap on the one key the bots cannot work without. Each key is now
  named **only when the run actually has it**, values arrive through `env`
  rather than being pasted into the script, and the run log prints names only.
  That is the shape `supabase-deploy.yml` already used for the Google pair.
- The workflow's `paths` filter now includes the workflow itself: changing
  which secrets are asserted has to be able to reach the project without
  waiting for an unrelated change to a function.
`scripts/deploy-secrets-check.sh` lifts the step **out of the YAML** — no
second copy to drift — and runs it against a stub `supabase`: all three
asserted when present; a missing key never sent as empty (either the Anthropic
one or the Google pair); nothing to assert calls the CLI not at all; a value
carrying a space, a `$` and a `*` survives intact; no value is echoed to the
log. The control is the old step with a secret absent, which really does emit
`GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET=`.

## Bots — a 401 is not an empty wallet, and the message has to name the key
"My API ran out of credit, I paid again, and Telegram still gives me 401."
Those are two different failures and the bot was describing neither.
- **401 is `authentication_error`** — the key is missing, malformed, **revoked
  or deleted**. Credit has nothing to do with it, so topping up can never clear
  one; a key that was replaced after the account lapsed will 401 for ever. The
  old message said "rotated or revoked" and was right, and then sent you to
  Settings → AI without saying that the key it had just presented *was* the one
  in Settings. Two places hold a key, only one is ever in play, and the sentence
  named neither — so the advice read as "do the thing you have already done".
  It now names the one that was refused (`keyFrom`, threaded out of
  `anthropicKeyFor`), and says in so many words that adding credit will not fix
  it. When the fallback is in play it says the function secret is being used
  **and that nothing is saved under Settings → AI**, which is the fact that
  tells you where to put the key.
- **Out of credit is a 400**, and it fell through to *"Sorry, I could not reach
  the AI service (400)"* — which points at the network, for a billing problem.
  Anthropic's own body names it ("Your credit balance is too low…"), so the 400
  branch **quotes that message** rather than pattern-matching text we would have
  to guess at: a body we cannot parse still says the request was refused instead
  of blaming the connection.
- `anthropicKeyFor` returns `{ key, from }` in both bots. The precedence is
  unchanged and deliberate (Settings beats the secret) — this only makes it
  legible from the message.
`scripts/bot-key-errors-say-which.mjs` lifts the branch out of **each** real
file and de-types it with `tsc`, since there is no Deno here: 18 assertions,
the first being that each file still parses. Control, on the code before the
fix: **10 failing**, among them the out-of-credit 400 answered with "could not
reach the AI service" — the sentence that sent this question to the network.

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

## Bots — Telegram and Siri are the app's assistant too, and they ask first
`_shared/assistantGate.ts` (the consent policy — **the app's `src/lib/assistantPolicy.ts` is a re-export of it**),
`_shared/appGuide.ts` (the guide — `src/lib/appGuide.ts` re-exports it), `_shared/botKit.ts` (the gate's plumbing and
the bots' new tools), `20260040_assistant_pending.sql`. Before this the bots did a reply or a ledger entry the moment
the model asked, and had no Library, no habit create/edit/delete, no "what needs me" and no app guide.
- **Every tool call goes through `gateCall` before `dispatchTool`** (both bots, asserted by a test that counts the call
  sites). An outward / destructive / money act is **parked** in `assistant_pending_actions` and *not run*; the model is
  told it is waiting and not to claim it is done. `reply_email` joined the outward set — the bots' name for the app's
  `reply_to_email`; a new name belongs in the one file and is gated in all three assistants.
- **The question is built from the call's real arguments**, by us, never from the model's description of it: Telegram
  sends a card with ✅ Approve / Not now (`callback_data` `ap:<uuid>` / `no:<uuid>`, 39 bytes of 64); Siri speaks the
  title and arguments and "Say yes to do it, or no to cancel", replacing whatever the model said.
- **Approve runs it once.** `takeAction` is `delete … returning` filtered by id, user, channel, chat (Telegram) and
  `expires_at > now()` (10 minutes) — a second tap, a retried webhook, another person, another chat or a stale button
  finds nothing and does nothing. The table has RLS on and **no policy**: only the service role touches it.
- **Fail closed.** If the act cannot be parked (migration not run, database down) it is *not done* and the model is
  told NOT DONE. Until `20260040` runs, a bot reply or ledger entry is refused, not allowed.
- **Siri has no buttons, so a bare yes/no answers the latest open question.** `parseYesNo` accepts only 1–4 words that
  are a plain yes/no (English and Arabic); "yes, send it to Ahmed instead" is a new request and goes to the agent, the
  old question just expires. One question open at a time (a new one replaces it; two in one turn → the second is
  refused, reserved synchronously because tool calls run in parallel). Apostrophes are dropped before matching
  (`don't` → `dont`) — the first draft turned it into `don t` and could not cancel.
- **New bot tools** (both bots): `app_guide`, `mail_needs`, `create_habit` / `update_habit` / `delete_habit`, and
  `library_overview/find_books/add_book/update_book/log_reading/add_quote/delete_book`. All query `user_id = <the
  resolved user>` with the service role, so scope is enforced in the query, not by RLS. The Library obeys both
  switches the app does (`has_module` and the person's synced `library-settings`) and **fails off** if it cannot tell.
  `library_log_reading` keeps the app's rules (new ground only, 1–1440 min, no future day, page within the book,
  first sitting starts the book, never finishes it); `library_update_book` stamps/clears dates as the app does.
- **Deliberately not in the bots:** settings tools, cover/online lookup when adding a book (a wrong cover is worse than
  none — the bot says nothing was fetched), Notes/Planning/Booking, company-hiding in `mail_needs` (a client-side
  preference). The app's own Library/habit tools are still separate, store-based implementations; only the policy and
  the guide are single-sourced.
`scripts/bots-as-assistant.mjs` (140+ assertions): a fake database that can refuse, **the bots' real approval handler and
real `Deno.serve` block lifted out of the files**. Controls: remove `reply_email` from the gate → 2 fail; drop the
expiry check → "an expired act cannot be approved" fails; drop the chat check → 2 fail. **Not exercised here: a live
Telegram button tap, a live Siri Shortcut, or the Anthropic model choosing the tool** — those need the deployed bots.

## `assistant-chat` — the web assistant's model call
Not a bot: the browser's own assistant, moved server-side so an answer survives a frozen page. Deployed by
`deploy-functions.yml` **with the JWT gateway on** (its caller is always a signed-in browser spending that person's
key). `_shared/assistantChat.ts` is pure and dependency-injected so Node tests it; `index.ts` only authenticates,
checks the conversation is the caller's, resolves the key and backs `ChatDb` with Supabase. Full behaviour and tests:
`assistant.md` ("The conversation lives on the server").

