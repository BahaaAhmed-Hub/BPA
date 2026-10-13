---
paths:
  - "src/modules/assistant/**"
  - "src/lib/assistantTools.ts"
  - "src/lib/chatAttachments.ts"
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
