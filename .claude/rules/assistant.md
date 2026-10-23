---
paths:
  - "src/modules/assistant/**"
  - "src/lib/assistantTools.ts"
  - "src/lib/chatAttachments.ts"
  - "src/lib/assistantPersona.ts"
  - "src/lib/assistantName.ts"
  - "src/lib/assistantBridge.ts"
  - "src/lib/callName.ts"
  - "src/lib/speech.ts"
  - "supabase/functions/_shared/persona.ts"
---

# The assistant panel

Loaded when a file this rule's `paths` names is read or edited — it is not
in context on every turn, which is the whole point. The root `CLAUDE.md`
holds what is true everywhere; this holds what is true here.

## The assistant can be put aside
An arrow in the panel header slides it out and leaves a tab on the right edge;
the tab, or the floating button, brings it back. `minimised` lives in **App**
beside `open`, because the floating button has to return to its "open me" state
while it is aside. The panel is **slid out, never unmounted** — the thread, a
half-typed message, staged attachments and an answer still streaming all carry
on behind it, and the tab shows a pulsing dot while one is arriving. Closing is
still closing: it clears the conversation.

## The assistant is a floating window, and stepping away from it collapses it
This replaces the side panel with an edge tab that "The assistant can be put aside" (above)
describes; that section is left as it was, as the history it is.

`AssistantPanel` draws **a card above the button**, not a column down the side
(it used to be `top: 0; bottom: 0`, 390px wide, over whatever was under it). Four
rules hold it together, measured in `scripts/assistant-window.mjs` (50 assertions,
real pointer events, with a control for the two that are subtle):
- **Collapse is not close.** `open` and `minimised` are still App state, and the
  window is *faded and dropped, never unmounted* (`data-shown="false"`: opacity 0,
  `visibility: hidden`, `pointer-events: none`) — the thread, a half-typed draft and
  an answer still streaming all carry on. The chevron in the header, **a pointer-down
  anywhere else on any screen**, Escape from inside it, and pressing the button while
  it is open all collapse it. **The ✕ closes, and now actually forgets** — its tooltip
  has always said "Close, and forget the conversation" and on `main` it kept the thread,
  because `onClose` only flipped `open`. It calls `clearConversation()` first.
- **One listener decides, with a 400ms guard.** A touch screen replays a tap as a
  synthetic mousedown a moment after `pointerup`, so whatever *opened* the window (the
  button, the search box, the name listener) would collapse it in the same gesture.
  `openedAt` is stamped when `shown` turns true, and the callback is read through a
  ref — otherwise every re-render of the app re-armed the guard and "click anywhere
  else" would intermittently do nothing for 400ms. Control: with the guard line
  removed, the 400ms assertion is the one that fails. The button is excluded by
  `[data-assistant-fab]`, so pressing it collapses once and does not collapse-then-reopen.
- **The width is the person's, kept per device, and never overwritten by a screen too
  small for it.** The right edge is the fixed one, so the handle is the window's *left*
  edge and dragging it left widens. `assistantWindow.ts`: 340–860, default 420, bent to
  `viewport − gaps` only **when drawn** (`clampWidth(chosenW, vw)`); what is stored
  (`assistant-window-width`) is only ever a width the person set — pointer-up, the arrow
  keys (←widens, →narrows, Shift = 80, Home resets) or a double-click. The first version
  clamped the stored value on load, so opening the app once on a phone turned a chosen
  600 into 366 for ever; control: that line puts the 366 back. Per device on purpose —
  it is not a prefSync key, because a laptop and a phone have nothing to say to each
  other about how much of the screen a chat deserves.
- **Opaque, and every edge drawn.** `--sb-overlay` (not `--sb-page`) with a border all
  round and `--sb-r-card`: it is drawn over the page, and a wash that is legible only
  when a blur lands is the reason that token exists. Height is `min(640px, 100dvh −
  200px)`, so there is always page above it.

## The button is a person, not a tile
`.ai-fab` in `index.css`, `AssistantToggle`, `AssistantAvatar bare`. 72px — the 48px it
was, one and a half times — with **no fill, border or box-shadow**: the transparent
cut-out `public/assistant-avatar-cutout.png` (384px, RGBA, head and shoulders ending
in a superellipse bowl) and a `drop-shadow` that follows its outline, since a
`box-shadow` would shadow a rectangle that is not there.
- **It was a dark 48px button holding a cream 44px tile holding the portrait**, which
  is the "border" the portrait seemed to have. The cut-out removes both rather than
  restyling them.
- **Made from the flat cream background by colour distance, then decontaminated.** Alpha
  from distance to (246,234,211) with a smoothstep, `(I − (1−α)·B)/α` so a soft hair edge
  carries no cream halo on a dark ground, the matte pulled in 1px, and **interior
  pinholes filled only inside the face box** — filling everywhere also solidified the
  real gaps between strands of hair as cream patches, visible on a dark page. Previewed
  on light, dark and blue grounds, not just the one it will mostly be seen on.
- **`--ai-fab-clear: 104px`** (24 margin + 72 button + a gap) is what a footer that sits
  in the bottom-right corner pads by; four of them (PDF reader, Add book, Reflection,
  the event composer) used literal 44–56px for the old 48px button and now read the token.
- Lift is gated on `hover: hover`, and `prefers-reduced-motion` stills all of it.
- **A collapsed window with an answer on its way shows a pulse on the button**, which
  replaced the edge tab — the button is the only way back, so it has to show a reply
  arriving.

## The header says which model it is, and the badge reads the request's own constant
`modelInfo.ts` (`ASSISTANT_CLAUDE_MODEL`, `describeModel`), `ModelBadge.tsx`. The line
under the name used to be "Anthropic · Claude" — true of every Claude model and so of
none in particular — and the request named `claude-sonnet-4-6` in two other files, so
a label and a call could drift apart with nothing failing. It is now a mark and a
version (`Sonnet 4.6`), and **the id is declared once**: the assistant's request and
`professor.ts` take it from `modelInfo.ts`, and the badge shows what `describeModel`
makes of the same string.
- **The claim is measured, not read**: `scripts/model-badge.mjs` intercepts the
  request and asserts the id on the badge (`data-model-id`) equals the `model` that was
  sent. Control: make the request send `claude-haiku-4-5` behind the badge's back and
  that assertion — and only that one — fails.
- **A date is never a minor version.** `claude-sonnet-4-5-20250929` is 4.5; the older
  order `claude-3-5-sonnet-20241022` is 3.5. An id it cannot read is shown **as itself**:
  an invented name is a wrong answer. On Groq the context window (`32768`) and words like
  `versatile` are dropped (`llama-3.3-70b-versatile` → `Llama 3.3 70B`), and a size such as
  `8x7B` is not a version.
- **The marks are drawn, in theme tokens** (`--sb-accent-deep` for the Claude burst,
  `--sb-ink-2` for Groq), never a brand hex, so they read on all four grounds. The other
  Claude callers (the Library's, the day planner's, the image extractor's) keep their own
  literal on purpose: they are not the assistant, and the badge says nothing about them.

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

## The assistant panel — answers are Markdown, drawn as Markdown
`modules/assistant/Markdown.tsx` (react-markdown + remark-gfm). The bubble used
to print the model's reply with `white-space: pre-wrap`, so a day came back as
literal `###`, `**bold**` and `| Time | Event |` rows.
- **No raw HTML.** No `rehype-raw`, so a tag in a reply is text; links and images
  go through react-markdown's own URL filter. A model's output is a stranger's
  input as far as the page is concerned.
- **Every colour is a token**, so the four themes need nothing. The panel is
  ~390px: a table scrolls sideways **inside its own box** (`.ai-md-table`) rather
  than stretching the bubble, and headings step down to body size.
- **A global reset strips list markers** — bullets and numbers were missing until
  `list-style` was set explicitly. Found by looking at a screenshot, not by the
  DOM assertions, which all passed.
- **The model is told how to write for it** (`FORMAT_RULES`, shared by both
  tones): answer first, a table only for 3+ items with 2+ attributes and at most
  4 short columns, no `---` or `#`/`##`, an image only from a URL a tool returned.
  Your own message stays plain text. Telegram has its own prompt and a narrower
  dialect — legacy Markdown has no tables — and is a separate step.
- **A habit's picture is drawn by the app, not carried by the model.** The photo
  is a ~60KB data URL: through the model it costs the tokens and cannot be
  copied back out reliably. `list_habits` returns `picture: "habit:<id>"` (a
  dozen characters) and the model writes `![Water](habit:<id>)`; `Markdown.tsx`
  reads the real image from `useHabitsStore`, or the habit's emoji when there is
  none. Before this the tool returned only `emoji`, so the model could not have
  known a photo existed. `habit:` is allowed through `urlTransform`; every other
  URL keeps react-markdown's default filter. **Backticks inside `FORMAT_RULES`
  close the template literal** — the same trap the Telegram prompt hit.
- **A tool chip has a state, and nothing spins after the answer.** It was a
  sentence with a wrench on `animation: spin infinite` and nothing ever told it
  the tool had come back, so it went on looking busy under a finished answer.
  `DisplayMessage.tool` + `state` (`running` → `done` | `failed`); `settleChip`
  is called when each call returns (Claude and Groq loops, keyed by the call's
  own id), and the turn's `finally` settles anything still `running` as failed,
  so an error, a refused key or an abort cannot leave one spinning. Labels are
  what it was doing (`toolLabel`: "Reading habits…" → "Read habits"), not the
  tool's name. Measured: 2 spinning chips and 7 live animations while running;
  **0 animations on the whole page** once settled. `prefers-reduced-motion`
  stops the sweep and slows the ring.
Measured in Chromium at the panel's width: no raw `###`/`|---` left, one real
table that scrolls inside its box with no page overflow, an inert `<script>`, a
broken image falling back to a link.

## The assistant has a face, a name, and an ear
`AssistantAvatar.tsx`, `lib/assistantPersona.ts` + `assistantName.ts`, `lib/callName.ts`, `lib/speech.ts`,
`lib/assistantBridge.ts`, `NameListener.tsx`, `_shared/persona.ts`. The brain icon is gone from the
floating button, the panel header, every reply, the tab it leaves when put aside and the Settings → AI
rail entry; one component draws all of them, from `public/assistant-avatar.png`.
- **The picture is a person, with a drawn stand-in.** Until the file exists (or if it fails to load) an
  SVG portrait is shown, never an empty box. **`public/assistant-avatar.png` is the chosen portrait**
  (384px, cropped to the head and shoulders so the face reads in the 28px header circle); the drawing
  only shows if that file fails to load.
- **The name is the person's** (Settings → AI, or asked once on first use — "What would you like to call
  me?", with ideas and *Not now*, never asked twice). It is a shared pref, `assistant-persona`
  (`{name, listen, speak, lang, asked}`), **not** a field of `professor-ai-config`: that holds credentials,
  and a rename must never be able to trip the key-sync rules. Until named, it is "Your assistant".
- **A name goes into prompts and a matcher, so it is cleaned on the way in** (`cleanName`): letters of any
  script, digits, spaces, hyphen, apostrophe, full stop; 24 characters. The bots' copy
  (`_shared/persona.ts`) is run against it over 17 awkward inputs (`assistant-name-agrees.mjs`), including a
  name with a newline and an instruction in it.
- **Being called** (`callName.ts`, pure, 19 assertions in `scripts/call-name.mjs`). Typed in the search
  box an address must be *marked* — a comma/colon after it, a greeting before it, or the name alone — so
  "Theo meeting notes" stays a search for notes; a trailing ", Beau" needs its comma; a name mid-sentence is
  never an address. Spoken there is no punctuation, so the name at the start is enough, and a speech engine's
  slip is allowed **only behind a greeting** and never for a common word ("then" is one edit from "Theo").
  Folds case, accents and Arabic letter variants (أ إ آ → ا, ى → ي, ة → ه).
- **The bridge** (`askAssistant` / `takePendingAsk`) parks the request so the search box and the listener
  can reach a panel that is closed or not yet mounted; App opens it, the panel takes it when it is free.
- **iPhone and iPad, honestly.** A web page cannot listen with the screen locked or the tab hidden, so
  there are three layers and Settings says so: **type or say "Name, …"** anywhere; **tap the mic** (one
  phrase; the answer is spoken back if the question was spoken); **"Listen for its name while the app is
  open"** (opt-in, foreground only, with a visible pill the whole time); and the **Siri Shortcut named after
  the assistant**, which is the only hands-free route with the app closed ("Hey Siri, Beau").
  `speech.ts` is written around Safari: a session ends by itself, so continuous listening is a restart loop
  with a back-off (400 ms doubling to 5 s, six failures and it stops and says so); it stops the moment the
  page is hidden and comes back when visible; **it never restarts after a refusal** (`not-allowed` is
  named, `service-not-allowed` — Safari declining to start without a tap — turns the pill into "Tap to
  listen for Beau"); speaking is unlocked from a tap (`unlockSpeech`); **it ignores speech heard while the
  assistant is speaking and for 700 ms after** so it does not answer itself; the panel's mic and the
  listener share one microphone, the listener waiting and then taking it back.
- **A session we ended must not report later.** Aborting a recogniser fires its `end` *after* a newer
  session has begun, which switched the "listening" indicator off while it was on (StrictMode's double effect
  found it). `stop()` detaches the handlers first.
- **Chromium has a native `SpeechRecognition`**, and the code prefers the unprefixed name, so a test that
  fakes only `webkitSpeechRecognition` is not testing the fake — the first run "started" a real session in
  headless Chromium and the fake saw nothing.
- **Where the audio goes is the platform's**, and the Settings text says so before the switch is on (Apple's
  speech service in Safari, Google's in Chrome). The **speech language** is a choice with "same as this
  browser" as the default; a junk tag falls back to English.
- **Telegram and Siri use the same name** (`assistantNameFor` reads the prefs row of the user already
  resolved, once per message, never throws; absent → "Professor AI" as before), and the Settings → Siri block
  names the Shortcut after it. The bots' own prompts say who they are.
`scripts/assistant-voice.mjs` — 30 assertions with a fake `SpeechRecognition`, a fake `speechSynthesis` and
Claude faked as a **stream**: the search box (offers it first, sends only what follows the name, unmarked is a
search), the mic (interim words, the name stripped, the answer spoken once with the markup removed, bare name
→ listens again, blocked mic named), listening (a mention does nothing, "hey Beau" asks it, its own voice
ignored, hidden → stops / visible → returns, the mic and the listener sharing), iPhone's tap, a refusal not
retried, no recogniser → no button and no pill, first use. The Today screen asks Claude things of its own, so
the harness counts only requests carrying `tools`. The ink audit has the first-use and named panels.

## The message box gives its height back, and is never disabled
`AssistantPanel` composer. The textarea was sized by an `onInput` handler, so clearing it
after Send (a state change — no input event) left a four-line height under an empty box,
with the icons dropped to its bottom edge: an 81px box for a one-line placeholder. Height
is a `useLayoutEffect` on the text now, and one line is 32px — the send button's height —
so the clip, mic, text and button share a centre. It is **no longer `disabled` while an
answer is arriving** (that also dropped focus after every reply): you can write the next
message, Enter waits (`sendMessage` refuses while thinking). `assistant-window.mjs` §5;
control with the old file: 20px / 81px / disabled / focus lost — 4 of 4 fail.

## The assistant works in every module, inside the account's scope, and asks before it matters
`lib/assistantPolicy.ts` (consent), `appGuide.ts` (knowledge), `libraryTools.ts`, `settingsTools.ts`, and
more in `assistantTools.ts`. "Scope" is already the signed-in person's own data (their tokens, their rows);
this is what it may do *with* it, and how it knows the app.
- **Three kinds of act wait for a click, enforced in code** — `runTool` in `AssistantPanel` calls
  `approvalFor(name, input)` between the model's request and the tool, shows an **Approval needed** card
  with the call's real arguments (long ones clipped, `confirm` and blanks dropped), and runs only on
  *Approve*. **outward** (send, reply, RSVP, changing an event that has guests), **destructive** (any tool
  named `delete_*` / `remove_*` / `*_delete_*`) and **money** (writes to the ledger). A refusal is handed back
  as `DECLINED`, which tells the model not to retry or find another way. Never a line in the prompt alone.
  Everything else — reading, ordinary edits of your own things, archive, logging — is done directly.
- **A model can say `confirm: true` for itself, so the person's click is what counts**: the card drops that
  key. `update_calendar_event` on an event with other guests refuses (`needs_confirmation`) until called again
  with `confirm_notify_guests: true`, and *that* call is outward — it can never tell guests as a side effect.
- **The hint line under the composer is gone** (it appeared and disappeared with focus). Pressing a button in
  that area blurred the box, the line unmounted, and the buttons moved before the click landed — the
  Approve button lost its click to it. The shortcuts are the box's `title`. Same trap as the shelf panel.
- **`app_guide` is what it answers "how do I…" from**, and the prompt says to call it and not invent.
  `assistant-knows-the-app.mjs` reads the *source* — the rail in `App.tsx`, the Settings sections, the Library
  views, the Finance screens — and fails if the guide names something the app does not have or omits one it does.
- **Library tools use names, not ids** (`library_*`): a book is found by title, an ambiguous or unknown one is
  refused with what matched, adding looks the book up as strictly as the Add panel (a wrong cover is worse than
  none), finishing/starting dates itself, progress is `progressOf`/`pagesCovered`, switched off or unmigrated
  answers in words. **Habits** can now be made, changed, paused and deleted by name.
- **Settings are a closed list of four** (the assistant's name, reading answers aloud, the Library shown, the
  quote of the day), changed through the same functions Settings calls. The AI key, tokens, billing, accounts,
  privacy, automation and the **theme** are not in it: the theme lives in three places the Settings screen keeps
  in step, and changing one from outside would be put back by the next load. It says where to do it instead.
- Not covered: Telegram and Siri have their own server-side tools (`supabase/functions`) and are a separate
  step; there is no tool, and no guide entry, for Notes/Planning (booking is one line under Calendar) yet — the prompt
  tells the assistant to say it is not sure rather than guess.
Tests: `assistant-approval` (19), `assistant-library` (23), `assistant-calendar-habits` (19),
`assistant-knows-the-app` (26); `assistant-window` and `mail-unified` re-run unchanged.

## Telegram and Siri use the same policy
The consent policy (`approvalFor`, `DECLINED`) now lives in `supabase/functions/_shared/assistantGate.ts` and the guide in `_shared/appGuide.ts`; `src/lib/assistantPolicy.ts` and `src/lib/appGuide.ts` re-export them, so the panel, the Telegram bot and Siri gate the same acts and answer from the same text. How the bots park and approve an act is in `server.md` ("Telegram and Siri are the app's assistant too").

## The conversation lives on the server, and the answer is written there
`20260042/43` (tables), `functions/assistant-chat` + `_shared/assistantChat.ts` (the model call),
`lib/assistantChatView.ts` (pure rules) + `assistantChatApi.ts` (Supabase calls), and the block in `AssistantPanel`
headed "The conversation on the server". It used to be React state only, so iPad Safari reloading a dimmed tab lost
the thread, and the browser's own request to Anthropic died with the page.
- **The server is the source of truth.** `assistant_conversations` / `assistant_messages`: plain text per message, a
  `status` (`streaming`|`complete`|`error`), tool chips as `role = 'tool'` rows, attachments as name+kind only. Order by
  `id`, never `created_at`. `client_id` makes a retried insert one row. The address carries `?c=<uuid>`; with none, the
  newest live conversation under 24h old is adopted (that is how a second device finds the thread). ✕ **archives**
  (`archived_at`), it does not delete.
- **One model step per invocation of `assistant-chat`**, answered 202 at once, finished in `EdgeRuntime.waitUntil`, so
  it carries on when the page is gone. It writes the answer into one `streaming` row (every ~700ms), then `complete`.
  The page supplies the **system prompt, tool list, model and key** because it owns them; the key falls back to the one
  saved under Settings → AI (`shared_prefs`), then `ANTHROPIC_API_KEY`. Anthropic streams (SSE); Groq is one reply.
  Deployed with the gateway's JWT check ON, and it checks the conversation is the caller's.
- **Tools still run in the browser** (they read/write the app's stores and wait on the approval card). The function
  parks each call as a `running` tool row and stops; **the page that claims it runs it** (a conditional update is the
  claim, so two open devices cannot both run `delete_task`; a claim older than 2 minutes, or this device's own after a
  reload, may be retaken; a heartbeat keeps it alive under an approval card), writes `tool_result`, and any page that
  sees every tool of the step back asks for the next step (`mode: 'continue'`). The in-flight turn's exact provider
  messages sit in `conversations.turn` and are cleared when the turn ends. A tool only runs on a page that is visible.
- **The lock is an index**: one `streaming` row per conversation, so a double Send or two devices both continuing get
  a 23505 → "busy", not two answers. A streaming row untouched for ~100s (`STALE_ANSWER_MS`) is **interrupted** on
  screen and marked `error` on the server; the function sweeps the same on its next step.
- **Coming back**: `visibilitychange`, `pageshow` (bfcache restore), `online`, `focus` refetch (a trailing refresh —
  a 1s debounce that *dropped* the later event lost a message); while busy a 2.5s poll backs up Realtime, which does
  not survive a dimmed iPad. A half-typed message is kept per device (`assistant-draft`). Loading shows "Still
  reconnecting…" after 6s.
- **The old in-browser loop remains** for a message with a file (the bytes are not sent through the function), and when
  the function or tables are unavailable (404 → `serverMode = 'no'` for that page's life, the user row it wrote is
  deleted). Those turns are written to the thread afterwards (`persistBubbles`) so they still survive a reload — just
  not mid-flight. The browser path is also handed the thread's plain text so it remembers.
- **Known limits**: the stale-answer test compares the device clock with the server's `updated_at` (a clock minutes
  fast would call live answers interrupted); a turn whose tool needs a browser stalls until a device is in front of
  the person; Realtime was not exercised (the stand-in has no websocket) — the poll is what the harness proves.
Tests: `assistant-conversations-sql.sh <socket-dir> [port]` (60 assertions, throwaway Postgres 16; needs a non-root user
to run the server; cross-user update/delete counts have no RLS-off control of their own), `assistant-chat-server.mjs`
(56: the real `_shared/assistantChat.ts` transpiled, a fake DB that enforces the lock and a fake model that can refuse;
control: lock removed → both requests call the model; also typechecks `index.ts` strictly against stub Deno types),
`assistant-chat-view.mjs` (33), `assistant-persists.mjs` (a stateful stand-in project whose function writes from Node
on a timer: page killed mid-answer then reopened, second device, bfcache, interrupted answer, drafts, tool run once
across two devices, approval card across a reload, 404 fallback, file stays in the browser, ✕ archives),
`auth-survives-dim.mjs` (12). **Not exercised: the real Deno function, a real Anthropic/Groq stream, Realtime, a real iPad.**

## The model is the person's choice, and one that stops working is replaced
`lib/modelCatalog.ts`, `settings/sections/ModelPicker.tsx`, `claudeModel` in `AIConfig`, `ModelBadge`. The Groq id was a
hard-coded constant, so when Groq answered *"The model `llama-3.3-70b-versatile` does not exist or you do not have access
to it"* there was nothing to do but wait for a developer.
- **Settings → AI → "Which model"** is a combo box fed by the provider's own model list asked with the person's key
  (`GET /models`; Groq's speech, guard and TTS models are filtered out), and it takes any typed id. On Groq the chosen
  model is also **tried with one token** — "listed" is not "allowed", and that gap is the report. A model that fails is
  named in the provider's words with a one-click "Use <best the key can use> instead". Claude's is not tried (that would
  be a paid request per keystroke); an empty Claude box means "the app's default" so a default that moves moves for
  everyone who never chose. `claudeModelOf(cfg)` is the one place that reads it; the assistant, the panel header and
  `professor.ts` all do.
- **Self-heal on send** (`ensureWorkingGroqModel`, in `sendMessage` before both the server and the browser path): one probe
  per `key|model` per page session. Only a definite *"that model is not available"* (404, or the provider's words) changes
  anything — offline, a bad key and a rate limit leave the choice alone, and a billing refusal is **not** a missing model
  (`isBillingMessage`). It tries a few candidates, best first (`GROQ_PREFERENCE`, then whatever else the key has), saves the
  working one, and `notify`s what it switched from and where to change it.
- **Three failures, three sentences** (the panel and the function's `friendlyError`): a refused key, an account out of credit
  or past its billing date ("choose another provider or model in Settings → AI"), a model the key cannot use.
- **The header shows the model in use**, redrawn when Settings saves (`professor:aiConfigChanged`), and a long id is cut
  with an ellipsis (the label box, `minWidth: 0` all the way up the header) with the whole id as the tooltip.
  `describeModel` drops a publisher prefix and knows initialisms: `openai/gpt-oss-120b` is "GPT OSS 120B", not
  "Openai/gpt Oss 120B".
- **Not covered**: the Telegram bot and Siri choose their own models server-side and do not read this setting.
Tests: `assistant-models.mjs` (31, the real catalog against a provider that refuses; offline / bad key / rate limit leave the
choice alone), `assistant-model-choice.mjs` (browser: the exact error in the report, the picker, the heal, billing, the
ellipsis measured against the header's buttons, Settings→header with no reload, Claude's choice reaching the request).

## The usage counter sits beside the model name, and tokens are exact while money is not
`lib/aiUsage.ts` (pure), `ModelBadge` (`data-usage-counter`), the header block in `AssistantPanel`, `20260044_assistant_usage.sql`,
`MonthUsageRow` / `PriceRow` in `settings/sections/ModelPicker.tsx`. "I need the counter of tokens or used amount reflected
beside the model during usage."
- **Tokens are what the provider reported** — Anthropic in `message_start` (input, cache) and the *running total* in
  `message_delta` (output), Groq in `usage` — kept as `assistant_messages.usage` on the answer that request produced
  (`{input, output, cacheRead, cacheWrite, model, provider}`). A conversation's figure is a sum of rows, so every device
  and a reload agree. **A step that only asked for a tool keeps its empty answer row** (the page draws a complete answer
  with no words as nothing): a tool loop is several requests and every one is billed. A failed request records nothing;
  a provider that said nothing records zeros — never a guess.
- **Counted once.** The in-browser path writes its usage with the turn (`persistBubbles`, grouped per model, on the last
  answer or on an empty answer row if there was none), marks the entries `persisted` so a later write cannot repeat them,
  and drops them from the live list only when the rows that now hold them have been read back.
- **During usage**: the figure moves while an answer is written — characters ÷ 4 for the streaming row, drawn with a "~"
  (`data-usage-live`) — and the exact number replaces it when the row completes. The name gives way (ellipsis), the
  counter does not (`flexShrink: 0`), measured against the header's Close button.
- **The amount is an estimate and says so** ("≈", and the tooltip). Neither provider lets an app read a balance or an
  invoice, so money is tokens × a price per million. `BUILT_IN` in `aiUsage.ts` are list-price estimates for a few
  families **entered from memory — check them**; a model with no price shows tokens and **no amount** (never `$0`); a
  person's own rate (Settings → AI → Price, `AIConfig.prices[modelId]`) beats the estimate and, when every priced figure is
  theirs, drops the "≈". Sub-cent is "<$0.01" with no "≈"; a conversation that changed model shows "+" (a floor) and names
  what had no price. Cache writes bill at 1.25× input and reads at 0.1×.
- **Settings → AI → Used this month** is a sum over this month's rows (RLS makes it the person's own), across devices,
  per model. **It is the assistant's chat only** — the morning brief, mail drafts and the other AI features use the same
  key and are not counted; the provider's billing page is the only total for a key.
Tests: `assistant-usage.mjs` (36, the arithmetic and wording), `assistant-chat-server.mjs` (66: both providers' usage,
a tool loop counted per request, a failed request records nothing), `assistant-usage-counter.mjs` (browser: exact on both
providers, live then exact, counted once and rebuilt from rows after a reload, a tool loop, unpriced model, own rate,
layout with a very long model name, month total excluding last month, the price row), the SQL harness (20260044).
**Not exercised: a real provider's usage fields (the stand-ins send the documented shapes), or the built-in prices being
right.**

