import type Anthropic from '@anthropic-ai/sdk'
import type { Task } from '@/types'
import { archiveMessage, extractBody, getThread, type GmailMessage } from './gmail'
import { archiveThread, answerInvitation } from './mailActions'
import { readInvite } from './invitations'
import { readNeeds } from './mailNeeds'
import { parseGuests } from '../../supabase/functions/_shared/guests.ts'
import { meetRequest, meetLinkOf, meetSentence, supportsMeet, noMeetSentence } from '../../supabase/functions/_shared/meet.ts'
import { APP_GUIDE, findGuide } from './appGuide'
import { mailAccounts } from '@/modules/inbox/mailAccounts'
import { type ConnectedAccount } from './multiAccount'
import { getGoogleToken } from './tokenManager'
import { refreshPrimaryToken } from './googleCalendar'
import { loadLogs, commitHabitLogs, getHabitColors, useHabitsStore, type Habit } from '@/store/habitsStore'
import { FINANCE_TOOLS, FINANCE_TOOL_NAMES, executeFinanceTool } from './financeTools'
import { LIBRARY_TOOLS, LIBRARY_TOOL_NAMES, executeLibraryTool } from './libraryTools'
import { SETTINGS_TOOLS, SETTINGS_TOOL_NAMES, executeSettingsTool } from './settingsTools'

// ─── Context provided by the React component ─────────────────────────────────

export interface ToolContext {
  tasks:        Task[]
  addTask:      (t: Omit<Task, 'id' | 'createdAt'>) => void
  updateTask:   (id: string, updates: Partial<Task>) => void
  deleteTask:   (id: string) => void
  accounts:     ConnectedAccount[]
  primaryEmail: string
  habits:       Array<{ id: string; name: string; emoji: string; frequency: string; isActive: boolean; type: string; goal?: number; unit?: string; image?: string }>
}

// ─── Token helpers ────────────────────────────────────────────────────────────

async function primaryToken(): Promise<string> {
  return (await refreshPrimaryToken()) ?? localStorage.getItem('google_provider_token') ?? ''
}

async function tokenForEmail(email: string | undefined, ctx: ToolContext): Promise<string> {
  if (!email || email === ctx.primaryEmail) return primaryToken()
  const acc = ctx.accounts.find(a => a.email === email)
  if (!acc) throw new Error(`Account "${email}" is not connected. Use list_connected_accounts to see available accounts.`)
  // Use tokenManager: memory cache → Edge Function refresh → Supabase bootstrap fallback
  const token = await getGoogleToken(email)
  if (token) return token
  throw new Error(`The access token for ${email} has expired. Please reconnect this account in Settings → Connected Accounts.`)
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

interface GmailHeader { name: string; value: string }
interface GmailMsg { id: string; snippet: string; payload: { headers: GmailHeader[] } }
interface GmailThread { id: string; messages: GmailMsg[] }

async function gmailGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    if (res.status === 401 || res.status === 403)
      throw new Error('Google token expired or revoked. Please reconnect this account in Settings → Connected Accounts.')
    throw new Error(b?.error?.message ?? `Gmail ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function gmailPost(token: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    if (res.status === 401 || res.status === 403)
      throw new Error('Google token expired or revoked. Please reconnect this account in Settings → Connected Accounts.')
    throw new Error(b?.error?.message ?? `Gmail ${res.status}`)
  }
}

async function calGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    if (res.status === 401 || res.status === 403)
      throw new Error('Google token expired or revoked. Please reconnect this account in Settings → Connected Accounts.')
    throw new Error(b?.error?.message ?? `Calendar ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ─── Which calendar, on which account ─────────────────────────────────────────
// A company's calendar lives on a connected account, so an event on it must be read and written with *that*
// account's token — never the signed-in account's, and never `primary` of whichever account is the default.
// `cal-intel-cals-cache` (written by the calendar) is the only place a calendar id is tied to an account.

interface CachedCal { id: string; summary: string; accountEmail: string; accessRole?: string; primary?: boolean }
export interface CalTarget { token: string; calendarId: string; accountEmail: string; name: string }

function cachedCals(): CachedCal[] {
  try { return JSON.parse(localStorage.getItem('cal-intel-cals-cache') ?? '[]') as CachedCal[] } catch { return [] }
}
function hiddenCals(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('cal-intel-hidden') ?? '[]') as string[]) } catch { return new Set() }
}
const isWritable = (c: CachedCal) => c.accessRole === 'owner' || c.accessRole === 'writer'

/** `eventId::calendarId` is what listing hands back, so an edit knows where to go; a bare id still works. */
export function splitEventRef(ref: unknown): { eventId: string; calendarId?: string } {
  const raw = String(ref ?? '').trim()
  const i = raw.indexOf('::')
  return i < 0 ? { eventId: raw } : { eventId: raw.slice(0, i), calendarId: raw.slice(i + 2) || undefined }
}

/** A calendar named loosely ("teradix") — id, then name, then the account's address. */
function matchCal(cals: CachedCal[], want: string): CachedCal | undefined {
  const q = want.trim().toLowerCase()
  return cals.find(c => c.id.toLowerCase() === q)
    ?? cals.find(c => c.summary.toLowerCase() === q)
    ?? cals.find(c => c.summary.toLowerCase().includes(q))
    ?? cals.find(c => c.accountEmail.toLowerCase().includes(q))
}

export async function resolveCal(input: Record<string, unknown>, ctx: ToolContext, forWrite: boolean): Promise<CalTarget> {
  const { calendarId: fromRef } = splitEventRef(input.event_id)
  const want = fromRef ?? (typeof input.calendar === 'string' && input.calendar.trim() ? input.calendar : undefined)
  const acct = input.account_email as string | undefined
  if (want) {
    const pool = cachedCals().filter(c => !forWrite || isWritable(c))
    const hit = matchCal(pool, want)
    if (hit) return { token: await tokenForEmail(hit.accountEmail || undefined, ctx), calendarId: hit.id, accountEmail: hit.accountEmail, name: hit.summary }
    // An id that came from a listing but is not in the cache: trust the id on the named (else default) account.
    if (fromRef) return { token: await tokenForEmail(acct, ctx), calendarId: fromRef, accountEmail: acct ?? ctx.primaryEmail, name: fromRef }
    const names = cachedCals().filter(c => !forWrite || isWritable(c)).map(c => c.summary).join(', ')
    throw new Error(`No ${forWrite ? 'writable ' : ''}calendar matches "${want}"${names ? ` (you have: ${names})` : ''}. Nothing was changed — do not fall back to another calendar.`)
  }
  const email = acct ?? ctx.primaryEmail
  return { token: await tokenForEmail(acct, ctx), calendarId: 'primary', accountEmail: email, name: `${email} (main calendar)` }
}

/** What to hand back as an event's id: the calendar rides along unless it is the default one. */
const refOf = (eventId: string, calendarId: string) => calendarId === 'primary' ? eventId : `${eventId}::${calendarId}`

/** Which video providers a calendar can mint (Google's own word, per calendar). */
async function meetTypesOf(token: string, calendarId = 'primary'): Promise<string[] | undefined> {
  try {
    const c = await calGet<{ conferenceProperties?: { allowedConferenceSolutionTypes?: string[] } }>(token, `/users/me/calendarList/${encodeURIComponent(calendarId)}`)
    return c.conferenceProperties?.allowedConferenceSolutionTypes
  } catch { return undefined }
}

async function calPost<T>(token: string, path: string, body: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    if (res.status === 401 || res.status === 403)
      throw new Error('Google token expired or revoked. Please reconnect this account in Settings → Connected Accounts.')
    throw new Error(b?.error?.message ?? `Calendar ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function driveGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    if (res.status === 401 || res.status === 403)
      throw new Error('Google token expired or revoked. Please reconnect this account in Settings → Connected Accounts.')
    throw new Error(b?.error?.message ?? `Drive ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ─── Email helpers ────────────────────────────────────────────────────────────

function encodeBase64url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function hdr(headers: GmailHeader[], name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

async function fetchEmailSummaries(token: string, query: string, max = 8) {
  const list = await gmailGet<{ threads?: { id: string }[] }>(
    token, `/users/me/threads?q=${encodeURIComponent(query)}&maxResults=${max}`,
  )
  const ids = (list.threads ?? []).map(t => t.id).slice(0, max)
  const threads = await Promise.all(
    ids.map(id => gmailGet<GmailThread>(
      token,
      `/users/me/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    )),
  )
  return threads.map(t => {
    const msg = t.messages[t.messages.length - 1]
    return {
      thread_id: t.id, message_id: msg.id,
      from:    hdr(msg.payload.headers, 'from'),
      subject: hdr(msg.payload.headers, 'subject'),
      date:    hdr(msg.payload.headers, 'date'),
      snippet: msg.snippet,
    }
  })
}

// ─── Tool schemas ─────────────────────────────────────────────────────────────

const ACCT = { account_email: { type: 'string', description: 'Connected account email (omit for primary)' } }
const CAL = { calendar: { type: 'string', description: 'Which calendar, by name, id or its account address (e.g. "Teradix"). The event is read or written with THAT calendar\'s own account. Omit for the main calendar. A name that matches nothing is an error — it never falls back to another calendar.' } }

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  // ── The app itself ─────────────────────────────────────────────────────────
  {
    name: 'app_guide',
    description: 'How the app works: what each module is, where things are, and what the user can do there. Call it for ANY question about the app itself ("how do I…", "where is…", "what does … do", "can I…"). With no topic it lists the topics; with a topic (overview, today, calendar, mail, tasks, habits, finance, shopping, library, assistant, settings, search) it returns that guide. Answer from what it says. If it does not cover something, say you are not sure — never invent a feature or a screen.',
    input_schema: { type: 'object' as const, properties: { topic: { type: 'string', description: 'A topic id such as "library" or "mail" (optional)' } }, required: [] },
  },

  // ── Accounts ────────────────────────────────────────────────────────────────
  {
    name: 'list_connected_accounts',
    description: 'List all Google accounts connected to the app. Call this when the user asks about a specific account or inbox.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },

  // ── Email ────────────────────────────────────────────────────────────────────
  {
    name: 'list_emails',
    description: 'List recent unread emails (returns snippets, with NO judgement of importance). For "what needs me", "what is important" or "what should I answer", use mail_needs instead — it is the same list the Mail page and Today show. Use get_email to read the full body of a specific thread.',
    input_schema: { type: 'object' as const, properties: { ...ACCT }, required: [] },
  },
  {
    name: 'mail_needs',
    description: 'What needs the user, exactly as the Mail page and the Today card judge it: "action" = they owe someone an answer, decision or RSVP; "attention" = worth knowing, nothing to answer. Already excludes mail they archived, muted or marked done anywhere in the app. ALWAYS use this for questions about important, urgent or waiting mail — never decide importance from list_emails snippets yourself, or the answer will disagree with what they see on screen. If it says unavailable, say so and offer list_emails as an unranked look.',
    input_schema: { type: 'object' as const, properties: { ...ACCT }, required: [] },
  },
  {
    name: 'get_email',
    description: 'Read the full body of an email thread. Use after list_emails or search_emails to get the actual content.',
    input_schema: {
      type: 'object' as const,
      properties: { thread_id: { type: 'string', description: 'Gmail thread ID' }, ...ACCT },
      required: ['thread_id'],
    },
  },
  {
    name: 'search_emails',
    description: 'Search Gmail (e.g. "from:boss@co.com", "subject:invoice is:unread", "after:2024/1/1").',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'Gmail search query' }, ...ACCT },
      required: ['query'],
    },
  },
  {
    name: 'send_email',
    description: 'Compose and send a new email.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to:      { type: 'string', description: 'Recipient address' },
        subject: { type: 'string', description: 'Subject line' },
        body:    { type: 'string', description: 'Plain-text body' },
        ...ACCT,
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'reply_to_email',
    description: 'Reply to an existing email thread.',
    input_schema: {
      type: 'object' as const,
      properties: {
        thread_id:   { type: 'string' },
        to:          { type: 'string' },
        subject:     { type: 'string' },
        body:        { type: 'string' },
        in_reply_to: { type: 'string', description: 'Message-ID header (optional)' },
        ...ACCT,
      },
      required: ['thread_id', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'archive_email',
    description: 'Archive an email thread (remove it from the Gmail inbox and from the app\'s lists). Pass thread_id, which list_emails, search_emails and mail_needs all return.',
    input_schema: {
      type: 'object' as const,
      properties: { thread_id: { type: 'string' }, message_id: { type: 'string', description: 'Only if you have no thread_id; archives just that one message.' }, ...ACCT },
      required: [],
    },
  },
  {
    name: 'rsvp_invitation',
    description: 'Answer a calendar invitation that arrived by email — it sets the user\'s real reply on the Google Calendar event and the organiser is told, exactly as the Yes / Maybe / No buttons in Mail and Today do. This tells other people something on the user\'s behalf: call it ONLY after the user has said which answer to give (accepted, tentative or declined) for that invitation. Pass the thread_id from mail_needs, list_emails or search_emails.',
    input_schema: {
      type: 'object' as const,
      properties: { thread_id: { type: 'string' }, answer: { type: 'string', enum: ['accepted', 'tentative', 'declined'] }, ...ACCT },
      required: ['thread_id', 'answer'],
    },
  },
  {
    name: 'mark_email_read',
    description: 'Mark an email as read (remove Unread label).',
    input_schema: {
      type: 'object' as const,
      properties: { message_id: { type: 'string' }, ...ACCT },
      required: ['message_id'],
    },
  },

  // ── Calendar ─────────────────────────────────────────────────────────────────
  {
    name: 'list_calendar_events',
    description: 'Get calendar events for a date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        date_to:   { type: 'string', description: 'End date YYYY-MM-DD' },
        ...ACCT,
        ...CAL,
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Create a new calendar event.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:          { type: 'string', description: 'Event title' },
        start_datetime: { type: 'string', description: 'ISO 8601 datetime e.g. 2025-05-10T14:00:00' },
        end_datetime:   { type: 'string', description: 'ISO 8601 datetime e.g. 2025-05-10T15:00:00' },
        description:    { type: 'string', description: 'Event description (optional)' },
        location:       { type: 'string', description: 'Location (optional)' },
        timezone:       { type: 'string', description: 'IANA timezone e.g. America/New_York (optional, default UTC)' },
        add_meet:       { type: 'boolean', description: 'true to attach a Google Meet video link (optional).' },
        guests:         { type: 'array', items: { type: 'string' }, description: 'Email addresses to invite (optional). Google emails each an invitation, so the app asks the user to approve first. Only real addresses the user gave — if you only have a name, ask for the address; never guess one.' },
        ...ACCT,
        ...CAL,
      },
      required: ['title', 'start_datetime', 'end_datetime'],
    },
  },
  {
    name: 'update_calendar_event',
    description: 'Change or move a calendar event: its title, start/end time, description or location. Get the event_id from list_calendar_events. Giving only a new start keeps the event\'s length. If the event has other guests, changing it tells them: the tool then refuses until you call it again with confirm_notify_guests: true, which makes the app ask the user to approve first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id:       { type: 'string', description: 'Google Calendar event ID' },
        title:          { type: 'string' },
        start_datetime: { type: 'string', description: 'ISO 8601 e.g. 2025-05-10T14:00:00' },
        end_datetime:   { type: 'string', description: 'ISO 8601 (optional; the length is kept if omitted)' },
        description:    { type: 'string' },
        location:       { type: 'string' },
        timezone:       { type: 'string', description: 'IANA timezone (optional; the event\'s own is kept)' },
        confirm_notify_guests: { type: 'boolean', description: 'Only after the tool said the event has guests' },
        add_meet:       { type: 'boolean', description: 'true to add a Google Meet video link to this event (an existing link is kept, never replaced).' },
        add_guests:     { type: 'array', items: { type: 'string' }, description: 'Email addresses to ADD to the guest list (existing guests are kept). Google emails each an invitation, so the app asks the user to approve first. Only real addresses the user gave — never guess one.' },
        ...ACCT,
        ...CAL,
      },
      required: ['event_id'],
    },
  },
  {
    name: 'delete_calendar_event',
    description: 'Delete (cancel) a calendar event by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: { event_id: { type: 'string', description: 'The id from list_calendar_events, exactly as given (it may end ::calendar).' }, ...ACCT, ...CAL },
      required: ['event_id'],
    },
  },

  // ── Tasks ────────────────────────────────────────────────────────────────────
  {
    name: 'list_tasks',
    description: "List tasks, optionally filtered by status or quadrant.",
    input_schema: {
      type: 'object' as const,
      properties: {
        status:   { type: 'string', enum: ['open', 'done', 'all'], description: 'Default: open' },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'] },
      },
      required: [],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task on the board.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:    { type: 'string' },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'] },
        due_date: { type: 'string', description: 'YYYY-MM-DD (optional)' },
        urgent:   { type: 'boolean', description: 'Mark as urgent (optional)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Update task properties (title, quadrant, due date, urgency, status).',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id:  { type: 'string', description: 'Task ID from list_tasks' },
        title:    { type: 'string' },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'] },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
        urgent:   { type: 'boolean' },
        status:   { type: 'string', enum: ['open', 'done'] },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as done.',
    input_schema: {
      type: 'object' as const,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'delete_task',
    description: 'Permanently delete a task.',
    input_schema: {
      type: 'object' as const,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },

  // ── Habits ───────────────────────────────────────────────────────────────────
  {
    name: 'list_habits',
    description: "List all habits with today's completion status and current streak. A habit with a `picture` has its own photo: show it with that exact value as ![name](picture) next to the name — the app draws the real photo. Use the emoji only when there is no `picture`.",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'create_habit',
    description: 'Create a new habit. A yes/no habit is "boolean"; a counted one is "quantity" with a goal and a unit (8 glasses).',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' }, emoji: { type: 'string', description: 'One emoji (optional)' },
        frequency: { type: 'string', enum: ['daily', 'weekdays', 'weekly'], description: 'Default daily' },
        type: { type: 'string', enum: ['boolean', 'quantity'], description: 'Default boolean' },
        goal: { type: 'number', description: 'Target per day, for a quantity habit' }, unit: { type: 'string', description: 'e.g. glasses, minutes' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_habit',
    description: 'Change a habit — rename it, change its emoji, frequency, goal or unit, or pause it (active: false) or bring it back (active: true). Name the habit by its name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        habit: { type: 'string', description: 'The habit\'s name (or part of it)' }, name: { type: 'string' }, emoji: { type: 'string' },
        frequency: { type: 'string', enum: ['daily', 'weekdays', 'weekly'] }, goal: { type: 'number' }, unit: { type: 'string' }, active: { type: 'boolean' },
      },
      required: ['habit'],
    },
  },
  {
    name: 'delete_habit',
    description: 'Delete a habit and its history for good. The app asks the user to approve first. Prefer update_habit with active: false to pause one.',
    input_schema: { type: 'object' as const, properties: { habit: { type: 'string' } }, required: ['habit'] },
  },
  {
    name: 'log_habit_completion',
    description: 'Mark a habit as completed for a given date.',
    input_schema: {
      type: 'object' as const,
      properties: {
        habit_id: { type: 'string', description: 'Habit ID from list_habits' },
        date:     { type: 'string', description: 'YYYY-MM-DD (omit for today)' },
        value:    { type: 'number', description: 'Quantity value for measurable habits' },
      },
      required: ['habit_id'],
    },
  },

  // ── Drive ────────────────────────────────────────────────────────────────────
  {
    name: 'list_drive_files',
    description: 'Search Google Drive files. Returns name, type, modified date, and a link.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search term (omit for recent files)' },
        ...ACCT,
      },
      required: [],
    },
  },

  // ── Summary ──────────────────────────────────────────────────────────────────
  {
    name: 'get_productivity_summary',
    description: "Get a snapshot of today's productivity: tasks due/done today, habits completed, and upcoming events.",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },

  // ── Money ────────────────────────────────────────────────────────────────────
  // Read the ledger, work things out from it, and write to it. They live in
  // financeTools.ts, because money has its own rules — the lock, the currency
  // conversion, what counts as paid — and none of them belong in here.
  ...FINANCE_TOOLS,
  ...LIBRARY_TOOLS,
  ...SETTINGS_TOOLS,
]

// ─── Tool executor ────────────────────────────────────────────────────────────

/** A habit by what the person calls it. Ambiguous or unknown is refused with what matched, never guessed. */
function habitNamed(name: string): Habit {
  const q = name.trim().toLowerCase()
  if (!q) throw new Error('Which habit? Give its name.')
  const all = useHabitsStore.getState().habits
  const exact = all.filter(h => h.name.trim().toLowerCase() === q)
  if (exact.length === 1) return exact[0]
  const hits = exact.length ? exact : all.filter(h => h.name.toLowerCase().includes(q))
  if (hits.length === 1) return hits[0]
  if (!hits.length) throw new Error(`No habit matches "${name}". They are: ${all.map(h => h.name).join(', ') || 'none yet'}.`)
  throw new Error(`"${name}" matches ${hits.length} habits: ${hits.slice(0, 6).map(h => `“${h.name}”`).join(', ')}. Say which one.`)
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const acctEmail = input.account_email as string | undefined

  // Money answers for itself: the finance lock, the base currency and the
  // ledger's own arithmetic are all in there.
  if (FINANCE_TOOL_NAMES.has(name)) return executeFinanceTool(name, input)
  if (LIBRARY_TOOL_NAMES.has(name)) return executeLibraryTool(name, input)
  if (SETTINGS_TOOL_NAMES.has(name)) return executeSettingsTool(name, input)

  switch (name) {

    // ── The app itself ───────────────────────────────────────────────────────

    case 'app_guide': {
      const asked = typeof input.topic === 'string' ? input.topic : ''
      if (!asked.trim()) return { topics: Object.entries(APP_GUIDE).map(([id, e]) => ({ id, title: e.title, where: e.where })) }
      const hit = findGuide(asked)
      if (!hit) return { found: false, note: `No guide for "${asked}". Topics: ${Object.keys(APP_GUIDE).join(', ')}. If the question is not covered, say you are not sure rather than guessing.` }
      return { id: hit.id, ...hit.entry }
    }

    // ── Accounts ─────────────────────────────────────────────────────────────

    case 'list_connected_accounts': {
      return [
        { email: ctx.primaryEmail, type: 'primary', note: 'Sign-in account — full access' },
        ...ctx.accounts.map(a => ({
          email:        a.email,
          name:         a.name,
          type:         'additional',
          connected:    a.connectedAt ? new Date(a.connectedAt).toLocaleDateString() : 'unknown',
          integrations: {
            calendar: a.scopes.some(s => s.includes('calendar')),
            gmail:    a.scopes.some(s => s.includes('gmail')),
            drive:    a.scopes.some(s => s.includes('drive')),
          },
        })),
      ]
    }

    // ── Email ─────────────────────────────────────────────────────────────────

    case 'list_emails': {
      const token = await tokenForEmail(acctEmail, ctx)
      return fetchEmailSummaries(token, 'is:unread in:inbox', 8)
    }

    case 'mail_needs': {
      const boxes = mailAccounts(ctx.primaryEmail)
      const picked = acctEmail ? boxes.filter(b => b.email === acctEmail) : boxes
      const needs = await readNeeds(picked.map(b => b.email))
      if (!needs) {
        return { available: false, note: 'The app has not analysed the mail yet (open the Mail page once, or sign in again). list_emails gives an unranked look in the meantime.' }
      }
      const shape = (t: (typeof needs.all)[number]) => ({
        thread_id: t.threadId, account_email: t.accountEmail, from: t.fromName || t.fromEmail, subject: t.subject,
        what_is_wanted: t.need || undefined, kind: t.kind, last_message_days_ago: Math.floor((Date.now() - t.lastAt) / 86_400_000),
        you_are_holding_someone_up: t.bottleneck || undefined,
      })
      return {
        available: true,
        action: needs.action.slice(0, 15).map(shape), action_total: needs.action.length,
        attention: needs.attention.slice(0, 10).map(shape), attention_total: needs.attention.length,
      }
    }

    case 'get_email': {
      const token = await tokenForEmail(acctEmail, ctx)
      const threadId = input.thread_id as string
      const thread = await gmailGet<{ id: string; messages: GmailMessage[] }>(
        token, `/users/me/threads/${threadId}?format=full`,
      )
      const msg = thread.messages[thread.messages.length - 1]
      const body = extractBody(msg)
      return {
        thread_id:  thread.id,
        message_id: msg.id,
        from:       hdr(msg.payload.headers as GmailHeader[], 'from'),
        to:         hdr(msg.payload.headers as GmailHeader[], 'to'),
        subject:    hdr(msg.payload.headers as GmailHeader[], 'subject'),
        date:       hdr(msg.payload.headers as GmailHeader[], 'date'),
        body:       body.slice(0, 4000),
        truncated:  body.length > 4000,
        message_count: thread.messages.length,
      }
    }

    case 'search_emails': {
      const token = await tokenForEmail(acctEmail, ctx)
      return fetchEmailSummaries(token, input.query as string, 8)
    }

    case 'send_email': {
      const token = await tokenForEmail(acctEmail, ctx)
      const from  = acctEmail ?? ctx.primaryEmail
      const rfc   = [
        `From: ${from}`,
        `To: ${input.to as string}`,
        `Subject: ${input.subject as string}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        input.body as string,
      ].join('\r\n')
      await gmailPost(token, '/users/me/messages/send', { raw: encodeBase64url(rfc) })
      return { success: true, message: `Email sent to ${input.to as string} from ${from}` }
    }

    case 'reply_to_email': {
      const token = await tokenForEmail(acctEmail, ctx)
      const from  = acctEmail ?? ctx.primaryEmail
      const subj  = (input.subject as string).replace(/^(re:\s*)+/i, '')
      const lines = [
        `From: ${from}`,
        `To: ${input.to as string}`,
        `Subject: Re: ${subj}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
      ]
      if (input.in_reply_to) {
        lines.push(`In-Reply-To: ${input.in_reply_to as string}`, `References: ${input.in_reply_to as string}`)
      }
      lines.push('', input.body as string)
      await gmailPost(token, '/users/me/messages/send', {
        raw: encodeBase64url(lines.join('\r\n')),
        threadId: input.thread_id as string,
      })
      return { success: true, message: `Reply sent to ${input.to as string}` }
    }

    case 'archive_email': {
      if (input.thread_id) {
        // The whole thread, in Gmail, and recorded for every screen — or a refusal said in words, never a quiet "done".
        const account = mailAccounts(ctx.primaryEmail).find(a => a.email === (acctEmail ?? ctx.primaryEmail))
        if (!account) throw new Error(`Account "${acctEmail}" is not connected.`)
        const done = await archiveThread(account, input.thread_id as string)
        if (!done.ok) throw new Error(`Not archived: ${done.why}`)
        return { success: true, message: 'Thread archived' }
      }
      if (!input.message_id) throw new Error('Give a thread_id (or a message_id).')
      if (acctEmail && acctEmail !== ctx.primaryEmail) {
        const token = await tokenForEmail(acctEmail, ctx)
        await gmailPost(token, `/users/me/messages/${input.message_id as string}/modify`, { removeLabelIds: ['INBOX'] })
      } else {
        await archiveMessage(input.message_id as string)
      }
      return { success: true, message: 'Email archived' }
    }

    case 'rsvp_invitation': {
      const answer = input.answer as string
      if (answer !== 'accepted' && answer !== 'tentative' && answer !== 'declined') throw new Error('answer must be accepted, tentative or declined')
      const account = mailAccounts(ctx.primaryEmail).find(a => a.email === (acctEmail ?? ctx.primaryEmail))
      if (!account) throw new Error(`Account "${acctEmail}" is not connected.`)
      const thread = await getThread(input.thread_id as string, account)
      const subject = thread.messages.at(-1)?.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value ?? ''
      const read = await readInvite(thread.messages, subject, account)
      if (read.kind === 'not-one') throw new Error('There is no calendar invitation in that thread.')
      if (read.kind === 'unreadable') throw new Error(`The invitation could not be read: ${read.why}`)
      if (read.invite.cancelled) throw new Error('That meeting has been cancelled — there is nothing to answer.')
      const res = await answerInvitation(read.invite, account, input.thread_id as string, answer)
      if (!res.ok) throw new Error(res.why ?? 'Google would not record the answer')
      return { success: true, message: `Answered ${answer} to "${read.invite.summary}" on the calendar; the organiser has been told.` }
    }

    case 'mark_email_read': {
      const token = await tokenForEmail(acctEmail, ctx)
      await gmailPost(token, `/users/me/messages/${input.message_id as string}/modify`, { removeLabelIds: ['UNREAD'] })
      return { success: true, message: 'Marked as read' }
    }

    // ── Calendar ──────────────────────────────────────────────────────────────

    case 'list_calendar_events': {
      const from  = input.date_from as string
      const to    = input.date_to   as string
      type Ev = { id: string; summary: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; location?: string }
      // One named calendar (or account) answers for itself; otherwise every calendar you can see, each read with its
      // own account — a company's diary is not on the account you signed in with.
      const named = (typeof input.calendar === 'string' && input.calendar.trim()) || acctEmail
      const hidden = hiddenCals()
      const cached = cachedCals().filter(c => !hidden.has(c.id))
      const targets: { calendarId: string; name: string; accountEmail: string }[] = named || !cached.length
        ? [await resolveCal(input, ctx, false)]
        : cached.slice(0, 12).map(c => ({ calendarId: c.id, name: c.summary, accountEmail: c.accountEmail }))
      const out: Record<string, unknown>[] = []
      const failed: string[] = []
      await Promise.all(targets.map(async t => {
        try {
          const token = 'token' in t ? (t as CalTarget).token : await tokenForEmail(t.accountEmail || undefined, ctx)
          const data = await calGet<{ items?: Ev[] }>(token, `/calendars/${encodeURIComponent(t.calendarId)}/events?timeMin=${from}T00:00:00Z&timeMax=${to}T23:59:59Z&singleEvents=true&orderBy=startTime&maxResults=50`)
          for (const e of data.items ?? []) out.push({
            id:       refOf(e.id, t.calendarId),
            title:    e.summary,
            start:    e.start.dateTime ?? e.start.date,
            end:      e.end.dateTime   ?? e.end.date,
            location: e.location,
            ...(targets.length > 1 ? { calendar: t.name } : {}),
          })
        } catch { failed.push(t.name) }
      }))
      if (targets.length === 1 && failed.length) throw new Error(`Could not read ${failed[0]}. Its account may need reconnecting in Settings → Connected Accounts.`)
      out.sort((x, y) => String(x.start).localeCompare(String(y.start)))
      // An unreadable calendar is said, never silently an empty day.
      return failed.length ? { events: out, could_not_read: failed } : out
    }

    case 'create_calendar_event': {
      const target = await resolveCal(input, ctx, true)
      const token = target.token
      const tz    = (input.timezone as string) ?? 'UTC'
      const { emails: invitees, rejected } = parseGuests(input.guests)
      const askedMeet = input.add_meet === true
      const meetTypes = askedMeet ? await meetTypesOf(token, target.calendarId) : undefined
      const wantMeet = askedMeet && supportsMeet(meetTypes)
      if (input.guests !== undefined && !invitees.length && rejected.length) {
        throw new Error(`Not an email address: ${rejected.join(', ')}. Ask the user for their email; nothing was created.`)
      }
      const event = await calPost<{ id: string; htmlLink: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } }>(
        token,
        `/calendars/${encodeURIComponent(target.calendarId)}/events${[invitees.length ? 'sendUpdates=all' : '', wantMeet ? 'conferenceDataVersion=1' : ''].filter(Boolean).map((x, n) => (n ? '&' : '?') + x).join('')}`,
        {
          ...(invitees.length ? { attendees: invitees.map(email => ({ email })) } : {}),
          ...(wantMeet ? meetRequest() : {}),
          summary:     input.title       as string,
          description: input.description as string | undefined,
          location:    input.location    as string | undefined,
          start: { dateTime: input.start_datetime as string, timeZone: tz },
          end:   { dateTime: input.end_datetime   as string, timeZone: tz },
        },
      )
      const note = (invitees.length ? ` and ${invitees.join(', ')} invited` : '') + (rejected.length ? `. Not invited (not an email address): ${rejected.join(', ')} — ask for their email` : '')
      return { success: true, event_id: refOf(event.id, target.calendarId), link: event.htmlLink, message: `Event "${input.title as string}" created on ${target.name}${note}${wantMeet ? meetSentence(event) : askedMeet ? noMeetSentence(target.name, meetTypes) : ''}` }
    }

    case 'update_calendar_event': {
      const target = await resolveCal(input, ctx, true)
      const token = target.token
      const calPath = `/calendars/${encodeURIComponent(target.calendarId)}/events`
      const id = encodeURIComponent(splitEventRef(input.event_id).eventId)
      const cur = await calGet<{ summary?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }; attendees?: { email: string; self?: boolean; organizer?: boolean }[]; start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string } }>(token, `${calPath}/${id}`)
      const guests = (cur.attendees ?? []).filter(a => !a.self && !a.organizer)
      const { emails: addGuests, rejected: badGuests } = parseGuests(input.add_guests)
      // Changing an event with guests tells them. That is somebody else's calendar and inbox, so it needs
      // the person's approval (the panel asks when `confirm_notify_guests` is set) — never a quiet side effect.
      if (guests.length && input.confirm_notify_guests !== true && !addGuests.length) {
        return { needs_confirmation: true, message: `“${cur.summary ?? 'This event'}” has ${guests.length} other guest${guests.length === 1 ? '' : 's'}, and changing it tells them. If the user wants that, call update_calendar_event again with the same changes and confirm_notify_guests: true — the app will ask them to approve.` }
      }
      const patch: Record<string, unknown> = {}
      if (typeof input.title === 'string' && input.title.trim()) patch.summary = input.title.trim()
      if (typeof input.description === 'string') patch.description = input.description
      if (typeof input.location === 'string') patch.location = input.location
      const tz = (input.timezone as string | undefined) ?? cur.start?.timeZone ?? 'UTC'
      if (typeof input.start_datetime === 'string') {
        const startMs = new Date(input.start_datetime).getTime()
        if (!Number.isFinite(startMs)) throw new Error('start_datetime is not a date and time.')
        const oldS = cur.start?.dateTime ? new Date(cur.start.dateTime).getTime() : NaN
        const oldE = cur.end?.dateTime ? new Date(cur.end.dateTime).getTime() : NaN
        const endIso = typeof input.end_datetime === 'string' ? input.end_datetime
          : Number.isFinite(oldS) && Number.isFinite(oldE) ? new Date(startMs + (oldE - oldS)).toISOString() : null
        if (!endIso) throw new Error('Give end_datetime too: this event has no timed length to keep.')
        if (!(new Date(endIso).getTime() > startMs)) throw new Error('The end must be after the start.')
        patch.start = { dateTime: input.start_datetime, timeZone: tz }
        patch.end = { dateTime: endIso, timeZone: tz }
      } else if (typeof input.end_datetime === 'string') {
        patch.end = { dateTime: input.end_datetime, timeZone: tz }
      }
      if (addGuests.length) {
        // A PATCH replaces the attendee list: keep who is on it (replies included) and add the new addresses.
        const have = cur.attendees ?? []
        const known = new Set(have.map(a => a.email.toLowerCase()))
        patch.attendees = [...have, ...addGuests.filter(e => !known.has(e.toLowerCase())).map(email => ({ email }))]
      }
      const existingMeet = meetLinkOf(cur)
      const meetTypes = input.add_meet === true ? await meetTypesOf(token, target.calendarId) : undefined
      const meetOk = input.add_meet === true && supportsMeet(meetTypes)
      if (meetOk && !existingMeet) Object.assign(patch, meetRequest())
      if (!Object.keys(patch).length) {
        if (input.add_meet === true && !meetOk) return { success: true, message: noMeetSentence(target.name, meetTypes).trim() }
        if (input.add_meet === true && existingMeet) return { success: true, message: `That event already has a Meet link: ${existingMeet}` }
        throw new Error(badGuests.length ? `Not an email address: ${badGuests.join(', ')}. Ask the user for their email.` : 'Nothing to change: give a title, time, description, location or guests to add.')
      }
      const tell = guests.length > 0 || addGuests.length > 0
      const saved = await calPost<{ hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } }>(token, `${calPath}/${id}?sendUpdates=${tell ? 'all' : 'none'}${patch.conferenceData ? '&conferenceDataVersion=1' : ''}`, patch, 'PATCH')
      return { success: true, message: `Event updated${guests.length ? ` and ${guests.length} guest${guests.length === 1 ? '' : 's'} told` : ''}${addGuests.length ? `; invited ${addGuests.join(', ')}` : ''}${badGuests.length ? `. Not invited (not an email address): ${badGuests.join(', ')} — ask for their email` : ''}${patch.conferenceData ? meetSentence(saved) : existingMeet && input.add_meet === true ? ` It already had a Meet link: ${existingMeet}` : input.add_meet === true && !meetOk ? noMeetSentence(target.name, meetTypes) : ''}` }
    }

    case 'delete_calendar_event': {
      const target = await resolveCal(input, ctx, true)
      const res   = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.calendarId)}/events/${encodeURIComponent(splitEventRef(input.event_id).eventId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${target.token}` } },
      )
      if (!res.ok && res.status !== 204 && res.status !== 410) {
        const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
        throw new Error(b?.error?.message ?? `Calendar ${res.status}`)
      }
      return { success: true, message: `Event deleted from ${target.name}` }
    }

    // ── Tasks ─────────────────────────────────────────────────────────────────

    case 'list_tasks': {
      const status   = (input.status as string) ?? 'open'
      const quadrant =  input.quadrant as string | undefined
      let tasks = ctx.tasks
      if (status !== 'all') tasks = tasks.filter(t => t.status === status)
      if (quadrant) tasks = tasks.filter(t => t.quadrant === quadrant)
      return tasks.slice(0, 60).map(t => ({
        id: t.id, title: t.title, status: t.status,
        quadrant: t.quadrant, due_date: t.dueDate, urgent: t.urgent,
      }))
    }

    case 'create_task': {
      ctx.addTask({
        title:    input.title as string,
        quadrant: (input.quadrant as 'do' | 'schedule' | 'delegate' | 'eliminate') ?? null,
        status:   'open', completed: false, company: 'teradix',
        dueDate:  input.due_date as string | undefined,
        urgent:   input.urgent   as boolean | undefined,
      })
      return { success: true, message: `Task "${input.title as string}" created` }
    }

    case 'update_task': {
      const updates: Partial<Task> = {}
      if (input.title    != null) updates.title    = input.title    as string
      if (input.quadrant != null) updates.quadrant = input.quadrant as 'do' | 'schedule' | 'delegate' | 'eliminate'
      if (input.due_date != null) updates.dueDate  = input.due_date as string
      if (input.urgent   != null) updates.urgent   = input.urgent   as boolean
      if (input.status   === 'done') { updates.status = 'done'; updates.completed = true; updates.completedAt = new Date().toISOString() }
      else if (input.status === 'open') { updates.status = 'open'; updates.completed = false }
      ctx.updateTask(input.task_id as string, updates)
      return { success: true, message: 'Task updated' }
    }

    case 'complete_task': {
      ctx.updateTask(input.task_id as string, { status: 'done', completed: true, completedAt: new Date().toISOString() })
      return { success: true, message: 'Task marked as done' }
    }

    case 'delete_task': {
      ctx.deleteTask(input.task_id as string)
      return { success: true, message: 'Task deleted' }
    }

    // ── Habits ────────────────────────────────────────────────────────────────

    case 'list_habits': {
      const today   = new Date().toISOString().slice(0, 10)
      const logs    = loadLogs()
      return ctx.habits.filter(h => h.isActive).map(h => {
        const habitLogs = logs[h.id] ?? []
        const doneToday = habitLogs.includes(today)
        const streak    = calcStreak(habitLogs)
        return {
          id: h.id, name: h.name, emoji: h.emoji,
          picture: h.image ? `habit:${h.id}` : undefined,
          frequency: h.frequency, type: h.type,
          goal: h.goal, unit: h.unit,
          done_today: doneToday, streak,
          total_completions: habitLogs.length,
        }
      })
    }

    case 'log_habit_completion': {
      const date    = (input.date as string) ?? new Date().toISOString().slice(0, 10)
      const logs    = loadLogs()
      const entries = logs[input.habit_id as string] ?? []
      if (!entries.includes(date)) {
        logs[input.habit_id as string] = [...entries, date]
        commitHabitLogs(logs)
      }
      const habit = ctx.habits.find(h => h.id === input.habit_id)
      return { success: true, message: `${habit?.emoji ?? '✓'} ${habit?.name ?? 'Habit'} logged for ${date}` }
    }

    case 'create_habit': {
      const name = String(input.name ?? '').trim()
      if (!name) throw new Error('A name is needed.')
      const st = useHabitsStore.getState()
      if (st.habits.some(h => h.name.trim().toLowerCase() === name.toLowerCase() && h.isActive)) return { created: false, already_exists: true, message: `You already have a habit called “${name}”.` }
      const type = input.type === 'quantity' ? 'quantity' : 'boolean'
      const goal = Number(input.goal)
      if (type === 'quantity' && !(goal > 0)) throw new Error('A counted habit needs a goal above zero (for example 8) and a unit (glasses).')
      const frequency = input.frequency === 'weekdays' || input.frequency === 'weekly' ? input.frequency : 'daily'
      const colors = getHabitColors()
      const color = colors[st.habits.length % colors.length]
      const id = st.addHabit({ name, emoji: typeof input.emoji === 'string' && input.emoji.trim() ? input.emoji.trim() : '✅', color, frequency, isActive: true, type, ...(type === 'quantity' ? { goal, unit: typeof input.unit === 'string' ? input.unit.trim() : undefined } : {}) })
      return { created: true, id, message: `Habit “${name}” created (${frequency}${type === 'quantity' ? `, ${goal} ${String(input.unit ?? '')}`.trimEnd() : ''}).` }
    }

    case 'update_habit': {
      const h = habitNamed(String(input.habit ?? ''))
      const patch: Partial<Habit> = {}
      if (typeof input.name === 'string' && input.name.trim()) patch.name = input.name.trim()
      if (typeof input.emoji === 'string' && input.emoji.trim()) patch.emoji = input.emoji.trim()
      if (input.frequency === 'daily' || input.frequency === 'weekdays' || input.frequency === 'weekly') patch.frequency = input.frequency
      if (input.goal !== undefined) { const g = Number(input.goal); if (!(g > 0)) throw new Error('goal must be above zero.'); patch.goal = g }
      if (typeof input.unit === 'string') patch.unit = input.unit.trim() || undefined
      if (typeof input.active === 'boolean') patch.isActive = input.active
      if (!Object.keys(patch).length) throw new Error('Nothing to change.')
      useHabitsStore.getState().updateHabit(h.id, patch)
      return { updated: true, message: `Habit “${patch.name ?? h.name}” updated.` }
    }

    case 'delete_habit': {
      const h = habitNamed(String(input.habit ?? ''))
      useHabitsStore.getState().deleteHabit(h.id)
      return { deleted: true, message: `Habit “${h.name}” deleted.` }
    }

    // ── Drive ─────────────────────────────────────────────────────────────────

    case 'list_drive_files': {
      const token = await tokenForEmail(acctEmail, ctx)
      const q     = (input.query as string | undefined)
        ? `trashed=false and (name contains '${(input.query as string).replace(/'/g, "\\'")}' or fullText contains '${(input.query as string).replace(/'/g, "\\'")}')`
        : 'trashed=false'
      const fields = 'files(id,name,mimeType,modifiedTime,webViewLink,size)'
      const data = await driveGet<{ files?: Array<{ id: string; name: string; mimeType: string; modifiedTime: string; webViewLink?: string; size?: string }> }>(
        token,
        `/files?q=${encodeURIComponent(q)}&pageSize=15&orderBy=modifiedTime+desc&fields=${encodeURIComponent(fields)}`,
      )
      return (data.files ?? []).map(f => ({
        id:       f.id,
        name:     f.name,
        type:     f.mimeType.replace('application/vnd.google-apps.', '').replace('application/', ''),
        modified: f.modifiedTime,
        link:     f.webViewLink,
        size:     f.size,
      }))
    }

    // ── Summary ───────────────────────────────────────────────────────────────

    case 'get_productivity_summary': {
      const today     = new Date().toISOString().slice(0, 10)
      const logs      = loadLogs()
      const dueTasks  = ctx.tasks.filter(t => t.status === 'open' && t.dueDate === today)
      const doneTasks = ctx.tasks.filter(t => t.status === 'done' && t.completedAt?.startsWith(today))
      const habitsDoneToday = ctx.habits.filter(h => h.isActive && (logs[h.id] ?? []).includes(today))
      const habitsTotal     = ctx.habits.filter(h => h.isActive).length
      return {
        date:              today,
        tasks_due_today:   dueTasks.map(t => ({ id: t.id, title: t.title, quadrant: t.quadrant })),
        tasks_done_today:  doneTasks.map(t => ({ id: t.id, title: t.title })),
        open_urgent:       ctx.tasks.filter(t => t.status === 'open' && t.urgent).length,
        habits_today:      `${habitsDoneToday.length}/${habitsTotal} completed`,
        habits_done:       habitsDoneToday.map(h => `${h.emoji} ${h.name}`),
      }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcStreak(dates: string[]): number {
  if (!dates.length) return 0
  const sorted = [...new Set(dates)].sort().reverse()
  const today  = new Date().toISOString().slice(0, 10)
  let streak = 0, cursor = today
  for (const d of sorted) {
    if (d === cursor) { streak++; cursor = prevDay(cursor) }
    else if (d < cursor) break
  }
  return streak
}

function prevDay(dateStr: string): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}
