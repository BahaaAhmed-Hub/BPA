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

type ChatContext = { role: string; content: string }[]

async function resolveChat(chatId: number): Promise<{ userId: string; token: string; context: ChatContext } | null> {
  const { data } = await sb
    .from('telegram_links')
    .select('user_id, token, context')
    .eq('chat_id', String(chatId))
    .maybeSingle()

  if (!data) return null
  const row = data as { user_id: string; token: string; context: ChatContext | null }
  return { userId: row.user_id, token: row.token, context: row.context ?? [] }
}

async function saveContext(chatId: number, context: ChatContext) {
  await sb.from('telegram_links')
    .update({ context })
    .eq('chat_id', String(chatId))
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

async function toolListHabits(userId: string): Promise<string> {
  // First do a count-only query to see if anything exists at all
  const { count, error: ce } = await sb.from('habits')
    .select('*', { count: 'exact', head: true }).eq('user_id', userId)
  if (ce) return `DB error (count): ${ce.message}`
  if (count === 0) {
    return `You have no habits set up yet. Open the Professor app to create some, then I'll be able to track them here.`
  }

  const { data, error } = await sb.from('habits')
    .select('id, name, goal, unit, is_active').eq('user_id', userId)
  if (error) return `Error fetching habits: ${error.message}`
  if (!data?.length) return `No habits found.`
  const rows = data as { id: string; name: string; goal: number | null; unit: string | null; is_active: boolean }[]
  const active   = rows.filter(h => h.is_active)
  const inactive = rows.filter(h => !h.is_active)
  const fmt = (h: typeof rows[0]) =>
    `· ${h.name}${h.goal ? ` (goal: ${h.goal}${h.unit ? ' ' + h.unit : ''})` : ''}`
  const lines: string[] = []
  if (active.length)   lines.push('Active:\n' + active.map(fmt).join('\n'))
  if (inactive.length) lines.push('Inactive:\n' + inactive.map(fmt).join('\n'))
  return lines.join('\n\n')
}

async function toolLogHabit(userId: string, args: Record<string, unknown>): Promise<string> {
  // Fetch all habits (skip is_active filter — let the model decide)
  const { data: allHabits, error: habitsErr } = await sb.from('habits')
    .select('id, name, goal, unit, is_active').eq('user_id', userId)

  if (habitsErr) return `Error fetching habits: ${habitsErr.message}`
  const allH = (allHabits ?? []) as { id: string; name: string; goal: number | null; unit: string | null; is_active: boolean }[]
  const searchName = String(args.habit_name ?? '').toLowerCase().trim()

  // 1. Exact match (case-insensitive)
  let candidates = allH.filter(h => h.name.toLowerCase() === searchName)
  // 2. Substring match
  if (!candidates.length) candidates = allH.filter(h => h.name.toLowerCase().includes(searchName) || searchName.includes(h.name.toLowerCase()))

  if (!candidates.length) {
    const names = allH.map(h => `· ${h.name}`).join('\n')
    return `No habit found matching "${args.habit_name}". Active habits:\n${names}\nCall log_habit again with the exact name from the list above.`
  }
  if (candidates.length > 1) {
    return `Multiple matches: ${candidates.map(h => h.name).join(', ')}. Be more specific.`
  }

  const habit = candidates[0]
  const date  = (args.date as string | undefined) ?? todayISO()
  const qty   = (args.quantity as number | undefined) ?? 1
  const done  = habit.goal ? qty >= habit.goal : true

  // Check for an existing log on this date
  const { data: existing } = await sb.from('habit_logs')
    .select('id')
    .eq('habit_id', habit.id)
    .eq('date', date)
    .maybeSingle()

  const existingId = (existing as { id: string } | null)?.id

  let writeError: { message: string } | null = null
  if (existingId) {
    const { error } = await sb.from('habit_logs')
      .update({ quantity: qty, completed: done })
      .eq('id', existingId)
    writeError = error
  } else {
    const { error } = await sb.from('habit_logs')
      .insert({ user_id: userId, habit_id: habit.id, date, quantity: qty, completed: done })
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
  const savedQty = s?.quantity ?? qty
  const goalNote = habit.goal
    ? (s?.completed ? ' ✓ goal reached!' : ` (${savedQty}/${habit.goal}${habit.unit ? ' ' + habit.unit : ''})`)
    : ' ✓'

  return `Logged ${habit.name}${habit.unit ? ': ' + savedQty + ' ' + habit.unit : ''}${goalNote} on ${date}`
}

async function toolGetFinanceCategories(userId: string, args: Record<string, unknown>): Promise<string> {
  let q = sb.from('finance_categories')
    .select('id, name, icon, tx_type, parent_id')
    .eq('user_id', userId)
    .order('sort_order')
  if (args.tx_type) q = q.eq('tx_type', args.tx_type as string)
  const { data, error } = await q
  if (error) return `Error: ${error.message}`
  if (!data?.length) return 'No categories found.'
  return (data as { id: string; name: string; icon: string; tx_type: string; parent_id: string | null }[])
    .map(c => `[${c.id.slice(0, 8)}] ${c.icon} ${c.name} (${c.tx_type})${c.parent_id ? ' — sub-category' : ''}`)
    .join('\n')
}

async function toolAddTransaction(userId: string, args: Record<string, unknown>): Promise<string> {
  const { data: accounts } = await sb
    .from('finance_accounts')
    .select('id, name, currency')
    .eq('user_id', userId)
    .in('account_type', ['payment', 'wallet'])
    .limit(5)

  const accs = (accounts ?? []) as { id: string; name: string; currency: string }[]
  if (!accs.length) return 'No payment accounts found. Add one in the Professor app first.'

  let account = accs[0]
  if (args.account_name) {
    const found = accs.find(a => a.name.toLowerCase().includes((args.account_name as string).toLowerCase()))
    if (found) account = found
  }

  // Resolve category_name → category_id if only name was given
  let categoryId = (args.category_id as string | undefined) ?? null
  if (!categoryId && args.category_name) {
    const { data: cats } = await sb.from('finance_categories')
      .select('id').eq('user_id', userId)
      .ilike('name', `%${args.category_name}%`).limit(1)
    if (cats?.length) categoryId = (cats as { id: string }[])[0].id
  }

  const date   = (args.date as string | undefined) ?? todayISO()
  const amount = Math.abs(args.amount as number)
  const payee  = (args.payee ?? args.description ?? '') as string

  const { error } = await sb.from('finance_transactions').insert({
    user_id:     userId,
    account_id:  account.id,
    category_id: categoryId,
    amount,
    currency:    account.currency,
    tx_type:     args.tx_type ?? 'expense',
    payee,
    date,
    paid_at:     date,
    is_cleared:  true,
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
    items?: { id?: string; summary?: string; start?: { dateTime?: string; date?: string } }[]
  }
  const events = calData.items ?? []
  if (!events.length) return `No events in the next ${daysAhead} days.`

  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  function fmtDT(start: { dateTime?: string; date?: string }): string {
    if (start.dateTime) {
      // Parse local time directly from the ISO string — avoids server TZ conversion.
      // "2026-09-19T15:30:00+03:00" → Wed 19 Sep, 15:30
      const m = start.dateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
      if (!m) return start.dateTime
      const [, yr, mo, dy, hh, mm] = m
      const dow = DAYS[new Date(Date.UTC(+yr, +mo - 1, +dy)).getUTCDay()]
      return `${dow} ${+dy} ${MONTHS[+mo - 1]}, ${hh}:${mm}`
    }
    if (start.date) {
      // All-day: "2026-09-19"
      const [yr, mo, dy] = start.date.split('-')
      const dow = DAYS[new Date(Date.UTC(+yr, +mo - 1, +dy)).getUTCDay()]
      return `${dow} ${+dy} ${MONTHS[+mo - 1]} · all day`
    }
    return ''
  }

  return events.map(e =>
    `[${(e.id ?? '').slice(0, 12)}] ${e.summary ?? 'Untitled'} — ${fmtDT(e.start ?? {})}`
  ).join('\n')
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

  // Resolve store_name → store_used_id
  if (args.store_name) {
    const { data: storeRows } = await sb.from('shopping_stores')
      .select('id, name').eq('user_id', userId)
      .ilike('name', `%${args.store_name}%`).limit(1)
    const matched = (storeRows as { id: string; name: string }[] | null)?.[0]
    if (matched) updates.store_used_id = matched.id
  }

  const { error } = await sb.from('shopping_items')
    .update(updates).eq('id', itemId).eq('user_id', userId)

  if (error) return `Error: ${error.message}`

  const pricePart = args.final_price !== undefined ? ` for ${(args.final_price as number).toLocaleString()}` : ''
  const storePart = updates.store_used_id
    ? ` at ${args.store_name}`
    : (args.store_name ? ` (store "${args.store_name}" not found in your list — add it in Settings → Shopping → Stores)` : '')
  return status === 'purchased'
    ? `✓ Marked as purchased${pricePart}${storePart}.`
    : 'Marked as still needed.'
}

// ── Habit full CRUD ───────────────────────────────────────────────────────────

async function toolCreateHabit(userId: string, args: Record<string, unknown>): Promise<string> {
  const { error } = await sb.from('habits').insert({
    user_id:   userId,
    name:      args.name,
    goal:      args.goal      ?? null,
    unit:      args.unit      ?? null,
    is_active: true,
  })
  if (error) return `Error: ${error.message}`
  return `Created habit "${args.name}"${args.goal ? ` (goal: ${args.goal}${args.unit ? ' ' + args.unit : ''})` : ''}.`
}

async function toolUpdateHabit(userId: string, args: Record<string, unknown>): Promise<string> {
  const { data: matches, error: fe } = await sb.from('habits')
    .select('id, name').eq('user_id', userId).ilike('name', `%${args.habit_name}%`)
  if (fe) return `Error: ${fe.message}`
  if (!matches?.length) return `No active habit matching "${args.habit_name}".`
  const habit = (matches as { id: string; name: string }[])[0]
  const updates: Record<string, unknown> = {}
  if (args.new_name !== undefined) updates.name = args.new_name
  if (args.new_goal !== undefined) updates.goal = args.new_goal
  if (args.new_unit !== undefined) updates.unit = args.new_unit
  if (!Object.keys(updates).length) return 'No changes specified.'
  const { error } = await sb.from('habits').update(updates).eq('id', habit.id).eq('user_id', userId)
  if (error) return `Error: ${error.message}`
  return `Updated "${habit.name}" ✓`
}

async function toolDeactivateHabit(userId: string, args: Record<string, unknown>): Promise<string> {
  const { data: matches, error: fe } = await sb.from('habits')
    .select('id, name').eq('user_id', userId).ilike('name', `%${args.habit_name}%`)
  if (fe) return `Error: ${fe.message}`
  if (!matches?.length) return `No active habit matching "${args.habit_name}".`
  const habit = (matches as { id: string; name: string }[])[0]
  const { error } = await sb.from('habits').update({ is_active: false }).eq('id', habit.id).eq('user_id', userId)
  if (error) return `Error: ${error.message}`
  return `"${habit.name}" deactivated. Logs are kept — you can reactivate from the app.`
}

async function toolGetHabitLogs(userId: string, args: Record<string, unknown>): Promise<string> {
  const { data: matches, error: fe } = await sb.from('habits')
    .select('id, name, goal, unit').eq('user_id', userId).ilike('name', `%${args.habit_name}%`)
  if (fe) return `Error: ${fe.message}`
  if (!matches?.length) return `No habit matching "${args.habit_name}".`
  const habit = (matches as { id: string; name: string; goal: number | null; unit: string | null }[])[0]
  const days = Math.min((args.days as number | undefined) ?? 7, 30)
  const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10)
  const { data: logs, error: le } = await sb.from('habit_logs')
    .select('date, quantity, completed').eq('habit_id', habit.id)
    .gte('date', since).order('date', { ascending: false })
  if (le) return `Error: ${le.message}`
  if (!logs?.length) return `No logs for "${habit.name}" in the last ${days} days.`
  const rows = (logs as { date: string; quantity: number | null; completed: boolean }[])
    .map(l => {
      const qty = l.quantity != null ? ` ${l.quantity}${habit.unit ? ' ' + habit.unit : ''}` : ''
      return `${l.completed ? '✓' : '○'} ${l.date}${qty}`
    })
  const done = rows.filter(r => r.startsWith('✓')).length
  return `*${habit.name}* — last ${days} days (${done}/${rows.length} done):\n${rows.join('\n')}`
}

// ── Task full CRUD ─────────────────────────────────────────────────────────────

async function toolUpdateTask(userId: string, args: Record<string, unknown>): Promise<string> {
  const updates: Record<string, unknown> = {}
  if (args.title    !== undefined) updates.title    = args.title
  if (args.quadrant !== undefined) updates.quadrant = args.quadrant
  if (args.due_date !== undefined) updates.due_date = args.due_date === '' ? null : args.due_date
  if (args.notes    !== undefined) updates.notes    = args.notes
  if (!Object.keys(updates).length) return 'No changes specified.'
  const { error } = await sb.from('tasks').update(updates).eq('id', args.task_id).eq('user_id', userId)
  if (error) return `Error: ${error.message}`
  return 'Task updated ✓'
}

async function toolDeleteTask(userId: string, args: Record<string, unknown>): Promise<string> {
  const { error } = await sb.from('tasks').delete().eq('id', args.task_id).eq('user_id', userId)
  if (error) return `Error: ${error.message}`
  return 'Task deleted ✓'
}

// ── Calendar full CRUD ─────────────────────────────────────────────────────────

async function toolCreateCalendarEvent(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error
  const tz = (args.timezone as string | undefined) ?? 'Africa/Cairo'
  const event: Record<string, unknown> = { summary: args.summary }
  if (args.description) event.description = args.description
  if (args.location)    event.location    = args.location
  if (args.start_date) {
    event.start = { date: args.start_date }
    event.end   = { date: (args.end_date ?? args.start_date) as string }
  } else {
    event.start = { dateTime: args.start_datetime, timeZone: tz }
    event.end   = { dateTime: args.end_datetime,   timeZone: tz }
  }
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  if (!res.ok) return `Calendar error (${res.status}).`
  const ev = await res.json() as { id: string; summary?: string }
  return `Created "${ev.summary}" on your calendar [${(ev.id ?? '').slice(0, 12)}] ✓`
}

async function toolUpdateCalendarEvent(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error
  const tz = (args.timezone as string | undefined) ?? 'Africa/Cairo'
  const patch: Record<string, unknown> = {}
  if (args.summary     !== undefined) patch.summary     = args.summary
  if (args.description !== undefined) patch.description = args.description
  if (args.location    !== undefined) patch.location    = args.location
  if (args.start_datetime) {
    patch.start = { dateTime: args.start_datetime, timeZone: tz }
    if (args.end_datetime) patch.end = { dateTime: args.end_datetime, timeZone: tz }
  }
  if (!Object.keys(patch).length) return 'No changes specified.'
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(args.event_id as string)}`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }
  )
  if (!res.ok) return `Update failed (${res.status}).`
  return 'Event updated ✓'
}

async function toolDeleteCalendarEvent(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(args.event_id as string)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${g.token}` } }
  )
  if (!res.ok && res.status !== 204) return `Delete failed (${res.status}).`
  return 'Event deleted ✓'
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
    return `${unread} [${id.slice(0, 8)}] *${subject}*\n  From: ${from}${snippet}`
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

async function toolReadEmail(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.message_id}?format=full`,
    { headers: { Authorization: `Bearer ${g.token}` } }
  )
  if (!r.ok) return `Failed to read email (${r.status}).`
  const m = await r.json() as {
    id: string; threadId: string; snippet?: string
    payload?: {
      headers?: { name: string; value: string }[]
      body?: { data?: string }
      parts?: { mimeType: string; body?: { data?: string }; parts?: unknown[] }[]
    }
  }
  const hdrs    = m.payload?.headers ?? []
  const subject = hdrs.find(h => h.name === 'Subject')?.value    ?? '(no subject)'
  const from    = hdrs.find(h => h.name === 'From')?.value       ?? ''
  const date    = hdrs.find(h => h.name === 'Date')?.value       ?? ''
  const msgId   = hdrs.find(h => h.name === 'Message-ID')?.value ?? ''

  type Part = { mimeType: string; body?: { data?: string }; parts?: Part[] }
  function extractText(p: Part): string {
    if (p.mimeType === 'text/plain' && p.body?.data)
      return atob(p.body.data.replace(/-/g, '+').replace(/_/g, '/'))
    if (p.parts) for (const c of p.parts) { const t = extractText(c); if (t) return t }
    return ''
  }
  const body = m.payload ? extractText(m.payload as Part) || (m.snippet ?? '') : (m.snippet ?? '')
  return [`From: ${from}`, `Subject: ${subject}`, `Date: ${date}`, `Message-ID: ${msgId}`, `Thread-ID: ${m.threadId}`, '', body.slice(0, 3000)].join('\n')
}

function _toBase64url(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function toolSendEmail(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error
  const lines = [
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ]
  if (args.in_reply_to) {
    lines.push(`In-Reply-To: ${args.in_reply_to}`)
    lines.push(`References: ${args.in_reply_to}`)
  }
  lines.push('', String(args.body ?? ''))
  const raw = _toBase64url(lines.join('\r\n'))
  const payload: Record<string, unknown> = { raw }
  if (args.thread_id) payload.threadId = args.thread_id
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    if (res.status === 403) return "Can't send — please reconnect Google with mail permissions in the Professor app."
    return `Send failed (${res.status}).`
  }
  return `Email sent to ${args.to} ✓`
}

async function toolTrashEmail(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.message_id}/trash`,
    { method: 'POST', headers: { Authorization: `Bearer ${g.token}` } }
  )
  if (!res.ok) return `Trash failed (${res.status}).`
  return 'Moved to trash ✓'
}

async function toolStarEmail(userId: string, args: Record<string, unknown>): Promise<string> {
  const g = await getGoogleToken(userId)
  if (!g.ok) return g.error
  const star = args.starred !== false
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.message_id}/modify`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(star ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] }),
    }
  )
  if (!res.ok) return `Failed (${res.status}).`
  return star ? 'Starred ✓' : 'Unstarred ✓'
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
    name:        'list_habits',
    description: 'List all active habits with their names, goals and units. Call this first when the user mentions a habit and you are not sure of the exact name stored.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name:        'log_habit',
    description: 'Log a habit completion. If unsure of the exact habit name (e.g. user spoke in Arabic about a habit stored in English), call list_habits first to get the exact name.',
    input_schema: {
      type:     'object',
      required: ['habit_name'],
      properties: {
        habit_name: { type: 'string', description: 'The habit name — use the exact name from list_habits if called first' },
        quantity:   { type: 'number' },
        date:       { type: 'string', description: 'YYYY-MM-DD — defaults to today' },
      },
    },
  },
  {
    name:        'get_finance_categories',
    description: 'List the user\'s expense/income categories so you can suggest the right one. Call this before add_transaction when category is unknown.',
    input_schema: {
      type: 'object',
      properties: {
        tx_type: { type: 'string', enum: ['expense', 'income'], description: 'Filter by type (omit for all)' },
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
        amount:        { type: 'number', description: 'Positive number — direction is set by tx_type' },
        payee:         { type: 'string', description: 'Merchant, shop, or description of what it was' },
        tx_type:       { type: 'string', enum: ['expense', 'income'], description: 'Defaults to expense' },
        date:          { type: 'string', description: 'YYYY-MM-DD — defaults to today' },
        account_name:  { type: 'string', description: 'Partial name of the account to charge. Omit to use default.' },
        category_id:   { type: 'string', description: '8-char prefix from get_finance_categories' },
        category_name: { type: 'string', description: 'Category name fallback if no category_id' },
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
    description: 'Mark a shopping item as purchased or back to wanted. Always record final_price and store_name when marking purchased.',
    input_schema: {
      type: 'object',
      properties: {
        item_id:     { type: 'string', description: '8-char prefix from get_shopping_items' },
        item_name:   { type: 'string', description: 'Partial item name if no item_id' },
        status:      { type: 'string', enum: ['purchased', 'wanted'], description: 'Defaults to purchased' },
        final_price: { type: 'number', description: 'What it actually cost' },
        store_name:  { type: 'string', description: 'Store or shop where it was bought (partial name OK)' },
      },
    },
  },
  // ── Habit full CRUD ──
  {
    name:        'create_habit',
    description: 'Create a new habit to track.',
    input_schema: {
      type: 'object', required: ['name'],
      properties: {
        name: { type: 'string' },
        goal: { type: 'number', description: 'Target amount per day (optional)' },
        unit: { type: 'string', description: 'Unit, e.g. glasses, km, minutes (optional)' },
      },
    },
  },
  {
    name:        'update_habit',
    description: 'Rename a habit or change its goal/unit.',
    input_schema: {
      type: 'object', required: ['habit_name'],
      properties: {
        habit_name: { type: 'string', description: 'Current habit name (partial OK)' },
        new_name:   { type: 'string' },
        new_goal:   { type: 'number' },
        new_unit:   { type: 'string' },
      },
    },
  },
  {
    name:        'deactivate_habit',
    description: 'Deactivate (stop tracking) a habit. Logs are kept.',
    input_schema: {
      type: 'object', required: ['habit_name'],
      properties: { habit_name: { type: 'string' } },
    },
  },
  {
    name:        'get_habit_logs',
    description: 'View recent log history for a habit.',
    input_schema: {
      type: 'object', required: ['habit_name'],
      properties: {
        habit_name: { type: 'string' },
        days: { type: 'number', description: 'How many days back (default 7, max 30)' },
      },
    },
  },
  // ── Task update / delete ──
  {
    name:        'update_task',
    description: 'Update a task\'s title, quadrant, due date, or notes. Get task_id from get_tasks.',
    input_schema: {
      type: 'object', required: ['task_id'],
      properties: {
        task_id:  { type: 'string' },
        title:    { type: 'string' },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'dump'] },
        due_date: { type: 'string', description: 'YYYY-MM-DD, or empty string to clear' },
        notes:    { type: 'string' },
      },
    },
  },
  {
    name:        'delete_task',
    description: 'Permanently delete a task. Get task_id from get_tasks.',
    input_schema: {
      type: 'object', required: ['task_id'],
      properties: { task_id: { type: 'string' } },
    },
  },
  // ── Calendar full CRUD ──
  {
    name:        'create_calendar_event',
    description: 'Create a new event on Google Calendar.',
    input_schema: {
      type: 'object', required: ['summary'],
      properties: {
        summary:        { type: 'string', description: 'Event title' },
        start_datetime: { type: 'string', description: 'ISO 8601 with offset, e.g. 2026-09-20T14:00:00+03:00' },
        end_datetime:   { type: 'string', description: 'ISO 8601 with offset' },
        start_date:     { type: 'string', description: 'YYYY-MM-DD for all-day events (use instead of start_datetime)' },
        end_date:       { type: 'string', description: 'YYYY-MM-DD for all-day events' },
        description:    { type: 'string' },
        location:       { type: 'string' },
        timezone:       { type: 'string', description: 'IANA timezone, defaults to Africa/Cairo' },
      },
    },
  },
  {
    name:        'update_calendar_event',
    description: 'Update an existing calendar event. Get event_id from get_calendar_events.',
    input_schema: {
      type: 'object', required: ['event_id'],
      properties: {
        event_id:       { type: 'string', description: 'Event ID from get_calendar_events (12-char prefix)' },
        summary:        { type: 'string' },
        start_datetime: { type: 'string', description: 'ISO 8601 with offset' },
        end_datetime:   { type: 'string', description: 'ISO 8601 with offset' },
        description:    { type: 'string' },
        location:       { type: 'string' },
        timezone:       { type: 'string' },
      },
    },
  },
  {
    name:        'delete_calendar_event',
    description: 'Delete a calendar event. Get event_id from get_calendar_events.',
    input_schema: {
      type: 'object', required: ['event_id'],
      properties: { event_id: { type: 'string' } },
    },
  },
  // ── Mail extended ──
  {
    name:        'read_email',
    description: 'Read the full body of an email. Call this before replying to see the content and get the Message-ID and Thread-ID needed for send_email.',
    input_schema: {
      type: 'object', required: ['message_id'],
      properties: { message_id: { type: 'string' } },
    },
  },
  {
    name:        'send_email',
    description: 'Send a new email or reply to one. For replies, pass thread_id and in_reply_to (Message-ID) from read_email.',
    input_schema: {
      type: 'object', required: ['to', 'subject', 'body'],
      properties: {
        to:           { type: 'string', description: 'Recipient email address' },
        subject:      { type: 'string' },
        body:         { type: 'string', description: 'Plain text body' },
        thread_id:    { type: 'string', description: 'Thread-ID from read_email — for replies' },
        in_reply_to:  { type: 'string', description: 'Message-ID from read_email — for replies' },
      },
    },
  },
  {
    name:        'trash_email',
    description: 'Move an email to the trash.',
    input_schema: {
      type: 'object', required: ['message_id'],
      properties: { message_id: { type: 'string' } },
    },
  },
  {
    name:        'star_email',
    description: 'Star or unstar an email.',
    input_schema: {
      type: 'object', required: ['message_id'],
      properties: {
        message_id: { type: 'string' },
        starred:    { type: 'boolean', description: 'true to star (default), false to unstar' },
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

type ContentBlock = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }

async function runAgent(
  userId: string,
  userMessage: string,
  history: ChatContext,
): Promise<{ text: string; updatedHistory: ChatContext }> {
  if (!ANTHROPIC_KEY) {
    const text = await fallbackProcess(userId, userMessage)
    return { text, updatedHistory: history }
  }

  const today = todayISO()
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  const systemPrompt = `CRITICAL RULE — LANGUAGE: You MUST reply in the exact same language the user wrote in.
- User writes Arabic → your ENTIRE reply must be in Arabic (no English words mixed in).
  Use Egyptian dialect (اللهجة المصرية): "النهارده / امبارح / إيه / ده / دي / عايز / طب / بقى / يلا / مش عارف / تمام / حلو / أيوه / لأ / زي ما قلت". Natural Egyptian — not Gulf, not formal MSA.
- User writes English → reply in English
- This overrides everything. Check the language of the user's message first, before doing anything else.

You are Professor AI, a personal assistant. You live in Telegram and the user talks to you naturally — like texting a smart friend, not filling out a form.

Today is ${today}. Yesterday was ${yesterday}.

CONTEXT MEMORY: You have the last several messages of this conversation in your history. Use them.
- When the user says "yes", "add it", "the first one", "Groceries", "ok" — check the recent history to understand what they're referring to.
- Never ask for information the user already gave you earlier in the conversation.
- A follow-up reply (e.g. "add it" after you asked about a shopping list, or "Food" after you asked about a category) is a direct answer to your last question — act on it immediately.
- When the user asks "what did we do?" / "what were my last actions?" / "what did you just do?" / "كنا بنعمل إيه" / "إيه اللي حصل" → look at the actual conversation history above, summarize the actions that were completed (tasks added, habits logged, transactions recorded, etc.). NEVER say you don't have access to previous messages — the history IS there in the conversation above.

HABITS — IMPORTANT: Habit names in the database may be in English while the user speaks Arabic (or vice versa). When the user mentions a habit by description ("المية", "الماء", "الرياضة", "نوم") → call list_habits first to see the actual stored names, then use the exact stored name in log_habit. Never guess a name that might not match.

BUYING SOMETHING FLOW — when the user says they bought/purchased/paid for something with a price:
1. In parallel: call get_shopping_items (search for the item) AND get_finance_categories(tx_type="expense")
2. Log the expense immediately with add_transaction. Don't wait for category confirmation.
3. Shopping list check:
   - Item FOUND in list → call mark_shopping_item with final_price AND store_name (use the store they mentioned, or ask "Which store?" if not given)
   - Item NOT found → ask: "That wasn't on your shopping list. Want me to add it? And which store?"
     - If user says yes/ok → call get_shopping_lists, detect the right list, add_shopping_item
4. Category:
   - If user already named a category in their message → use it directly in add_transaction(category_name=...)
   - If not → after logging the expense, show 3–5 relevant categories from get_finance_categories and ask: "Which category should I file this under?" with bullet options
   - On their next reply naming a category → call add_transaction again with just category_name to update it... actually use a note in the reply that the category can be set in the app, and suggest the top match.

IMPORTANT — understand natural speech (Arabic and English):
- "yesterday", "last night", "this morning" / "امبارح", "امبارح بالليل", "الصبح" → use the right date (${yesterday} for yesterday)
- "water 600ml" / "مية 600 مل" / "شربت 600 مية" / "شربت 600 ميه" → FIRST call list_habits to find the water habit's exact name, THEN log_habit(habit_name=<exact name>, quantity=600)
- "water 600ml yesterday" / "مية 600 مل امبارح" / "شربت 600 ميه امبارح" → list_habits then log_habit(..., date="${yesterday}")
- Multiple habits in one message → call log_habit multiple times in parallel, one per habit
- "add call Ahmed" / "ضيف مهمة كلم أحمد" / "أضف مهمة اتصل بأحمد" → add_task
- "what do I have today" / "إيه اللي عندي النهارده" / "فيه إيه النهارده" → get_today, then get_calendar_events(days_ahead=1)
- "spent 200 on lunch" / "صرفت 200 على الغداء" / "دفعت 200 على الأكل" → add_transaction(amount=200, payee="lunch")
- "what's on my calendar" / "فيه إيه في التقويم" / "ماله التقويم النهارده" → get_calendar_events
- "what's on my shopping list" / "إيه في قايمة التسوق" / "عايز أشوف قايمة الشراء" → get_shopping_lists, then get_shopping_items
- MARKING AS PURCHASED — always include final_price and store_name in mark_shopping_item. If the user said "bought milk for 25 at Carrefour" → final_price=25, store_name="Carrefour". If price or store is missing and the item was on the list, ask for the missing one before calling.
- ADDING ITEMS — always follow this flow:
  1. Call get_shopping_lists to see what lists exist
  2. Detect the item's category (grocery/food, pharmacy/medicine, electronics, hardware, clothing, etc.)
  3. Match to the most suitable list by name or category
  4. If a good match exists → call add_shopping_item with list_id
  5. If NO suitable list exists → ask the user: "I don't have a [category] list. Want me to create one?" — then call create_shopping_list only after they confirm
  6. For multiple items at once → call add_shopping_item in parallel for all of them
- "check my email" / "شوف الإيميلات" → get_emails
- "show unread" / "الإيميلات الجديدة" → get_emails(query="is:unread in:inbox")
- "archive that email" / "أرشف الإيميل ده" → archive_email(message_id=...)
- "mark it as read" / "علّم مقروء" → mark_email_read(message_id=...)
- Never ask the user to rephrase. When the user lists multiple things, call tools in parallel.

What you CAN do:
- Habits: list, log, create, rename, change goal/unit, deactivate, view history
- Tasks: list, add, complete, update (title/quadrant/due date/notes), delete
- Calendar: list events (with IDs), create event, update event, delete event
- Finance: log expenses with category (cannot read balances or history)
- Shopping: full shopping list management
- Email: list, read full body, send new email, reply, archive, trash, star/unstar, mark read

CALENDAR WORKFLOW: When the user asks to create/update/delete an event:
- Use ISO 8601 datetimes with +03:00 offset for Cairo (e.g. 2026-09-20T14:00:00+03:00)
- For update/delete: first call get_calendar_events to find the event ID, then act
- Confirm with the user before deleting

MAIL REPLY WORKFLOW:
- call read_email(message_id) first to get the full body, Thread-ID, and Message-ID
- Use those in send_email(to, subject, body, thread_id, in_reply_to)
- Subject for replies: prepend "Re: " if not already there

What you CANNOT do: read financial balances or history — say so briefly.

Reply style: short, warm, direct. No markdown headers.
- Always present any list of items as bullet points (use · or -).
- For confirmations ("Added ✓", "Logged ✓") a single line is fine — no bullet needed.
- When asking a follow-up question (category? add to list?), keep it to one short question at a time.`

  // Build messages: history pairs + current message
  const messages: { role: string; content: unknown }[] = [
    ...history.map(h => ({ role: h.role, content: h.content })),
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
        max_tokens: 2048,
        system:     systemPrompt,
        tools:      CLAUDE_TOOLS,
        messages,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Anthropic error:', err)
      return { text: 'Sorry, I ran into a problem. Try again in a moment.', updatedHistory: history }
    }

    const data = await res.json() as { stop_reason: string; content: ContentBlock[] }

    if (data.stop_reason === 'end_turn') {
      const text = data.content.find(b => b.type === 'text')?.text ?? '...'
      const updatedHistory: ChatContext = [
        ...history,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: text },
      ].slice(-16)
      return { text, updatedHistory }
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

  return { text: 'I got a bit confused — could you rephrase that?', updatedHistory: history }
}

async function dispatchTool(userId: string, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_today':           return toolGetToday(userId)
    case 'get_tasks':           return toolGetTasks(userId, args)
    case 'add_task':            return toolAddTask(userId, args)
    case 'complete_task':       return toolCompleteTask(userId, args)
    case 'list_habits':         return toolListHabits(userId)
    case 'log_habit':           return toolLogHabit(userId, args)
    case 'create_habit':        return toolCreateHabit(userId, args)
    case 'update_habit':        return toolUpdateHabit(userId, args)
    case 'deactivate_habit':    return toolDeactivateHabit(userId, args)
    case 'get_habit_logs':      return toolGetHabitLogs(userId, args)
    case 'update_task':         return toolUpdateTask(userId, args)
    case 'delete_task':         return toolDeleteTask(userId, args)
    case 'create_calendar_event': return toolCreateCalendarEvent(userId, args)
    case 'update_calendar_event': return toolUpdateCalendarEvent(userId, args)
    case 'delete_calendar_event': return toolDeleteCalendarEvent(userId, args)
    case 'read_email':          return toolReadEmail(userId, args)
    case 'send_email':          return toolSendEmail(userId, args)
    case 'trash_email':         return toolTrashEmail(userId, args)
    case 'star_email':          return toolStarEmail(userId, args)
    case 'get_finance_categories': return toolGetFinanceCategories(userId, args)
    case 'add_transaction':        return toolAddTransaction(userId, args)
    case 'get_calendar_events': return toolGetCalendarEvents(userId, args)
    case 'get_shopping_lists':    return toolGetShoppingLists(userId)
    case 'get_shopping_items':    return toolGetShoppingItems(userId, args)
    case 'add_shopping_item':     return toolAddShoppingItem(userId, args)
    case 'mark_shopping_item':    return toolMarkShoppingItem(userId, args)
    case 'create_shopping_list':  return toolCreateShoppingList(userId, args)
    case 'get_emails':          return toolGetEmails(userId, args)
    case 'archive_email':       return toolArchiveEmail(userId, args)
    case 'mark_email_read':     return toolMarkEmailRead(userId, args)
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

  // Run the agent (or fallback) and reply, then persist context
  const { text: response, updatedHistory } = await runAgent(auth.userId, text, auth.context)
  await Promise.all([
    reply(chatId, response),
    saveContext(chatId, updatedHistory),
  ])

  return new Response('ok')
})
