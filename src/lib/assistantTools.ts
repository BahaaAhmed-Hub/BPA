import type Anthropic from '@anthropic-ai/sdk'
import type { Task } from '@/types'
import { archiveMessage, extractBody, type GmailMessage } from './gmail'
import { supabase } from './supabase'
import { getProviderTokenForAccount, type ConnectedAccount } from './multiAccount'
import { loadLogs, saveLogs } from '@/store/habitsStore'

// ─── Context provided by the React component ─────────────────────────────────

export interface ToolContext {
  tasks:        Task[]
  addTask:      (t: Omit<Task, 'id' | 'createdAt'>) => void
  updateTask:   (id: string, updates: Partial<Task>) => void
  deleteTask:   (id: string) => void
  accounts:     ConnectedAccount[]
  primaryEmail: string
  habits:       Array<{ id: string; name: string; emoji: string; frequency: string; isActive: boolean; type: string; goal?: number; unit?: string }>
}

// ─── Token helpers ────────────────────────────────────────────────────────────

async function primaryToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.provider_token ?? localStorage.getItem('google_provider_token') ?? ''
}

async function tokenForEmail(email: string | undefined, ctx: ToolContext): Promise<string> {
  if (!email || email === ctx.primaryEmail) return primaryToken()
  const acc = ctx.accounts.find(a => a.email === email)
  if (!acc) throw new Error(`Account "${email}" is not connected. Use list_connected_accounts to see available accounts.`)
  return (await getProviderTokenForAccount(acc)) ?? acc.providerToken ?? ''
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
    throw new Error(b?.error?.message ?? `Gmail ${res.status}`)
  }
}

async function calGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b?.error?.message ?? `Calendar ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function calPost<T>(token: string, path: string, body: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
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

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  // ── Accounts ────────────────────────────────────────────────────────────────
  {
    name: 'list_connected_accounts',
    description: 'List all Google accounts connected to the app. Call this when the user asks about a specific account or inbox.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },

  // ── Email ────────────────────────────────────────────────────────────────────
  {
    name: 'list_emails',
    description: 'List recent unread emails (returns snippets). Use get_email to read the full body of a specific thread.',
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
    description: 'Archive an email (remove from inbox).',
    input_schema: {
      type: 'object' as const,
      properties: { message_id: { type: 'string' }, ...ACCT },
      required: ['message_id'],
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
        ...ACCT,
      },
      required: ['title', 'start_datetime', 'end_datetime'],
    },
  },
  {
    name: 'delete_calendar_event',
    description: 'Delete (cancel) a calendar event by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: { event_id: { type: 'string', description: 'Google Calendar event ID' }, ...ACCT },
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
    description: "List all habits with today's completion status and current streak.",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
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
]

// ─── Tool executor ────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const acctEmail = input.account_email as string | undefined

  switch (name) {

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
      if (acctEmail && acctEmail !== ctx.primaryEmail) {
        const token = await tokenForEmail(acctEmail, ctx)
        await gmailPost(token, `/users/me/messages/${input.message_id as string}/modify`, { removeLabelIds: ['INBOX'] })
      } else {
        await archiveMessage(input.message_id as string)
      }
      return { success: true, message: 'Email archived' }
    }

    case 'mark_email_read': {
      const token = await tokenForEmail(acctEmail, ctx)
      await gmailPost(token, `/users/me/messages/${input.message_id as string}/modify`, { removeLabelIds: ['UNREAD'] })
      return { success: true, message: 'Marked as read' }
    }

    // ── Calendar ──────────────────────────────────────────────────────────────

    case 'list_calendar_events': {
      const token = await tokenForEmail(acctEmail, ctx)
      const from  = input.date_from as string
      const to    = input.date_to   as string
      const data  = await calGet<{
        items?: Array<{
          id: string; summary: string
          start: { dateTime?: string; date?: string }
          end:   { dateTime?: string; date?: string }
          location?: string
        }>
      }>(token, `/calendars/primary/events?timeMin=${from}T00:00:00Z&timeMax=${to}T23:59:59Z&singleEvents=true&orderBy=startTime&maxResults=50`)
      return (data.items ?? []).map(e => ({
        id:       e.id,
        title:    e.summary,
        start:    e.start.dateTime ?? e.start.date,
        end:      e.end.dateTime   ?? e.end.date,
        location: e.location,
      }))
    }

    case 'create_calendar_event': {
      const token = await tokenForEmail(acctEmail, ctx)
      const tz    = (input.timezone as string) ?? 'UTC'
      const event = await calPost<{ id: string; htmlLink: string }>(
        token,
        '/calendars/primary/events',
        {
          summary:     input.title       as string,
          description: input.description as string | undefined,
          location:    input.location    as string | undefined,
          start: { dateTime: input.start_datetime as string, timeZone: tz },
          end:   { dateTime: input.end_datetime   as string, timeZone: tz },
        },
      )
      return { success: true, event_id: event.id, link: event.htmlLink, message: `Event "${input.title as string}" created` }
    }

    case 'delete_calendar_event': {
      const token = await tokenForEmail(acctEmail, ctx)
      const res   = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${input.event_id as string}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok && res.status !== 204 && res.status !== 410) {
        const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
        throw new Error(b?.error?.message ?? `Calendar ${res.status}`)
      }
      return { success: true, message: 'Event deleted' }
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
        saveLogs(logs)
      }
      const habit = ctx.habits.find(h => h.id === input.habit_id)
      return { success: true, message: `${habit?.emoji ?? '✓'} ${habit?.name ?? 'Habit'} logged for ${date}` }
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
