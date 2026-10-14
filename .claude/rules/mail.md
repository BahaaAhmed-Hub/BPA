---
paths:
  - "src/modules/inbox/**"
  - "src/lib/mail*.ts"
  - "src/lib/gmail.ts"
  - "src/lib/invitations.ts"
  - "src/lib/messageDoc.ts"
  - "src/lib/mailProvider.ts"
---

# Mail — the smart view, kinds, invitations and the reader

Loaded when a file this rule's `paths` names is read or edited — it is not
in context on every turn, which is the whole point. The root `CLAUDE.md`
holds what is true everywhere; this holds what is true here.

## Mail — Arabic, and every other right-to-left script
`lib/messageDoc.ts` builds the document every mail body is drawn in. Three
screens each built their own by hand and had already drifted — different
padding, different colours, and two of them reaching for `var(--sb-ink-1)` and
`var(--sb-info)` inside a **sandboxed iframe**, which cannot see the parent's
custom properties, so those rules resolved to nothing and always had.
- **A mail body arrives with no `dir` on anything**, so the frame's own
  direction decided it — left to right — for all of it. Arabic rendered with
  its full stops at the *start* of the line and its markers on the wrong side:
  the characters were right, their order was not.
- **`unicode-bidi: plaintext` is not enough, and finding that out needed a
  browser.** It reorders the *text* inside a block correctly and stops there:
  the computed `direction` stays `ltr`, so everything the box hangs off that
  property — the list marker, the quote rule, `text-align: start` — is still
  left-handed. `dir` is the property those read, so `dir` is what has to be set.
- **One `dir="auto"` on `<body>` is not enough either.** It takes the first
  strong character of the whole document and applies that one verdict to all of
  it, and business mail here opens with an English heading — so every Arabic
  paragraph under it would stay broken.
- So `markDirection` gives **every block its own `dir="auto"`**, via
  `DOMParser`, which builds a tree without running a script or fetching a
  resource. A block that already carries a `dir` is left alone: the sender said
  what they meant. `text-align` is never set — its initial `start` already
  follows whatever each block resolved to, and overriding an inline
  `text-align: left` would break every deliberately left-aligned layout to fix
  the ones that said nothing.
- **First-strong is the rule, with its edge accepted.** A list item opening
  `"Vouchers / Certificates:"` and continuing in Arabic resolves LTR and keeps
  its marker on the left, while the Arabic block inside it flips. A
  majority-script heuristic would fix that case and be wrong the other way
  round on genuinely English-led content.
Verified in Chromium against the **module the dev server serves**, not a copy:
9 `dir="auto"` injected; the Arabic paragraph starts 753px into a 760px block
and the English one at 0px; list body, blockquote and paragraph all compute
`rtl`; the quote rule moves to the right. An earlier run of this test proved
nothing — it called `markDirection` in Node, where `DOMParser` is undefined and
the function returns its input untouched, exactly as its guard says.

## Mail — several mailboxes, and the three ways of answering
`lib/gmail.ts` takes a `MailAccount` on every call (`accessToken(account)`: the
signed-in one from the session, a connected one from `tokenManager`). Nothing
here is "the app's mail" any more — it is always *an account's*.
- **`mailAccounts(primaryEmail)`** in `modules/inbox/mailAccounts.ts` is the
  whole set: the account you signed in with is not in
  `professor-connected-accounts`, so it is added here. `mail-account-view` holds
  `'all'` or one address.
- **All is the default.** Every mailbox is fetched in parallel and merged newest
  first; one that will not open names itself and the rest still arrive. Each row
  and the open message carry the mailbox, because otherwise a merged inbox is a
  list you cannot act on — you would not know where a reply leaves from.
- **`sendMail()` is the only sender.** Reply, reply-all, forward and new differ
  only in the fields. It does Cc/Bcc, HTML with a plain-text alternative,
  attachments (`multipart/mixed`), `In-Reply-To`/`References`, and RFC 2047
  headers so a non-ASCII subject survives.
- **Folders are queries.** Gmail has labels and a search language, so
  `FOLDER_QUERY` names the searches people mean — Unread / Inbox / Sent /
  Drafts / Starred / Archived — and `mail-folder` remembers the last one. Sent
  and Drafts show the *recipient* on the row; a list of your own name is not a
  mailbox view.
- **`Composer.tsx`** is that panel. From defaults to the mailbox the message
  arrived in. Reply-all drops **every** address of yours, not just that mailbox.
  A forward leaves the thread (no `threadId`, no `In-Reply-To`).

## Today — the mail card reads the mail and answers it
`lib/mailBriefs.ts` + `professor.briefInbox()`. The card used to show the first
140 characters of each message, which is a greeting and half a sentence. It now
shows **what the message is** and, where it wants an answer, **the answer**.
- **One call for the card, not one per message.** A morning inbox is six or
  eight threads; the model is better for seeing them together — it can tell the
  invitation from the thread the invitation is about — and it is one round trip
  instead of eight. `briefRun` (a ref keyed on the message ids) makes StrictMode's
  double effect, and any re-render, share the one call.
- **A brief is cached against the message, not the thread** (`today-mail-briefs`,
  7-day TTL). A new message in a thread is a new thing to answer; the same
  message read twice is not.
- **Never on the render path.** Rows draw the moment mail arrives; summaries land
  after. No key is the ordinary case on a fresh browser and is said once under
  the header, not down every row — and the header then counts what it honestly
  can ("3 addressed to you"), never "nothing wants an answer" about mail nobody
  has read.
- **The header counts by what each message wants, and the counts are the
  filter.** `MailStats` draws one chip per action — `to answer` / `to book` /
  `to decide` — and tapping one narrows the card to it. A count you cannot act
  on is decoration; the lit chip is how you know something is hidden, and
  `MailWaiting` carries the way back out. A filter whose chip drops to zero
  clears itself, or you are looking at nothing with no way back.
- **`MailWaiting` is the line that gets the card opened**: who has been waiting
  longest for an answer, by first name, and how long — "Hasan waiting 1d". No
  count ever did that. The informative totals sit after it in ghost.
- The 3px `MailMeter` is the action share, so a morning where everything wants
  you is nearly full and a quiet one nearly empty.
- **Nothing is sent from the card.** The draft area opens `DraftPopup` — To/Cc,
  the editable text, the original one click away, Rewrite, and the mailbox it
  leaves from named. A reply threads on the **RFC `Message-ID` header**, which is
  not the Gmail message id; `MailRow` carries both. A failed send keeps the text.
- Sending drops the row and forgets its brief. The `+` (add as task) left the
  row — the opened message still offers it.

## Mail — an invitation is an RSVP, not a reply
`lib/invitations.ts`. A Google Calendar invitation is an ordinary email carrying
a `text/calendar` part with `METHOD:REQUEST`. Answering it in prose sends the
organiser a pleasant note and **tells Google nothing** — your name stays in the
Awaiting column and the event never shows as accepted on your own calendar. So
an invitation row offers **Yes / Maybe / No / No, with a note** instead of a
drafted reply, and the draft is suppressed for it.
- **The calendar part is usually not inline.** Gmail puts an inline copy in the
  `multipart/alternative` *and* attaches `invite.ics`, and externalises whichever
  it likes — leaving `attachmentId` and no `data`. Requiring inline bytes meant
  every real invitation with an externalised part was missed, which is exactly
  what happened. `extractInvite` fetches the attachment, so it is async, and the
  read happens **after** the rows are drawn.
- **The invitations are keyed by message id, beside the rows, not inside them.**
  Written back into `mail` they were lost the moment the mail loaded again — and
  a run guard on the row set then refused to look a second time.
- **Every message in the thread is searched, newest first**, and every calendar
  part in each — a thread whose latest message is a reply still carries the
  invitation further up, and reading only the last one missed it.
- **`METHOD` is read from the part's content type as well as the body**, since
  senders set one or the other, and Gmail strips the parameters off `mimeType`
  so the body is usually the only one left. No METHOD at all still leaves a
  VEVENT with a UID, which is enough to answer.
- **Every event property comes out of the VEVENT** (`veventOf`), never out of
  the whole calendar. A Google invitation carries a `VTIMEZONE` *first*, and each
  DAYLIGHT/STANDARD block has a `DTSTART` of its own — the moment that rule
  starts, conventionally in 1970. Searching the file found Cairo's
  `19700424T000000` and every invitation rendered "Fri 24 Apr, 00:00". The same
  date on every row is the tell: it was not reading the event at all. `METHOD`
  is the exception — it belongs to the calendar, not the event.
- **A `DTSTART` with no `Z` is a wall clock in the zone its `TZID` names.**
  Reading it locally is right only by luck, for a Cairo event read in Cairo.
  `icsDate(raw, tzid)` takes the TZID off the property's own parameters and asks
  `Intl` for the offset *on that date*, so summer time comes from the browser's
  tz database rather than from the VTIMEZONE. An unknown TZID falls back to
  local rather than throwing.
- **`parseIcs` is exported so the parsing can be tested without Gmail around
  it.** The cases that matter: the Cairo invitation, a UTC time, a cancellation,
  an all-day date, London in summer and winter, a quoted TZID, a TZID that does
  not exist, and a folded SUMMARY — run with the clock set to several zones,
  because the answer must not depend on where it is read.
- **An invitation nobody could read says so.** Google's subject prefixes
  ("Invitation:", "Updated invitation:", …) tell "not one" from "one that went
  wrong", and the row names which — a silent fallback to a drafted reply is what
  sent us round this loop twice.
- **The answer is remembered against the UID** (`cal-invite-answers`, 30 days)
  and the message is **marked read**, so an answered invitation leaves a card
  that reads unread mail only. Component state alone lost the answer on the
  first refresh.
- **`UID` is the only shared identifier.** Google mints a different event id for
  every attendee's copy, so `findEventByICalUid` (`events.list?iCalUID=`) is the
  one way from the invitation to the row you can answer on. It asks `primary`
  first, then every writable calendar, because Google files it wherever the
  address is subscribed.
- **Only `self`'s `responseStatus` is patched**, and by PATCH, so nothing else
  on the event moves. `sendUpdates=all` lets Google tell the organiser — a
  second iMIP reply from us would be a duplicate with worse headers.
- **It never creates the event.** If Google has not put the invitation on a
  calendar there is nothing to patch, and the row says so and points at Google
  Calendar rather than inventing a copy the organiser's event knows nothing of.
- A `CANCEL`, or `STATUS:CANCELLED`, is not something to answer: the row says
  the organiser called it off. A `REPLY` is somebody answering an invitation
  *you* sent, so it is not treated as one at all.
- **A `[Cancelled] …` title counts too** (`titleSaysCancelled`). Plenty of
  organisers rename the event and send an update rather than cancelling, which
  leaves Google holding a live event that still wants an answer — so the row
  offered Yes/Maybe/No for a meeting its own summary said was off.
- **A cancellation removes nothing on its own.** Deleting a calendar row cannot
  be undone and the decision is yours, not the organiser's, so the cancelled row
  *offers* **Remove it from my calendar** (`removeFromCalendar` → find by UID,
  delete your copy only) and says "Off your calendar" once done.
- **"Not on any of your calendars" is a claim, and it used to cover failures.**
  `findEventByICalUid` returned `null` for a 403, an expired token and a dead
  network alike. `lookUpICalUid` returns the reason instead; `findOnCalendars`
  keeps the first one, and the message tells "we looked and it is not there"
  apart from "we could not look" — they point at different fixes. When Google
  genuinely has not filed it, that is the "Add invitations to my calendar"
  setting, and the row says so rather than sending you nowhere.
- **A series shows its next occurrence, not its first.** The DTSTART of an
  invitation to a weekly meeting is the day the series began, so "Bugs Review"
  read as a meeting in March. `parseIcs` reads the VEVENT's RRULE
  (`parseRecurrence`) and `nextOccurrence()` in `recurrence.ts` walks it — the
  first occurrence that has not *ended* at `now`, so one in progress still
  counts — and the row says "next Tue 15 Sept, 17:00 · every Tuesday", with
  the series start in the tooltip. A series that has run out keeps its first
  date and still says it repeated. The walk happens on the **event's own
  clock** (`lib/zones.ts`: a wall clock is a Date whose UTC fields carry the
  reading; TZID, `UTC` for a `Z` time, the reader's for floating), so a Cairo
  Tuesday is a Tuesday read in Tokyo and summer time moves the instant rather
  than the hour. `recur.mjs` runs the cases in four zones.
- An invitation always counts as **to book** in the header, whatever the model
  made of the wording.

## Mail — one toolbar, built out of the app's own controls
Search, what kind of mail, and how it is ordered were three boxes stacked down
the column — two of which wrapped onto a second line of their own — so a third
of the list's width-worth of height went on controls before a message appeared.
They are one `Card` now, and **every control in it is a platform component**:
`Pill` for the class filters (a filter is on or off), `Segmented` for sort and
for grouping (each is one of a small fixed set). The hand-built `classTab()`
pill is gone.
- **The filter rail is one line that scrolls.** Seven classes wrapped and pushed
  everything below them down; `.mail-filter-rail` is `flex-wrap: nowrap` with
  `overflow-x: auto`. The scrollbar is hidden — 15px of furniture under a 27px
  row that appears and disappears as counts change — so a **`mask-image` fade**
  on the right edge is the only thing that says there is more. It is drawn
  **only while there is** (`data-overflow`, measured by a `ResizeObserver`) and
  **not once you have reached the end** (`data-at-end`): a permanent fade is
  just a dimmed last pill. A class with nothing in it stays drawn and goes
  quiet, so the row does not reshuffle as mail arrives.
- **Sort is one `Segmented`, not four pills.** Date / Sender / Company /
  Subject, with ↑ or ↓ on the active one; pressing the key you are on turns it
  round, so four keys and two directions cost one control rather than five.
- **The group control right-aligns with `margin-left: auto`, never a spacer.**
  On one line the two are identical; when the row wraps a flex spacer eats the
  rest of the first line and drops the control to the *left* of the second.
- **The toolbar measures itself, not the window.** `container-type: inline-size`
  and a `@container (max-width: 500px)` rule drops the SORT eyebrow — what
  decides whether the two controls fit is the width of the column they are in,
  which is 360px with a message open and the whole page without one.

## Mail — whose business is this
`lib/mailCompany.ts` answers it for one message, and the answer is the
**counterparty first**: the sender's domain matched against your companies, then
the other addresses on it, and only then the mailbox it landed in. A colleague at
one of your companies writing to your personal address is that company's mail
whatever inbox it reached; a client writing in from a domain you have never heard
of is about the business whose inbox they wrote to. Past that nothing is guessed —
a personal address into a personal mailbox has no company and the row says
nothing, because a label that is wrong some of the time is worse than no label:
you cannot tell which times.
- **The chip is on both views.** A coloured dot in the company's own colour plus
  its name, beside the sender, in the flat list and in the smart view.
- **The mailbox chip answers a different question** and stays: *where did it
  land* is not *what is it about*, and the two differ often.
- **Sort sits beside the filters, on their line.** It had a row of its own under
  them; a list's controls belong together rather than stacked. Under 470px of
  *the toolbar's own width* it drops underneath instead, because the sort
  control is a fixed ~250px and pinning them side by side at every width left
  the filter rail showing "All" and half of a second pill.
- **The list column grows with the window** — `clamp(340px, 36vw, 640px)`. It
  was pinned at exactly 360px, so on a 2200px screen the mail was a strip beside
  1700px of reading pane, and its toolbar could never fit both controls on one
  line whatever the screen.
- **Sort is Date / Sender / Company / Subject**; the one you are on turns round
  when pressed again, which is what a sortable column has
  always done and what a second control for it would be. Each says what its two
  directions mean in its tooltip, since "Date ↑" does not say which end is which.
  Mail belonging to no company of yours sits at the bottom **whichever way round
  the sort is** — it is a remainder, not a name.
- **There is no grouping control.** There was a `Flat / By company` switch, and
  it went: sorting **by** company already puts a company's mail together, so two
  controls were answering one question. (`components/ui/SectionCard.tsx` went
  with it — the smart view had already stopped using it for its own views, and a
  UI primitive nothing renders is worse in a shared index than absent.) Kept per
  browser in `mail-sort` and `mail-sort-asc`.

## Mail — why a thread you archived kept coming back
Two bugs, and the second undid the first:
- **`archived_at` was written on every archive and read by nothing.** The row
  left the screen, and the next pass loaded it straight back out of the store
  and put it where it was. `visibleThreads` now drops a thread whose
  `archivedAt` is at or after its newest message — the comparison is against
  `lastAt` rather than a flag, so a **reply** to something you archived brings
  it back, which is what Gmail does with the thread and the only behaviour that
  does not quietly swallow an answer you were waiting for.
- **`factsToRow` hard-coded `muted: false, archived_at: null,
  acknowledged_at: null`.** Every pass that re-stored a thread wiped all three,
  and the backfill re-stored *any* row with no summary — so muting something
  the nightly run had left blank destroyed the mute on the next open. It takes
  the cached row now and carries the marks forward. `handled_at` is the one
  deliberate exception: it means "dealt with for now", and the function is only
  called about a thread that has changed.
- `handled` is likewise read as a *moment*, not a flag: a message arriving after
  you marked it done un-marks it.
- Archive writes `archivedAt`, **not** `muted` — muting would hide the reply
  too, which is not what archiving promises. The Bin does set `muted`: that one
  is gone.

## Mail — the primary account's token, and the hour it stopped working
`eng.bahaa.a@gmail.com could not be read — Request had invalid authentication
credentials…` Three faults stacked:
- **`App.tsx` stamped an unverified token as fresh.** When Supabase had no new
  `provider_token` on a session restore it wrote `Date.now()` against the
  *existing* one — its own comment said "the token itself may still be valid;
  we just reset the staleness timestamp". A token Google issued three hours ago
  was therefore brand new to `isTokenStale()`, and the refresh ladder under it
  was never climbed once. **A stale stamp costs one refresh call; a false fresh
  one costs every request until the clock runs out.** The branch is gone.
- **`gmail.ts` never refreshed at all.** `accessToken` read `provider_token` off
  the session — only there in the minutes after an OAuth sign-in — and
  otherwise whatever was cached. It calls `refreshPrimaryToken()` now, the
  ladder the calendar has used all along, and `gFetch` retries **once** on a
  401 with a force-refreshed token. A token that comes back identical to the one
  Google just rejected throws immediately: forty threads would otherwise make
  forty identical requests.
- **`refreshPrimaryViaEdgeFn` posted to a relative URL** whenever
  `VITE_SUPABASE_URL` was unset — `as string ?? ''` catches undefined and yields
  the empty string — so the refresh hit whatever host served the page, got the
  app's own HTML, and looked like a refusal. It uses the client's own
  `supabaseUrl` now.
- **The banner says what to do.** Google's prose is addressed to whoever wrote
  the app; `isAuthReason` recognises it (and `MailAuthError`) and the row becomes
  "<address> needs signing in to Google again" with the button that fixes it.

## Mail — an announcement is not a person writing to you
`kindOf` used to call a thread a `reply` unless its **subject** proved
otherwise, so "Anghami installed on Hania's device" from `no-reply@google.com`
arrived in the list of things you owe an answer to, with a Draft button under
it. Nobody at that address is waiting. The order is the other way round now:
- **A no-reply address can never want a reply.** `NO_REPLY_SENDER` — the local
  part says so in so many words — is `security` if the subject is about a
  sign-in and `update` otherwise. Never `reply`: offering to write to a mailbox
  that discards it is a contradiction.
- **A role address is an announcement unless the thread is a conversation.**
  `ROLE_SENDER` (`events@`, `marketing@`, `support@`, `team@`…) demotes only a
  **first** message that does not name you and that you have never written in.
  A `Re:`, a thread of three, a message that says your first name, or one you
  have answered stays a conversation whatever the address — which is why a
  support ticket you are in the middle of is not filed as noise.
- **Information is information whoever it was addressed to.** `update` always
  lands in FYI. It used to go to *worth knowing* when addressed to you, which
  made that group the place everything automated ended up, beside the sign-in
  alerts that genuinely wanted acknowledging.
- **A campaign goes, and nothing else does.** The old second clause — discard
  automated mail where the row has nothing but a Draft button — was doing
  `kindOf`'s job from the spelling of one address, and threw away a support
  thread for it. Both implementations now say only `!looksCampaign`.
- **`in:inbox`.** The pass read All Mail, which is everything you have ever sent
  and everything you have ever archived — so a forward you wrote to yourself was
  a thing waiting on your answer, and archiving did not take a row out. Fixed in
  the browser adapter and in the nightly function together.
- **Personal is a tag, not an absence.** `tagOfMail` gives mail on a mailbox you
  have *not* marked as work the word **Personal**, in the muted ink. It is not a
  guess — you say which mailboxes are work in Settings. Mail on a *work* mailbox
  from a domain that is none of your companies still gets nothing: that is a
  client, and calling it personal would be wrong rather than merely unhelpful.
- **Hiding a company hides its mail here too.** `visibleThreads` filters through
  `isMailHiddenByCompany`, including rows the nightly run stored before it was
  hidden.
- **Dismiss and Mute are two controls**, because they were two promises under
  one bell: dismiss takes *this message* out and a new one on the thread brings
  it back; mute is the thread, for good.
- **The reader is `calc(100dvh - 118px)`, and the message frame has no ceiling.**
  `calc(100vh - 150px)` guessed at the chrome above it and came out short, and
  the frame was capped so the body scrolled inside a box inside a scrolling
  panel. The frame is now as tall as the message and the panel is what scrolls.
  It needs `allow-same-origin` to be measurable at all — safe **only** because
  `allow-scripts` is absent and always will be: nothing in a message can run, so
  same-origin grants it nothing and grants us a height.
- The reader carries the row's own decisions too — Make a task, Done, Mute, and
  RSVP or Acknowledge where the kind calls for them. Reading a message is when
  you decide what to do about it.

## Mail — a bulk action you cannot see is one that did not happen
Select all in **Internal FYI**, click an action, and seventy-eight rows sat
exactly where they were. Two faults, and either on its own was enough.
- **An FYI row had no checkbox.** A quiet row is drawn as a compact one-liner
  — it was a single `<button>`, and a checkbox cannot live inside a button, so
  it simply had none. `Select all` added all 78 keys, the bar said *78
  selected*, and **not one row on screen showed any sign of it** (measured: 0
  of 78 ticked). A selection you cannot see is one you cannot trust. The row is
  a `div` with the text as the button now, exactly as `Row` is built, and it
  carries the same checkbox and the same picked tint.
- **FYI is where "done" goes.** `grouped` files a handled thread under `fyi`
  whatever its own section, and a thread filed there in the first place is
  there because nothing is wanted of it — so **Mark done** moved a row from fyi
  to fyi, and **Dismiss**, which *is* Mark done under the name that says what
  it promises, did the same. Seventy-eight server writes, no change on screen.
  Neither is offered in that view any more.
- **Put back is the move only this view has**, and it had no button at all.
  `onHandled(sel.filter(t => t.handled), false)` — and the count on the button
  is of those rows only, because "Put 78 back" about rows that were never taken
  away is a lie about what the click will do. A row put back leaves FYI for the
  group it came from; one that was always FYI stays, which is correct.
Archive and Mute were right all along: both write `markSmart` fields that
`visibleThreads` filters on, so the rows leave.
`scripts/smart-bulk-applies.mjs` is the measurement — 78 stored threads, half
of them handled-out-of-`action`, half natively FYI. 10/10 after; the control on
the old code fails 5, the first being the 0 ticked checkboxes.

## Mail — the four are views, not sections
Four collapsible sections stacked down the page meant scrolling past the three
you were not working on to reach the one you were; folding them away traded that
for four headers and a memory of which you had shut. They are **views** — one at
a time, picked from the same `Pill` rail (`.mail-filter-rail`) the ordinary list
filters by class with — plus **All**.
- **All is a real answer, not a fallback.** The whole window in one list, in the
  order the pass gave it (what you are holding up first, then newest), so a row
  keeps its place whichever view you came from. Each row carries a
  **`SectionDot`** naming its group, which is what the section header used to
  say; the dot is drawn *only* in All, since anywhere else you have just asked
  that question by picking the view.
- **Each view says what it is.** "Worth knowing" and "On your radar" are not
  self-explanatory and nothing on screen said which was which. The blurb is on
  the pill's tooltip and again above the list you are reading.
- **A count prints even when it is 0.** Blank reads as *not known* where a nought
  reads as *none*, and telling those apart is the whole point of a count.
- **The header stopped repeating the rail.** It said the same four numbers a
  second time; it now says the one thing none of them does — how many people are
  actually waiting on you (`bottleneck && !handled`).
- **The reply state sits with the sender and the date**, not at the left of the
  actions row. There it had a whole line to itself whenever the buttons wrapped
  away from it — a four-line row for three lines of content — and it is a fact
  about the thread, like the date, rather than a thing you do.
- **3px between a row's lines, not 5**, and `9px 14px` of padding. A row is one
  thing said on three lines; spacing them like paragraphs made eight threads a
  page of scrolling.
- **The actions share the sentence's line**, at its right, which is where a mail
  client has always put them. They had a line of their own under everything
  else, so every card was four lines tall and a screen held six. The sentence
  gives way first — one line, ellipsised, the whole of it on hover — because a
  truncated summary beside a reachable button is a better row than a full
  sentence above one. It wraps rather than crushing below about 600px. A card
  is **93px** now against 112, and 164 against 183 with a draft on it.
- **The reader's envelope is labelled fields, not a notation.** `from@x → to@y ·
  cc z` is something you decode rather than scan: it gives Cc no more weight
  than an arrow and has nowhere to put Bcc at all. FROM / TO / CC / BCC down the
  left, each absent when empty — Bcc therefore appears only on your own sent
  copy, which is exactly where it is worth seeing.
- **A row shows the name or the address, never both.** `"Name" <address>`
  repeated down six recipients is a wall in which the names — the only part
  anybody reads — are the minority of the characters. `nameOf` falls back to the
  address where there is no name, and the raw header is on hover, so nothing is
  lost, only stacked.
- **Splitting that header on `,` invents people.** A display name may contain a
  comma and corporate directories are full of them: `"BahaaElDin
  Amar-AbdElSalam, Vodafone" <…>` is one person, and a naive split makes a
  second whose name is a company and who has no address at all. `addressList`
  separates only on a comma that is outside quotes **and** outside angle
  brackets (`<a,b@x>` is one address too).
- **And the names are joined with a middle dot, not a comma**, for the same
  reason read backwards: half of them already contain one, so a comma between
  them is the same character doing two jobs and five people render as eight.
  Checked on the real header: 5 parsed, 5 rendered, no address in the text.
- A row's *shape* belongs to the row: an FYI thread is one compact line whether
  you are looking at FYI or at everything. `mail-smart-view` remembers the view;
  changing it clears the selection, which was aimed at rows the next view does
  not show.

## Mail — the smart row, and the thread beside it
- **The title line is subject on the left, company on the right.** It used to
  be one wrapping row of subject, sender, date, company and the waiting flag, so
  the chip landed at a different x on every row and the column read as five
  things that had drifted. A label you scan down has to be pinned to an edge,
  not pushed along by whatever precedes it. Sender, date and *Waiting on you*
  are the second line.
- **The mailbox is named only when it says something the chip does not.** With
  the company resolved from that same mailbox the two were the identical word
  twice on one line.
- **The draft is in the row, not behind a button.** "Review the reply" meant the
  one thing the pass produces that saves any time was invisible until you asked.
  Two clamped lines sit in the mail's own area with **Send** (the only control
  in the view that sends), Edit (the composer, seeded) and Discard. A failed
  send keeps the words: losing what you wrote is the expensive half.
- **The composer lives in both views, or Edit is a button that does nothing.**
  `handleSmartDraft` set `compose` and the file's only `<Composer>` sat inside
  the *flat* list's selected-email panel, reading `selectedEmail.id` — which the
  smart view never renders. So Edit set state nothing drew. The smart branch
  renders its own, in the right-hand column with the reader hidden behind it
  (one column, not two), seeded To / subject-prefixed-once / the draft as
  paragraphs; sending does what the row's own Send does — acted, `forgetBrief`,
  `forgetWaiting`, `markHandled`.
- **An action is over once it is taken.** `SmartThread.acted` is a receipt for
  the gesture — session-only, deliberately unstored — and the row shows it in
  place of the buttons. Leaving *Make a task* lit beside a task that now exists
  invites a second one and says nothing about the first.
- **A task is named for the thing to do, not the thing it is about.**
  `taskTitleFor`: the triage's own sentence first, then the kind ("Answer the
  invitation: …"), and the subject last rather than by default — a board of
  tasks called "Fw: Re: SAWA Cloud Hosting request" says nothing a week later.
- **Every action reaches Gmail.** Archive removes INBOX, Delete moves to the
  Bin, the tick removes UNREAD (a thread you have dealt with is one you have
  read; leaving is what Archive is for), opening one marks it read. An archive
  the server refuses **puts the row back** and says so — a row that left here
  and not Gmail is a lie you will never look for again.
- **`SmartReader.tsx` — the thread, docked right.** Clicking a row used to
  switch to the other view and hand a *thread* id to a list indexed by *message*
  id, so it changed the whole screen and selected nothing. It is a column
  beside the list, not a modal over it: the list is the queue you are working
  down. Reply / reply-all / forward hand to the composer; archive, bin, mark
  unread and Open in Gmail act on the server. The whole thread is there with the
  newest expanded and the rest one line each, since every reply quotes what it
  answers. The body is a **sandboxed iframe with no `allow-scripts` and no
  `allow-same-origin`** — a message is somebody else's HTML — sized to its own
  content so the panel scrolls once. Width is `mail-reader-width` (clamped
  380–820); `.mail-smart-reader` in `index.css` takes it to 46% under 1280px
  and stacks it under the list below 1000px, because an inline width beats
  every stylesheet rule and a media query needs a class to argue with.
- **Opening the tab draws the stored rows before a single byte of mail is
  fetched.** `runSmartPass({ onCached })` fires with what Postgres already holds
  — that is what the table is *for* — and the pass adds to it. A reading also
  stands for five minutes (`SMART_STALE_MS`), so flicking between tabs costs
  nothing. `visibleThreads()` filters and sorts both the early paint and the
  final result, or the list would visibly reshuffle a second after appearing.

## Mail — the smart view, and what a thread actually wants
`lib/mailKinds.ts` answers *what kind of thing is this*, from headers and the
subject alone — no model call, so a row knows the instant it is drawn.
`invitation` / `cancelled` / `security` / `update` / `reply`, and the kind is
what the row offers:
- **A sign-in alert with a Draft button is how a list teaches you to stop
  reading it.** "Needs your attention" was carrying a renewal waiting on an
  answer, a meeting invitation, a login notice and a cloud status page, all
  with the same three buttons — and only one of the four wants words back. So
  the first group is split in two: `action` is what you owe somebody,
  `attention` is what you should know. Four sections, each collapsible, the
  open set kept in `mail-smart-open-sections`.
- **An invitation gets Yes / Maybe / No**, through the app's own RSVP
  (`respondToInvite`), because answering in prose tells the organiser's calendar
  nothing — a mistake this app made once already.
- **A machine's notice gets Acknowledge, and stays.** "Keep it while allowing me
  to acknowledge" is the whole request: the row is marked *Seen* and remains in
  the list. Archive or Ignore is how one leaves. Taking it out for having been
  read would mean the only record that you looked is that it is no longer there.
- **A machine is never a bottleneck.** `bottleneck` is gated on
  `canNeedAction(kind)` in both implementations — "waiting on you" over a status
  page is how the flag stops meaning anything on the rows where it is true. The
  same row drops the "No reply" chip and the Follow up button, which are true
  and useless about a status page.
- **What is discarded is stated once, the same way on both sides.** A campaign
  goes whatever its subject says (`looksCampaign` / `classifyMail`'s
  `newsletter`); other automated mail goes only where the row would have nothing
  but a Draft button to put under it — `canNeedAction(kind)`. That is what was
  throwing away every sign-in alert and every status notice.
- **Only a plain `reply` costs a model call.** The other four kinds say the same
  thing every time they arrive, so `KIND_NEED[kind]` writes the sentence and the
  tokens are not spent — in the browser and in the nightly edge function alike.
- The rules exist twice (Deno cannot import the app's bundle).
  `scripts/mail-rules-agree.mjs` runs 23 fixtures through both and fails on any
  disagreement, kept/discarded included.
- **And they drifted, exactly where the suite exists to catch it.** A commit
  that stopped digests leaking into *action* changed `mailKinds.ts` and added
  a mirror to the server's `looksCampaign` — but the two were never the same
  shape. The browser asks in two steps: a **newsletter** goes, and a
  **notification** goes only where `canNeedAction(kind)` is false. The server
  asked one: a regex over the sender's **local part** — `team@`, `support@`,
  `info@` among them — which decided *kept at all*, on its own. So a support
  ticket you were in the middle of, and a `team@` message that addressed you
  by name, were `action` in the app at 9am and **discarded** by the nightly
  pass at 3am. One thread, two answers, and nothing on screen to say which had
  run; the only reason it was ever found is that the suite compares `kept`.
  A local part says a message is **bulk** and nothing more — whether bulk is a
  campaign or a receipt is `classifyMail`'s question, and it has to be asked
  before anything is thrown away.
  So `supabase/functions/_shared/mailClasses.ts` is the classifier's twin and
  `keepThread` is now the browser's own two sentences; `looksCampaign` is
  `classifyMail(…) === 'newsletter'` and its two regexes are gone, so there is
  one answer rather than two. The new rule is broader where it should be (an
  ESP domain, a `mail.` subdomain, an unsubscribe line in the body) and
  narrower where it must be. The **account-is-work** half stays with the
  browser — `index.ts` asks it separately — which is also the generous side: a
  row stored and then filtered on display is recoverable, a row never stored
  is not.
  Measured as a **diff of the whole fixture table before and after**, not just
  of the two rows: the nightly column moves on **exactly two** of 23 and
  nothing else moves at all — which is what stops "keep everything" passing,
  since six fixtures are still discarded on both sides. `20260017_mail_smart_kinds.sql` adds
  `kind`, `muted`, `archived_at`, `acknowledged_at` and widens the section check.

## Mail — the week's mail, sorted by what it wants
`lib/mailClasses.ts` decides the kind from the message itself — the list headers
(`List-Unsubscribe`/`-Id`/`-Post`), `Precedence`, `Auto-Submitted`, the campaign
headers the big platforms stamp on, the sending address and its subdomain, and
failing all that an unsubscribe line in the body. **No model call**, so the tabs
are there the instant the mail is and they are the same on every device.
- **Six classes, each implying a different action.** A split that does not change
  what you would do with the mail only costs you a decision, so "important / not
  important" is not one: `needs-you` → draft, `invitation` → RSVP (nothing here),
  `copied` → mark read, `notification` → archive, `newsletter` → archive,
  `other` → nothing. Order binds strongest-first: an invitation is one whoever
  sent it, a campaign is one even when it greets you by name.
- **Every tab is always drawn, counts and all**, so one that empties does not
  vanish and shift the ones beside it; an empty tab says what would live there.
- **Nothing is ever sent by drafting.** The class action and the message's own
  Draft button both do one batched `briefInbox` call (max 8) and fill the box
  under the mail — "DRAFT REPLY · NOT SENT" with Delete and Send. **Send is the
  only thing in the module that sends.** The list row carries a Draft pill, or a
  bulk draft across eight messages is invisible until you open each one.
- **Clicking the draft opens the full composer**, seeded with what is written,
  paragraphs kept (`<p style="margin:0 0 1em">` — the editor is a contenteditable
  with its own reset, so a bare `<p>` arrives with no spacing). The small box
  hides while that window holds the same text, and the triage card's
  "ready-to-send reply" does not sit under a draft that already is one.

## Mail — swiping a row, and acting on many
`SwipeRow.tsx` wraps every list row. Right marks read — or **unread**, since a
gesture that only works one way is a no-op half the time. Left pulls the row
aside and leaves Archive and Delete behind it until you pick one, swipe back or
tap elsewhere. Four rules it exists to keep:
- **Vertical scrolling survives.** The axis is decided once, past an 8px slop,
  and never revisited; `touch-action: pan-y` leaves the browser to scroll until
  the pointer is captured.
- **A swipe is not also a click.** A drag ending elsewhere still fires `click`
  on the row. Swallowed in the capture phase — but the gesture's own click and a
  real tap must be told apart by `moved`, or the click that *ends* the opening
  swipe closes it again in the same gesture and the swipe looks broken.
- **The action buttons are exempt from that guard** (`actions.current.contains`).
  Closing on a tap there stopped the click before its own button saw it: the
  buttons appeared and did nothing.
- **One row open at a time**, owned by the list. Pointer events, not touch —
  the same choice the Financials and goals drags made.

Selection: the avatar toggles a row, **shift-click takes the run** from the last
one picked. The bar offers Select all / Mark read (one toggle, not two buttons) /
Move / Archive / Delete.

**Every one of these is undoable** — both ways in are cheap enough to do by
accident. Gmail is the truth, so undo puts the labels back rather than restoring
a snapshot, and the row returns to the list with it.
- `byAccount(rows)` groups first: ids and token both belong to one mailbox, so
  an action over a merged inbox is one `batchModify` per mailbox.
- **Only labels every visible mailbox shares** are offered to move to, or half a
  selection moves and the rest fails.
- **Delete means the Bin**, and says so. `gmail.modify` cannot erase a message —
  that needs full `mail.google.com` — and a swipe should not destroy mail. No
  batch endpoint bins mail, so that one is a call each via `messages/trash`.

## Mail — one answer to "what needs me", and one way to act (Mail page · Today · assistant)
`lib/mailNeeds.ts` (read) and `lib/mailActions.ts` (act). Three screens had three judgements — the
Mail page from stored analysis, the Today card from its own sender rules over an unread query, the
assistant from a raw Gmail search the model had to judge itself — so one thread could be an action,
a newsletter and a line in a list at once. The smart view's stored analysis is the authority now.
- **`readNeeds(accounts)`** = the smart view's own `visibleThreads` over `mail_smart_threads`,
  grouped by `groupOf` (**handled is always FYI**, which SmartView now uses too). `null` means "could
  not ask", never "nothing". `stored` vs `byKey` separates *a decision you made* (archived, muted,
  handled — in the store, not visible) from *never analysed* (not in the store).
- **Today** judges a thread the store holds by the store (`needsYou` = section is action; a handled,
  archived or muted thread leaves the card) and falls back to its own `looksLikeBulk` rules only for a
  thread the store has not read yet — showing a new message beats hiding it. The fallback is the thing
  still to delete (its rules are the third copy); the header's answer/book/decide chips are still the
  model's `briefInbox`.
- **The assistant** has `mail_needs` (the same list: action / attention, with what is wanted) and its
  `list_emails` description says it carries no judgement; `archive_email` takes a `thread_id`.
- **Acting is server first, whichever screen.** `archiveThread` is a **thread** modify in Gmail (Today
  and the assistant archived one *message*, which leaves a thread with other INBOX messages in the
  inbox) and **Today swallowed a refusal** — the row left the card and the mail never left Gmail. It now
  comes back with "Not archived — why". `answerInvitation` = the real PATCH of your attendee status on
  the event (`sendUpdates=all`, the organiser is told), then marks the thread handled and read. Nothing
  is marked unless Gmail / Calendar said yes, so no screen shows a state the mail does not have.
- Not done on purpose: the assistant has no RSVP tool; Today's own bulk rules and `mailClasses.ts` are
  still in the tree (cleanup is its own change); the Today card still lists only unread mail.
`scripts/mail-unified.mjs` (22) — Gmail and Calendar faked and able to refuse; every claim read off
the request that went out. Control on the old code: Today still lists the handled and archived
threads and the assistant has no `mail_needs`.
