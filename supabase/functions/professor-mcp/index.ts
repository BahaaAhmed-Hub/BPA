/**
 * professor-mcp — MCP server for the Professor AI platform
 *
 * Implements the Model Context Protocol (Streamable HTTP transport, 2024-11-05)
 * so any MCP-compatible AI client — Claude.ai, Claude Code, a Telegram bot —
 * can read and write Professor data as the authenticated user.
 *
 * Authentication: Bearer token in the Authorization header.
 *   Authorization: Bearer prof_sk_<hex>
 * Tokens are created in Settings → Connections and stored in user_tokens.
 *
 * Tools exposed:
 *   get_today           — tasks + habits + finance snapshot for today
 *   get_tasks           — list tasks (optional quadrant / status filter)
 *   add_task            — create a task
 *   complete_task       — mark done or cancelled
 *   get_habits          — list habits with today's log status
 *   log_habit           — log a habit for a date
 *   get_finance_overview— account balances + this month's spending
 *   add_transaction     — record an income or expense entry
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── CORS ──────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

// ── Tool registry ──────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_today',
    description: "Summary of today: open tasks by quadrant, each habit's completion, and this month's spend so far.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_tasks',
    description: 'List tasks. Optionally filter by quadrant (do / schedule / delegate / dump) or status (open / done).',
    inputSchema: {
      type: 'object',
      properties: {
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'dump'] },
        status:   { type: 'string', enum: ['open', 'done'] },
        limit:    { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'add_task',
    description: 'Create a new task.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:    { type: 'string' },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'dump'], description: 'Default: dump' },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task done or cancelled. Pass the task id from get_tasks.',
    inputSchema: {
      type: 'object',
      required: ['task_id', 'status'],
      properties: {
        task_id: { type: 'string' },
        status:  { type: 'string', enum: ['done', 'deferred'] },
      },
    },
  },
  {
    name: 'get_habits',
    description: "List all active habits with today's log status and progress.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'log_habit',
    description: 'Log a habit completion. Match by name (partial). For measurable habits, pass a quantity.',
    inputSchema: {
      type: 'object',
      required: ['habit_name'],
      properties: {
        habit_name: { type: 'string' },
        quantity:   { type: 'number', description: 'Amount (glasses, steps, minutes…)' },
        date:       { type: 'string', description: 'YYYY-MM-DD — defaults to today' },
      },
    },
  },
  {
    name: 'get_finance_overview',
    description: 'Account balances and this-month income vs expenses.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_transaction',
    description: 'Record an income or expense transaction.',
    inputSchema: {
      type: 'object',
      required: ['amount', 'tx_type', 'payee'],
      properties: {
        amount:   { type: 'number', description: 'Positive number' },
        tx_type:  { type: 'string', enum: ['expense', 'income'] },
        payee:    { type: 'string' },
        category: { type: 'string', description: 'Category name (partial match)' },
        note:     { type: 'string' },
        date:     { type: 'string', description: 'YYYY-MM-DD — defaults to today' },
      },
    },
  },
]

// ── Auth ───────────────────────────────────────────────────────────────────────

async function resolveToken(token: string, sb: ReturnType<typeof createClient>): Promise<string | null> {
  if (!token.startsWith('prof_sk_')) return null

  const { data } = await sb
    .from('user_tokens')
    .select('user_id')
    .eq('token', token)
    .eq('revoked', false)
    .maybeSingle()

  if (!data) return null

  // fire-and-forget last_used_at update
  sb.from('user_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', token)

  return (data as { user_id: string }).user_id
}

// ── Tool implementations ───────────────────────────────────────────────────────

const today = () => new Date().toISOString().split('T')[0]

async function toolGetToday(userId: string, sb: ReturnType<typeof createClient>): Promise<string> {
  const date = today()
  const monthStart = date.slice(0, 7) + '-01'

  const [tasksRes, habitsRes, logsRes, txRes] = await Promise.all([
    sb.from('tasks').select('title, quadrant, status').eq('user_id', userId)
      .in('status', ['todo', 'in_progress']).order('created_at', { ascending: false }).limit(12),
    sb.from('habits').select('id, name, goal, unit').eq('user_id', userId).eq('is_active', true),
    sb.from('habit_logs').select('habit_id, completed, quantity').eq('user_id', userId).eq('date', date),
    sb.from('finance_transactions').select('amount, tx_type').eq('user_id', userId)
      .gte('date', monthStart).not('paid_at', 'is', null),
  ])

  const tasks  = (tasksRes.data  ?? []) as { title: string; quadrant: string | null; status: string }[]
  const habits = (habitsRes.data ?? []) as { id: string; name: string; goal: number | null; unit: string | null }[]
  const logs   = (logsRes.data   ?? []) as { habit_id: string; completed: boolean; quantity: number | null }[]
  const txs    = (txRes.data     ?? []) as { amount: number; tx_type: string }[]

  const logMap = new Map(logs.map(l => [l.habit_id, l]))

  // tasks by quadrant
  const byQ: Record<string, string[]> = { do: [], schedule: [], delegate: [], dump: [] }
  for (const t of tasks) byQ[t.quadrant ?? 'dump']?.push(t.title)
  const taskBlock = (Object.entries(byQ) as [string, string[]][])
    .filter(([, v]) => v.length)
    .map(([q, ts]) => `  [${q}]\n${ts.map(t => `    · ${t}`).join('\n')}`)
    .join('\n') || '  No open tasks'

  // habits
  const habitBlock = habits.length
    ? habits.map(h => {
        const l = logMap.get(h.id)
        const pct = h.goal && l?.quantity ? `${l.quantity}/${h.goal}${h.unit ? ' ' + h.unit : ''}` : ''
        const mark = l?.completed ? '✓' : (pct || '○')
        return `  ${mark}  ${h.name}${pct ? ` — ${pct}` : ''}`
      }).join('\n')
    : '  No habits'

  // finance
  const income   = txs.filter(t => t.tx_type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0)
  const expenses = txs.filter(t => t.tx_type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0)

  return [
    `TODAY — ${date}`,
    '',
    `TASKS (${tasks.length} open)`,
    taskBlock,
    '',
    'HABITS',
    habitBlock,
    '',
    `THIS MONTH`,
    `  Income:   ${income.toLocaleString()}`,
    `  Expenses: ${expenses.toLocaleString()}`,
    `  Net:      ${(income - expenses).toLocaleString()}`,
  ].join('\n')
}

async function toolGetTasks(userId: string, args: Record<string, unknown>, sb: ReturnType<typeof createClient>): Promise<string> {
  let q = sb.from('tasks').select('id, title, quadrant, status, due_date').eq('user_id', userId)
  if (args.quadrant) q = q.eq('quadrant', args.quadrant)
  if (args.status === 'open')  q = q.in('status', ['todo', 'in_progress'])
  if (args.status === 'done')  q = q.eq('status', 'done')
  q = q.order('created_at', { ascending: false }).limit((args.limit as number) ?? 20)

  const { data, error } = await q
  if (error) return `Error: ${error.message}`
  if (!data?.length) return 'No tasks found.'

  return (data as { id: string; title: string; quadrant: string | null; status: string; due_date: string | null }[])
    .map(t => `[${t.id}] ${t.status === 'done' ? '✓' : '○'} ${t.title}  (${t.quadrant ?? 'dump'}${t.due_date ? ' · ' + t.due_date : ''})`)
    .join('\n')
}

async function toolAddTask(userId: string, args: Record<string, unknown>, sb: ReturnType<typeof createClient>): Promise<string> {
  const { data, error } = await sb.from('tasks').insert({
    user_id:  userId,
    title:    args.title,
    quadrant: args.quadrant ?? 'dump',
    due_date: args.due_date ?? null,
    status:   'todo',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select('id').single()

  if (error) return `Error: ${error.message}`
  return `Created: "${args.title}" [id: ${(data as { id: string }).id}]`
}

async function toolCompleteTask(userId: string, args: Record<string, unknown>, sb: ReturnType<typeof createClient>): Promise<string> {
  const { error } = await sb.from('tasks').update({
    status:       args.status,
    completed_at: new Date().toISOString(),
    updated_at:   new Date().toISOString(),
  }).eq('id', args.task_id).eq('user_id', userId)

  if (error) return `Error: ${error.message}`
  return `Task marked as ${args.status}.`
}

async function toolGetHabits(userId: string, sb: ReturnType<typeof createClient>): Promise<string> {
  const date = today()
  const [habitsRes, logsRes] = await Promise.all([
    sb.from('habits').select('id, name, goal, unit').eq('user_id', userId).eq('is_active', true),
    sb.from('habit_logs').select('habit_id, completed, quantity').eq('user_id', userId).eq('date', date),
  ])

  const habits = (habitsRes.data ?? []) as { id: string; name: string; goal: number | null; unit: string | null }[]
  const logs   = (logsRes.data   ?? []) as { habit_id: string; completed: boolean; quantity: number | null }[]
  if (!habits.length) return 'No active habits.'

  const logMap = new Map(logs.map(l => [l.habit_id, l]))
  return habits.map(h => {
    const l = logMap.get(h.id)
    const progress = h.goal && l?.quantity ? ` — ${l.quantity}/${h.goal} ${h.unit ?? ''}` : ''
    return `[${h.id}] ${l?.completed ? '✓' : '○'} ${h.name}${progress}`
  }).join('\n')
}

async function toolLogHabit(userId: string, args: Record<string, unknown>, sb: ReturnType<typeof createClient>): Promise<string> {
  const { data: matches, error: findErr } = await sb.from('habits')
    .select('id, name, goal, unit').eq('user_id', userId).eq('is_active', true)
    .ilike('name', `%${args.habit_name}%`)

  if (findErr) return `Error: ${findErr.message}`
  if (!matches?.length) return `No habit found matching "${args.habit_name}".`

  const candidates = matches as { id: string; name: string; goal: number | null; unit: string | null }[]
  if (candidates.length > 1) return `Multiple matches: ${candidates.map(h => h.name).join(', ')}. Be more specific.`

  const habit   = candidates[0]
  const date    = (args.date as string | undefined) ?? today()
  const qty     = (args.quantity as number | undefined) ?? 1
  const done    = habit.goal ? qty >= habit.goal : true

  const { error } = await sb.from('habit_logs').upsert({
    user_id:    userId,
    habit_id:   habit.id,
    date,
    quantity:   qty,
    completed:  done,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'habit_id,date' })

  if (error) return `Error: ${error.message}`
  return `Logged ${habit.name}: ${qty}${habit.unit ? ' ' + habit.unit : ''}${done ? ' ✓' : ` (goal: ${habit.goal} ${habit.unit ?? ''})`}`
}

async function toolGetFinanceOverview(userId: string, sb: ReturnType<typeof createClient>): Promise<string> {
  const date       = today()
  const monthStart = date.slice(0, 7) + '-01'

  const [accountsRes, txRes] = await Promise.all([
    sb.from('finance_accounts').select('name, balance, currency').eq('user_id', userId),
    sb.from('finance_transactions').select('amount, tx_type, currency')
      .eq('user_id', userId).gte('date', monthStart).not('paid_at', 'is', null),
  ])

  const accounts = (accountsRes.data ?? []) as { name: string; balance: number; currency: string }[]
  const txs      = (txRes.data      ?? []) as { amount: number; tx_type: string; currency: string }[]

  const income   = txs.filter(t => t.tx_type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0)
  const expenses = txs.filter(t => t.tx_type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0)

  const acctLines = accounts.length
    ? accounts.map(a => `  ${a.name}: ${a.balance.toLocaleString()} ${a.currency}`).join('\n')
    : '  No accounts'

  return [
    'ACCOUNTS',
    acctLines,
    '',
    `THIS MONTH (${date.slice(0, 7)})`,
    `  Income:   ${income.toLocaleString()}`,
    `  Expenses: ${expenses.toLocaleString()}`,
    `  Net:      ${(income - expenses).toLocaleString()}`,
  ].join('\n')
}

async function toolAddTransaction(userId: string, args: Record<string, unknown>, sb: ReturnType<typeof createClient>): Promise<string> {
  let categoryId: string | null = null
  if (args.category) {
    const { data } = await sb.from('finance_categories').select('id').eq('user_id', userId)
      .ilike('name', `%${args.category}%`).limit(1)
    categoryId = (data as { id: string }[] | null)?.[0]?.id ?? null
  }

  const { data: accounts } = await sb.from('finance_accounts').select('id').eq('user_id', userId).limit(1)
  const accountId = (accounts as { id: string }[] | null)?.[0]?.id
  if (!accountId) return 'No accounts found — add an account in Finance first.'

  const txDate = (args.date as string | undefined) ?? today()
  const sign   = args.tx_type === 'expense' ? -1 : 1

  const { error } = await sb.from('finance_transactions').insert({
    user_id:     userId,
    account_id:  accountId,
    amount:      sign * Math.abs(args.amount as number),
    currency:    'EGP',
    tx_type:     args.tx_type,
    payee:       args.payee,
    category_id: categoryId,
    note:        (args.note as string | undefined) ?? null,
    date:        txDate,
    paid_at:     txDate,
    is_cleared:  true,
    created_at:  new Date().toISOString(),
    updated_at:  new Date().toISOString(),
  })

  if (error) return `Error: ${error.message}`
  return `Added: ${args.tx_type === 'expense' ? '−' : '+'}${(args.amount as number).toLocaleString()} — ${args.payee}${args.category ? ` (${args.category})` : ''}`
}

// ── MCP dispatcher ────────────────────────────────────────────────────────────

async function dispatch(userId: string, name: string, args: Record<string, unknown>, sb: ReturnType<typeof createClient>): Promise<string> {
  switch (name) {
    case 'get_today':            return toolGetToday(userId, sb)
    case 'get_tasks':            return toolGetTasks(userId, args, sb)
    case 'add_task':             return toolAddTask(userId, args, sb)
    case 'complete_task':        return toolCompleteTask(userId, args, sb)
    case 'get_habits':           return toolGetHabits(userId, sb)
    case 'log_habit':            return toolLogHabit(userId, args, sb)
    case 'get_finance_overview': return toolGetFinanceOverview(userId, sb)
    case 'add_transaction':      return toolAddTransaction(userId, args, sb)
    default:                     return `Unknown tool: ${name}`
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')   return new Response('Method not allowed', { status: 405, headers: CORS })

  let body: { jsonrpc: string; id?: unknown; method: string; params?: Record<string, unknown> }
  try { body = await req.json() } catch {
    return json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }, 400)
  }

  const { method, id, params } = body

  const ok  = (result: unknown) => json({ jsonrpc: '2.0', id, result })
  const err = (code: number, message: string) => json({ jsonrpc: '2.0', id, error: { code, message } })

  // initialize — no auth required (the client handshake)
  if (method === 'initialize') {
    return ok({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'professor-mcp', version: '1.0.0' },
    })
  }

  // notifications/initialized — client acknowledgement, no response needed
  if (method === 'notifications/initialized') {
    return new Response(null, { status: 204, headers: CORS })
  }

  // All other methods require a valid token
  const raw = req.headers.get('Authorization') ?? ''
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : null
  if (!token) return err(-32001, 'Authorization header required: Bearer prof_sk_...')

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const userId = await resolveToken(token, sb)
  if (!userId) return err(-32001, 'Invalid or revoked token')

  if (method === 'tools/list') return ok({ tools: TOOLS })

  if (method === 'tools/call') {
    const name = (params?.name as string | undefined) ?? ''
    const args = (params?.arguments as Record<string, unknown> | undefined) ?? {}
    try {
      const text = await dispatch(userId, name, args, sb)
      return ok({ content: [{ type: 'text', text }] })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      return ok({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true })
    }
  }

  return err(-32601, `Method not found: ${method}`)
})
