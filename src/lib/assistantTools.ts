import type Anthropic from '@anthropic-ai/sdk'
import type { Task } from '@/types'
import { listUnreadThreadIds, getThread, header, archiveMessage, composeEmail, sendReply } from './gmail'
import { listDriveFiles } from './googleDrive'
import { supabase } from './supabase'

// ─── Context provided by the React component ─────────────────────────────────

export interface ToolContext {
  tasks: Task[]
  addTask: (t: Omit<Task, 'id' | 'createdAt'>) => void
  updateTask: (id: string, updates: Partial<Task>) => void
}

// ─── Shared token helper ──────────────────────────────────────────────────────

async function googleToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.provider_token ?? localStorage.getItem('google_provider_token') ?? ''
}

// ─── Tool schemas (Anthropic format) ─────────────────────────────────────────

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_emails',
    description:
      'List recent unread emails from Gmail inbox. Returns subject, sender, snippet and thread/message IDs for up to 8 threads.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'search_emails',
    description:
      'Search Gmail with a query (e.g. "from:boss@company.com", "subject:invoice is:unread"). Returns matching threads.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'Gmail search query' } },
      required: ['query'],
    },
  },
  {
    name: 'send_email',
    description: 'Compose and send a new email from the primary account.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to:      { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Subject line' },
        body:    { type: 'string', description: 'Plain-text body' },
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
        thread_id:   { type: 'string', description: 'Gmail thread ID' },
        to:          { type: 'string', description: 'Recipient email address' },
        subject:     { type: 'string', description: 'Subject (Re: will be prepended automatically)' },
        body:        { type: 'string', description: 'Reply body text' },
        in_reply_to: { type: 'string', description: 'Message-ID header of the email being replied to (optional)' },
      },
      required: ['thread_id', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'archive_email',
    description: 'Archive an email (removes it from inbox, keeps it in All Mail).',
    input_schema: {
      type: 'object' as const,
      properties: { message_id: { type: 'string', description: 'Gmail message ID' } },
      required: ['message_id'],
    },
  },
  {
    name: 'list_calendar_events',
    description: 'Get calendar events from the primary Google Calendar for a given date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
        date_to:   { type: 'string', description: 'End date in YYYY-MM-DD format' },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'list_tasks',
    description: "List the user's tasks. Filter by status and/or quadrant.",
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'done', 'all'],
          description: 'Filter by status (default: open)',
        },
        quadrant: {
          type: 'string',
          enum: ['do', 'schedule', 'delegate', 'eliminate'],
          description: 'Filter by Eisenhower quadrant',
        },
      },
      required: [],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task in the task board.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:    { type: 'string', description: 'Task title (may include an emoji prefix)' },
        quadrant: {
          type: 'string',
          enum: ['do', 'schedule', 'delegate', 'eliminate'],
          description: 'Eisenhower quadrant',
        },
        due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format (optional)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as done.',
    input_schema: {
      type: 'object' as const,
      properties: { task_id: { type: 'string', description: 'Task ID to mark complete' } },
      required: ['task_id'],
    },
  },
  {
    name: 'list_drive_files',
    description: 'Search Google Drive files. Returns file name, type, modified date and a direct link.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search term (optional — omit to see recent files)' },
      },
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
  switch (name) {
    // ── Email ──────────────────────────────────────────────────────────────────

    case 'list_emails': {
      const { ids } = await listUnreadThreadIds(8)
      const threads = await Promise.all(ids.slice(0, 8).map(id => getThread(id)))
      return threads.map(t => {
        const msg = t.messages[t.messages.length - 1]
        const h = msg.payload.headers
        return {
          thread_id: t.id,
          message_id: msg.id,
          from: header(h, 'from'),
          subject: header(h, 'subject'),
          date: header(h, 'date'),
          snippet: msg.snippet,
        }
      })
    }

    case 'search_emails': {
      const token = await googleToken()
      if (!token) return { error: 'Not authenticated with Google' }
      const q = input.query as string
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(q)}&maxResults=10`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const data = await res.json() as { threads?: { id: string }[] }
      const ids = (data.threads ?? []).map(t => t.id).slice(0, 8)
      const threads = await Promise.all(ids.map(id => getThread(id)))
      return threads.map(t => {
        const msg = t.messages[t.messages.length - 1]
        const h = msg.payload.headers
        return {
          thread_id: t.id,
          message_id: msg.id,
          from: header(h, 'from'),
          subject: header(h, 'subject'),
          date: header(h, 'date'),
          snippet: msg.snippet,
        }
      })
    }

    case 'send_email': {
      await composeEmail({
        to:      input.to      as string,
        subject: input.subject as string,
        body:    input.body    as string,
      })
      return { success: true, message: `Email sent to ${input.to as string}` }
    }

    case 'reply_to_email': {
      await sendReply({
        to:          input.to          as string,
        subject:     input.subject     as string,
        body:        input.body        as string,
        threadId:    input.thread_id   as string,
        inReplyTo:   input.in_reply_to as string | undefined,
      })
      return { success: true, message: `Reply sent to ${input.to as string}` }
    }

    case 'archive_email': {
      await archiveMessage(input.message_id as string)
      return { success: true, message: 'Email archived' }
    }

    // ── Calendar ───────────────────────────────────────────────────────────────

    case 'list_calendar_events': {
      const token = await googleToken()
      if (!token) return { error: 'Not authenticated with Google' }
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
          location?: string; description?: string
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
      const status   = (input.status   as string) ?? 'open'
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
      ctx.updateTask(input.task_id as string, {
        status:    'done',
        completed: true,
        completedAt: new Date().toISOString(),
      })
      return { success: true, message: 'Task marked as done' }
    }

    // ── Drive ──────────────────────────────────────────────────────────────────

    case 'list_drive_files': {
      const query = input.query as string | undefined
      const files = await listDriveFiles(query)
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
