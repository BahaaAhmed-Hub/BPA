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
  const date       = todayISO()
  const monthStart = date.slice(0, 7) + '-01'

  const [tasksRes, habitsRes, logsRes, txRes] = await Promise.all([
    sb.from('tasks').select('title, quadrant, status')
      .eq('user_id', userId).in('status', ['todo', 'in_progress'])
      .order('created_at', { ascending: false }).limit(10),
    sb.from('habits').select('id, name, goal, unit')
      .eq('user_id', userId).eq('is_active', true),
    sb.from('habit_logs').select('habit_id, completed, quantity')
      .eq('user_id', userId).eq('date', date),
    sb.from('finance_transactions').select('amount, tx_type')
      .eq('user_id', userId).gte('date', monthStart).not('paid_at', 'is', null),
  ])

  const tasks  = (tasksRes.data  ?? []) as { title: string; quadrant: string | null }[]
  const habits = (habitsRes.data ?? []) as { id: string; name: string; goal: number | null; unit: string | null }[]
  const logs   = (logsRes.data   ?? []) as { habit_id: string; completed: boolean; quantity: number | null }[]
  const txs    = (txRes.data     ?? []) as { amount: number; tx_type: string }[]

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

  const income   = txs.filter(t => t.tx_type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0)
  const expenses = txs.filter(t => t.tx_type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0)

  return [
    `*Today — ${date}*`,
    '',
    `*Tasks (${tasks.length} open)*`,
    taskBlock,
    '',
    '*Habits*',
    habitBlock,
    '',
    `*This month*`,
    `  In:  ${income.toLocaleString()}`,
    `  Out: ${expenses.toLocaleString()}`,
    `  Net: ${(income - expenses).toLocaleString()}`,
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
    user_id:    userId,
    title:      args.title,
    quadrant:   args.quadrant ?? 'dump',
    due_date:   args.due_date ?? null,
    status:     'todo',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select('id').single()

  if (error) return `Error: ${error.message}`
  return `Added: "${args.title}" — it's in your task list now.`
}

async function toolCompleteTask(userId: string, args: Record<string, unknown>): Promise<string> {
  const { error } = await sb.from('tasks').update({
    status:       args.status,
    completed_at: new Date().toISOString(),
    updated_at:   new Date().toISOString(),
  }).eq('id', args.task_id).eq('user_id', userId)

  if (error) return `Error: ${error.message}`
  return `Done ✓ — task marked as ${args.status}.`
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
  const done  = habit.goal ? qty >= habit.goal : true

  const { error } = await sb.from('habit_logs').upsert({
    user_id:    userId,
    habit_id:   habit.id,
    date,
    quantity:   qty,
    completed:  done,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'habit_id,date' })

  if (error) return `Error: ${error.message}`
  return `Logged ${habit.name}: ${qty}${habit.unit ? ' ' + habit.unit : ''}${done ? ' ✓' : ''}`
}

async function toolGetBalance(userId: string): Promise<string> {
  const { data: accounts } = await sb.from('finance_accounts')
    .select('name, balance, currency, account_type')
    .eq('user_id', userId)
    .in('account_type', ['payment', 'wallet', 'savings'])
    .order('balance', { ascending: false })

  if (!accounts?.length) return 'No accounts found.'

  return (accounts as { name: string; balance: number; currency: string; account_type: string }[])
    .map(a => `${a.name}: ${Number(a.balance).toLocaleString()} ${a.currency}`)
    .join('\n')
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
    name:        'get_balance',
    description: 'Get current account balances.',
    input_schema: { type: 'object', properties: {} },
  },
]

type ContentBlock = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }

async function runAgent(userId: string, userMessage: string): Promise<string> {
  if (!ANTHROPIC_KEY) {
    return fallbackProcess(userId, userMessage)
  }

  const today = todayISO()
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  const systemPrompt = `You are Professor AI, a personal assistant. You live in Telegram and the user talks to you naturally — like texting a smart friend, not filling out a form.

Today is ${today}. Yesterday was ${yesterday}.

IMPORTANT — understand natural speech:
- "yesterday", "last night", "this morning" → convert to the right date (${yesterday} for yesterday)
- "water 600ml" → log_habit with habit_name="water", quantity=600
- "add call Ahmed" or "remind me to call Ahmed" → add_task
- "what do I have today" or "what's on" → get_today
- "how much money do I have" → get_balance
- Never ask the user to rephrase or use a specific format. Just figure it out.

What you CAN do: tasks (list, add, complete), habits (list, log with quantities and past dates), account balances, today's overview.
What you CANNOT do: calendar events, email, shopping lists — say so briefly if asked, don't apologise.

Reply style: short, warm, direct. One or two sentences after using a tool. No markdown headers. Bullet points only when listing 3+ things.`

  const messages: { role: string; content: unknown }[] = [
    { role: 'user', content: userMessage },
  ]

  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1024,
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
    } else {
      break
    }
  }

  return 'I got a bit confused — could you rephrase that?'
}

async function dispatchTool(userId: string, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_today':    return toolGetToday(userId)
    case 'get_tasks':    return toolGetTasks(userId, args)
    case 'add_task':     return toolAddTask(userId, args)
    case 'complete_task':return toolCompleteTask(userId, args)
    case 'log_habit':    return toolLogHabit(userId, args)
    case 'get_balance':  return toolGetBalance(userId)
    default:             return `Unknown tool: ${name}`
  }
}

// Fallback when no Anthropic key — pattern-match common requests
async function fallbackProcess(userId: string, text: string): Promise<string> {
  const lower = text.toLowerCase()
  if (/\b(today|tasks|schedule)\b/.test(lower))    return toolGetToday(userId)
  if (/\b(balance|money|account)\b/.test(lower))   return toolGetBalance(userId)
  if (/\badd task[:\s](.+)/i.test(text)) {
    const title = text.match(/add task[:\s](.+)/i)?.[1]?.trim()
    if (title) return toolAddTask(userId, { title })
  }
  return "I can answer:\n· What's on today?\n· My balance\n· Add task: [name]\n\nOr set up an Anthropic API key in Supabase secrets for full AI responses."
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

  await reply(chatId, "✅ *Connected!* Your Telegram is now linked to Professor.\n\nTry: _What's on today?_ or _My balance_")
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
