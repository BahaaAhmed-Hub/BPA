/**
 * professor-siri — Siri Shortcuts HTTP endpoint for Professor AI
 *
 * Usage: GET /functions/v1/professor-siri?token=prof_sk_...&q=what+is+on+today
 *
 * Returns plain text — Siri reads it aloud via a "Speak Text" action.
 *
 * Setup:
 *   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   npx supabase functions deploy professor-siri
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const todayISO = () => new Date().toISOString().slice(0, 10)

type SiriContext = { role: string; content: string }[]

async function resolveToken(token: string): Promise<{ userId: string; context: SiriContext } | null> {
  if (!token.startsWith('prof_sk_')) return null
  const { data } = await sb
    .from('user_tokens')
    .select('user_id, siri_context')
    .eq('token', token)
    .eq('revoked', false)
    .maybeSingle()
  if (!data) return null
  const row = data as { user_id: string; siri_context: SiriContext | null }
  return { userId: row.user_id, context: row.siri_context ?? [] }
}

async function saveContext(token: string, context: SiriContext) {
  await sb.from('user_tokens').update({ siri_context: context }).eq('token', token)
}

// ── Minimal tool set for Siri (one-shot voice queries) ───────────────────────

async function getToday(userId: string): Promise<string> {
  const date = todayISO()
  const [tasksRes, habitsRes, logsRes] = await Promise.all([
    sb.from('tasks').select('title, quadrant, status')
      .eq('user_id', userId).in('status', ['todo', 'in_progress'])
      .order('created_at', { ascending: false }).limit(8),
    sb.from('habits').select('id, name, goal, unit')
      .eq('user_id', userId).eq('is_active', true),
    sb.from('habit_logs').select('habit_id, completed, quantity')
      .eq('user_id', userId).eq('date', date),
  ])

  const tasks  = (tasksRes.data  ?? []) as { title: string; quadrant: string | null }[]
  const habits = (habitsRes.data ?? []) as { id: string; name: string; goal: number | null; unit: string | null }[]
  const logs   = (logsRes.data   ?? []) as { habit_id: string; completed: boolean; quantity: number | null }[]
  const logMap = new Map(logs.map(l => [l.habit_id, l]))

  const open = tasks.filter(t => t.quadrant === 'do' || t.quadrant === 'schedule')
  const taskLine = open.length
    ? open.slice(0, 5).map(t => t.title).join(', ')
    : 'no urgent tasks'

  const habitLines = habits.map(h => {
    const l = logMap.get(h.id)
    if (l?.completed) return `${h.name} done`
    if (l?.quantity && h.goal) return `${h.name}: ${l.quantity} of ${h.goal}${h.unit ? ' ' + h.unit : ''}`
    return `${h.name} not yet`
  })

  return [
    `Today is ${date}.`,
    open.length ? `Your priority tasks: ${taskLine}.` : 'No urgent tasks today.',
    habitLines.length ? 'Habits: ' + habitLines.join('; ') + '.' : '',
  ].filter(Boolean).join(' ')
}

async function addTask(userId: string, title: string, quadrant = 'dump'): Promise<string> {
  const { error } = await sb.from('tasks').insert({
    user_id: userId, title, quadrant, status: 'todo',
  })
  if (error) return `Sorry, could not add the task: ${error.message}`
  return `Added "${title}" to your task list.`
}

async function logHabit(userId: string, name: string, quantity?: number): Promise<string> {
  const { data: matches } = await sb.from('habits')
    .select('id, name, goal, unit').eq('user_id', userId).eq('is_active', true)
    .ilike('name', `%${name}%`)
  if (!matches?.length) return `No habit found matching "${name}".`
  const habit = (matches as { id: string; name: string; goal: number | null; unit: string | null }[])[0]
  const date  = todayISO()
  const qty   = quantity ?? 1
  const done  = habit.goal ? qty >= habit.goal : true

  const { data: existing } = await sb.from('habit_logs')
    .select('id').eq('habit_id', habit.id).eq('date', date).maybeSingle()
  const id = (existing as { id: string } | null)?.id

  let err: { message: string } | null = null
  if (id) {
    const { error } = await sb.from('habit_logs').update({ quantity: qty, completed: done }).eq('id', id)
    err = error
  } else {
    const { error } = await sb.from('habit_logs')
      .insert({ user_id: userId, habit_id: habit.id, date, quantity: qty, completed: done })
    err = error
  }

  if (err) return `Could not log habit: ${err.message}`
  const goal = habit.goal ? ` (${qty} of ${habit.goal}${habit.unit ? ' ' + habit.unit : ''})` : ''
  return done
    ? `Logged ${habit.name}${goal} — goal reached!`
    : `Logged ${habit.name}${goal}.`
}

async function addTransaction(userId: string, amount: number, payee: string): Promise<string> {
  const { data: accounts } = await sb.from('finance_accounts')
    .select('id, name, currency').eq('user_id', userId)
    .in('account_type', ['payment', 'wallet']).limit(1)

  const acc = (accounts as { id: string; name: string; currency: string }[] | null)?.[0]
  if (!acc) return 'No payment account found. Add one in the Professor app first.'

  const date = todayISO()
  const { error } = await sb.from('finance_transactions').insert({
    user_id: userId, account_id: acc.id, amount: Math.abs(amount),
    currency: acc.currency, tx_type: 'expense', payee, date, paid_at: date, is_cleared: true,
  })
  if (error) return `Could not log expense: ${error.message}`
  return `Logged ${payee}: ${Math.abs(amount).toLocaleString()} ${acc.currency} today.`
}

// ── Claude agent (one-shot, no history for Siri) ─────────────────────────────

const SIRI_TOOLS = [
  {
    name: 'get_today',
    description: 'Get a summary of today: tasks and habit progress.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'add_task',
    description: 'Add a task to the list.',
    input_schema: {
      type: 'object', required: ['title'],
      properties: {
        title:    { type: 'string' },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'dump'] },
      },
    },
  },
  {
    name: 'log_habit',
    description: 'Log a habit completion.',
    input_schema: {
      type: 'object', required: ['habit_name'],
      properties: {
        habit_name: { type: 'string' },
        quantity:   { type: 'number' },
      },
    },
  },
  {
    name: 'add_expense',
    description: 'Log an expense.',
    input_schema: {
      type: 'object', required: ['amount', 'payee'],
      properties: {
        amount: { type: 'number' },
        payee:  { type: 'string' },
      },
    },
  },
]

type ContentBlock = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }

async function runSiriAgent(
  userId: string,
  query: string,
  history: SiriContext,
): Promise<{ text: string; updatedHistory: SiriContext }> {
  if (!ANTHROPIC_KEY) return {
    text: 'Professor AI is not configured. Ask your admin to set the Anthropic API key.',
    updatedHistory: history,
  }

  const today     = todayISO()
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)

  const system = `You are Professor AI, answering voice queries from Siri Shortcuts. Today is ${today}. Yesterday was ${yesterday}.
Reply in plain spoken sentences — no markdown, no bullet points. Keep it short (1–3 sentences max).
CRITICAL: reply in the same language the user spoke in. If Arabic, use Egyptian dialect (اللهجة المصرية).
CONTEXT MEMORY: you have the last several messages in your history — use them. If the user says "add it", "yes", "the first one", check the history to understand what they mean.
You can: check today's tasks and habits (get_today), add a task (add_task), log a habit (log_habit), log an expense (add_expense).`

  const messages: { role: string; content: unknown }[] = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: query },
  ]

  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system,
        tools: SIRI_TOOLS,
        messages,
      }),
    })

    if (!res.ok) return { text: 'Something went wrong. Try again in a moment.', updatedHistory: history }

    const data = await res.json() as { stop_reason: string; content: ContentBlock[] }

    if (data.stop_reason === 'end_turn') {
      const text = data.content.find(b => b.type === 'text')?.text?.trim() ?? 'Done.'
      const updatedHistory: SiriContext = [
        ...history,
        { role: 'user', content: query },
        { role: 'assistant', content: text },
      ].slice(-20)
      return { text, updatedHistory }
    }

    if (data.stop_reason === 'tool_use') {
      const toolUses = data.content.filter(b => b.type === 'tool_use')
      const results = await Promise.all(toolUses.map(async tu => {
        const args = tu.input ?? {}
        let content: string
        switch (tu.name) {
          case 'get_today':   content = await getToday(userId); break
          case 'add_task':    content = await addTask(userId, args.title as string, args.quadrant as string | undefined); break
          case 'log_habit':   content = await logHabit(userId, args.habit_name as string, args.quantity as number | undefined); break
          case 'add_expense': content = await addTransaction(userId, args.amount as number, args.payee as string); break
          default:            content = `Unknown tool: ${tu.name}`
        }
        return { type: 'tool_result' as const, tool_use_id: tu.id!, content }
      }))
      messages.push({ role: 'assistant', content: data.content })
      messages.push({ role: 'user', content: results })
    } else {
      break
    }
  }

  return { text: 'Could not process that. Try again.', updatedHistory: history }
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' }

  let token = ''
  let query = ''

  if (req.method === 'GET') {
    const url = new URL(req.url)
    token = url.searchParams.get('token') ?? ''
    query = url.searchParams.get('q') ?? url.searchParams.get('text') ?? ''
  } else if (req.method === 'POST') {
    try {
      const body = await req.json() as Record<string, string>
      token = body.token ?? ''
      query = body.q ?? body.text ?? body.query ?? ''
    } catch {
      return new Response('Invalid JSON body.', { status: 400, headers: corsHeaders })
    }
  } else {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  if (!token) {
    return new Response('Missing token. Add ?token=prof_sk_... to the URL.', { status: 400, headers: corsHeaders })
  }
  if (!query.trim()) {
    return new Response('Missing question. Add &q=your+question or send {"q":"..."} in the body.', { status: 400, headers: corsHeaders })
  }

  const auth = await resolveToken(token)
  if (!auth) {
    return new Response('Token not found or revoked. Generate a new one in Settings.', {
      status: 403, headers: corsHeaders,
    })
  }

  const { text, updatedHistory } = await runSiriAgent(auth.userId, query.trim(), auth.context)
  await saveContext(token, updatedHistory)
  return new Response(text, { headers: corsHeaders })
})
