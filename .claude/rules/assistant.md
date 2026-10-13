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
