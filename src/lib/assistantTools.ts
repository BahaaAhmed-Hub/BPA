import type Anthropic from '@anthropic-ai/sdk'
import type { Task } from '@/types'
import { archiveMessage, composeEmail, sendReply } from './gmail'
import { listDriveFiles } from './googleDrive'
import { supabase } from './supabase'
import { getProviderTokenForAccount, type ConnectedAccount } from './multiAccount'

// ─── Context provided by the React component ─────────────────────────────────

export interface ToolContext {
  tasks: Task[]
  addTask:     (t: Omit<Task, 'id' | 'createdAt'>) => void
  updateTask:  (id: string, updates: Partial<Task>) => void
  accounts:    ConnectedAccount[]   // additional connected accounts
  primaryEmail: string              // sign-in account email
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

// ─── Low-level Gmail fetch with explicit token ────────────────────────────────

interface GmailHeader { name: string; value: string }
interface GmailMsg {
  id: string; snippet: string
  payload: { headers: GmailHeader[] }
}
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

function hdr(headers: GmailHeader[], name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

/** Fetch email summaries (list + per-thread detail) for any account token. */
async function fetchEmailSummaries(token: string, query: string, max = 8) {
  const list = await gmailGet<{ threads?: { id: string }[] }>(
    token,
    `/users/me/threads?q=${encodeURIComponent(query)}&maxResults=${max}`,
  )
  const ids = (list.threads ?? []).map(t => t.id).slice(0, max)
  const threads = await Promise.all(
    ids.map(id => gmailGet<GmailThread>(token, `/users/me/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)),
  )
  return threads.map(t => {
    const msg = t.messages[t.messages.length - 1]
    return {
      thread_id:  t.id,
      message_id: msg.id,
      from:       hdr(msg.payload.headers, 'from'),
      subject:    hdr(msg.payload.headers, 'subject'),
      date:       hdr(msg.payload.headers, 'date'),
      snippet:    msg.snippet,
    }
  })
}

// ─── Tool schemas (Anthropic format) ─────────────────────────────────────────

const ACCOUNT_EMAIL_PROP = {
  account_email: { type: 'string', description: 'Email of the connected account to use (omit for primary account)' },
}

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_connected_accounts',
    description: 'List all Google accounts connected to the app (primary + additional). Always call this first if the user asks about a specific account or inbox.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_emails',
    description: 'List recent unread emails. Specify account_email to read a secondary inbox; omit for primary.',
    input_schema: {
      type: 'object' as const,
      properties: { ...ACCOUNT_EMAIL_PROP },
      required: [],
    },
  },
  {
    name: 'search_emails',
    description: 'Search Gmail (e.g. "from:boss@company.com", "subject:invoice is:unread"). Specify account_email for a secondary inbox.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Gmail search query' },
        ...ACCOUNT_EMAIL_PROP,
      },
      required: ['query'],
    },
  },
  {
    name: 'send_email',
    description: 'Compose and send a new email. Specify account_email to send from a secondary account.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to:      { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Subject line' },
        body:    { type: 'string', description: 'Plain-text body' },
        ...ACCOUNT_EMAIL_PROP,
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'reply_to_email',
    description: 'Reply to an existing email thread. Specify account_email for a secondary account.',
    input_schema: {
      type: 'object' as const,
      properties: {
        thread_id:   { type: 'string', description: 'Gmail thread ID' },
        to:          { type: 'string', description: 'Recipient email address' },
        subject:     { type: 'string', description: 'Subject line' },
        body:        { type: 'string', description: 'Reply body text' },
        in_reply_to: { type: 'string', description: 'Message-ID of the email being replied to (optional)' },
        ...ACCOUNT_EMAIL_PROP,
      },
      required: ['thread_id', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'archive_email',
    description: 'Archive a message (remove from inbox). Specify account_email for a secondary account.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string', description: 'Gmail message ID' },
        ...ACCOUNT_EMAIL_PROP,
      },
      required: ['message_id'],
    },
  },
  {
    name: 'list_calendar_events',
    description: 'Get calendar events for a date range. Specify account_email to query a secondary account\'s calendar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        date_to:   { type: 'string', description: 'End date YYYY-MM-DD' },
        ...ACCOUNT_EMAIL_PROP,
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'list_tasks',
    description: "List the user's tasks, optionally filtered by status or quadrant.",
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
    description: 'Create a new task on the task board.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:    { type: 'string', description: 'Task title' },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'] },
        due_date: { type: 'string', description: 'YYYY-MM-DD (optional)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as done.',
    input_schema: {
      type: 'object' as const,
      properties: { task_id: { type: 'string', description: 'Task ID' } },
      required: ['task_id'],
    },
  },
  {
    name: 'list_drive_files',
    description: 'Search Google Drive files from the primary account.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'Search term (optional — omit for recent files)' } },
      required: [],
    },
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

    // ── Accounts ───────────────────────────────────────────────────────────────

    case 'list_connected_accounts': {
      const extras = ctx.accounts.map(a => ({
        email:      a.email,
        name:       a.name,
        type:       'additional',
        connected:  a.connectedAt ? new Date(a.connectedAt).toLocaleDateString() : 'unknown',
        integrations: {
          calendar: a.scopes.some(s => s.includes('calendar')),
          gmail:    a.scopes.some(s => s.includes('gmail')),
          drive:    a.scopes.some(s => s.includes('drive')),
        },
      }))
      return [
        { email: ctx.primaryEmail, type: 'primary', note: 'Sign-in account — full access' },
        ...extras,
      ]
    }

    // ── Email ──────────────────────────────────────────────────────────────────

    case 'list_emails': {
      const token = await tokenForEmail(acctEmail, ctx)
      return fetchEmailSummaries(token, 'is:unread in:inbox', 8)
    }

    case 'search_emails': {
      const token = await tokenForEmail(acctEmail, ctx)
      return fetchEmailSummaries(token, input.query as string, 8)
    }

    case 'send_email': {
      // For secondary accounts we'd need per-account send; use gmail.ts (primary) for now
      // and note the limitation if account_email points elsewhere
      if (acctEmail && acctEmail !== ctx.primaryEmail) {
        return { error: 'Sending from secondary accounts is not yet supported. Use the primary account.' }
      }
      await composeEmail({ to: input.to as string, subject: input.subject as string, body: input.body as string })
      return { success: true, message: `Email sent to ${input.to as string}` }
    }

    case 'reply_to_email': {
      if (acctEmail && acctEmail !== ctx.primaryEmail) {
        return { error: 'Replying from secondary accounts is not yet supported. Use the primary account.' }
      }
      await sendReply({
        to:       input.to          as string,
        subject:  input.subject     as string,
        body:     input.body        as string,
        threadId: input.thread_id   as string,
        inReplyTo: input.in_reply_to as string | undefined,
      })
      return { success: true, message: `Reply sent to ${input.to as string}` }
    }

    case 'archive_email': {
      if (acctEmail && acctEmail !== ctx.primaryEmail) {
        // Archive via direct API call with the account's token
        const token = await tokenForEmail(acctEmail, ctx)
        await gmailPost(token, `/users/me/messages/${input.message_id as string}/modify`, { removeLabelIds: ['INBOX'] })
        return { success: true, message: 'Email archived' }
      }
      await archiveMessage(input.message_id as string)
      return { success: true, message: 'Email archived' }
    }

    // ── Calendar ───────────────────────────────────────────────────────────────

    case 'list_calendar_events': {
      const token = await tokenForEmail(acctEmail, ctx)
      if (!token) return { error: 'No token available for this account' }
      const from = input.date_from as string
      const to   = input.date_to   as string
      const url  = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${from}T00:00:00Z&timeMax=${to}T23:59:59Z&singleEvents=true&orderBy=startTime&maxResults=50`
      const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return { error: `Calendar API error ${res.status}` }
      const data = await res.json() as {
        items?: Array<{
          id: string; summary: string
          start: { dateTime?: string; date?: string }
          end:   { dateTime?: string; date?: string }
          location?: string
        }>
      }
      return (data.items ?? []).map(e => ({
        id:       e.id,
        title:    e.summary,
        start:    e.start.dateTime ?? e.start.date,
        end:      e.end.dateTime   ?? e.end.date,
        location: e.location,
      }))
    }

    // ── Tasks ──────────────────────────────────────────────────────────────────

    case 'list_tasks': {
      const status   = (input.status as string) ?? 'open'
      const quadrant =  input.quadrant as string | undefined
      let tasks = ctx.tasks
      if (status !== 'all') tasks = tasks.filter(t => t.status === status)
      if (quadrant) tasks = tasks.filter(t => t.quadrant === quadrant)
      return tasks.slice(0, 60).map(t => ({
        id:       t.id,
        title:    t.title,
        status:   t.status,
        quadrant: t.quadrant,
        due_date: t.dueDate,
        company:  t.company,
        urgent:   t.urgent,
      }))
    }

    case 'create_task': {
      ctx.addTask({
        title:    input.title    as string,
        quadrant: (input.quadrant as 'do' | 'schedule' | 'delegate' | 'eliminate') ?? null,
        status:   'open',
        completed: false,
        company:  'teradix',
        dueDate:  input.due_date as string | undefined,
      })
      return { success: true, message: `Task "${input.title as string}" created` }
    }

    case 'complete_task': {
      ctx.updateTask(input.task_id as string, { status: 'done', completed: true, completedAt: new Date().toISOString() })
      return { success: true, message: 'Task marked as done' }
    }

    // ── Drive ──────────────────────────────────────────────────────────────────

    case 'list_drive_files': {
      const files = await listDriveFiles(input.query as string | undefined)
      return files.map(f => ({
        id:       f.id,
        name:     f.name,
        type:     f.mimeType.replace('application/vnd.google-apps.', '').replace('application/', ''),
        modified: f.modifiedTime,
        link:     f.webViewLink,
        size:     f.size,
      }))
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}
