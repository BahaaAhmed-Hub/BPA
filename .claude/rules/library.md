---
paths:
  - "src/modules/library/**"
  - "supabase/functions/library-follow-check/**"
  - "supabase/functions/_shared/releases.ts"
  - "supabase/functions/_shared/releaseRun.ts"
  - "supabase/migrations/2026002[5-9]_library*.sql"
  - "supabase/migrations/2026003*_library*.sql"
  - "scripts/library-*.mjs"
---

# The Library — shelf, quotes, reader, discover, tracker, releases

Loaded when a file this rule's `paths` names is read or edited. The root
`CLAUDE.md` holds what is true everywhere; this holds what is true here.

## Library — a shelf, built in phases
`src/modules/library/`, `20260025_library.sql`. Phase 1 of six (shelf, lists and
categories, cover lookup, the on/off switch). Quotes/notes/PDF reader (2),
Discover and buy links (3), tracker and plans (4), AI summary and audio (5),
photograph-your-shelf (6) and the extras (7) each arrive as their own migration.
- **Two switches, either one turns it off.** The server's (`my_modules()`: plan
  and admin override) and the person's (Settings → Library, `library-settings`,
  a prefSync key). `libraryIsOff()` is the one answer, used by the nav, the
  module gate, the loader and the live-sync handler — which asks **at call
  time**, because the person can switch it on while the app is open. Off means
  never loaded, as for every module.
- **The migration registers it for `free` as well as `pro`.** The backfill put
  every account on `free`; a module in neither plan resolves false for everyone
  and vanishes from the nav the moment the migration runs.
- **One table for lists and categories** (`library_lists.kind`). A category is
  what a book *is*, a list is what you are *doing* with it; they differ in the
  question the UI asks, not in shape, and two tables would be two copies of
  every control that edits a name and a thumbnail. `library_list_books` carries
  its own `user_id` because Realtime can only filter on a column the row has.
- **Authoritative from the server, optimistic on the screen.** `loadFromDB`
  replaces; every write goes straight out; a failed write says so and reloads
  rather than leaving a book on screen the server never heard of. `loading` is
  distinct from empty ("Fetching your library…", never "Your shelf is empty"
  about a shelf on its way), and a failed read keeps what is shown. `'missing'`
  (42P01 / PGRST205) means the migration has not run and says so.
- **`?? null` on every optional in `fromBook`.** `undefined` is dropped on the
  way to JSON, so an upsert never *clears* a field the person emptied — the
  `parent_id` hole again.
- **The panel is the calendar composer's contract**: a cream shell of white
  cards, every control writes straight through, words held 700ms
  (`lib/useHeldText.ts` — a third copy of a hook Shopping already has twice;
  promoted for the Library only, the Shopping ones are untouched).
  Starting/finishing date themselves; coming off *finished* clears the date.
- **A picked book is inert on the shelf** (`data-picked`, dashed empty slot,
  `pointer-events: none`) while its panel is open — it has left the shelf.
  Escape closes the panel but never from under a dialog or a text field.
- **The flight is a clone moved by transform only.** `BookFlight` sizes itself
  to the panel's cover *in the layout effect* (on a first pick the panel has
  only just mounted) and animates translate+scale+rotateY; the real cover is
  `visibility: hidden` until it lands. Reduced motion skips it. Never
  `oncancel = onDone`: unmount cancels, and that clobbered the *next* flight.
- **Lift is gated on `hover: hover`.** A finger has no hover; a tap would
  leave the first book touched stuck halfway out.
- **Under 760px the panel replaces the shelf** instead of docking (300px of
  panel left a phone ~90px of books), as the Mail reader stacks.
- **A button must not carry `role="listitem"`** — it replaces the button role.
  Found by the test looking for the button; the group is `role="group"`.
- **Spine colours are theme tokens** (`--sb-cat-*`, deep semantics) with
  `inkOn()` per spine, so Glass draws a Glass shelf. Width follows page count,
  height a stable hash of the id, minimum 34px (a touch target).
- **Lookup is Open Library + Google Books, asked together, merged.** One source
  down is named, never reported as "no results"; both down says to add by hand.
  Google's `http:` thumbnails are upgraded (a https page will not load them) and
  Open Library's 1×1 "no cover" gif is treated as a miss. `applyCandidate` takes
  the cover always and everything else only where the book has nothing.
`scripts/library-shelf.mjs` — 28 assertions against an in-memory PostgREST that
refuses an unknown column. The ink audit has five Library screens.

## Library 2a — quotes, notes and bookmarks
`20260026_library_quotes.sql`. Phase 2 is split into small chunks: **2a** (this:
quotes, notes, bookmarks, the file bucket), 2b PDF upload and reader with page
and line bookmarks, 2c quotes from a photo, 2d the quote board, 2e export and
"apply this idea" as a task.
- **Read separately from the shelf.** `loadLibraryExtras()` runs after
  `loadLibrary()`, so an account that has run 20260025 but not 20260026 keeps a
  working shelf: `extrasMissing` disables favouriting, hides the quote and note
  forms and names the migration, instead of costing the books.
- **One notes table, anchored by `scope`** (`book` / `quote` / `list` / `page` /
  `line`), and the CHECK refuses a note whose anchor is missing — a `line` note
  with no page is a note about nothing. The UI never picks a scope: a page typed
  beside the words makes it a page note, a page and a line a line note. The fake
  server in `scripts/library-quotes.mjs` enforces the same CHECKs and has a
  control that proves it refuses.
- **A page left in the form is not carried to the next quote.** It was, and a
  second quote silently inherited page 42 — a wrong page is worse than none, so
  saving clears words, page and line together. Line stays disabled until a page.
- **A book bookmark is a favourite**; a quote bookmark is anchored to the quote.
  Page and line bookmarks arrive with the reader (2b).
- **Delete takes everything and undo gives it all back.** The server cascades a
  book's quotes, notes and bookmarks away, so the store drops them locally too
  and the undo entry re-saves each one — restoring only the book row would bring
  back an empty book. Verified: 3 quotes / 4 notes / 1 bookmark, gone, then back.
- **Quote colour is chosen while editing**, not a standing row of six dots beside
  three icons; the row wrapped into a mess at panel width.
- **The `library` bucket is private and keyed by the owner's id** as the first
  path segment, so nobody reads or writes another account's files whatever name
  they guess. Nothing uses it until 2b/2c.
`scripts/library-quotes.mjs` (22 assertions; `missing` runs the 20260026-not-run
case, 4 more). The ink audit's Library fixture now carries quotes, notes and a
bookmark, so the panel's second half is measured with something in it.

## Library 2b — a book's file, and the reader
`libraryFiles.ts`, `PdfReader.tsx`, `BookFileCard.tsx`. One PDF per book in the
private `library` bucket (20260026), read with `pdfjs-dist`.
- **pdf.js is a lazy chunk.** `React.lazy(() => import('./PdfReader'))` in the
  module: the reader is ~500 kB and its worker 1.3 MB, loaded the first time a
  book is opened to read. The main bundle grew by 8 kB. The **legacy** build
  (`pdfjs-dist/legacy/…`) is used so an older iPad Safari still opens it.
- **The path is `<owner id>/<book id>/book.pdf`**, which is what the bucket's
  policy compares to `auth.uid()`; one file per book, so Replace is the same call
  as the first upload (`upsert`). The harness's storage fake **refuses an upload
  outside the owner's folder**, with a control that shows it does.
- **The first five bytes decide it is a PDF** (`looksLikePdf`), not the extension
  or the MIME type, which are only what a person or a browser claims — and the
  50 MB ceiling is checked before the upload, not after the whole transfer.
- **Its text layer is transparent on purpose.** pdf.js draws a page to a canvas
  and lays its words over it as invisible spans, which is what makes them
  selectable and readable aloud. Its own stylesheet is global (`.page`,
  `.pdfViewer`, `:root`) and would reach the rest of the app, so the few rules
  that matter are in `index.css` under `.lib-textlayer`, with `--total-scale-factor`
  set by the reader — every span's font-size is a calc() of it, and without it
  the words are the wrong size and the selection misses the printed ones.
  **The ink audit names `.lib-textlayer` as exempt**, with the reason beside it:
  it cannot be `aria-hidden` (that takes the words from a screen reader), and
  what is *seen* is the PDF's own picture, the document's ink and not the app's.
- **Selecting text offers Save as quote**, filed with the page it came from —
  the thing a typed quote never knew. `tidySelection` joins the PDF's hard line
  breaks and the hyphen where a word wrapped, since a quote is a sentence. The
  last good selection is kept, because a tap on the button can collapse the
  selection first on some browsers.
- **Page bookmarks** share the bookmark table (`kind: 'page'`); `BookmarkTarget`
  is a union so a page can't be asked for without its number. **Line** bookmarks
  are not here: a printed line is not something a PDF's text layer exposes
  reliably, so they wait for something better than a guess.
- **The page box shows where it landed.** Asking for page 99 of 3 while already on
  3 changed no state, so the box kept saying 99 — found by the test, fixed in `go`.
- **Reading position is per device** (`library-page:<book id>` in localStorage):
  the books table has no column for it, and Phase 4's tracker is where reading
  progress is kept properly. A book with no length learns it from its own file.
- **Removing the file asks twice, inline**, because the bytes are deleted and it
  cannot be undone. **Deleting a *book* does not delete its file** — undo has to be
  able to bring the book back with a file that still exists — so a deleted book's
  PDF stays in the bucket. A purge of files no book points at is not built yet.
- **A file the reader cannot open is a message** (password-protected, corrupt),
  not a crash or a blank page.
- **A disabled accent or primary button looked live — a platform bug found here.**
  `.sb-btn:disabled` and the variants (`.sb-btn[data-variant=…]`) are the same
  weight and the variant comes later, so it won: "Save as quote" was amber with
  nothing selected, and so was every other disabled accent button in the app,
  against the stylesheet's own comment. `[data-variant]` is now in the disabled
  selector for specificity. The audit is clean in all four themes after it.
`scripts/library-reader.mjs` — 37 assertions on a three-page PDF **built byte by
byte** (`scripts/pdf-fixture.mjs`, also used by the audit) so pdf.js really parses
and draws it: dark pixels on the canvas, the words in the text layer and sitting
over the page, zoom, page turns, bookmarks, a selection filed as a quote with its
page, resume, the two-step removal, and a corrupt file. The ink audit has the
reader (28 screens, 0 failing pairs).

## Library 2c — a photographed page becomes a quote
`readPassage.ts`, `QuotePhotoDialog.tsx`, `quoteImageUrl`/`uploadQuoteImage` in
`libraryFiles.ts`. A photo goes to Claude vision with the key from Settings → AI —
no second key, nothing server-side — and the passage comes back as text.
- **What comes back is a draft, and the screen says so.** A model reading a phone
  photo of a curved page gets words wrong, so the photo is shown beside the text
  to be checked, with a line saying whether it read the marked passage or the
  whole page. The prompt says *copy, do not correct or complete*, join wrapped
  lines, un-hyphenate, write `[illegible]` rather than guess, and read **only the
  marked part** (highlighted, underlined, boxed) if there is one.
- **Every failure leaves the quote typeable.** No key, a refused key (401/403),
  a rate limit (429), a refused image (400), an unreachable service, a page with
  no text, a reply that is not JSON — each is a sentence naming what to do, the
  text box stays live, and Save does not wait for words (a photo of the page you
  want to come back to is a quote). A reply in code fences parses; a reply with
  no JSON at all is taken as the text, since keeping it beats losing it.
- **The upload comes first, and a failed one saves nothing.** The photo is stored
  under `<owner>/<book>/quotes/<random>.<ext>` — random, not the quote's id, so it
  can be uploaded before the quote exists — and only then is the quote written. A
  quote pointing at a photo that never arrived is worse than no quote, so on a
  failure the dialog stays open with the words kept and says "Nothing was added".
- **Reuses the assistant's image path** (`readAttachment`: downscale to 1568px,
  JPEG where smaller, a small PNG keeps its encoding) rather than a second
  scaler, and `anthropic()` is exported from `professor.ts` instead of building a
  second client.
- **No `capture` attribute on the file input.** It forces the camera and takes the
  photo library away, which is where a screenshot of an e-book page lives; on iOS
  the plain image picker offers both.
- **The bucket is private, so a photo is fetched and shown from an object URL**,
  once per path per session, and a failed fetch is not remembered or the photo
  stays broken until reload. Tapping enlarges it.
- **Deleting a quote does not delete its photo** (undo must be able to bring the
  quote back with a photo that exists) — the same call, and the same unbuilt
  purge, as a book's PDF.
- **The audit found a contrast failure in the first draft of the notice**:
  `--sb-warning` on white reads 4.24 in Sunlit, under 4.5. The three Library
  notices (the dialog's, the missing-migration line on quotes, and Settings →
  Library) use `--sb-accent-deep`, which each theme tunes for text. Other
  `--sb-warning` text in Settings (the lost-access line) is older and unmeasured
  — Settings' own screens still measure nothing.
`scripts/library-photo.mjs` — 32 assertions with Claude and Storage both faked
(the Anthropic route answers CORS preflight, as the SDK's browser fetch needs):
the request carries the photo as a base64 image block, the words and printed page
number arrive for checking, a corrected text is what is saved, Read again calls
once more, and each failure above. The ink audit has the dialog and a photo-only
quote (29 screens).

## Library 2d — the quote board, and an explanation that says what it has read
`QuoteBoard.tsx`, a fourth header view (**Quotes**) across every book. Three
modes, remembered in `library-quote-mode`: **Cards** (a wall to scan), **Poster**
(one quote set large, to sit with) and **Explain** (the words, and what they
mean). Search, a book filter and a bookmarked-only filter apply to all three.
- **A card opens its poster** — the same thought, larger; the book's title on a
  poster or explanation opens that book's panel.
- **Poster and Explain show quotes with words only.** A photo with no text typed
  has nothing to set in type or to explain; the view says how many are left out
  rather than silently dropping them. Cards show all of them.
- **The poster is a tint of the theme, not a white card**: the quote's colour
  mixed 16% into `--sb-overlay` (opaque in every theme) with the ordinary ink on
  it, so Glass draws a Glass poster and the contrast the audit measures holds.
  Type steps down with length (`posterSize`) and `text-wrap: balance`; arrow
  keys and a sideways swipe turn it, ignored in a field and when the drag is a
  text selection.
- **Explain is opt-in and one quote at a time.** Each answer is a model call; a
  board that spent them on every open would be a bill nobody chose. The answer
  is stored on the quote (`explanation`, `20260027`) so it is paid for once, and
  survives a reload without a second call.
- **Grounded in the words, not in the book.** The prompt is the passage, the
  title and author, and the reader's own notes on that quote — and says in so
  many words that the model has NOT read the book and must not invent chapters
  or characters. The screen labels it "An AI explanation of the words alone".
  `apply` items are short and start with a verb so 2e can turn each into a task.
- **An empty or non-JSON reply is never stored as an explanation** (`parseExplanation`
  returns `null`): it would show a blank "explained" card with no way to ask again.
  A stored value that is not JSON reads back as plain meaning rather than lost.
- **`aiFailure.ts` is the one place AI failures are worded** (no key, 401/403,
  429, 400, other); `readPassage` (2c) uses it too, so a photographed page and an
  explanation refuse in the same words and point at Settings → AI.
- **A migration-less account keeps working**: `fromQuote` sends `explanation`
  only when it was set, so every other quote write survives without `20260027`.
  Only the explanation write is refused by the server, and `failed()` says so.
`scripts/library-board.mjs` — the fake PostgREST refuses an unknown column
(`explanation` known only once migrated) and the fake Anthropic can be ok, a 401,
a 429, prose or `{}`. The fake only counts calls whose system prompt is the
explain one: the Today screen makes its own, and counting those read as the board
asking twice. A 429 needs a longer wait — the SDK retries it. The ink audit has
the three modes (32 screens) and a stored explanation on the fixture.

## Library 2e — a quote leaves the app, and an idea becomes a task
Two chunks, both small. **Apply this idea** (`applyIdea.ts`, `IdeaButton.tsx`)
and **Export** (`exportQuotes.ts`, `zip.ts`, `ExportDialog.tsx`).
- **Apply this idea is on the two places an action lives**: each *Try this* line
  of an Explain card, and each note. A quote itself is not an action and has no
  button. It makes one task through `placementForNew` — asking for it is deciding
  about it, so it is placed, never filed in the brain dump — in `personal`,
  open. Where it came from is the **description's first line** ("From “Atomic
  Habits” · p. 27"), then the quote. **No `links` entry**: the task panel draws
  every link as a URL, and a book is not one.
- **Once is once.** A made idea is remembered against its source and its words
  (`library-idea-tasks`, localStorage, per browser) and the button becomes a
  "Task made" receipt, surviving a reload — the mail row's `acted` rule. Editing
  the words makes it a different idea. Private-window storage failing means it
  can be made twice, not lost.
- **Export is what the board shows.** Search, book and bookmarked filters decide
  the quotes; the notes on those quotes and on their books come with them, and
  the dialog says how many quotes and files. A photo with no text is kept as a
  line saying so — a silent drop would leave the file a count short of the screen.
- **Three destinations, two shapes.** *Markdown* is one file. *Obsidian* is a
  note per book — author, status, rating, ISBN as front-matter (JSON strings are
  valid YAML, so a title with a colon is safe) and a `^q-xxxxxxxx` block id on
  every quote so another note can embed it; several books come as a zip. *Notion*
  reads Markdown on paste or Import → Text & Markdown, so it is the single file
  again; a separate "Notion format" would be the same text under another name.
  Nothing is uploaded: the text is built in the browser, downloaded or copied.
- **File names are ASCII-safe.** `safeName` drops `\ / : * ? " < > | # ^ [ ]`
  (a wikilink breaks on the last four) and trailing dots; two books with one
  title get `(2)`. The first draft used an em dash in "Title — quotes.md" and
  Chromium reported the download as `download` — a hyphen is the whole fix.
- **`zip.ts` is a stored (uncompressed) zip** with UTF-8 names and a CRC-32 — a
  few small notes do not justify a dependency. Checked by `unzip -t` on a real
  download, and crc32 against the standard check value (`cbf43926`).
- Explanations are **off by default** in an export and labelled "(AI)" when
  included: a note taken out of the app should not quietly mix a model's words
  with the reader's own.
`scripts/library-export.mjs` — the fake PostgREST carries a `tasks` table, so the
task is read off what was really upserted. The ink audit has the dialog (33
screens).

## Library 3a — Discover: find a book you do not have
Phase 3 is four chunks: **3a** (this) search online and put it on the shelf, 3b
buy and free-download links by country, 3c ISBN / barcode scan, 3d follow an
author or series. A fifth view in the header, **Discover** (`DiscoverView.tsx`),
no migration: a result is added as an ordinary book with `status: 'want'`.
- **Two modes, because they are two questions.** *Books* is the Add dialog's
  search (`lookupBooks`: Open Library + Google Books, merged) with room for 24.
  *Authors* asks Open Library for the author **as a person** — it has keys
  (`OL23919A`), where a book only carries a name string — and then lists their
  works through `author_key:OL…A`, most-edited first (`sort=editions`, a decent
  proxy for the ones people mean). Google's `inauthor:` is a text match and would
  return anyone who shares the name, so authors are Open Library only, and the
  file says why.
- **An author key is not free text.** `booksByAuthor` refuses anything that is not
  `^OL\d+A$` before it reaches a query string and asks nothing for it; a
  catalogue's own response is still data, not a query.
- **Already on the shelf says so and opens it.** `shelfMatch` — the ISBN when
  both have one, otherwise the same title by the same first author with case and
  punctuation stripped, since two catalogues never agree on those. A card whose
  book you own is a receipt, not a second "Want to read" (the button is a link to
  the shelf copy). Compared against the live store, so adding turns the card
  over by itself.
- **A source down is named; both down is not "nothing found".** One catalogue
  failing reads "Google Books could not be reached; showing the other"; both
  failing reads "Could not reach the book catalogues" — telling a person a book
  does not exist because the network dropped is the lie this copies Add's rule
  to avoid. A fetch that throws (offline, CORS) is the same as a 503.
- **A stale answer never overwrites a newer one**: a counter per request, plus an
  AbortController, keyed on a single `wants` string (`books:newport`,
  `works:OL123A`). State that follows a keystroke is set in the handler; the effect
  only schedules the request (the lint rule, and the right shape).
- **Cover and spine are the shelf's own** (`CoverArt` with the candidate dressed
  as a book), so a result without a cover draws a title-page, not a hole.
`scripts/library-discover.mjs` — 23 assertions with Open Library and Google Books
faked *with the CORS headers the real ones send* and each switchable off, and a
PostgREST that refuses an unknown `library_books` column. A trailing space is not
a new search (`wants` is trimmed), which the first draft of the test tripped on.
The ink audit has Discover over books and over authors (35 screens).

## Library 3b — where to read it free, where to buy it, and "buy later"
`bookLinks.ts` (pure), `BookLinksCard.tsx` (a **Get it** card in the book panel),
`20260028_library_acquire.sql` (`library_books.to_buy`).
- **Links, not prices.** Every button opens a shop's or library's *own search
  page* for the book; nothing asks whether it is in stock or what it costs, and
  the card says so in a line. Price watch is Phase 7 and reuses the Shopping
  one. A link to a shop's search page cannot be wrong about stock; a price shown
  here could.
- **Free means legal, and the list is closed.** Open Library and the Internet
  Archive (lent scans), Project Gutenberg (out of copyright), a Google Books
  preview, and WorldCat (the nearest library that holds it). There is no "free
  PDF" source in `bookLinks.ts` and there will not be — a pirated copy is not
  something a reading app should hand over however often it is asked for. A test
  pins the five ids.
- **The country picks the storefront**: Amazon's per-region domain (a region
  with no store falls back to .com and the note says it ships abroad), Play
  Books told the region, Bookshop.org only for US/GB, **Jamalon** only for the
  regions it delivers to (Egypt, the Gulf, Jordan, Lebanon, Iraq). Region
  *names* come from `Intl.DisplayNames`, never a typed table (the shopping
  currency-list mistake). The default is the browser's region (`en-GB` → GB,
  `ar-EG` → EG, a bare `en` → US) — a guess, shown, and changeable on the card;
  the choice is `library-settings.country` and **Settings → Library's switch now
  spreads the stored settings** rather than writing `{enabled}` alone, which
  would have dropped the country each time it was flipped.
- **The ISBN is the search when there is one**, stripped to digits/X; otherwise
  title + first author. Everything goes through `encodeURIComponent`, so a `&` or
  `#` in a title ("Rich Dad & Poor Dad #1") cannot cut the query short. Links open
  `_blank` with `noopener noreferrer`.
- **"To buy" is a flag, not a status**: a want-to-read can be a loan, or at the
  library, or a gift. It composes with every reading state. A pill on the card, a
  **Buy later** button beside *Want to read* on a Discover result (adds it wanted
  and flagged in one gesture), and a **To buy N** filter in the shelf toolbar —
  shown only once something is flagged.
- **A project without 20260028 keeps working.** `fromBook` sends `to_buy` only
  once the book has a value, the way a quote's `explanation` does; only toggling
  the flag is refused (400 naming `to_buy`) and the store's failure path says so
  and reloads. Verified: the flag refused, then a rename still saves. The first
  fake kept `to_buy` on the stored row and handed it back on the next read, which
  made every later save re-send the refused column — a real project without the
  column returns nothing, so the fake now strips it on read.
`scripts/library-links.mjs` — 27 assertions, the pure module imported from the
dev server (regions, encoding, the closed free list, locale defaults) and the card
driven in `en-GB`. The ink audit's first book carries `to_buy`, so the pill and
the card are measured (35 screens).

## Library 3c — scan a book's barcode
`isbn.ts`, `barcodeScan.ts`, `ScanIsbnDialog.tsx`, reached from **Scan ISBN** in
Discover. No migration. `@zxing/library` is the one new dependency, loaded only
when a scan needs it.
- **The check digit is the whole defence.** A camera guesses at stripes and a
  person at digits; an unchecked ISBN becomes a confidently wrong book.
  `parseIsbn` accepts ISBN-10 or 13, with or without hyphens, and returns an
  ISBN-13 — an ISBN-10 is the same book with `978` in front and a new check
  digit — or `null` for a wrong check digit, the wrong length, **or an EAN that
  is not a book** (a 977 magazine, a tin of beans: valid EAN-13s that must not
  reach a catalogue).
- **Two engines behind one `Scanner`, chosen at the moment of use.** The
  browser's `BarcodeDetector` where it exists **and lists `ean_13`**; ZXing
  everywhere else, which in practice is **Safari on iPhone and iPad** — the
  devices this is for. A detector that exists but cannot read EAN-13 would scan
  for ever and find nothing, so it falls through to ZXing. Only EAN-13 is asked
  for: that is every book, and asking for all formats is slower in both engines
  and lets a QR code across the room win. ZXing decodes frames drawn to a canvas
  at ≤960px, luminance only; "no barcode in this frame" is its ordinary
  `NotFoundException` and is swallowed.
- **Three ways in, because a camera is the one that is sometimes missing**: the
  live camera, a **photo** of the barcode (tried upright and quarter-turned each
  way, since a phone photo of a back cover is as often sideways), and the number
  **typed**. All end in one `handle(isbn)`. Denied, missing, insecure-context and
  failed cameras each get their own sentence naming the way round; none leaves
  the dialog empty. The file input has no `capture` (it would take the photo
  library away).
- **A scan never adds a book by itself.** It looks the ISBN up
  (`lookupByIsbn`: `isbn:` in both catalogues, merged, one result), shows the
  book, and waits — so a misread that happens to pass the check digit is one tap
  from being ignored rather than one tap from being on the shelf. The scanner
  **pauses while a result is on screen**, or a camera still pointing at the same
  book finds it every 140ms; **Scan next** resumes. The ISBN stored is the one
  scanned, not the catalogue's first listed edition. A book already on the shelf
  says so and opens it.
- **Not found, and could not look, are different sentences.** No catalogue knows
  it → *Add it by hand*, which opens the Add form with the ISBN already in it
  (`initialIsbn`). Both catalogues failing → "could not be reached".
- **The camera is let go** on close, Escape and unmount (the recording light going
  out is the proof), and a stream that arrives after the dialog was dismissed is
  stopped on arrival. The test wraps `getUserMedia` and asserts every track is
  `ended`.
`scripts/make-barcode.py` draws a real EAN-13 from the standard's L/G/R tables
and writes a PNG and a looping Y4M; Chromium is told to use it as its fake camera
(`--use-file-for-fake-video-capture`), so **ZXing decodes real bars off a real
video stream**. `scripts/library-scan.mjs` (31 assertions) covers that, the
native path with a stand-in detector (headless Linux has none: it reads EAN-13
only, passes over a non-book code seen first, and never downloads ZXing),
the photo path (upright, sideways, a non-ISBN barcode, a blank page), a refused
camera, and the typed path. The ink audit has the dialog (36 screens).

## Library 3d — following an author or a series
`FollowingView.tsx`, `followCheck.ts`, `ResultCard.tsx` (lifted out of Discover so
both draw a result the same way), `20260029_library_follows.sql`. A third mode in
Discover: **Books / Authors / Following**. Phase 3 is now complete.
- **A follow is a saved question plus what existed when you asked.**
  `library_follows`: `query` (the Open Library search), `seen_keys` (work keys).
  "New" = what the question returns now that is not in `seen_keys`, is not
  duplicated, and is not already on your shelf (`shelfMatch`). So following an
  author with forty books announces none of them; **Mark all seen** only ever
  widens the set (capped at 400, oldest dropped).
- **Following snapshots first, and refuses if it cannot.** A failed snapshot would
  be an empty set, and an empty set makes every book the author ever wrote "new"
  — the opposite of the feature. Nothing is created until the snapshot has been
  read; the message says nothing was followed. Same for a series.
- **An author is followed by Open Library key** (`author_key:OL…A`, validated
  against `^OL\d+A$` before it is put in a query), from the **Follow** button on an
  author's page. **A series is matched by name** (`title:"Name"`, optionally
  `AND author_key:…` narrowed to an author you follow): no catalogue has a
  dependable series field, and the form says so beside the box rather than
  presenting a guess as a fact. Quotes and backslashes are stripped from the name
  (not escaped) and it is clipped at 80 characters.
- **Nothing runs in the background.** The check happens when the Following view
  is open (4 at a time, answered from memory for 30 minutes — a once-a-day glance
  at someone else's server). An alert while the app is closed needs a scheduled
  server job; that is Phase 7 and the screen does not pretend otherwise. **Failure
  is per follow**: one card says "Could not check …" and the others still answer.
- **Newest first** (`sort=new`) via `latestWorks`, which **throws** — unlike a
  search box, a follow check must tell "nothing new" from "could not look".
- **Unfollow is undoable** (⌘Z re-follows with its seen-set intact). A project
  without 20260029 gets the migration named on that view only; `followsMissing`
  is read separately, like the extras, so the shelf and quotes are untouched.
`scripts/library-follow.mjs` (27 assertions) — Open Library keeps a mutable list
of works, so a new release is a real change between two visits (a reload clears
the 30-minute cache); covers the snapshot refusal, the stored question and
seen-set, a release already on the shelf not being new, Mark all seen surviving a
reload, a series refused when unreadable, narrowing to an author, one follow
failing without hiding the others, unfollow and undo, and the missing migration.
The ink audit has the view with an author, a series and the form (37 screens).

## Library 4a — reading and listening sessions
Phase 4 is five chunks: **4a** (this) log a sitting and see progress, 4b a
Tracker view (the week, streak, totals), 4c reading plans (a finish date and a
daily/weekly target, from a pace you actually have), 4d those plans as calendar
blocks, 4e yearly goals and challenges. `20260030_library_sessions.sql`,
`ReadingLogCard.tsx` (a **Progress** card in the book panel), `readingStats.ts`,
`readingTimer.ts`.
- **Progress is derived, never stored on the book.** It is the furthest
  `to_page` any reading session reached. So deleting a mistaken session puts it
  back by itself, two devices cannot disagree, and there is exactly one source
  for "how far am I". Listening sessions add minutes and no page.
- **New ground only.** `pagesCovered(previousFurthest, toPage)`: re-reading, or
  jumping back, is time spent but not progress, so it logs minutes and no
  `pages`, and the bar does not fall.
- **The stopwatch is a start time, not a counter** (`library-timer`,
  localStorage): a counter dies with the tab or a locked phone, a start time does
  not, so a reload, a sleeping iPad and a second tab all agree. One timer at a
  time (you are reading one thing); on another book the card says where it is
  running and will not start a second. Per device on purpose. Elapsed is clamped
  to 1–1440 minutes — a timer left running for days stops at a day, to be
  corrected.
- **Stop opens the form; it does not save.** The number worth keeping is the one
  the reader agrees with, not the one the clock produced — so the measured time
  is filled in to correct. By-hand logging ends in the same form.
- **A day is the reader's local day** (`todayISO`): a session logged at 00:30
  belongs to the night you were up reading, not to UTC. A future day is refused.
- **Validation lives on the form and in the table**: `minutes` 1–1440 and `kind`
  are CHECKs in the migration, and the fake server in the test enforces them, so a
  bad row would be refused by the "server", not just the form. A page past the
  book's length is refused naming the page count (the catalogue's count is often
  not the edition in hand; the message points at the field to fix).
- **The first session on a want-to-read book starts it** (`status: reading`,
  `startedOn` the day logged). **Reaching the last page offers *Mark finished*
  and does not do it** — finishing is the reader's call.
- Sessions are read separately (`sessionsMissing`), so a project without 20260030
  keeps its shelf and the card names the migration; deleting a book takes its
  sessions locally and ⌘Z restores them; both log and delete are undoable.
`scripts/library-sessions.mjs` — 31 assertions: the pure maths (furthest page,
new ground, hours, midnight), the form's refusals sending nothing, the stored row,
progress bar and percentages, delete and undo, Mark finished, the stopwatch
surviving a reload (a start time rewritten to 12 minutes ago), a second book
refusing a second timer, listening, the 1440 cap, and the missing migration. The
ink audit's first book carries two sessions (37 screens).

## Library 4b — the Tracker
`trackerStats.ts` (pure), `TrackerView.tsx`, a sixth header view (**Tracker**). No
migration: it reads the `library_sessions` log 4a already writes, so a figure here
and the same figure on a book panel cannot disagree.
- **Dates go through noon-local Dates, never `+ 86 400 000`.** A clock change makes
  a day 23 or 25 hours, and midnight-plus-a-day lands on the wrong date twice a
  year, putting a Sunday session in Monday's bar. Asserted across both hemispheres'
  changes.
- **Weeks run Monday to Sunday** (`weekStart`); a Sunday session belongs to the week
  before the Monday after it. The 12-week chart is twelve such buckets ending with
  this one.
- **A streak is days with a session of either kind, and it survives a day not
  logged *yet*.** At 08:00 you have not read today; a number that read 0 every
  morning would break itself. It is alive until a whole day has gone, and `today`
  says whether today is already in it. Future-dated rows are ignored, `longest` is
  kept after a run ends.
- **The figure is printed on the bar**, reading in the accent and listening in
  `--sb-info`; each column has an accessible label ("Monday 12 Oct: 30 min reading,
  15 min listening") since the bar itself is `aria-hidden`.
- A session's book opens on the shelf; a deleted book's session says so rather than
  vanishing from the list. `sessionsMissing` names `20260030` instead of drawing an
  empty week that would read as "you read nothing".
`scripts/library-tracker.mjs` — 24 assertions: the pure maths (week edges, year
edge, clock changes, every streak case, inclusive period totals, buckets) and the
view (streak tile, filters, 12 columns, opening a book, the missing migration).
The ink audit has the Tracker.

## Library 4c — a reading plan
`20260031_library_plans.sql` (`library_plans`), `planStats.ts` (pure), `PlanCard.tsx`
(a **Plan** card under Progress in the book panel) and a **Plans** list in the Tracker.
**One plan per book** (`unique (book_id)`): a finish-by date, a time budget
(`minutes`, `per` day or week), or both. Multi-book timelines are the Tracker's
list of single-book plans, not a second kind of object.
- **A plan stores the intention and nothing it implies.** Pages a day, the pace
  you are keeping, the date you are heading for and whether that is on time are
  all derived from the session log (`planStatus`), so they cannot drift from what
  was read — the rule progress already follows.
- **Pace is over the days the book has existed, up to 14.** `pacePerDay` divides
  by `min(14, days since the first sitting + 1)`: a book begun yesterday
  averaged over two weeks it did not exist for reads as a crawl, and "behind"
  about a book that is going well. A future-dated sitting and a listening
  session (no pages) add nothing.
- **Six states, and one is deliberately "I can't tell".** `ahead` (pace ≥ 1.25×
  needed), `on`, `behind` (the pace lands after the date — or **stalled**: read
  before, nothing in the window), `late` (date passed, not done), `done`, and
  `unknown`. **Nothing read yet is `unknown`, never `behind`**: judging a book
  you have not opened is a verdict nobody earned. No date, or no page count,
  is `unknown` too and says which is missing. The finish day itself still counts
  as a day left.
- **Minutes are a period, not a total.** A day plan counts today's sittings, a
  week plan Monday–Sunday (`weekStart`, the Tracker's definition), reading and
  listening both. `left` never goes negative.
- **Pre-answered.** "Make a plan" opens already holding `suggestedFinish` —
  where the current pace lands the book, or a month out with no pace — so the
  work is editing. Every control writes straight through; the minutes box is
  held 700ms by `NumField`.
- **A plan that says nothing is not a plan.** Clearing both the date and the
  minutes deletes it (the table's CHECK would refuse the row), and `0` minutes
  clears the target rather than writing a violation. Undo restores either.
- **A finished book's plan is history**: the Tracker lists live plans only.
  Deleting a book takes its plan, and ⌘Z puts it back.
- Read separately (`plansMissing`): without 20260031 the card names the
  migration and the rest of the module is unaffected.
- **Not built here, on purpose:** putting plan time on the calendar is 4d, and
  yearly goals are 4e.
`scripts/library-plans.mjs` — 45 assertions: the pure maths (pace edge cases,
every state, the minutes periods, other books' sessions, the suggested date, the
sentences) and the UI against a fake that enforces the CHECKs and the unique —
make, edit date/minutes/per, zero minutes, clearing, undo, the Tracker list,
trash, replace-not-duplicate, book delete + undo, and the missing migration.
The ink audit carries a live and a past-its-date plan.

## Library 4d — a plan's time, on the calendar
`20260032_library_plan_blocks.sql` (`block_at`, `block_event_id`, `block_sig` on
`library_plans`), `planBlock.ts` (pure), and a **Time of day / Block this time**
row on the Plan card, shown once the plan has minutes. A plan puts **one repeating
event on the primary calendar** — nothing else, and only the primary: a company
calendar or a connected account is a different token and a different question.
- **One recurring event, not a hundred.** `FREQ=DAILY;COUNT=n` for a day plan,
  `FREQ=WEEKLY` for a week plan: one id to remember and one thing to remove. It is
  **COUNT, never UNTIL** — UNTIL on a timed event must be a UTC date-time, which
  turns "the finish day" into a timezone question COUNT does not have. No finish
  date is four weeks, never a series with no end; capped at 366 daily / 52 weekly.
- **The first block is never in the past.** A time still ahead today starts today,
  one that has passed starts tomorrow. A finish date already gone is refused
  ("move it, then block the time") rather than writing a series that ended.
- **The plan remembers the handle and the recipe, nothing else.** `block_event_id`
  is the *only* way to that event — lose it and the event is an orphan nothing in
  the app can find, the `gcalEventId` lesson again — and `block_sig` (time ·
  minutes · per · finish date · title) is what it was built from. **Stale is a
  comparison of strings, not a fetch**: edit the minutes, the date or the picker
  and the card says the block no longer matches and offers **Update the block**.
  The edit itself writes nothing to Google; a calendar write per keystroke is what
  the 700ms hold exists to prevent.
- **Nothing is remembered unless Google took it.** A refused POST (403) stores
  no id and the card says why; no Google sign-in says so instead of "failed".
- **Update on an event deleted in Google makes a fresh one** (the PATCH answers
  404/410) rather than failing on an id that no longer exists. **Taking off an
  event that is already gone is success.** A delete Google *refuses* keeps the id
  and says the block is still on the calendar.
- **Removing the plan takes its block off first**, and if Google refuses, the plan
  stays: a plan removed while its event survives leaves an event nobody can find.
  The cleared-block write is skipped on that path — `setPlanBlock` then
  `deletePlan` fire an upsert and a delete without awaiting either, and the upsert
  can land second and **bring the row back**. (Found by the test: the plan was
  still there after a successful delete.)
- **Block fields are not undoable.** The event lives in Google. `setPlanBlock`
  pushes no undo entry; undoing a date change restores the date and keeps whatever
  block the plan has *now*; undoing a removal restores a plan with **no** block,
  since the event it pointed at was taken off. Otherwise ⌘Z would orphan an event
  or point a plan at one that is gone.
- **Block columns follow the optional-column rule.** `fromPlan` sends them once
  they hold something or once the project is known to have them (`blockColumns`,
  learned from a row that carried the key), so a *cleared* block really clears
  (`null`) and an unmigrated project is never sent a column it lacks. The card
  asks once (`blocksSupported()` — `select block_event_id limit 1`) before offering
  the button, because creating the event and then failing to remember it is the
  worst order to fail in; without 20260032 it names the migration and nothing
  reaches Google. The plan itself keeps saving.
- **The caption says what is true now:** before blocking, it says what *will* be made ("One
  repeating 30 min block every day until Fri 23 Oct, on your main calendar");
  after, what *was*.
`scripts/library-plan-blocks.mjs` — 40 assertions with `www.googleapis.com`
intercepted, so the *requests* are asserted: the pure builder with the clock fixed
(today/tomorrow, COUNT daily/weekly/open-ended/capped, refusals, length, signature,
time validation) and the card (one POST to `primary`, the recurrence, what is
stored, stale on edit, PATCH not a second POST, the deleted-in-Google fallback,
refused delete keeps the id, already-gone is success, refused POST stores nothing,
removing a plan with a block, both undo rules, no minutes → no controls, and the
missing migration). The ink audit's first plan carries a stale block.

## Library 4e — yearly goals and challenges
`20260033_library_goals.sql` (`library_goals`), `goalStats.ts` (pure), `GoalsCard.tsx`
at the top of the Tracker. A goal is a **year, a kind (books finished · pages read ·
hours spent) and a target**; a **challenge is the same row with a `list_id`**, counting
only the books on that list or category. One table and one set of controls, not two.
- **Progress is counted, never stored.** Books = those with a `finishedOn` inside the
  year (Dec 31 and Jan 1 fall on the right sides); pages = `read` sessions' *new
  ground* in the year, as everywhere else; time = both kinds. A corrected finish date
  or a deleted session moves the bar on every device by itself. A challenge narrows all
  three to its list's books.
- **One goal per (year, kind, scope).** The unique index coalesces a null `list_id` to a
  fixed uuid — a plain unique treats two nulls as different and would let the whole
  library carry any number of identical goals. The store refuses a duplicate first and
  the card says which one exists ("change its target instead").
- **The year's line is straight, with two honest exceptions.** `expected = target ×
  days elapsed ÷ days in year` (leap years included; today counts as a day elapsed *and*
  a day left). Ahead ≥ 110%, on ≥ 90%, else behind — except **a book is a lump**: being
  under a whole book short of the line is `on`, because 0.68 of a book is not a thing
  you can be behind by. And **the first 14 days of the year are "just started"**, not
  judged: a Jan 3 verdict on a year-long goal is noise either way.
- **Exceeding a goal is a full bar with the real figure beside it**, not 125%. `done`
  stays `done` after the year ends; short at year end is `missed`; before Jan 1 is
  `upcoming`. The year stepper shows any year, so last year's result stays readable.
- **The pace is in the kind's own unit**: a book goal slower than a book a week reads
  "one every 11 days" (0.09 of a book a day is not a pace anyone feels), pages "55
  pages a day", time "33 min a day". The projection is shown only when behind.
- **Hours are typed, minutes are stored.** The Hours tab and the target field talk in
  hours; the row holds minutes like every other duration here. Zero, blanks and
  non-digits never reach the table (its CHECKs would refuse them); a zero in the target
  box is ignored rather than written.
- **Deleting a list takes its challenge** (the server cascades it) and ⌘Z brings both
  back, via the list's own undo. A removed goal is undoable on its own.
- **The progress line puts the unit once, at the end** — `3 of 24 books`,
  `1 h 35 min of 100 h`. The first draft read "3 books of 24 books".
- Read separately (`goalsMissing`): without 20260033 the card names the migration
  and the rest of the Tracker still draws.
`scripts/library-goals.mjs` — 49 assertions: the pure maths with the clock fixed
(every state and its boundaries, the lump rule, the grace period, year edges, leap
years, scope, units, sentences) and the card against a fake that enforces the
CHECKs, the coalesced unique and the cascade.

## Library 6 — a photographed shelf becomes books
`shelfTiles.ts`, `readShelf.ts`, `shelfCategories.ts`, `shelfEnrich.ts`,
`ShelfPhotoDialog.tsx`, reached from **Scan shelf** in the header. No migration. Three
chunks, one dialog: **6a** read the spines, **6b** file them under categories, **6c**
fill in covers and details afterwards. Nothing is added until it is ticked.
- **The photo is cut into overlapping tiles** (`planTiles`, at most 6). A shelf is wide;
  a phone photo of one is ~4000px across and the model takes ~1568 on an edge, so the
  whole photo shrunk is a smear. Columns first, then rows, squeezed to the cap, each
  piece reaching 12% into its neighbour so a spine on a cut line is whole in one. Drawn
  from `createImageBitmap(file, {imageOrientation:'from-image'})` so a rotated phone
  photo is read the right way up. Pieces are read **one after another**, not in
  parallel: in parallel a rate limit takes all of them at once.
- **The model is told to under-claim.** It lists titles it can actually read, with
  `high/medium/low` sureness, and *counts* the spines it could not read instead of
  guessing — a half-covered spine guessed from a fragment is a confident wrong book.
  The screen says "N spines could not be read — those are not listed", and names
  uncertainty on the row ("Small print", "Not sure — check this one"). Clear and
  small-print rows are ticked; unsure ones are not.
- **Every row is a draft.** Title and author are editable, and a book **already on the
  shelf** (`shelfMatch`, re-evaluated as you retype a title) is shown as such and
  cannot be ticked: adding it twice is the one mistake this screen could make for you.
- **A piece that fails costs its piece.** The books from the others are listed and the
  screen says "1 of 3 parts could not be read". Only when *every* piece fails is it an
  error; a **refused key stops after the first piece** (the rest would be refused too).
  No key, no JSON, nothing readable, a file that is not an image, a corrupt image: each
  is a sentence ending in the way back to adding by hand, and none sends a call it
  doesn't need. A reply that isn't JSON is "nothing readable", never an error screen.
- **The tiles overlap, so a spine is read twice.** `mergeSpines` keys on the normalised
  title: one row per book, the surer reading wins, an author or category seen once is
  kept. Capped at 80 rows.
- **One request and one undo for the whole add** — `addBooks`, not forty `addBook`s. A
  reload landing between forty sequential upserts replaces the list with what the
  server has *so far*; one batch cannot be split. ⌘Z takes the books **and any
  category the add had to make** (not the ones you already had), or "undo" would leave
  empty shelves behind.
- **Categories: yours first, spelled your way.** The prompt carries your category names
  and says to use one *exactly*; the model still answers "history" for "History", so
  `resolveCategory` maps near-misses (case, punctuation) onto the one you have rather
  than creating a twin. A genuinely new genre is offered as `Biography (new)`,
  preselected, with "Makes 1 new category: Biography." on screen before anything is
  made. **Sort into categories** turns the whole thing off. The category is judged from
  the title alone — the prompt forbids guessing from a spine's colour or design. A
  category is made *inside* `addBooks` rather than through `addList`: the links must wait
  for it to be saved, and `addList` saves fire-and-forget (using both wrote it twice).
- **Reading goes through a ref, not a dependency.** A background reload replaces `lists`;
  a read callback depending on the category names would re-run the effect and read (and
  bill for) the photo again, losing the person's edits.
- **Enrichment is strict, because a wrong cover is worse than none.** `pickMatch`
  accepts a catalogue result only if the title matches whole (case/punctuation aside,
  or once a subtitle is set aside — in either direction), **and**, with an author on the
  spine, shares its **surname as a whole word** (`Clear` ≠ `Clearwater`); with none, the
  title must be exact and the result must have a cover to show for it, and a title under
  4 characters ("It") is refused outright. `Dune` does not get `Dune Messiah`'s cover.
  Of those that pass, the richest (cover, ISBN, pages) wins. `applyCandidate` then fills
  only what the book lacks. Books it cannot match stay exactly as the spine read them.
- **It runs after the dialog closes** (`enrichAndReport` from the module, so it survives
  the dialog), three books at a time, and applies all patches in **one** request
  (`patchBooks`). The person gets one line: "Found covers and details for 2 of 5 books",
  "No confident matches…", or "Could not reach the book catalogues, so N books were
  added without covers". Both catalogues down for a book is *could not look*, not *no
  match*. **If the books were taken back (undo) while it ran, nothing is patched and
  nothing is said** — only books still on the shelf are counted.
- **"Already read" adds the books without a finish date**, so a shelf you photograph does
  not move a yearly goal; set the dates where you know them.
`scripts/library-shelf-photo.mjs` (58) — the tile geometry, parsing, merging and
categories asked pure questions, then the dialog against a faked Claude: the request
itself (a JPEG block, the prompt, your categories), ticking and editing, the one
batch POST, the categories made and the links, one undo, three pieces for a wide
photo, a piece failing, a refused key, no key, nothing readable, not JSON, not an image,
corrupt, cancel/Escape. `scripts/library-shelf-enrich.mjs` (25) — the matcher's refusals
and the whole path with faked catalogues. The ink audit has the dialog (39 screens).

## Library 7a — a quote of the day, on Today
`dailyQuote.ts` (pure), `DailyQuoteCard.tsx` — one import and one line in
`TodayPage`, between the brief and the mail. No migration, nothing stored.
- **Deterministic, so every device agrees without storing anything**: the quotes with
  words are put in a fixed order (`createdAt`, ties by `id` — the server's order is
  irrelevant) and the day number picks the place. **Walking the order, not hashing the
  date**, so every quote comes round once before any repeats; a random pick shows the
  same line twice in a week and never shows another. Days are counted by calendar date
  (`daysBetween`, noon-local), so a clock change cannot skip or repeat a day; the year
  turning is just another day.
- **A quote with no words is never picked**: a photographed page with nothing typed
  (`kind: 'image'`) and a blank body have no sentence to show.
- **It draws nothing unless there is something to show**: Library off (server plan *or*
  the person's switch), the person said no to this alone, or no quote with words. No
  empty card, no "save a quote" nag — a home screen should not grow one. With a single
  quote there is no *Another* button, since there is nothing to go to.
- **Another is for the visit only** — a session-local step past today's, wrapping both
  ways; reload and it is today's again. Row breaks in a quote are kept.
- **The title opens that book**, in a Library that may never have been opened this
  session (modules mount on first visit and the selection is state inside it). So the
  request is *parked* (`requestOpenBook` / `takePendingOpen` in `libraryPrefs`) and taken
  on mount **and** on `professor:libraryOpenBook` for one already open behind a tab.
- **Settings → Library → "A quote on Today"** (`library-settings.dailyQuote`; absent =
  on, only *off* is written, and a junk value reads as "not said no"). It appears only
  while the Library is on, and pushes to the other devices at once like the main switch.
`scripts/library-daily-quote.mjs` — 25 assertions. The expected pick is computed a
**different way** (civil date → `Date.UTC` → days since 1970) from the module, so the
test is not marking its own homework; the card is driven on the real Today screen.

## Library 7b — your quotes, asked back to you
`20260034_library_quote_reviews.sql`, `srs.ts` + `cloze.ts` (pure), `ReviewView.tsx`, a
fourth mode on the Quotes board (**Review**, with what is waiting on the tab:
`Review (7)`). A card is a quote with a few of its words hidden; you fill them in, look,
and say how it went.
- **One row per reviewed quote, and no row means new.** `due_on`, `interval_days`,
  `ease`, `reps`, `lapses`, `first_on`, `last_on` — everything on screen (what is due,
  how many are new today, the next date) is derived from them, nothing is a stored
  count. `quote_id` is the primary key with `on delete cascade`; deleting a quote or a
  book takes its reviews locally too, and undo brings them back (after the quote, for
  the foreign key).
- **A small SM-2, readable off a table.** First answers: again 1 d (ease −0.2), hard 1 d
  (−0.15), good 1 d, easy 4 d (+0.15). Then good = 1 → 3 → `interval × ease`; hard =
  `× 1.2`; easy = 4 → 7 → `× ease × 1.3`; again = tomorrow, reps reset. Ease lives in
  1.3–3.0, a gap in 1–365 days. **A lapse is only a lapse if it was known** — a new
  quote you get wrong has not been forgotten, only not learned yet. The tests pin the
  numbers (good ×4 is 1, 3, 8, 20), not the formula.
- **Each button says how long it would wait** (`Forgot · 1 day`, `Good · 8 days`), so
  the choice is between real things. The label is the scheduler's own `next()`.
- **Five new a day, twenty cards a sitting.** A backlog of 200 saved quotes is not 200
  cards tomorrow, and a first screen of fifty is how a habit ends. "New today" is
  counted from `first_on = today` **on the rows**, so answering five and coming back an
  hour later — or reloading, or opening the iPad — does not hand you five more; the
  limit survives because it is not remembered anywhere. A review whose quote is gone
  does not use up the room. More can be asked for ("Review 5 more").
- **A sitting is frozen when it starts.** Answering changes what is due; a queue that
  rearranged itself under you would show a card twice or skip one. A forgotten card is
  asked once more at the end of the same sitting (never twice — it is already coming
  back tomorrow). A quote deleted mid-sitting is skipped, not shown blank.
- **The blanks change every time** (`makeCloze(text, seed)`, the seed carrying the
  quote, how many times it has been answered and how many times it was shown this
  sitting): what you learn is the sentence, not the shape of one gap. Longer words,
  never the connective ones when a better exists; a line of short words hides its last
  word; 1 blank under 10 words, 2 under 25, 3 beyond. Any script (letters and digits,
  hyphen and apostrophe inside a word) and the pieces always rejoin to exactly the
  original — punctuation, dashes, newlines. `dir="auto"` so Arabic reads right to left.
  The blanks are computed once per card shown, **not per render**, or revealing would
  re-roll them.
- **The front gives nothing away**: digits do nothing until the words are shown (Space
  or Enter shows; 1–4 answer). Reveal marks exactly the hidden words and your notes on
  that quote follow. `Review` shows no filters or Export — those are about a list of
  quotes and this is a sitting.
- **⌘Z takes an answer back to exactly what it was**, including "never reviewed", which
  is no row at all (a DELETE, not a zeroed row).
- Read separately (`reviewsMissing`): without 20260034 the screen names the migration
  and every other mode of the board still works.
`scripts/library-review.mjs` — 53 assertions: the scheduler as a table, the queue's
limits, the cloze's invariants, and the whole sitting against a fake that enforces the
table's CHECKs and persists (answers, the repeat, the five-a-day limit across a
reload, undo of both kinds, the 20-card cap, a quote disappearing mid-sitting, the
missing migration). A first draft carried assertions of the form `a || b || true`
that could not fail; they were replaced with the exact figures.

## Library 7c — the year in review
`yearStats.ts` (pure), `YearReviewCard.tsx` at the foot of the Tracker. No migration:
it reads the books, sessions, quotes and lists already loaded, so it cannot disagree with them.
- **A book belongs to the year of its `finishedOn`.** Finished with no date is in no year,
  and the card says how many (`undated`) rather than quietly under-counting. The Dec 31 /
  Jan 1 boundary has a book on each side.
- **Nothing is averaged over what is not known.** Pages are summed over the books that have
  a count and print "(3 counted)"; fastest/slowest need both dates and ignore a finish before
  the start; a top author needs two books; an empty year gives `null`, never NaN. Ties go to
  the book finished first, so the answer does not depend on the order the server sent.
- **Quotes are filed by the reader's calendar year** (`getFullYear` of the instant), not UTC,
  or one saved at 00:30 on 1 January lands in the year before.
- **Copy summary** puts a Markdown recap on the clipboard (`yearMarkdown`), leaving out any
  line that would be zero, and an empty year is one sentence.
`scripts/library-year.mjs` — 40+ assertions; the first fixture run "failed" because the test's
own `book()` ignored `status`, a reading book counted as finished-undated. Fixtures are code.
The two year steppers (Goals, Year in review) share aria-labels: tests use `.first()`/`.last()`.

## Library 7d (part 1) — what a book cost
`20260035_library_spend.sql`, `spendStats.ts` (pure), `PurchaseCard.tsx` (a **What it
cost** card under *Get it*), and a **Spent on books** line in the Year in review. Part 2
of 7d — a wishlist price watch on the Shopping one — is separate and not built.
- **Four facts on the book, not a ledger entry**: `paid_amount`, `paid_currency`,
  `bought_on`, `bought_at`. The Library works without Finance (and its lock), and a price
  is a note about the book. Nothing here touches Finance's accounts or budgets.
- **Never converted.** Totals are **per currency** (`spendInYear`): 40 USD and 900 EGP are
  two figures, because the only rate that would join them is a guess about a day nobody
  recorded. Sums are in whole cents, so 0.10 + 0.20 is 0.30.
- **A year is the day it was bought**, not the day it was finished. A price with no
  currency or no date is in no total, and the screen says how many (`unplaced`) rather
  than counting it somewhere.
- **Pre-answered.** The first price typed brings today's date and the currency of the
  book you last priced — both on screen and editable — so the work is correcting.
- **A mistyped price is refused, never reinterpreted.** `parseMoney`: a separator
  followed by 1–2 digits is a decimal point, by exactly 3 a thousands mark (`1,299`,
  `1.299,50`, `1,299.50`); `12.5.5` and `12,3456` are `null`. The CHECKs in the table
  (`>= 0`, currency `^[A-Z]{3}$`) say the same thing to a client that skipped the form.
  The currency list is `Intl.supportedValuesOf('currency')`, not a typed few.
- **Optional columns, again.** `fromBook` sends the four once they hold something or once
  a row has come back carrying them (`spendColumns`), so a *cleared* price really clears
  (`null`) and a project without 20260035 keeps saving everything else — only the price
  is refused, and the notice names the column.
- **"Bought it"** appears only on a book that is both on the buy list and priced, and
  takes it off the list; nothing does that on its own.
`scripts/library-spend.mjs` — 29 assertions: the parser as a table, exact sums, year
edges, the left-out count, the Markdown, every write body (a clear is `null`), the CHECK
refusals, a reload, and the unmigrated project still saving a rating. The ink audit's
first book carries a price.

## Library 7d (part 2) — watching a book's price
`20260036_library_watch.sql` (`library_books.watch_item_id`), `priceWatch.ts`,
`WatchCard.tsx` (**Watch the price**, under *What it cost*, on any book not yet finished).
**The watch is Shopping's.** A watched book is one ordinary Shopping item in the category
`Books`, and the existing `shopping-price-watch` does the checking; the Library holds only
the pointer. Nothing was added to the edge function.
- **It exists only where Shopping can be read.** Shopping is a tab of Finance, so the card
  says "Finance is not on your plan" (and reads nothing — measured: zero `shopping_*`
  requests) or "behind the Finance lock", exactly as the assistant's tools refuse a locked
  ledger. The lock is the lock.
- **The pointer is written only after the item exists, and the card asks first whether it
  may be** (`watchSupported()`, a `select watch_item_id limit 1`): creating a Shopping item
  and then failing to remember it on the book is the worst order to fail in, and an orphan
  Shopping item keeps being scraped. Without 20260036 the card names the file and adds
  nothing. The probe answers "may I start" and nothing else — it must **not** make every save
  send the column (it did, and 6 older suites' fake projects, which accept any select,
  started refusing every write); that is decided by a row that carried the key.
- **"Gone" is not claimed before Shopping has been read.** The Shopping store only loaded
  when its own screen mounted, so an empty list meant "not read yet". `loaded` is true
  once a load returned items (a failed read does not count), the card loads it itself, and
  until then says "Reading your shopping list…". A pointer whose item is missing *after*
  that is said plainly, with **Forget it**; nothing then checks the price.
- **No store, no price — said before and after.** `storesToCheck` for a `Books` item with no
  store choice; with none, the card warns at start and while watching. The check is that
  one answer, not a second copy.
- **The price is a first match, not a fact.** The shops are searched by title and first
  author and the page is the first result, which can be another edition. The card says so,
  links the shop's own page, and shows the shop and how long ago (`checkedAgo`).
  The verdict against the target is to the cent (`verdict`).
- **The target is the Shopping item's** (`target_price_max`), edited on the card with the
  same parser as a price (`parseMoney`); a bad value saves nothing and says so.
- **Switching the watch on is Shopping's global setting**, so it is a button the person
  presses, not something starting a watch does silently. Check now is disabled until then.
- **Ending it is explicit and removes the Shopping item** (two-step: *Stop watching* →
  *Yes, stop and remove it from Shopping*), and **Bought it** on a priced book on the buy
  list ends the watch too. **Deleting the book does not touch the Shopping item** — a
  cross-module delete with no confirmation is the wrong default; it stays under "Books" in
  Shopping for the person to remove there.
`scripts/library-watch.mjs` — 37 assertions: the verdict/name/time maths, Finance off
(zero Shopping reads), no bookshop, the whole path against a fake with the shopping
tables and a faked price function (item made, pointer written after, the function asked
for this item at the Books store only, price/shop/verdict/link, target edit and clear, a
reload, stop with back-out, Bought it), a removed item only after Shopping is read, and
the unmigrated project. The fake's PATCH had to apply to the matched row — treated as an
upsert it created a store with no `categories` and crashed `enrichedItems`.

## Library 7e — new releases, found while the app is closed
`20260037_library_releases.sql` (`library_follow_news`, `library_follows.last_checked_at/last_check_ok`),
`20260038_library_releases_schedule.sql`, `supabase/functions/library-follow-check/`,
`_shared/releases.ts` + `_shared/releaseRun.ts`. A follow (3d) was only ever checked while the
Following view was open; a function now asks the same question daily and records what it finds.
- **News is a record of announcements, never the baseline.** `seen_keys` on the follow is still the
  only thing that decides what is new and "Mark all seen" still just widens it. A news row goes when its
  work is marked seen (client deletes it at once, the server sweeps stale ones each run), reaches the
  shelf, or the follow goes (cascade). *Read* (the bell lets go) is not *seen* (it stops being new): a
  find you have glanced at stays on the card until you say so.
- **The rules exist twice and are run against each other.** Deno cannot import the bundle, so
  `releases.ts` restates `followCheck.ts` + `bookLookup.ts`; `library-releases-agree.mjs` drives the
  app through its real fetch path and the server module over 32 seen × shelf combinations, with a control
  that the fixtures give different answers. It found a real fault in both: a work listed twice, the first
  listing owned, was announced from the second — **a work is owned if either listing is on the shelf.**
- **The pass is pure with its I/O handed in** (`runChecks`), so the test runs the real code with stand-ins
  that fail on demand: a catalogue failure costs that follow only and is stamped failed (never "nothing
  new"); a user without the Library, or whose shelf cannot be read, is skipped and their catalogue is not
  asked (announcing books they own is worse than a late alert); **a follow with no baseline is never
  announced from** (it would be the whole catalogue); one shelf read per user; a pause between asks, not
  before the first; never-checked first so a pass that runs out of time continues where it stopped; a
  per-follow cap, a follow cap and a time budget, with the rest *deferred*, not lost.
- **Two ways in, nothing else** (`mail-smart-run`'s arrangement): `x-cron-secret` = `CRON_SECRET`, or a
  signed-in user, who is limited to their own follows. `--no-verify-jwt` in `deploy-functions.yml` because
  the caller is pg_cron. The schedule migration reuses the two Vault entries 20260016 already needs
  (`project_functions_url`, `cron_secret`) and is a no-op without pg_cron/pg_net/Vault: the Following view
  still checks when opened.
- **The card shows the union**: what the live check found, plus the overnight finds it has not said (so
  the finds appear at once, and while the live check is reading or has failed), each work once. It says
  when the overnight check last looked and whether it could reach Open Library. The columns
  `last_check_*` are the server's; the client never writes them.
- **The bell has an eighth kind, `release`** ("New book from someone you follow"): unread, not seen, not
  on the shelf, only while the Library is on; clicking opens the Library; the matrix switch silences it;
  with 20260037 unrun it says so (`dormantKinds`). Opening the Following view marks the finds read after a
  moment.
`scripts/library-releases-run.mjs` (plain node, 17), `library-releases-agree.mjs` (7),
`library-news.mjs` (22). Not done: the function has not been deployed and nothing has run it against the
real Open Library from this machine.

