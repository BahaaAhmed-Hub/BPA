/**
 * professor-siri — a dead-simple HTTP endpoint for Siri Shortcuts.
 *
 * Siri Shortcuts can't speak MCP, but they can do a POST with a JSON body.
 * This function accepts plain actions and returns plain text Siri can read aloud.
 *
 * Auth:  Authorization: Bearer prof_sk_<48 hex chars>
 * Body:  { "action": "add_task" | "get_today" | "log_habit" | "get_balance", ...args }
 * Reply: plain text, always 200 (errors are spoken by Siri too)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ── Auth ─────────────────────────────────────────────────────────────────────

async function resolveToken(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace('Bearer ', '').trim()
  if (!token.startsWith('prof_sk_')) return null

  const { data } = await sb
    .from('user_tokens')
    .select('user_id')
    .eq('token', token)
    .eq('revoked', false)
    .single()

  if (!data) return null

  // update last_used_at without waiting
  sb.from('user_tokens').update({ last_used_at: new Date().toISOString() })
    .eq('token', token).then(() => {})

  return data.user_id
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(text: string) {
  return new Response(text, { headers: { 'Content-Type': 'text/plain' } })
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function addTask(userId: string, body: Record<string, string>): Promise<string> {
  const title = (body.title ?? '').trim()
  if (!title) return 'What should I call the task?'

  const { error } = await sb.from('tasks').insert({
    user_id: userId,
    title,
    status: 'open',
    quadrant: body.quadrant ?? null,
    priority: body.priority ?? 'medium',
  })

  if (error) return `Couldn't add the task: ${error.message}`
  return `Added: ${title}`
}

async function getToday(userId: string): Promise<string> {
  // Tasks due today or overdue
  const today = todayISO()
  const { data: tasks } = await sb
    .from('tasks')
    .select('title, priority, quadrant')
    .eq('user_id', userId)
    .eq('status', 'open')
    .lte('due_date', today)
    .order('priority', { ascending: false })
    .limit(5)

  if (!tasks?.length) return 'No tasks due today. Clear schedule!'

  const lines = tasks.map((t, i) => `${i + 1}. ${t.title}`)
  return `You have ${tasks.length} task${tasks.length > 1 ? 's' : ''} due today:\n${lines.join('\n')}`
}

async function logHabit(userId: string, body: Record<string, string>): Promise<string> {
  const name = (body.habit ?? body.name ?? '').trim()
  if (!name) return 'Which habit should I log?'

  // Find the habit by name (case-insensitive contains)
  const { data: habits } = await sb
    .from('habits')
    .select('id, name, goal, unit')
    .eq('user_id', userId)
    .eq('is_active', true)
    .ilike('name', `%${name}%`)
    .limit(3)

  if (!habits?.length) return `I couldn't find a habit matching "${name}".`
  if (habits.length > 1) {
    return `Found a few habits: ${habits.map(h => h.name).join(', ')}. Be more specific.`
  }

  const habit = habits[0]
  const today = todayISO()
  const quantity = body.quantity ? Number(body.quantity) : null
  const completed = quantity !== null ? quantity >= (habit.goal ?? 1) : true

  const { error } = await sb.from('habit_logs').upsert(
    { habit_id: habit.id, date: today, completed, quantity },
    { onConflict: 'habit_id,date' }
  )

  if (error) return `Couldn't log the habit: ${error.message}`

  if (quantity !== null) {
    return `Logged ${quantity}${habit.unit ? ' ' + habit.unit : ''} for ${habit.name}.`
  }
  return `Logged ${habit.name} for today. Well done!`
}

async function getBalance(userId: string): Promise<string> {
  const { data: accounts } = await sb
    .from('finance_accounts')
    .select('name, balance, currency, account_type')
    .eq('user_id', userId)
    .in('account_type', ['payment', 'wallet', 'savings'])
    .order('balance', { ascending: false })
    .limit(5)

  if (!accounts?.length) return 'No accounts found in Finance.'

  const lines = accounts.map(a =>
    `${a.name}: ${Number(a.balance).toLocaleString()} ${a.currency}`
  )
  return lines.join('\n')
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } })
  }

  if (req.method !== 'POST') return ok('Send a POST request.')

  const userId = await resolveToken(req)
  if (!userId) return ok('Invalid or missing token. Generate one in Settings → Integrations → Connections.')

  let body: Record<string, string> = {}
  try { body = await req.json() } catch { return ok('Send a JSON body.') }

  const action = (body.action ?? '').toLowerCase()

  switch (action) {
    case 'add_task':   return ok(await addTask(userId, body))
    case 'get_today':  return ok(await getToday(userId))
    case 'log_habit':  return ok(await logHabit(userId, body))
    case 'get_balance':return ok(await getBalance(userId))
    default:
      return ok('Unknown action. Available: add_task, get_today, log_habit, get_balance.')
  }
})
