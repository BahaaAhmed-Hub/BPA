/**
 * professor-siri — Natural-language HTTP endpoint for Siri Shortcuts.
 *
 * Siri Shortcuts ("Get Contents of URL") sends a query and speaks the plain-text
 * response aloud. This function accepts a natural-language command, runs it through
 * the Professor AI agent (same tools as the Telegram bot), strips markdown, and
 * returns clean prose Siri can read.
 *
 * Auth (query param preferred — Siri's "Get Contents of URL" action can't set headers):
 *   ?token=prof_sk_<48 hex chars>
 *   Authorization: Bearer prof_sk_<48 hex chars>
 *
 * Input (either works, GET or POST):
 *   ?text=What's on today?
 *   POST body (JSON): { "text": "What's on today?" }
 *
 * Response: Content-Type: text/plain, always HTTP 200 (errors spoken by Siri too).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const ANTHROPIC_KEY         = Deno.env.get('ANTHROPIC_API_KEY')  ?? ''
const GOOGLE_CLIENT_ID      = Deno.env.get('GOOGLE_CLIENT_ID')   ?? ''
const GOOGLE_CLIENT_SECRET  = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''

// ── Response helpers ──────────────────────────────────────────────────────────

/** Always 200, text/plain — errors are spoken by Siri too. */
function ok(text: string) {
  return new Response(stripMarkdown(text), {
    status:  200,
    headers: {
      'Content-Type':                'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/** Strip markdown so Siri doesn't read asterisks, backticks, and hashes aloud. */
function stripMarkdown(text: string): string {
  return text
    // Remove bold/italic markers: *** ** * ___ __ _
    .replace(/\*{1,3}|_{1,3}/g, '')
    // Remove inline code and code fences
    .replace(/```[\s\S]*?```/g, match => match.replace(/```\w*\n?/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    // Remove ATX headers: ### Title → Title
    .replace(/^#{1,6}\s+/gm, '')
    // Normalise bullet dashes and middle dots → •
    .replace(/^[-–—·•]\s+/gm, '• ')
    // Also handle "  - " indented bullets
    .replace(/^\s{2,}[-–—·•]\s+/gm, '  • ')
    // Collapse multiple blank lines to one
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Resolve a prof_sk_* token from:
 *   1. ?token= query param (preferred — Siri Shortcuts uses plain URLs)
 *   2. Authorization: Bearer header
 */
async function resolveToken(req: Request): Promise<string | null> {
  const url    = new URL(req.url)
  const qToken = url.searchParams.get('token')?.trim() ?? ''
  const hToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()

  const token = qToken.startsWith('prof_sk_') ? qToken
    : hToken.startsWith('prof_sk_')           ? hToken
    : ''

  if (!token) return null

  const { data } = await sb
    .from('user_tokens')
    .select('user_id')
    .eq('token', token)
    .eq('revoked', false)
    .maybeSingle()

  if (!data) return null

  // Update last_used_at without blocking the response
  sb.from('user_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token', token)
    .then(() => {})

  return (data as { user_id: string }).user_id
}

/** Extract the natural-language text from ?text= or a JSON POST body. */
async function extractText(req: Request): Promise<string> {
  const url   = new URL(req.url)
  // Accept both ?q= (Siri Shortcut format) and ?text=
  const qText = (url.searchParams.get('q') ?? url.searchParams.get('text'))?.trim()
  if (qText) return qText

  if (req.method === 'POST') {
    const ct = req.headers.get('Content-Type') ?? ''
    if (ct.includes('application/json')) {
      try {
        const body = await req.json() as Record<string, unknown>
        const t = (body.text ?? body.q ?? body.query ?? body.message ?? '') as string
        return t.trim()
      } catch { /* fall through */ }
    } else {
      // application/x-www-form-urlencoded or plain text
      try {
        const raw = await req.text()
        const params = new URLSearchParams(raw)
        const t = params.get('text') ?? raw
        return t.trim()
      } catch { /* fall through */ }
    }
  }

  return ''
}

// ── Shared date helpers ───────────────────────────────────────────────────────

const todayISO = () => new Date().toISOString().slice(0, 10)

// ── Google OAuth helper ───────────────────────────────────────────────────────

async function getGoogleToken(
  userId: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
    return { ok: false, error: 'Google is not configured on the server.' }

  const { data: account } = await sb
    .from('google_accounts').select('id')
    .eq('user_id', userId).eq('is_primary', true).maybeSingle()

  if (!account)
    return { ok: false, error: "Your Google account is not connected. Sign in with Google in the Professor app." }

  const { data: tokenRow } = await sb
    .from('google_account_tokens').select('refresh_token')
    .eq('account_id', (account as { id: string }).id).maybeSingle()

  const refreshToken = (tokenRow as { refresh_token: string } | null)?.refresh_token
  if (!refreshToken)
    return { ok: false, error: "Cannot reach Google right now. Try reconnecting in Settings." }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  })

  const td = await tokenRes.json() as { access_token?: string }
  if (!td.access_token)
    return { ok: false, error: 'Google token expired. Please reconnect in the Professor app.' }

  return { ok: true, token: td.access_token }
}

// ── Professor tools ───────────────────────────────────────────────────────────

async function toolGetToday(userId: string): Promise<string> {
  const date = todayISO()

  const [tasksRes, habitsRes, logsRes] = await Promise.all([
    sb.from('tasks').select('title, quadrant, status')
      .eq('user_id', userId).in('status', ['todo', 'in_progress'])
      .order('created_at', { ascending: false }).limit(10),
    sb.from('habits').select('id, name, goal, unit')
      .eq('user_id', userId).eq('is_active', true),
    sb.from('habit_logs').select('habit_id, completed, quantity')
      .eq('user_id', userId).eq('date', date),
  ])

  const tasks  = (tasksRes.data  ?? []) as { title: string; quadrant: string | null }[]
  const habits = (habitsRes.data ?? []) as { id: string; name: string; goal: number | null; unit: string | null }[]
  const logs   = (logsRes.data   ?? []) as { habit_id: string; completed: boolean; quantity: number | null }[]

  const logMap = new Map(logs.map(l => [l.habit_id, l]))

  const byQ: Record<string, string[]> = { do: [], schedule: [], delegate: [], dump: [] }
  for (const t of tasks) byQ[t.quadrant ?? 'dump']?.push(t.title)
  const taskLines = (Object.entries(byQ) as [string, string[]][])
    .filter(([, v]) => v.length)
    .flatMap(([q, ts]) => [`${q.toUpperCase()}`, ...ts.map(t => `• ${t}`)])
  const taskBlock = taskLines.join('\n') || 'No open tasks'

  const habitBlock = habits.length
    ? habits.map(h => {
        const l   = logMap.get(h.id)
        const pct = h.goal && l?.quantity ? ` ${l.quantity}/${h.goal}${h.unit ? ' ' + h.unit : ''}` : ''
        return `${l?.completed ? 'Done' : 'Not done'}: ${h.name}${pct}`
      }).join('\n')
    : 'No habits'

  return [
    `Today — ${date}`,
    '',
    `Tasks (${tasks.length} open)`,
    taskBlock,
    '',
    'Habits',
    habitBlock,
  ].join('\n')
}

async function toolGetTasks(userId: string, args: Record<string, unknown>): Promise<string> {
  let q = sb.from('tasks').select('id, title, quadrant, status, due_date').eq('user_id', userId)
  if (args.quadrant) q = q.eq('quadrant', args.quadrant)
  if (args.status === 'open') q = q.in('status', ['todo', 'in_progress'])
  if (args.status === 'done') q = q.eq('status', 'done')
  q = q.order('created_at', { ascending: false }).limit((args.limit as number) ?? 20)

  const { data, error } = await q
  if (error) return `Error: ${error.message}`
  if (!data?.length) return 'No tasks found.'

  return (data as { id: string; title: string; quadrant: string | null; status: string; due_date: string | null }[])
    .map(t => `• ${t.title} (${t.quadrant ?? 'dump'}${t.due_date ? ', ' + t.due_date : ''})`)
    .join('\n')
}

async function toolAddTask(userId: string, args: Record<string, unknown>): Promise<string> {
  const { error } = await sb.from('tasks').insert({
    user_id:  userId,
    title:    args.title,
    quadrant: args.quadrant ?? 'dump',
    due_date: args.due_date ?? null,
    status:   'todo',
  })

  if (error) return `Error: ${error.message}`
  return `Added: "${args.title}"`
}

async function toolCompleteTask(userId: string, args: Record<string, unknown>): Promise<string> {
  const { error } = await sb.from('tasks').update({
    status:       args.status,
    completed_at: new Date().toISOString(),
  }).eq('id', args.task_id).eq('user_id', userId)

  if (error) return `Error: ${error.message}`
  return `Done. Task marked as ${args.status}.`
}

async function toolLogHabit(userId: string, args: Record<string, unknown>): Promise<string> {
  const { data: matches } = await sb.from('habits')
    .select('id, name, goal, unit').eq('user_id', userId).eq('is_active', true)
    .ilike('name', `%${args.habit_name}%`)

  if (!matches?.length) return `No habit found matching "${args.habit_name}".`
  const candidates = matches as { id: string; name: string; goal: number | null; unit: string | null }[]
  if (candidates.length > 1)
    return `Multiple matches: ${candidates.map(h => h.name).join(', ')}. Be more specific.`

  const habit = candidates[0]
  const date  = (args.date as string | undefined) ?? todayISO()
  const qty   = (args.quantity as number | undefined) ?? 1

  // Read existing log first so we accumulate quantity rather than replace it
  const { data: existing } = await sb.from('habit_logs')
    .select('id, quantity').eq('habit_id', habit.id).eq('date', date).maybeSingle()

  const existingRow = existing as { id: string; quantity: number | null } | null
  const totalQty = habit.goal ? (existingRow?.quantity ?? 0) + qty : qty
  const done  = habit.goal ? totalQty >= habit.goal : true

  let writeError: { message: string } | null = null

  if (existingRow?.id) {
    const { error } = await sb.from('habit_logs')
      .update({ quantity: totalQty, completed: done }).eq('id', existingRow.id)
    writeError = error
  } else {
    const { error } = await sb.from('habit_logs')
      .insert({ user_id: userId, habit_id: habit.id, date, quantity: totalQty, completed: done })
    writeError = error
  }

  if (writeError) return `Error: ${writeError.message}`

  const { data: saved } = await sb.from('habit_logs')
    .select('quantity, completed').eq('habit_id', habit.id).eq('date', date).maybeSingle()

  const s = saved as { quantity: number | null; completed: boolean } | null
  const savedQty  = s?.quantity ?? totalQty
  const goalNote  = habit.goal
    ? (s?.completed ? ' Goal reached!' : ` (${savedQty}/${habit.goal}${habit.unit ? ' ' + habit.unit : ''})`)
    : ''

  return `Logged ${habit.name}${habit.unit ? ': ' + savedQty + ' ' + habit.unit : ''}${goalNote} on ${date}`
}

async function toolAddTransaction(userId: string, args: Record<string, unknown>): Promise<string> {
  const { data: accounts } = await sb
    .from('finance_accounts').select('id, name, currency')
    .eq('user_id', userId).in('account_type', ['payment', 'wallet']).limit(5)

  const accs = (accounts ?? []) as { id: string; name: string; currency: string }[]
  if (!accs.length) return 'No payment accounts found. Add one in the Professor app first.'

  let account = accs[0]
  if (args.account_name) {
    const found = accs.find(a =>
      a.name.toLowerCase().includes((args.account_name as string).toLowerCase())
    )
    if (found) account = found
  }

  const date   = (args.date as string | undefined) ?? todayISO()
  const amount = Math.abs(args.amount as number)
  const payee  = (args.payee ?? args.description ?? '') as string

  const { error } = await sb.from('finance_transactions').insert({
    user_id:    userId,
    account_id: account.id,
    amount,
    currency:   account.currency,
    tx_type:    args.tx_type ?? 'expense',
    payee,
    date,
    paid_at:    date,
    is_cleared: true,
  })

  if (error) return `Error: ${error.message}`
  return `Logged: ${payee || 'transaction'} — ${amount.toLocaleString()} ${account.currency} on ${date} (${account.name})`
}

async function toolGetCalendarEvents(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error

  const daysAhead = Math.min((args.days_ahead as number | undefined) ?? 3, 14)
  const now       = new Date()
  const timeMin   = now.toISOString()
  const timeMax   = new Date(now.getTime() + daysAhead * 86400e3).toISOString()

  const calRes = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?' +
    new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '20' }),
    { headers: { Authorization: `Bearer ${g.token}` } }
  )

  if (!calRes.ok) return `Calendar error (${calRes.status}). Try again in a moment.`

  const calData = await calRes.json() as {
    items?: { summary?: string; start?: { dateTime?: string; date?: string } }[]
  }
  const events = calData.items ?? []
  if (!events.length) return `No events in the next ${daysAhead} days.`

  const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  function fmtDT(start: { dateTime?: string; date?: string }): string {
    if (start.dateTime) {
      const m = start.dateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
      if (!m) return start.dateTime
      const [, yr, mo, dy, hh, mm] = m
      const dow = DAYS[new Date(Date.UTC(+yr, +mo - 1, +dy)).getUTCDay()]
      return `${dow} ${+dy} ${MONTHS[+mo - 1]}, ${hh}:${mm}`
    }
    if (start.date) {
      const [yr, mo, dy] = start.date.split('-')
      const dow = DAYS[new Date(Date.UTC(+yr, +mo - 1, +dy)).getUTCDay()]
      return `${dow} ${+dy} ${MONTHS[+mo - 1]} (all day)`
    }
    return ''
  }

  return events.map(e =>
    `• ${e.summary ?? 'Untitled'} — ${fmtDT(e.start ?? {})}`
  ).join('\n')
}

// ── Shopping tools ────────────────────────────────────────────────────────────

async function toolGetShoppingLists(userId: string): Promise<string> {
  const { data } = await sb.from('shopping_groups')
    .select('id, name, icon, scheduled_date')
    .eq('user_id', userId).eq('status', 'active').order('sort_order')

  if (!data?.length) return 'No shopping lists.'
  const lists = data as { id: string; name: string; icon: string; scheduled_date: string | null }[]

  const counts = await Promise.all(lists.map(l =>
    sb.from('shopping_items')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', l.id)
      .in('status', ['wanted', 'planned'])
  ))

  return lists.map((l, i) => {
    const n = counts[i].count ?? 0
    const d = l.scheduled_date ? ` (${l.scheduled_date})` : ''
    return `• ${l.icon} ${l.name}${d} — ${n} item${n !== 1 ? 's' : ''} [${l.id.slice(0, 8)}]`
  }).join('\n')
}

async function toolGetShoppingItems(userId: string, args: Record<string, unknown>): Promise<string> {
  let groupId: string | null = null

  if (args.list_name) {
    const { data: groups } = await sb.from('shopping_groups')
      .select('id, name').eq('user_id', userId).ilike('name', `%${args.list_name}%`)
    if (!groups?.length) return `No list found matching "${args.list_name}".`
    groupId = (groups as { id: string }[])[0].id
  }

  let q = sb.from('shopping_items')
    .select('id, name, quantity, unit, status, notes')
    .eq('user_id', userId).order('sort_order')

  if (groupId)     q = q.eq('group_id', groupId)
  if (args.status) q = q.eq('status', args.status as string)
  else             q = q.in('status', ['wanted', 'planned'])

  const { data, error } = await q.limit(30)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return 'No items.'

  return (data as { id: string; name: string; quantity: number; unit: string | null; status: string; notes: string | null }[])
    .map(i => {
      const qty  = i.quantity !== 1 ? ` x${i.quantity}` : ''
      const unit = i.unit ? ' ' + i.unit : ''
      const note = i.notes ? ` (${i.notes})` : ''
      const done = i.status === 'purchased' ? 'Got it' : 'Need'
      return `• ${i.name}${qty}${unit}${note} [${done}]`
    }).join('\n')
}

async function toolAddShoppingItem(userId: string, args: Record<string, unknown>): Promise<string> {
  let groupId: string | null = null
  let resolvedListName: string | null = null

  if (args.list_id) {
    groupId = args.list_id as string
    resolvedListName = args.list_name as string | null
  } else if (args.list_name) {
    const { data: groups } = await sb.from('shopping_groups')
      .select('id, name').eq('user_id', userId).ilike('name', `%${args.list_name}%`)
    if (groups?.length) {
      groupId          = (groups as { id: string; name: string }[])[0].id
      resolvedListName = (groups as { id: string; name: string }[])[0].name
    }
  }

  const { error } = await sb.from('shopping_items').insert({
    user_id:  userId,
    group_id: groupId,
    name:     args.name,
    quantity: args.quantity ?? 1,
    unit:     args.unit    ?? null,
    notes:    args.notes   ?? null,
    status:   'wanted',
  })

  if (error) return `Error: ${error.message}`
  const listPart = resolvedListName ? ` to ${resolvedListName}` : ' (no list assigned)'
  return `Added "${args.name}"${listPart}.`
}

async function toolCreateShoppingList(userId: string, args: Record<string, unknown>): Promise<string> {
  const name = args.name as string
  const icon = (args.icon as string | undefined) ?? '🛒'

  const { data, error } = await sb.from('shopping_groups').insert({
    user_id:    userId,
    name,
    icon,
    status:     'active',
    sort_order: 0,
  }).select('id').single()

  if (error) return `Error: ${error.message}`
  return `Created list ${name} ${icon} [${(data as { id: string }).id.slice(0, 8)}]`
}

async function toolMarkShoppingItem(userId: string, args: Record<string, unknown>): Promise<string> {
  let itemId = args.item_id as string | undefined

  if (!itemId) {
    const { data } = await sb.from('shopping_items')
      .select('id, name').eq('user_id', userId)
      .ilike('name', `%${args.item_name}%`)
      .in('status', ['wanted', 'planned']).limit(3)

    if (!data?.length) return `No item found matching "${args.item_name}".`
    const candidates = data as { id: string; name: string }[]
    if (candidates.length > 1)
      return `Multiple matches: ${candidates.map(i => i.name).join(', ')}. Be more specific.`
    itemId = candidates[0].id
  }

  const status  = (args.status as string | undefined) ?? 'purchased'
  const updates: Record<string, unknown> = { status }
  if (status === 'purchased') updates.purchased_at = new Date().toISOString()
  if (args.final_price !== undefined) updates.final_price = args.final_price

  const { error } = await sb.from('shopping_items')
    .update(updates).eq('id', itemId).eq('user_id', userId)

  if (error) return `Error: ${error.message}`
  return status === 'purchased' ? 'Marked as purchased.' : 'Marked as still needed.'
}

// ── Mail tools ────────────────────────────────────────────────────────────────

async function toolGetEmails(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error

  const maxResults = Math.min((args.limit as number | undefined) ?? 10, 20)
  const q = (args.query as string | undefined) ?? 'is:unread in:inbox'

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?` +
    new URLSearchParams({ q, maxResults: String(maxResults) }),
    { headers: { Authorization: `Bearer ${g.token}` } }
  )
  if (!listRes.ok) {
    if (listRes.status === 403)
      return "Cannot read email. Please reconnect Google with mail permissions in the Professor app."
    return `Gmail error (${listRes.status}).`
  }

  const listData = await listRes.json() as { messages?: { id: string }[] }
  const ids = listData.messages ?? []
  if (!ids.length) return 'No emails found.'

  const metas = await Promise.all(ids.slice(0, 10).map(async ({ id }) => {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata` +
      `&metadataHeaders=Subject&metadataHeaders=From`,
      { headers: { Authorization: `Bearer ${g.token}` } }
    )
    if (!r.ok) return null
    const m = await r.json() as {
      id: string
      snippet?: string
      labelIds?: string[]
      payload?: { headers?: { name: string; value: string }[] }
    }
    const headers = m.payload?.headers ?? []
    const subject = headers.find(h => h.name === 'Subject')?.value ?? '(no subject)'
    const from    = headers.find(h => h.name === 'From')?.value ?? ''
    const unread  = m.labelIds?.includes('UNREAD') ? 'Unread' : 'Read'
    const snippet = m.snippet ? ` — ${m.snippet.slice(0, 80)}` : ''
    return `• [${id.slice(0, 8)}] ${subject} — From: ${from} (${unread})${snippet}`
  }))

  return metas.filter(Boolean).join('\n')
}

async function toolArchiveEmail(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error

  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.message_id}/modify`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ removeLabelIds: ['INBOX'] }),
    }
  )
  if (!r.ok) {
    if (r.status === 403) return "Cannot archive. Please reconnect Google with mail permissions."
    return `Archive failed (${r.status}).`
  }
  return 'Archived.'
}

async function toolMarkEmailRead(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error

  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.message_id}/modify`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    }
  )
  if (!r.ok) {
    if (r.status === 403) return "Cannot mark as read. Please reconnect Google with mail permissions."
    return `Failed (${r.status}).`
  }
  return 'Marked as read.'
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

async function dispatchTool(userId: string, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_today':            return toolGetToday(userId)
    case 'get_tasks':            return toolGetTasks(userId, args)
    case 'add_task':             return toolAddTask(userId, args)
    case 'complete_task':        return toolCompleteTask(userId, args)
    case 'log_habit':            return toolLogHabit(userId, args)
    case 'add_transaction':      return toolAddTransaction(userId, args)
    case 'get_calendar_events':  return toolGetCalendarEvents(userId, args)
    case 'get_shopping_lists':   return toolGetShoppingLists(userId)
    case 'get_shopping_items':   return toolGetShoppingItems(userId, args)
    case 'add_shopping_item':    return toolAddShoppingItem(userId, args)
    case 'create_shopping_list': return toolCreateShoppingList(userId, args)
    case 'mark_shopping_item':   return toolMarkShoppingItem(userId, args)
    case 'get_emails':           return toolGetEmails(userId, args)
    case 'archive_email':        return toolArchiveEmail(userId, args)
    case 'mark_email_read':      return toolMarkEmailRead(userId, args)
    default:                     return `Unknown tool: ${name}`
  }
}

// ── Claude tool definitions ───────────────────────────────────────────────────

const CLAUDE_TOOLS = [
  {
    name:         'get_today',
    description:  "Get a summary of today: open tasks, habit progress, and this month's finances.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name:        'get_tasks',
    description: 'List tasks. Filter by quadrant (do/schedule/delegate/dump) or status (open/done).',
    input_schema: {
      type: 'object',
      properties: {
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'dump'] },
        status:   { type: 'string', enum: ['open', 'done'] },
        limit:    { type: 'number' },
      },
    },
  },
  {
    name:        'add_task',
    description: 'Create a new task in the task list.',
    input_schema: {
      type:     'object',
      required: ['title'],
      properties: {
        title:    { type: 'string' },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'dump'] },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
  },
  {
    name:        'complete_task',
    description: 'Mark a task as done or deferred. Get the task id from get_tasks first.',
    input_schema: {
      type:     'object',
      required: ['task_id', 'status'],
      properties: {
        task_id: { type: 'string' },
        status:  { type: 'string', enum: ['done', 'deferred'] },
      },
    },
  },
  {
    name:        'log_habit',
    description: 'Log a habit completion. Name can be partial.',
    input_schema: {
      type:     'object',
      required: ['habit_name'],
      properties: {
        habit_name: { type: 'string' },
        quantity:   { type: 'number' },
        date:       { type: 'string', description: 'YYYY-MM-DD — defaults to today' },
      },
    },
  },
  {
    name:        'add_transaction',
    description: 'Log an expense or income entry. Use this when the user mentions spending money, buying something, or receiving money.',
    input_schema: {
      type:     'object',
      required: ['amount', 'payee'],
      properties: {
        amount:       { type: 'number', description: 'Positive number — direction set by tx_type' },
        payee:        { type: 'string', description: 'Merchant, shop, or description of what it was' },
        tx_type:      { type: 'string', enum: ['expense', 'income'], description: 'Defaults to expense' },
        date:         { type: 'string', description: 'YYYY-MM-DD — defaults to today' },
        account_name: { type: 'string', description: 'Partial name of the account to charge. Omit to use default.' },
      },
    },
  },
  {
    name:        'get_calendar_events',
    description: 'List upcoming Google Calendar events.',
    input_schema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number', description: 'How many days ahead to look (default 3, max 14)' },
      },
    },
  },
  {
    name:         'get_shopping_lists',
    description:  'List all active shopping lists with item counts.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name:        'get_shopping_items',
    description: 'List items in a shopping list. Omit list_name to see all pending items.',
    input_schema: {
      type: 'object',
      properties: {
        list_name: { type: 'string', description: 'Partial list name (optional)' },
        status:    { type: 'string', enum: ['wanted', 'planned', 'purchased'] },
      },
    },
  },
  {
    name:        'add_shopping_item',
    description: 'Add an item to a shopping list. Always call get_shopping_lists first to find the right list. Pass list_id (from get_shopping_lists) when you have matched a list.',
    input_schema: {
      type:     'object',
      required: ['name'],
      properties: {
        name:      { type: 'string' },
        quantity:  { type: 'number' },
        unit:      { type: 'string' },
        notes:     { type: 'string', description: 'Optional note, e.g. brand or size' },
        list_id:   { type: 'string', description: 'Exact list id (8-char prefix from get_shopping_lists) — preferred over list_name' },
        list_name: { type: 'string', description: 'Partial list name fallback if no list_id' },
      },
    },
  },
  {
    name:        'create_shopping_list',
    description: 'Create a new shopping list. Only call this after the user confirms they want a new list.',
    input_schema: {
      type:     'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Name of the new list' },
        icon: { type: 'string', description: 'Single emoji for the list icon' },
      },
    },
  },
  {
    name:        'mark_shopping_item',
    description: 'Mark a shopping item as purchased or back to wanted.',
    input_schema: {
      type: 'object',
      properties: {
        item_id:     { type: 'string', description: '8-char prefix from get_shopping_items' },
        item_name:   { type: 'string', description: 'Partial item name if no item_id' },
        status:      { type: 'string', enum: ['purchased', 'wanted'], description: 'Defaults to purchased' },
        final_price: { type: 'number', description: 'What it actually cost' },
      },
    },
  },
  {
    name:        'get_emails',
    description: 'List emails from Gmail. Defaults to unread inbox. Can search with a query.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query, e.g. "is:unread in:inbox" or "from:boss". Defaults to unread inbox.' },
        limit: { type: 'number', description: 'Max emails to return (default 10, max 20)' },
      },
    },
  },
  {
    name:        'archive_email',
    description: 'Archive an email (remove from inbox). Get the message_id from get_emails.',
    input_schema: {
      type:     'object',
      required: ['message_id'],
      properties: {
        message_id: { type: 'string', description: '8-char or full message id from get_emails' },
      },
    },
  },
  {
    name:        'mark_email_read',
    description: 'Mark an email as read. Get the message_id from get_emails.',
    input_schema: {
      type:     'object',
      required: ['message_id'],
      properties: {
        message_id: { type: 'string', description: '8-char or full message id from get_emails' },
      },
    },
  },
]

// ── Claude agent ──────────────────────────────────────────────────────────────

type ContentBlock = {
  type:   string
  text?:  string
  id?:    string
  name?:  string
  input?: Record<string, unknown>
}

async function runAgent(userId: string, userMessage: string): Promise<string> {
  if (!ANTHROPIC_KEY) return fallbackProcess(userId, userMessage)

  const today     = todayISO()
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)

  const systemPrompt = `CRITICAL RULE — LANGUAGE: You MUST reply in the exact same language the user wrote in.
- User writes Arabic → your ENTIRE reply must be in Arabic (no English words mixed in)
- User writes English → reply in English
- This overrides everything. Check the language of the user's message first.

You are Professor AI. Keep responses SHORT — one to three sentences or a short list. Siri will speak your response aloud, so use NO markdown, NO asterisks, NO headers, NO backticks, NO bold, NO italic. Use plain language. Use • for list items.

Today is ${today}. Yesterday was ${yesterday}.

IMPORTANT — understand natural speech (Arabic and English):
- "yesterday", "last night", "this morning" / "امبارح", "الليلة الماضية", "الصبح" → use the right date (${yesterday} for yesterday)
- "water 600ml" / "مية 600 مل" → log_habit(habit_name="water", quantity=600)
- "water 600ml yesterday" / "مية 600 مل امبارح" → log_habit(habit_name="water", quantity=600, date="${yesterday}")
- Multiple habits in one message → call log_habit multiple times in parallel, one per habit
- "add call Ahmed" / "أضف مهمة اتصل بأحمد" → add_task
- "what do I have today" / "إيه اللي عندي النهارده" → get_today, then get_calendar_events(days_ahead=1)
- "spent 200 on lunch" / "صرفت 200 على الغداء" → add_transaction(amount=200, payee="lunch")
- "what's on my calendar" / "فيه إيه في التقويم" → get_calendar_events
- "what's on my shopping list" / "إيه في قايمة التسوق" → get_shopping_lists, then get_shopping_items
- ADDING ITEMS — always follow this flow:
  1. Call get_shopping_lists to see what lists exist
  2. Detect the item's category (grocery/food, pharmacy/medicine, electronics, hardware, clothing, etc.)
  3. Match to the most suitable list by name or category (e.g. milk → Groceries, paracetamol → Pharmacy)
  4. If a good match exists → call add_shopping_item with list_id
  5. If NO suitable list exists → ask the user: "I don't have a [category] list. Want me to create one?" — then call create_shopping_list only after they confirm
  6. For multiple items at once → call add_shopping_item in parallel for all of them (one call per item)
- "add milk to groceries" / "أضف لبن للجروسيري" → get_shopping_lists, match, add_shopping_item
- "add eggs, bread, and butter" / "أضف بيض وعيش وزبدة" → get_shopping_lists once, then add_shopping_item in parallel for each item
- "bought the milk" / "اشتريت اللبن" → mark_shopping_item(item_name="milk")
- "check my email" / "شوف الإيميلات" → get_emails
- "show unread" / "الإيميلات الجديدة" → get_emails(query="is:unread in:inbox")
- "archive that email" / "أرشف الإيميل ده" → archive_email(message_id=...)
- "mark it as read" / "علّم مقروء" → mark_email_read(message_id=...)
- Never ask the user to rephrase. Just figure it out.
- When the user lists multiple things to log or add, call the relevant tool in parallel for each one.

What you CAN do: tasks (list, add, complete), habits (log with quantities and past dates), log expenses/income, calendar events, today's overview, shopping lists (view, add items, mark bought), email (list, archive, mark read).
What you CANNOT do: read financial balances or history — say so briefly if asked.

Reply style: short, warm, direct. No markdown. Use plain bullets with •. After a tool result, one short sentence of context if helpful, then the list. For confirmations a single sentence is fine.`

  const messages: { role: string; content: unknown }[] = [
    { role: 'user', content: userMessage },
  ]

  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system:     systemPrompt,
        tools:      CLAUDE_TOOLS,
        messages,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Anthropic error:', err)
      return 'Sorry, I ran into a problem. Try again in a moment.'
    }

    const data = await res.json() as { stop_reason: string; content: ContentBlock[] }

    if (data.stop_reason === 'end_turn') {
      return data.content.find(b => b.type === 'text')?.text ?? ''
    }

    if (data.stop_reason === 'tool_use') {
      const toolUses = data.content.filter(b => b.type === 'tool_use')

      const toolResults = await Promise.all(
        toolUses.map(async tu => ({
          type:        'tool_result' as const,
          tool_use_id: tu.id!,
          content:     await dispatchTool(userId, tu.name!, tu.input ?? {}),
        }))
      )

      messages.push({ role: 'assistant', content: data.content })
      messages.push({ role: 'user',      content: toolResults })
    } else {
      break
    }
  }

  return 'I got a bit confused. Could you rephrase that?'
}

// Fallback when no Anthropic key — pattern-match common requests
async function fallbackProcess(userId: string, text: string): Promise<string> {
  const lower = text.toLowerCase()
  if (/\b(today|tasks|schedule)\b/.test(lower))   return toolGetToday(userId)
  if (/\b(calendar|events|meetings)\b/.test(lower)) return toolGetCalendarEvents(userId, {})
  if (/\badd task[:\s](.+)/i.test(text)) {
    const title = text.match(/add task[:\s](.+)/i)?.[1]?.trim()
    if (title) return toolAddTask(userId, { title })
  }
  return 'I can answer: What is on today, What is on my calendar, Add task (name). Set up an Anthropic API key in Supabase secrets for full AI responses.'
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status:  204,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    })
  }

  // Resolve token
  const userId = await resolveToken(req)
  if (!userId) {
    return ok('Invalid or missing token. Generate one in Settings, then Integrations, then Connections.')
  }

  // Extract the natural-language command
  const text = await extractText(req)
  if (!text) {
    return ok('What would you like me to do? Send your command as a text query parameter or in the request body.')
  }

  // Run the agent and return plain text Siri can speak
  const response = await runAgent(userId, text)
  return ok(response)
})
