# Microsoft 365 accounts (Outlook calendar + mail, Teams links)

Status: **plan, nothing built.** Decided with the owner: Microsoft 365 / Outlook work accounts; **calendar and mail** in the
first version; the Google-side account fix shipped first (PR "calendar's own account").

Rule from CLAUDE.md applies to every step: **one assistant, three doors** — the in-app assistant, the Telegram bot and Siri
each get a capability in the same change, with the logic in `supabase/functions/_shared/`.

## Why this is a connector and not a flag
Today every account is Google: `google_accounts` + `google_account_tokens` (refresh tokens server-side only), the
`google-oauth` function mints access tokens, `CalendarHub` (`_shared/googleCalendars.ts`) is the bots' one answer to "which
calendars are mine", `googleCalendar.ts` is the web app's, and mail reads through `gmail.ts`. A Teams meeting is created by
Microsoft Graph, not by Google, so there is nothing to switch on in the existing path. A Google Calendar can only *show* a
Teams link added by the Teams add-on; the API cannot create one (the assistants say so already).

## Architecture
```
            ┌────────────── three assistants ──────────────┐
            │ app tools     telegram-bot      professor-siri │
            └──────────────────────┬─────────────────────────┘
                                   │  same _shared code
                     ┌─────────────▼─────────────┐
                     │  CalendarHub (providers)   │  list / create / patch / locate / pickWritable
                     └───────┬───────────┬────────┘
                    GoogleCalendarProvider   MicrosoftCalendarProvider (Graph)
                     google_accounts          microsoft_accounts
                     google_account_tokens    microsoft_account_tokens   (refresh token never in the browser)
```
- **`microsoft_accounts` / `microsoft_account_tokens`**: the same two-table shape and RLS as Google (metadata readable by
  the owner, tokens service-role only). `tenant_id` and `account_kind` (work/school vs personal) are columns.
- **`microsoft-oauth` edge function**: `save_account`, `refresh`, `delete`, mirroring `google-oauth`. Authorization-code
  flow with PKCE against the multi-tenant endpoint (`/organizations` — work and school accounts only; personal Outlook.com
  is out of scope unless asked), scopes `offline_access User.Read Calendars.ReadWrite Mail.ReadWrite Mail.Send`.
- **Provider seam for calendars**: `CalendarHub` gains a `CalendarProvider` interface (calendars, events, create, patch,
  delete, free/busy, `meet`/video). Google's code moves behind it unchanged; Microsoft is the second implementation.
  Event ids stay `eventId::calendarId` and gain a provider prefix only where ambiguous.
- **Video link is a provider capability**, replacing the hard-coded Meet: Google → `hangoutsMeet` if the calendar allows it
  (done); Microsoft → `isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness"` on the event, read back from
  `onlineMeeting.joinUrl`. A tenant that has Teams disabled returns no join URL — said, never invented (same rule as Meet).
- **Mail** uses the seam that already exists: `lib/mailProvider.ts` + `gmailProvider.ts` ("a second provider is a second
  file this size"). `microsoftMailProvider.ts` maps Graph messages to `NeutralMessage`; the smart-view server pass
  (`mail-smart-run`) learns to list/fetch/mark through it. Send/reply go through the same consent gate.
- **Consent gate unchanged**: inviting guests, replying and sending remain "outward" in `assistantGate.ts`; a Graph event with
  attendees emails them just as Google does, so `guests` / `add_guests` keep their approval.

## Small steps (each shippable, each with its own harness)
| # | Step | Done when |
|---|------|-----------|
| M0 | **Azure app registration** (owner action): multi-tenant, redirect URIs, secret → Supabase secrets `MS_CLIENT_ID/SECRET`; publisher verification started | secrets present, deploy asserts them like the Google pair |
| M1 | Tables + RLS + `microsoft-oauth` (save/refresh/delete), connect button in Settings → Connected accounts | a work account connects; token never reaches the browser (measured) |
| M2 | `CalendarProvider` seam; Google moved behind it with **no behaviour change** | existing `bots-invite-guests.mjs` (all assertions) unchanged and green |
| M3 | Microsoft calendar provider: read calendars + events, free/busy; web calendar shows them | events from a Graph stub render with the account's colour |
| M4 | Microsoft writes: create/patch/delete, **guests** (`attendees`), **Teams link** (`teamsForBusiness`) — in all three assistants | two-account test: the Microsoft token is on every Microsoft request; Teams link returned or honestly absent |
| M5 | Microsoft mail provider + smart-view pass (read, mark, archive) | `mail-action-sticks.mjs` pattern against a Graph stub |
| M6 | Mail send / reply / RSVP through Graph, behind the gate | approval card shows real recipients; one send per approval |
| M7 | Telegram/Siri parity sweep + prompts ("add a Teams link"), docs in `.claude/rules/` | `bots-as-assistant.mjs` extended; every tool present in all three files |
| M8 | Hardening: token expiry and revoked consent, throttling (Graph 429 + `Retry-After`), tenants that block third-party apps | each failure produces a sentence naming the account and the fix |

## Risks to settle before M1
1. **Admin consent.** Many corporate tenants block users from consenting to third-party apps requesting
   `Calendars.ReadWrite` / `Mail.ReadWrite`. Early adopters may need their IT admin to approve the app once. Publisher
   verification reduces the friction. Worth finding out early which of the early adopters' tenants allow user consent.
2. **Mail scopes are broad.** `Mail.ReadWrite` + `Mail.Send` is a significant grant; ask only for what each step needs
   (M3/M4 can ship with `Calendars.ReadWrite` alone, and mail scopes added at M5 with a re-consent).
3. **Personal Outlook.com / Hotmail** use a different endpoint and tenant model. Out of scope unless wanted.
4. **No live verification in this environment**: no Graph access and no Microsoft tenant here, so every step is proven
   against a stub that can refuse; a real tenant test needs an early adopter's account.
5. **Realtime**: Graph change notifications need a public webhook and renewal; first version polls, like Google.
