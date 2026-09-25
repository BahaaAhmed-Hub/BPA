/**
 * telegram-bot — Telegram webhook handler for Professor AI
 *
 * Required Supabase secrets (set via: npx supabase secrets set KEY=value):
 *   TELEGRAM_BOT_TOKEN   — token from @BotFather
 *   ANTHROPIC_API_KEY    — Anthropic API key for Claude responses
 *
 * After deploying, register the webhook once:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://gyvgqhaepfsqnydhhbnk.supabase.co/functions/v1/telegram-bot"
 *
 * Users connect their account:
 *   1. Copy a prof_sk_* token from Settings → Integrations → Connections
 *   2. Send:  /connect prof_sk_<...>  to the bot
 */

import { CalendarHub, eventLine } from '../_shared/googleCalendars.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const BOT_TOKEN     = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')  ?? ''

// ── Telegram helpers ──────────────────────────────────────────────────────────

async function tg(method: string, body: Record<string, unknown>) {
  if (!BOT_TOKEN) return
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  }).catch(() => {})
}

async function reply(chatId: number, text: string) {
  await tg('sendMessage', {
    chat_id:    chatId,
    text:       text.slice(0, 4096),     // Telegram hard limit
    parse_mode: 'Markdown',
  })
}

async function sendChatAction(chatId: number, action = 'typing') {
  await tg('sendChatAction', { chat_id: chatId, action })
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function resolveChat(chatId: number): Promise<{ userId: string; token: string } | null> {
  const { data } = await sb
    .from('telegram_links')
    .select('user_id, token')
    .eq('chat_id', String(chatId))
    .maybeSingle()

  if (!data) return null
  return { userId: (data as { user_id: string; token: string }).user_id, token: (data as { user_id: string; token: string }).token }
}

async function resolveToken(token: string): Promise<string | null> {
  if (!token.startsWith('prof_sk_')) return null
  const { data } = await sb
    .from('user_tokens')
    .select('user_id')
    .eq('token', token)
    .eq('revoked', false)
    .maybeSingle()
  return (data as { user_id: string } | null)?.user_id ?? null
}

// ── Professor tools (same logic as professor-mcp) ─────────────────────────────

const todayISO = () => new Date().toISOString().slice(0, 10)

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
  const taskBlock = (Object.entries(byQ) as [string, string[]][])
    .filter(([, v]) => v.length)
    .map(([q, ts]) => `*${q.toUpperCase()}*\n${ts.map(t => `  · ${t}`).join('\n')}`)
    .join('\n') || '  No open tasks'

  const habitBlock = habits.length
    ? habits.map(h => {
        const l   = logMap.get(h.id)
        const pct = h.goal && l?.quantity ? ` ${l.quantity}/${h.goal}${h.unit ? ' ' + h.unit : ''}` : ''
        return `${l?.completed ? '✓' : '○'} ${h.name}${pct}`
      }).join('\n')
    : '  No habits'

  return [
    `*Today — ${date}*`,
    '',
    `*Tasks (${tasks.length} open)*`,
    taskBlock,
    '',
    '*Habits*',
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
    .map(t => `[${t.id}] ${t.status === 'done' ? '✓' : '○'} ${t.title}  (${t.quadrant ?? 'dump'}${t.due_date ? ' · ' + t.due_date : ''})`)
    .join('\n')
}

async function toolAddTask(userId: string, args: Record<string, unknown>): Promise<string> {
  const { data, error } = await sb.from('tasks').insert({
    user_id:  userId,
    title:    args.title,
    quadrant: args.quadrant ?? 'dump',
    due_date: args.due_date ?? null,
    status:   'todo',
  }).select('id').single()

  if (error) return `Error: ${error.message}`
  return `Added: "${args.title}" — it's in your task list now.`
}

async function toolCompleteTask(userId: string, args: Record<string, unknown>): Promise<string> {
  const { error } = await sb.from('tasks').update({
    status:       args.status,
    completed_at: new Date().toISOString(),
  }).eq('id', args.task_id).eq('user_id', userId)

  if (error) return `Error: ${error.message}`
  return `Done ✓ — task marked as ${args.status}.`
}

async function toolUpdateTask(userId: string, args: Record<string, unknown>): Promise<string> {
  const updates: Record<string, unknown> = {}
  if (args.title    !== undefined) updates.title    = args.title
  if (args.quadrant !== undefined) updates.quadrant = args.quadrant
  if (args.due_date !== undefined) updates.due_date = (args.due_date as string) || null
  if (args.status   !== undefined) updates.status   = args.status

  if (!Object.keys(updates).length) return 'Nothing to update.'

  const { error } = await sb.from('tasks')
    .update(updates).eq('id', args.task_id).eq('user_id', userId)

  if (error) return `Error: ${error.message}`
  return `Task updated ✓`
}

async function toolLogHabit(userId: string, args: Record<string, unknown>): Promise<string> {
  const { data: matches } = await sb.from('habits')
    .select('id, name, goal, unit').eq('user_id', userId).eq('is_active', true)
    .ilike('name', `%${args.habit_name}%`)

  if (!matches?.length) return `No habit found matching "${args.habit_name}".`
  const candidates = matches as { id: string; name: string; goal: number | null; unit: string | null }[]
  if (candidates.length > 1) return `Multiple matches: ${candidates.map(h => h.name).join(', ')}. Be more specific.`

  const habit = candidates[0]
  const date  = (args.date as string | undefined) ?? todayISO()
  const qty   = (args.quantity as number | undefined) ?? 1

  // Read existing log first so we can accumulate quantity rather than replace
  const { data: existing } = await sb.from('habit_logs')
    .select('id, quantity')
    .eq('habit_id', habit.id)
    .eq('date', date)
    .maybeSingle()

  const existingRow = existing as { id: string; quantity: number | null } | null
  const totalQty = habit.goal ? (existingRow?.quantity ?? 0) + qty : qty
  const done  = habit.goal ? totalQty >= habit.goal : true

  let writeError: { message: string } | null = null
  if (existingRow?.id) {
    const { error } = await sb.from('habit_logs')
      .update({ quantity: totalQty, completed: done })
      .eq('id', existingRow.id)
    writeError = error
  } else {
    const { error } = await sb.from('habit_logs')
      .insert({ user_id: userId, habit_id: habit.id, date, quantity: totalQty, completed: done })
    writeError = error
  }

  if (writeError) return `Error: ${writeError.message}`

  // Read back to confirm
  const { data: saved } = await sb.from('habit_logs')
    .select('quantity, completed')
    .eq('habit_id', habit.id)
    .eq('date', date)
    .maybeSingle()

  const s = saved as { quantity: number | null; completed: boolean } | null
  const savedQty = s?.quantity ?? totalQty
  const goalNote = habit.goal
    ? (s?.completed ? ' ✓ goal reached!' : ` (${savedQty}/${habit.goal}${habit.unit ? ' ' + habit.unit : ''})`)
    : ' ✓'

  return `Logged ${habit.name}${habit.unit ? ': ' + savedQty + ' ' + habit.unit : ''}${goalNote} on ${date}`
}

async function toolGetHabits(userId: string, args: Record<string, unknown>): Promise<string> {
  const date = (args.date as string | undefined) ?? todayISO()

  const [habitsRes, logsRes] = await Promise.all([
    sb.from('habits').select('id, name, goal, unit').eq('user_id', userId).eq('is_active', true),
    sb.from('habit_logs').select('habit_id, completed, quantity').eq('user_id', userId).eq('date', date),
  ])

  const habits = (habitsRes.data ?? []) as { id: string; name: string; goal: number | null; unit: string | null }[]
  const logs   = (logsRes.data   ?? []) as { habit_id: string; completed: boolean; quantity: number | null }[]
  if (!habits.length) return 'No active habits.'

  const logMap = new Map(logs.map(l => [l.habit_id, l]))
  const lines = habits.map(h => {
    const l = logMap.get(h.id)
    if (!l) return `${h.name}: not logged yet`
    if (h.goal && l.quantity != null) {
      const pct = Math.round((l.quantity / h.goal) * 100)
      return `${h.name}: ${l.quantity}/${h.goal}${h.unit ? ' ' + h.unit : ''} (${pct}%)${l.completed ? ' ✓' : ''}`
    }
    return `${h.name}: ${l.completed ? 'done ✓' : 'not done'}`
  })
  return `Habits for ${date}:\n` + lines.join('\n')
}

async function toolGetTransactions(userId: string, args: Record<string, unknown>): Promise<string> {
  const dateFrom = (args.date_from as string | undefined) ?? (args.date as string | undefined) ?? todayISO()
  const dateTo   = (args.date_to   as string | undefined) ?? dateFrom

  let q = sb.from('finance_transactions')
    .select('amount, currency, tx_type, payee, date, paid_at, account_id')
    .eq('user_id', userId)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date', { ascending: false })
    .limit(50)

  const { data, error } = await q
  if (error) return `Error: ${error.message}`

  const txs = (data ?? []) as { amount: number; currency: string; tx_type: string; payee: string; date: string; paid_at: string | null; account_id: string }[]
  if (!txs.length) return dateFrom === dateTo
    ? `No transactions on ${dateFrom}.`
    : `No transactions between ${dateFrom} and ${dateTo}.`

  const { data: accounts } = await sb.from('finance_accounts').select('id, name').eq('user_id', userId)
  const acctMap = new Map(((accounts ?? []) as { id: string; name: string }[]).map(a => [a.id, a.name]))

  const expenses = txs.filter(t => t.tx_type === 'expense')
  const income   = txs.filter(t => t.tx_type === 'income')

  const label = dateFrom === dateTo ? dateFrom : `${dateFrom} – ${dateTo}`
  const lines: string[] = [`*Transactions for ${label}*`]

  if (expenses.length) {
    lines.push('', `*Expenses (${expenses.length})*`)
    for (const tx of expenses) {
      const acct = acctMap.get(tx.account_id) ?? 'Unknown'
      const unpaid = tx.paid_at ? '' : ' *(unpaid)*'
      lines.push(`- ${tx.amount.toLocaleString()} ${tx.currency} — ${tx.payee} · ${acct}${unpaid}`)
    }
  }
  if (income.length) {
    lines.push('', `*Income (${income.length})*`)
    for (const tx of income) {
      const acct = acctMap.get(tx.account_id) ?? 'Unknown'
      lines.push(`+ ${tx.amount.toLocaleString()} ${tx.currency} — ${tx.payee} · ${acct}`)
    }
  }

  return lines.join('\n')
}

async function toolAddTransaction(userId: string, args: Record<string, unknown>): Promise<string> {
  // Include credit cards — the app's type is 'credit_card', and a "platinum card"
  // or any named card must be findable here or the expense lands on the wrong account.
  const { data: accounts } = await sb
    .from('finance_accounts')
    .select('id, name, currency')
    .eq('user_id', userId)
    .in('account_type', ['payment', 'wallet', 'credit_card'])
    .limit(20)

  const accs = (accounts ?? []) as { id: string; name: string; currency: string }[]
  if (!accs.length) return 'No payment accounts found. Add one in the Professor app first.'

  let account = accs[0]
  if (args.account_name) {
    const found = accs.find(a => a.name.toLowerCase().includes((args.account_name as string).toLowerCase()))
    if (found) account = found
    else return `No account matching "${args.account_name}" found. Available: ${accs.map(a => a.name).join(', ')}.`
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

const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''

// Shared helper — returns access token or an error string
async function getGoogleToken(userId: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
    return { ok: false, error: 'Google is not configured on the server.' }

  const { data: account } = await sb
    .from('google_accounts').select('id')
    .eq('user_id', userId).eq('is_primary', true).maybeSingle()

  if (!account)
    return { ok: false, error: "Your Google account isn't connected. Sign in with Google in the Professor app." }

  const { data: tokenRow } = await sb
    .from('google_account_tokens').select('refresh_token')
    .eq('account_id', (account as { id: string }).id).maybeSingle()

  const refreshToken = (tokenRow as { refresh_token: string } | null)?.refresh_token
  if (!refreshToken)
    return { ok: false, error: "Can't reach Google right now. Try reconnecting in Settings." }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET, refresh_token: refreshToken,
    }),
  })

  const td = await tokenRes.json() as { access_token?: string }
  if (!td.access_token)
    return { ok: false, error: 'Google token expired. Please reconnect in the Professor app.' }

  return { ok: true, token: td.access_token }
}

// ── Calendars: every account, every calendar ──────────────────────────────────
// `getGoogleToken` above stays for Gmail, which is genuinely about one mailbox.
// Calendars are not: a company calendar lives on a connected account, so these
// go through `CalendarHub`, which reads them all. See _shared/googleCalendars.ts.

function calendarHub(userId: string): CalendarHub {
  return new CalendarHub(sb, userId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
}

async function toolGetCalendarEvents(userId: string, args: Record<string, unknown>): Promise<string> {
  const hub = calendarHub(userId)
  if (!hub.configured) return 'Google is not configured on the server.'

  const accounts = await hub.accounts()
  if (!accounts.length)
    return "Your Google account isn't connected. Sign in with Google in the Professor app."

  const daysAhead = Math.min((args.days_ahead as number | undefined) ?? 3, 14)
  const now     = new Date()
  const timeMin = now.toISOString()
  const timeMax = new Date(now.getTime() + daysAhead * 86400e3).toISOString()

  const cals = await hub.calendars()
  if (!cals.length) {
    return hub.unreachable.length
      ? `Couldn't reach ${hub.unreachable.join(', ')}. Reconnect in Settings and try again.`
      : 'No calendars are visible. Check Settings if you expect some.'
  }

  // A name narrows it — "what is on the Teradix calendar".
  const want = (args.calendar as string | undefined)?.trim().toLowerCase()
  const events = await hub.events({ timeMin, timeMax })
  const shown = want
    ? events.filter(e =>
        e.calendarName.toLowerCase().includes(want) || e.accountEmail.toLowerCase().includes(want))
    : events

  // Name the calendar on each row only where more than one is in play.
  const showCal = new Set(shown.map(e => e.calendarId)).size > 1
  const trouble = hub.unreachable.length
    ? `\n(Couldn't reach ${hub.unreachable.join(', ')} — reconnect in Settings.)`
    : ''

  if (!shown.length) {
    const scope = want ? ` on a calendar matching "${args.calendar as string}"` : ''
    return `No events in the next ${daysAhead} days${scope}.${trouble}`
  }

  return shown.map(e => eventLine(e, showCal)).join('\n') + trouble
}

async function toolAddCalendarEvent(userId: string, args: Record<string, unknown>): Promise<string> {
  const hub = calendarHub(userId)
  if (!hub.configured) return 'Google is not configured on the server.'

  const target = await hub.pickWritable(args.calendar as string | undefined)
  if (!target) {
    return hub.unreachable.length
      ? `Couldn't reach ${hub.unreachable.join(', ')}. Reconnect in Settings and try again.`
      : "No calendar you can write to. Sign in with Google in the Professor app."
  }
  const token = await hub.token(target.accountId)
  if (!token) return `Couldn't reach ${target.accountEmail}. Reconnect in Settings.`

  const title  = args.title as string
  const start  = args.start as string
  const allDay = !start.includes('T')

  const startObj = allDay ? { date: start } : { dateTime: start }
  const endArg   = args.end as string | undefined
  const endObj   = endArg
    ? (allDay ? { date: endArg } : { dateTime: endArg })
    : allDay
      ? { date: start }
      : { dateTime: new Date(new Date(start).getTime() + 3600000).toISOString() }

  const event: Record<string, unknown> = { summary: title, start: startObj, end: endObj }
  if (args.description) event.description = args.description
  if (args.location)    event.location    = args.location

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.calendarId)}/events`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(event),
    },
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    if (res.status === 403) return 'Cannot create events. Please reconnect Google with calendar permissions.'
    return `Calendar error: ${err.error?.message ?? res.status}`
  }

  const created = await res.json() as { summary?: string; start?: { dateTime?: string; date?: string } }
  const when = created.start?.dateTime
    ? created.start.dateTime.slice(0, 16).replace('T', ' at ')
    : (created.start?.date ?? start)
  // Say which calendar it landed on — with several in play, "created" alone
  // does not tell you whether it went where you meant.
  return `Created "${created.summary ?? title}" on ${when} in ${target.name}.`
}

async function toolUpdateCalendarEvent(userId: string, args: Record<string, unknown>): Promise<string> {
  const hub = calendarHub(userId)
  if (!hub.configured) return 'Google is not configured on the server.'

  const ref = String(args.event_id ?? '').trim()
  if (!ref) return 'Which event? Ask for the calendar first, then edit by its id.'

  const patch: Record<string, unknown> = {}
  if (args.title)       patch.summary     = args.title
  if (args.description) patch.description = args.description
  if (args.location)    patch.location    = args.location
  if (args.start) {
    const s = args.start as string
    patch.start = s.includes('T') ? { dateTime: s } : { date: s }
  }
  if (args.end) {
    const e = args.end as string
    patch.end = e.includes('T') ? { dateTime: e } : { date: e }
  }
  if (!Object.keys(patch).length) return 'Nothing to update.'

  // An event id means nothing without its calendar, and the id may come back
  // bare — so it is looked up rather than assumed to be on the default one.
  const found = await hub.locate(ref)
  if (!found) return "Couldn't find that event on any of your calendars. Ask for the calendar again and use the id it gives."
  if (!found.calendar.writable) return `"${found.calendar.name}" is read-only for you, so that event can't be edited.`

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(found.calendar.calendarId)}/events/${encodeURIComponent(found.eventId)}`,
    {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${found.token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    },
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    if (res.status === 403) return 'Cannot edit events. Please reconnect Google with calendar permissions.'
    return `Calendar error: ${err.error?.message ?? res.status}`
  }

  const updated = await res.json() as { summary?: string }
  return `Updated "${updated.summary ?? args.title}" in ${found.calendar.name}.`
}

// ── Shopping tools ────────────────────────────────────────────────────────────

async function toolGetShoppingLists(userId: string): Promise<string> {
  const { data } = await sb.from('shopping_groups')
    .select('id, name, icon, scheduled_date')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('sort_order')

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
    const d = l.scheduled_date ? ` · ${l.scheduled_date}` : ''
    return `${l.icon} ${l.name}${d} — ${n} item${n !== 1 ? 's' : ''} [${l.id.slice(0, 8)}]`
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
    .eq('user_id', userId)
    .order('sort_order')

  if (groupId)      q = q.eq('group_id', groupId)
  if (args.status)  q = q.eq('status', args.status as string)
  else              q = q.in('status', ['wanted', 'planned'])

  const { data, error } = await q.limit(30)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return 'No items.'

  return (data as { id: string; name: string; quantity: number; unit: string | null; status: string; notes: string | null }[])
    .map(i => {
      const qty = i.quantity !== 1 ? ` ×${i.quantity}` : ''
      const unit = i.unit ? ' ' + i.unit : ''
      const note = i.notes ? ` (${i.notes})` : ''
      return `${i.status === 'purchased' ? '✓' : '○'} ${i.name}${qty}${unit}${note} [${i.id.slice(0, 8)}]`
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
      groupId = (groups as { id: string; name: string }[])[0].id
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
  const listPart = resolvedListName ? ` to *${resolvedListName}*` : ' (no list assigned)'
  return `Added "${args.name}"${listPart}.`
}

async function toolCreateShoppingList(userId: string, args: Record<string, unknown>): Promise<string> {
  const name = args.name as string
  const icon = (args.icon as string | undefined) ?? '🛒'

  const { data, error } = await sb.from('shopping_groups').insert({
    user_id: userId,
    name,
    icon,
    status:     'active',
    sort_order: 0,
  }).select('id').single()

  if (error) return `Error: ${error.message}`
  return `Created list *${name}* ${icon} [${(data as { id: string }).id.slice(0, 8)}]`
}

async function toolMarkShoppingItem(userId: string, args: Record<string, unknown>): Promise<string> {
  let itemId = args.item_id as string | undefined

  if (!itemId) {
    const { data } = await sb.from('shopping_items')
      .select('id, name')
      .eq('user_id', userId)
      .ilike('name', `%${args.item_name}%`)
      .in('status', ['wanted', 'planned'])
      .limit(3)

    if (!data?.length) return `No item found matching "${args.item_name}".`
    const candidates = data as { id: string; name: string }[]
    if (candidates.length > 1)
      return `Multiple matches: ${candidates.map(i => i.name).join(', ')}. Be more specific.`
    itemId = candidates[0].id
  }

  const status = (args.status as string | undefined) ?? 'purchased'
  const updates: Record<string, unknown> = { status }
  if (status === 'purchased') updates.purchased_at = new Date().toISOString()
  if (args.final_price !== undefined) updates.final_price = args.final_price

  const { error } = await sb.from('shopping_items')
    .update(updates).eq('id', itemId).eq('user_id', userId)

  if (error) return `Error: ${error.message}`
  return status === 'purchased' ? '✓ Marked as purchased.' : 'Marked as still needed.'
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
    if (listRes.status === 403) return "Can't read email — please reconnect Google with mail permissions in the Professor app."
    return `Gmail error (${listRes.status}).`
  }

  const listData = await listRes.json() as { messages?: { id: string }[] }
  const ids = listData.messages ?? []
  if (!ids.length) return 'No emails found.'

  const metas = await Promise.all(ids.slice(0, 10).map(async ({ id }) => {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
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
    const unread  = m.labelIds?.includes('UNREAD') ? '●' : '○'
    const snippet = m.snippet ? ` — ${m.snippet.slice(0, 80)}…` : ''
    return `${unread} [id:${id}] *${subject}*\n  From: ${from}${snippet}`
  }))

  return metas.filter(Boolean).join('\n\n')
}

async function toolArchiveEmail(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error

  const messageId = args.message_id as string
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ removeLabelIds: ['INBOX'] }),
    }
  )
  if (!r.ok) {
    if (r.status === 403) return "Can't archive — please reconnect Google with mail permissions in the Professor app."
    return `Archive failed (${r.status}).`
  }
  return 'Archived ✓'
}

async function toolMarkEmailRead(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error

  const messageId = args.message_id as string
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    }
  )
  if (!r.ok) {
    if (r.status === 403) return "Can't mark as read — please reconnect Google with mail permissions in the Professor app."
    return `Failed (${r.status}).`
  }
  return 'Marked as read ✓'
}

async function toolReplyEmail(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error

  const messageId = args.message_id as string
  const replyText = args.text as string

  const origRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}` +
    `?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`,
    { headers: { Authorization: `Bearer ${g.token}` } }
  )
  if (!origRes.ok) return `Could not fetch original email (${origRes.status}).`

  const orig = await origRes.json() as {
    threadId: string
    payload?: { headers?: { name: string; value: string }[] }
  }

  const getH = (n: string) =>
    (orig.payload?.headers ?? []).find(h => h.name.toLowerCase() === n.toLowerCase())?.value ?? ''

  const fromOrig  = getH('From')
  const subjOrig  = getH('Subject')
  const msgIdOrig = getH('Message-ID')
  const subject   = subjOrig.startsWith('Re:') ? subjOrig : `Re: ${subjOrig}`
  const toMatch   = fromOrig.match(/<([^>]+)>/)
  const toEmail   = toMatch ? toMatch[1] : fromOrig.trim()

  const rawMsg = [
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    msgIdOrig ? `In-Reply-To: ${msgIdOrig}` : '',
    msgIdOrig ? `References: ${msgIdOrig}` : '',
    'Content-Type: text/plain; charset=utf-8',
    '',
    replyText,
  ].filter(Boolean).join('\r\n')

  const bytes = new TextEncoder().encode(rawMsg)
  let binary  = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method:  'POST',
    headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ raw: encoded, threadId: orig.threadId }),
  })

  if (!sendRes.ok) {
    if (sendRes.status === 403) return 'Cannot send email. Please reconnect Google with mail permissions.'
    return `Failed to send reply (${sendRes.status}).`
  }

  return `Reply sent to ${toEmail}.`
}

// ── Claude agent ──────────────────────────────────────────────────────────────

const CLAUDE_TOOLS = [
  {
    name:        'get_today',
    description: "Get a summary of today: open tasks, habit progress, and this month's finances.",
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
    name:        'update_task',
    description: 'Edit a task — rename it, change its quadrant, due date, or status. Get task_id from get_tasks first.',
    input_schema: {
      type:     'object',
      required: ['task_id'],
      properties: {
        task_id:  { type: 'string' },
        title:    { type: 'string', description: 'New task name' },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'dump'] },
        due_date: { type: 'string', description: 'YYYY-MM-DD, or empty string to clear' },
        status:   { type: 'string', enum: ['todo', 'in_progress', 'done', 'deferred'] },
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
    name:        'get_habits',
    description: 'Read habit progress for today or a specific date. Use for: "how much water today?", "did I exercise?", "show my habits", "what habits are done?".',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD — defaults to today' },
      },
    },
  },
  {
    name:        'get_transactions',
    description: "Read finance transactions. Use for: 'show today expenses', 'what did I spend today?', 'show this week's spending', 'list my transactions'.",
    input_schema: {
      type: 'object',
      properties: {
        date:      { type: 'string', description: 'YYYY-MM-DD — a single day. Defaults to today.' },
        date_from: { type: 'string', description: 'YYYY-MM-DD — start of a range. Use with date_to.' },
        date_to:   { type: 'string', description: 'YYYY-MM-DD — end of a range. Use with date_from.' },
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
        amount:       { type: 'number', description: 'Positive number — direction is set by tx_type' },
        payee:        { type: 'string', description: 'Merchant, shop, or description of what it was' },
        tx_type:      { type: 'string', enum: ['expense', 'income'], description: 'Defaults to expense' },
        date:         { type: 'string', description: 'YYYY-MM-DD — defaults to today' },
        account_name: { type: 'string', description: 'Partial name of the account to charge — include card name (e.g. "platinum") to pick the right card.' },
      },
    },
  },
  {
    name:        'get_calendar_events',
    description: 'List upcoming events across ALL the user\'s Google calendars — personal and company (e.g. Teradix, DX). Each row names its calendar when more than one is involved.',
    input_schema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number', description: 'How many days ahead to look (default 3, max 14)' },
        calendar:   { type: 'string', description: 'Optional: only this calendar, matched loosely by name or account address (e.g. "Teradix", "DX").' },
      },
    },
  },
  {
    name:        'add_calendar_event',
    description: 'Create a new Google Calendar event.',
    input_schema: {
      type:     'object',
      required: ['title', 'start'],
      properties: {
        title:       { type: 'string' },
        start:       { type: 'string', description: 'ISO datetime like 2026-09-20T15:00:00 or date 2026-09-20 for all-day' },
        end:         { type: 'string', description: 'ISO datetime or date. Defaults to 1 hour after start.' },
        description: { type: 'string' },
        location:    { type: 'string' },
        calendar:    { type: 'string', description: 'Which calendar to put it on, by name (e.g. "Teradix", "DX"). Defaults to the main one.' },
      },
    },
  },
  {
    name:        'update_calendar_event',
    description: 'Edit an existing Google Calendar event — rename it, change its time, location, or description. Get event_id from get_calendar_events first.',
    input_schema: {
      type:     'object',
      required: ['event_id'],
      properties: {
        event_id:    { type: 'string', description: 'The full id from get_calendar_events [id:...], which looks like eventId::calendarId. Pass it exactly as given.' },
        title:       { type: 'string', description: 'New event title' },
        start:       { type: 'string', description: 'New start — ISO datetime or date' },
        end:         { type: 'string', description: 'New end — ISO datetime or date' },
        description: { type: 'string' },
        location:    { type: 'string' },
      },
    },
  },
  {
    name:        'get_shopping_lists',
    description: 'List all active shopping lists with item counts.',
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
  {
    name:        'reply_email',
    description: 'Reply to an email. First call get_emails to find the message_id, then call this.',
    input_schema: {
      type:     'object',
      required: ['message_id', 'text'],
      properties: {
        message_id: { type: 'string', description: 'Full message id from get_emails [id:...]' },
        text:       { type: 'string', description: 'The reply body text.' },
      },
    },
  },
]

type ContentBlock = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }

async function runAgent(userId: string, userMessage: string): Promise<string> {
  if (!ANTHROPIC_KEY) {
    return fallbackProcess(userId, userMessage)
  }

  const today = todayISO()
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10)
  const systemPrompt = `CRITICAL RULE — LANGUAGE: You MUST reply in the exact same language the user wrote in.
- User writes Arabic → your ENTIRE reply must be in Arabic (no English words mixed in)
- User writes English → reply in English
- This overrides everything. Check the language of the user's message first, before doing anything else.

You are Professor AI, a personal assistant. You live in Telegram and the user talks to you naturally — like texting a smart friend, not filling out a form.

Today is ${today}. Yesterday was ${yesterday}.

IMPORTANT — understand natural speech (Arabic and English):
- "yesterday", "last night", "this morning" / "امبارح", "الليلة الماضية", "الصبح" → use the right date (${yesterday} for yesterday)
- "water 600ml" / "مية 600 مل" → log_habit(habit_name="water", quantity=600)
- "water 600ml yesterday" / "مية 600 مل امبارح" → log_habit(habit_name="water", quantity=600, date="${yesterday}")
- Multiple habits in one message → call log_habit multiple times in parallel, one per habit
- "how much water today?" / "كام مل مية شربت؟" → get_habits
- "show my habits" / "وريني العادات" → get_habits
- "add call Ahmed" / "أضف مهمة اتصل بأحمد" → add_task
- "what do I have today" / "إيه اللي عندي النهارده" → get_today, then get_calendar_events(days_ahead=1)
- "spent 200 on lunch" / "صرفت 200 على الغداء" → add_transaction(amount=200, payee="lunch")
- "add 420 as digital app expense on platinum card" → add_transaction(amount=420, payee="digital app", account_name="platinum")
- "show today expenses" / "وريني مصاريف النهارده" → get_transactions
- "what did I spend today?" / "صرفت كام النهارده؟" → get_transactions
- "show this week's spending" / "مصاريف الأسبوع" → get_transactions(date_from="<monday>", date_to="<today>")
- "what's on my calendar" / "فيه إيه في التقويم" → get_calendar_events
- "what's on the Teradix calendar" / "إيه اللي في تقويم Teradix" → get_calendar_events(calendar="Teradix")
- "add it to the DX calendar" / "حطها في تقويم DX" → add_calendar_event(..., calendar="DX")
- "add a meeting tomorrow at 3pm" / "حجز اجتماع بكرا الساعة 3" → add_calendar_event(title="meeting", start="${tomorrow}T15:00:00")
- "rename the meeting to X" / "غير اسم الاجتماع" → get_calendar_events, then update_calendar_event(event_id=..., title="X")
- "move the meeting to 4pm" / "حول الاجتماع الساعة 4" → get_calendar_events, then update_calendar_event(event_id=..., start="...T16:00:00")
- "rename task X to Y" / "غير اسم المهمة" → get_tasks, then update_task(task_id=..., title="Y")
- "move task X to schedule" / "حول المهمة للجدول" → get_tasks, then update_task(task_id=..., quadrant="schedule")
- "what's on my shopping list" / "إيه في قايمة التسوق" → get_shopping_lists, then get_shopping_items
- ADDING ITEMS — always follow this flow:
  1. Call get_shopping_lists to see what lists exist
  2. Detect the item's category (grocery/food, pharmacy/medicine, electronics, hardware, clothing, etc.)
  3. Match to the most suitable list by name or category (e.g. milk → Groceries, paracetamol → Pharmacy)
  4. If a good match exists → call add_shopping_item with list_id
  5. If NO suitable list exists → ask the user: "I don't have a [category] list. Want me to create one?" — then call create_shopping_list only after they confirm
  6. For multiple items at once → call add_shopping_item in parallel for all of them (one call per item), matching each to the right list
- "add milk to groceries" / "أضف لبن للجروسيري" → get_shopping_lists, match, add_shopping_item
- "add paracetamol" → get_shopping_lists, detect pharmacy, match or ask
- "add eggs, bread, and butter" / "أضف بيض وعيش وزبدة" → get_shopping_lists once, then add_shopping_item in parallel for each item
- "bought the milk" / "اشتريت اللبن" → mark_shopping_item(item_name="milk")
- "check my email" / "شوف الإيميلات" → get_emails
- "show unread" / "الإيميلات الجديدة" → get_emails(query="is:unread in:inbox")
- "archive that email" / "أرشف الإيميل ده" → archive_email(message_id=...)
- "mark it as read" / "علّم مقروء" → mark_email_read(message_id=...)
- "reply to Ahmed saying I'll attend" / "رد على أحمد إني هحضر" → get_emails(query="from:Ahmed"), then reply_email(message_id=..., text="...")
- "reply to the last email" / "رد على آخر إيميل" → get_emails, then reply_email
- Never ask the user to rephrase or use a specific format. Just figure it out.
- When the user lists multiple things to log or add, call the relevant tool in parallel for each one — never ask them to say it again one at a time.

Calendars: the user has SEVERAL — a personal one and company ones (Teradix, DX). get_calendar_events reads them all at once and names each event's calendar. Pass calendar="<name>" to narrow to one, and when creating an event pass calendar="<name>" if the user says which. Never claim they have only one calendar.

What you CAN do: tasks (list, add, complete, edit), habits (read with get_habits, log with log_habit), log expenses/income (add_transaction), read transactions (get_transactions), calendar (read, create, edit events), today's overview, shopping lists (view, add items, mark bought), email (list, archive, mark read, reply).
What you CANNOT do: read account balances, budget envelopes, or goal progress — say so briefly if asked, don't apologise.

LIVE DATA — ALWAYS CALL TOOLS: For any question about current state (habits logged today, tasks open, today's schedule, shopping list contents, finance totals) — you MUST call the relevant tool to get FRESH data from the database. NEVER answer these from conversation history — the data changes every minute. History is ONLY for understanding references like "that habit", "the task I just added", "mark it done" — not for reporting current counts or values.

Reply style: short, warm, direct. No markdown headers.
- Always present any list of items — tasks, habits, emails, events, shopping items, results — as bullet points (use · or -).
- Even a single result looks better as a bullet when it has multiple fields (e.g. name + date + status).
- After using a tool, add one short sentence of context if helpful, then the bullet list.
- For confirmations ("Added ✓", "Logged ✓") a single line is fine — no bullet needed.`

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
        // A day across several calendars is a longer reply than it used to be.
        max_tokens: 2048,
        system:     systemPrompt,
        tools:      CLAUDE_TOOLS,
        messages,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Anthropic error:', err)
      // Say which kind of failure it was. "I didn't understand" about a 529 is
      // a lie that sends you on to rephrase a sentence that was already fine.
      if (res.status === 429) return 'I am being rate limited right now — try again in a few seconds.'
      if (res.status >= 500)  return 'The AI service is having a moment. Try again shortly.'
      // 401/403 is the one failure that trying again can never fix: the request
      // arrived and the key on it was refused. "I could not reach the AI
      // service" points at the network and sends you off to retry for ever —
      // and the key this reads is the **Supabase** secret, which is a different
      // secret in a different place from the one the web app uses, so rotating
      // the app's key leaves this one holding the revoked value. Name it.
      if (res.status === 401 || res.status === 403) {
        return 'My Anthropic key was refused (' + res.status + '). It has most likely been '
          + 'rotated or revoked — set ANTHROPIC_API_KEY in the Supabase function secrets to the '
          + 'current key and redeploy. Trying again will not help until then.'
      }
      return `Sorry, I could not reach the AI service (${res.status}). Try again in a moment.`
    }

    const data = await res.json() as { stop_reason: string; content: ContentBlock[] }

    if (data.stop_reason === 'end_turn') {
      return data.content.find(b => b.type === 'text')?.text ?? '...'
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
      continue
    }

    // **`max_tokens` is not a misunderstanding.** The reply was cut off
    // mid-sentence, or mid tool-call. Speak whatever text did arrive rather
    // than asking the person to rephrase a sentence that was understood
    // perfectly well — that was the commonest way this said "I don't
    // understand you" to a question it had got right.
    if (data.stop_reason === 'max_tokens') {
      const partial = data.content.find(b => b.type === 'text')?.text?.trim()
      if (partial) return partial + ' …'
      return 'That answer got too long for me. Could you ask for a narrower slice — a single day, or one list?'
    }

    break
  }

  return 'I got a bit confused — could you rephrase that?'
}

async function dispatchTool(userId: string, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_today':           return toolGetToday(userId)
    case 'get_tasks':             return toolGetTasks(userId, args)
    case 'add_task':              return toolAddTask(userId, args)
    case 'complete_task':         return toolCompleteTask(userId, args)
    case 'update_task':           return toolUpdateTask(userId, args)
    case 'get_habits':            return toolGetHabits(userId, args)
    case 'log_habit':           return toolLogHabit(userId, args)
    case 'get_transactions':    return toolGetTransactions(userId, args)
    case 'add_transaction':     return toolAddTransaction(userId, args)
    case 'get_calendar_events':    return toolGetCalendarEvents(userId, args)
    case 'add_calendar_event':     return toolAddCalendarEvent(userId, args)
    case 'update_calendar_event':  return toolUpdateCalendarEvent(userId, args)
    case 'get_shopping_lists':    return toolGetShoppingLists(userId)
    case 'get_shopping_items':    return toolGetShoppingItems(userId, args)
    case 'add_shopping_item':     return toolAddShoppingItem(userId, args)
    case 'mark_shopping_item':    return toolMarkShoppingItem(userId, args)
    case 'create_shopping_list':  return toolCreateShoppingList(userId, args)
    case 'get_emails':          return toolGetEmails(userId, args)
    case 'archive_email':       return toolArchiveEmail(userId, args)
    case 'mark_email_read':     return toolMarkEmailRead(userId, args)
    case 'reply_email':         return toolReplyEmail(userId, args)
    default:                    return `Unknown tool: ${name}`
  }
}

// Fallback when no Anthropic key — pattern-match common requests
async function fallbackProcess(userId: string, text: string): Promise<string> {
  const lower = text.toLowerCase()
  if (/\b(today|tasks|schedule)\b/.test(lower)) return toolGetToday(userId)
  if (/\b(calendar|events|meetings)\b/.test(lower)) return toolGetCalendarEvents(userId, {})
  if (/\badd task[:\s](.+)/i.test(text)) {
    const title = text.match(/add task[:\s](.+)/i)?.[1]?.trim()
    if (title) return toolAddTask(userId, { title })
  }
  return "I can answer:\n· What's on today?\n· What's on my calendar?\n· Add task: [name]\n\nOr set up an Anthropic API key in Supabase secrets for full AI responses."
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function handleConnect(chatId: number, text: string) {
  const token = text.split(/\s+/)[1]?.trim()
  if (!token?.startsWith('prof_sk_')) {
    await reply(chatId, "Send your token like this:\n`/connect prof_sk_...`\n\nGet a token from *Settings → Integrations → Connections* in the Professor app.")
    return
  }

  const userId = await resolveToken(token)
  if (!userId) {
    await reply(chatId, "That token wasn't found or has been revoked. Generate a new one in *Settings → Integrations → Connections*.")
    return
  }

  await sb.from('telegram_links').upsert(
    { chat_id: String(chatId), user_id: userId, token, linked_at: new Date().toISOString() },
    { onConflict: 'chat_id' }
  )

  await reply(chatId, "✅ *Connected!* Your Telegram is now linked to Professor.\n\nTry: _What's on today?_ or _What's on my calendar?_")
}

async function handleDisconnect(chatId: number) {
  await sb.from('telegram_links').delete().eq('chat_id', String(chatId))
  await reply(chatId, "Disconnected. Your chat is no longer linked to any Professor account.\n\nTo reconnect, use `/connect prof_sk_...`")
}

async function handleStart(chatId: number) {
  await reply(chatId,
    "*Professor AI* 👋\n\n" +
    "I'm your personal productivity assistant.\n\n" +
    "To get started:\n" +
    "1. Open the Professor app\n" +
    "2. Go to *Settings → Integrations → Connections*\n" +
    "3. Copy your token\n" +
    "4. Send me: `/connect prof_sk_...`\n\n" +
    "Once connected, just talk to me — ask about your tasks, habits, or finances."
  )
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'GET') return new Response('Professor Telegram Bot is running.')
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let update: {
    message?: {
      chat: { id: number }
      from?: { first_name?: string }
      text?: string
    }
  }
  try {
    update = await req.json()
  } catch {
    return new Response('ok')
  }

  const message = update.message
  if (!message?.text) return new Response('ok')

  const chatId  = message.chat.id
  const rawText = message.text.trim()

  // Strip @BotName from commands
  const text = rawText.replace(/^(\/\w+)@\w+/, '$1')

  // Commands that don't need auth
  if (text === '/start' || text.startsWith('/start ')) {
    await handleStart(chatId)
    return new Response('ok')
  }
  if (text.startsWith('/connect')) {
    await handleConnect(chatId, text)
    return new Response('ok')
  }
  if (text === '/disconnect') {
    await handleDisconnect(chatId)
    return new Response('ok')
  }

  // All other messages need an authenticated user
  const auth = await resolveChat(chatId)
  if (!auth) {
    await reply(chatId,
      "You're not connected yet. Send `/start` to see setup instructions."
    )
    return new Response('ok')
  }

  // Show typing indicator while we work
  await sendChatAction(chatId)

  // Run the agent (or fallback) and reply
  const response = await runAgent(auth.userId, text)
  await reply(chatId, response)

  return new Response('ok')
})
