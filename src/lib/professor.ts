import Anthropic from '@anthropic-ai/sdk'
import type { DbUser, DbCompany, DbTask, DbCalendarEvent, DbWeeklyReview } from '@/types/database'
import type { AIConfig } from '@/modules/settings/Settings'

// ─── Client ──────────────────────────────────────────────────────────────────

const client = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY ?? '',
  dangerouslyAllowBrowser: true,
})

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4000

// ─── AI config helpers ────────────────────────────────────────────────────────

function getAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem('professor-ai-config')
    const saved = raw ? JSON.parse(raw) as Partial<AIConfig> : {}
    return {
      provider: saved.provider ?? 'anthropic',
      anthropicKey: saved.anthropicKey ?? import.meta.env.VITE_ANTHROPIC_API_KEY ?? '',
      groqKey: saved.groqKey ?? '',
      groqModel: saved.groqModel ?? 'llama-3.3-70b-versatile',
    }
  } catch {
    return { provider: 'anthropic', anthropicKey: import.meta.env.VITE_ANTHROPIC_API_KEY ?? '', groqKey: '', groqModel: 'llama-3.3-70b-versatile' }
  }
}

async function callGroq(apiKey: string, model: string, system: string, userMessage: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: userMessage },
      ],
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new ProfessorError(`Groq API error ${res.status}: ${errText}`, 'api_error')
  }
  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices[0]?.message?.content?.trim() ?? ''
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class ProfessorError extends Error {
  readonly code: 'api_error' | 'parse_error' | 'config_error'
  readonly cause?: unknown

  constructor(
    message: string,
    code: 'api_error' | 'parse_error' | 'config_error',
    cause?: unknown,
  ) {
    super(message)
    this.name = 'ProfessorError'
    this.code = code
    this.cause = cause
  }
}

// ─── Input types ─────────────────────────────────────────────────────────────

export interface UserContext {
  user: DbUser
  companies: DbCompany[]
}

export interface DayContext extends UserContext {
  todayEvents: DbCalendarEvent[]
  pendingTasks: DbTask[]
  energyLevel?: number   // 1-5 from this morning's log
  date: string           // "YYYY-MM-DD"
}

export interface EmailData extends UserContext {
  subject: string
  fromEmail: string
  body: string
  receivedAt: string
}

export interface CalEvent extends UserContext {
  event: DbCalendarEvent
  relatedTasks?: DbTask[]
}

export interface WeekData extends UserContext {
  review: DbWeeklyReview
  completedTasks: DbTask[]
  habits: { name: string; streak: number; completedThisWeek: number; target: number }[]
}

// ─── Output types ────────────────────────────────────────────────────────────

export interface DayPlan {
  schedule: { time: string; activity: string; company?: string }[]
  top3: string[]
  focusTip: string
}

export interface EmailTriage {
  classification: 'decision' | 'fyi' | 'waiting' | 'delegate'
  suggestedReply: string
  followUpDate?: string
  urgency: 'high' | 'medium' | 'low'
}

export interface MeetingPrep {
  contextSummary: string
  talkingPoints: string[]
  goal: string
}

// ─── System prompt builder ───────────────────────────────────────────────────

function baseSystem(user: DbUser, companies: DbCompany[]): string {
  const rules = user.schedule_rules as Record<string, string | number | boolean | string[]>

  const companyList = companies
    .filter(c => c.is_active)
    .map(c => `  • ${c.name}${c.color_tag ? ` (${c.color_tag})` : ''}`)
    .join('\n')

  const ruleLines = Object.entries(rules)
    .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n')

  return `You are The Professor — a premium AI executive productivity assistant.
Your tone is authoritative, warm, concise, and always actionable.
Never invent facts. If context is missing, say so briefly.

USER PROFILE
  Name: ${user.full_name ?? user.email}
  Active framework: ${user.active_framework}

COMPANIES / CONTEXTS
${companyList || '  (none configured)'}

SCHEDULE RULES
${ruleLines || '  (none configured)'}`
}

// ─── Core call helper ────────────────────────────────────────────────────────

async function call(system: string, userMessage: string): Promise<string> {
  const aiCfg = getAIConfig()
  console.log('[AI] provider:', aiCfg.provider, '| groqKey set:', !!aiCfg.groqKey, '| anthropicKey set:', !!aiCfg.anthropicKey)

  if (aiCfg.provider === 'groq') {
    if (!aiCfg.groqKey) throw new ProfessorError(
      'Groq API key not set. Go to Settings → Professor AI and enter your key (free at console.groq.com).',
      'config_error',
    )
    try {
      return await callGroq(aiCfg.groqKey, aiCfg.groqModel, system, userMessage)
    } catch (err) {
      if (err instanceof ProfessorError) throw err
      throw new ProfessorError(`Groq request failed: ${err instanceof Error ? err.message : String(err)}`, 'api_error', err)
    }
  }

  // Anthropic
  const apiKey = aiCfg.anthropicKey || (import.meta.env.VITE_ANTHROPIC_API_KEY ?? '')
  if (!apiKey) throw new ProfessorError(
    'Anthropic API key not set. Go to Settings → Professor AI and enter your key, or switch to Groq (free).',
    'config_error',
  )
  try {
    const freshClient = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    const msg = await freshClient.messages.create({
      model: MODEL, max_tokens: MAX_TOKENS, system,
      messages: [{ role: 'user', content: userMessage }],
    })
    const block = msg.content.find(b => b.type === 'text')
    return block?.type === 'text' ? block.text.trim() : ''
  } catch (err) {
    if (err instanceof ProfessorError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    const is401 = msg.includes('401') || msg.includes('authentication_error') || msg.includes('invalid x-api-key')
    if (is401) throw new ProfessorError('Invalid Anthropic API key. Check Settings → Professor AI.', 'config_error')
    throw new ProfessorError(`Anthropic request failed: ${msg}`, 'api_error', err)
  }
}

/** Parse JSON from a response that may wrap it in a fenced code block. */
function parseJson<T>(raw: string): T | null {
  try {
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    return JSON.parse(stripped) as T
  } catch {
    return null
  }
}

// ─── planMyDay ───────────────────────────────────────────────────────────────

export async function planMyDay(context: DayContext): Promise<DayPlan> {
  const system = baseSystem(context.user, context.companies) + `

TASK: Build an optimised day plan for ${context.date}.
Return ONLY valid JSON matching this shape — no prose:
{
  "schedule": [{ "time": "HH:MM", "activity": "...", "company": "..." }],
  "top3": ["task 1", "task 2", "task 3"],
  "focusTip": "one actionable sentence"
}`

  const events = context.todayEvents
    .map(e => `  ${e.start_time} – ${e.end_time}: ${e.title}`)
    .join('\n') || '  (no meetings)'

  const tasks = context.pendingTasks
    .slice(0, 20)
    .map(t => `  [${t.quadrant ?? 'unset'}] ${t.title}${t.due_date ? ` (due ${t.due_date})` : ''}`)
    .join('\n') || '  (no pending tasks)'

  const userMsg = [
    `Today's calendar:\n${events}`,
    `Pending tasks:\n${tasks}`,
    context.energyLevel ? `Morning energy level: ${context.energyLevel}/5` : '',
  ].filter(Boolean).join('\n\n')

  try {
    const raw = await call(system, userMsg)
    const parsed = parseJson<DayPlan>(raw)
    if (!parsed || !Array.isArray(parsed.schedule) || !Array.isArray(parsed.top3)) {
      return { schedule: [], top3: [], focusTip: '' }
    }
    return parsed
  } catch (err) {
    if (err instanceof ProfessorError) throw err
    throw new ProfessorError('Failed to plan day', 'parse_error', err)
  }
}

// ─── triageEmail ─────────────────────────────────────────────────────────────

const EMAIL_CLASSIFICATIONS = ['decision', 'fyi', 'waiting', 'delegate'] as const
const URGENCIES = ['high', 'medium', 'low'] as const

export async function triageEmail(email: EmailData): Promise<EmailTriage> {
  const system = baseSystem(email.user, email.companies) + `

TASK: Triage this email for a busy executive.
Return ONLY valid JSON — no prose:
{
  "classification": "decision|fyi|waiting|delegate",
  "suggestedReply": "ready-to-send reply (or empty string if none needed)",
  "followUpDate": "YYYY-MM-DD or omit if not applicable",
  "urgency": "high|medium|low"
}`

  const userMsg = `From: ${email.fromEmail}
Subject: ${email.subject}
Received: ${email.receivedAt}

${email.body}`

  try {
    const raw = await call(system, userMsg)
    const parsed = parseJson<EmailTriage>(raw)
    if (
      !parsed ||
      !EMAIL_CLASSIFICATIONS.includes(parsed.classification) ||
      !URGENCIES.includes(parsed.urgency)
    ) {
      return {
        classification: 'fyi',
        suggestedReply: '',
        urgency: 'low',
      }
    }
    return parsed
  } catch (err) {
    if (err instanceof ProfessorError) throw err
    throw new ProfessorError('Failed to triage email', 'parse_error', err)
  }
}

// ─── generateMeetingPrep ─────────────────────────────────────────────────────

export async function generateMeetingPrep(input: CalEvent): Promise<MeetingPrep> {
  const system = baseSystem(input.user, input.companies) + `

TASK: Generate concise meeting preparation for the event below.
Return ONLY valid JSON — no prose:
{
  "contextSummary": "2-3 sentence background",
  "talkingPoints": ["point 1", "point 2", "point 3"],
  "goal": "single clear outcome sentence"
}`

  const { event } = input
  const tasks = (input.relatedTasks ?? [])
    .map(t => `  • ${t.title}`)
    .join('\n')

  const userMsg = [
    `Meeting: ${event.title}`,
    `Time: ${event.start_time} – ${event.end_time}`,
    event.location ? `Location: ${event.location}` : '',
    event.meeting_type ? `Type: ${event.meeting_type}` : '',
    tasks ? `Related tasks:\n${tasks}` : '',
  ].filter(Boolean).join('\n')

  try {
    const raw = await call(system, userMsg)
    const parsed = parseJson<MeetingPrep>(raw)
    if (!parsed || !Array.isArray(parsed.talkingPoints)) {
      return { contextSummary: '', talkingPoints: [], goal: '' }
    }
    return parsed
  } catch (err) {
    if (err instanceof ProfessorError) throw err
    throw new ProfessorError('Failed to generate meeting prep', 'parse_error', err)
  }
}

// ─── weeklyInsight ───────────────────────────────────────────────────────────

export async function weeklyInsight(review: WeekData): Promise<string> {
  const system = baseSystem(review.user, review.companies) + `

TASK: Write a short weekly performance insight (3-5 sentences) for the executive.
Be direct, honest, and forward-looking. Plain text — no JSON, no markdown headers.`

  const { review: r } = review
  const habits = review.habits
    .map(h => `  ${h.name}: ${h.completedThisWeek}/${h.target} (streak ${h.streak})`)
    .join('\n')

  const userMsg = [
    `Week of: ${r.week_of}`,
    `Tasks shipped: ${r.shipped_count ?? 0}  Slipped: ${r.slipped_count ?? 0}`,
    `Focus hours: ${r.focus_hours ?? 0}  Meeting hours: ${r.meeting_hours ?? 0}`,
    habits ? `Habit performance:\n${habits}` : '',
    review.completedTasks.length
      ? `Completed tasks:\n${review.completedTasks.slice(0, 10).map(t => `  • ${t.title}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n')

  try {
    return await call(system, userMsg)
  } catch (err) {
    if (err instanceof ProfessorError) throw err
    throw new ProfessorError('Failed to generate weekly insight', 'api_error', err)
  }
}

// ─── checkTaskLoad ───────────────────────────────────────────────────────────

/** Returns a warning string if overloaded, null if load looks healthy. */
export async function checkTaskLoad(tasks: DbTask[]): Promise<string | null> {
  if (tasks.length === 0) return null

  // Quick heuristic — only call AI if load is potentially problematic
  const urgent = tasks.filter(
    t => t.quadrant === 'urgent_important' && t.status !== 'done',
  ).length

  if (urgent < 5) return null

  const system = `You are The Professor, an executive productivity assistant.
Evaluate the task list below and return ONE short sentence (max 20 words)
warning the executive if they are overloaded, or return exactly the string "OK" if load is fine.`

  const userMsg = tasks
    .slice(0, 30)
    .map(t => `[${t.quadrant ?? 'unset'}][${t.status}] ${t.title}`)
    .join('\n')

  try {
    const result = await call(system, userMsg)
    return result === 'OK' ? null : result
  } catch {
    // Non-critical — swallow and return null gracefully
    return null
  }
}

// ─── chat ────────────────────────────────────────────────────────────────────

export async function chat(message: string, ctx: UserContext): Promise<string> {
  const system = baseSystem(ctx.user, ctx.companies) + `

Answer the executive's question or request below concisely and helpfully.
If the question is outside your role as a productivity assistant, politely say so.`

  try {
    return await call(system, message)
  } catch (err) {
    if (err instanceof ProfessorError) throw err
    throw new ProfessorError('Chat request failed', 'api_error', err)
  }
}

// ─── analyzeTask ─────────────────────────────────────────────────────────────

export interface TaskAnalysis {
  icon: string | null
  companyId: string | null
  ownerId: string | null
  quadrant: 'do' | 'schedule' | 'delegate' | 'eliminate' | null
  assignToMe: boolean
  titleWithIcon: string
}

interface AnalysisCompany {
  id: string
  name: string
  users?: { id: string; name: string }[]
}

export async function analyzeTask(
  title: string,
  companies: AnalysisCompany[],
): Promise<TaskAnalysis> {
  const fallback: TaskAnalysis = {
    icon: null, companyId: null, ownerId: null, quadrant: null,
    assignToMe: true, titleWithIcon: title,
  }
  if (!title.trim()) return fallback

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY ?? ''
  if (!apiKey) return fallback

  const companyList = companies.map(c => ({
    id: c.id, name: c.name,
    users: (c.users ?? []).map(u => ({ id: u.id, name: u.name })),
  }))

  const system = `You are an AI task intelligence assistant. Analyze a task title and return structured JSON.

Return ONLY valid JSON with this exact shape:
{
  "icon": "emoji or null",
  "companyId": "matching company id or null",
  "ownerId": "matching user id from a company's users list or null",
  "quadrant": "do|schedule|delegate|eliminate or null",
  "assignToMe": true or false,
  "titleWithIcon": "title prefixed with icon if icon is set, else original title"
}

Rules:
- icon: 📞 for calls/ring/call with, ✅ for follow-up/followup/check in, 🔨 for build/develop/implement/code, 📝 for write/draft/document/report, 📊 for review/analyze/data, 💬 for discuss/meeting/sync/chat, 🔍 for research/investigate/look into, null if none match
- companyId: detect company name in title (case-insensitive partial match)
- ownerId: if a person's name is in the title and they exist in a company's users list
- quadrant: "do" if urgent/ASAP/today/critical, "schedule" if has future date/plan/research, "delegate" if "ask/tell/send to [person]", "eliminate" if maybe/someday/consider, null if unclear
- assignToMe: false if delegating to someone else, true otherwise
- titleWithIcon: prepend icon + space to title if icon is set`

  const userMsg = `Task title: "${title}"

Available companies and users:
${JSON.stringify(companyList, null, 2)}`

  try {
    const raw = await call(system, userMsg)
    const parsed = parseJson<TaskAnalysis>(raw)
    if (!parsed || typeof parsed.assignToMe !== 'boolean') return fallback
    return parsed
  } catch {
    return fallback
  }
}

// ─── breakdownMeetingNotes ────────────────────────────────────────────────────

export interface ExtractedTask {
  title: string
  quadrant: 'do' | 'schedule' | 'delegate' | 'eliminate' | null
  dueDate?: string
  ownerName?: string
}

export async function breakdownMeetingNotes(
  notes: string,
  parentTitle: string,
  companies: AnalysisCompany[],
): Promise<ExtractedTask[]> {
  if (!notes.trim()) return []

  const companyList = companies.map(c => ({
    id: c.id, name: c.name,
    users: (c.users ?? []).map(u => ({ id: u.id, name: u.name })),
  }))

  const system = `You are an AI task extraction assistant. Given meeting notes or raw action items, extract clear actionable tasks.

Return ONLY a valid JSON array (max 10 items):
[
  {
    "title": "task title with emoji prefix",
    "quadrant": "do|schedule|delegate|eliminate or null",
    "dueDate": "YYYY-MM-DD or omit if none",
    "ownerName": "first name of person responsible if mentioned, or omit"
  }
]

Rules:
- Extract only clear action items (not observations or context)
- Emoji prefix: ✅ follow-up/check, 📝 write/draft/document, 📞 call someone, 📊 review/analyze, 🔨 build/implement/fix, 💬 discuss/meet, 📧 email/send, 🔍 research/investigate
- quadrant: "do" if urgent/ASAP/today, "schedule" if specific future date, "delegate" if for someone else, null if unclear
- ownerName: only if explicitly delegated to a named person`

  const userMsg = `Meeting: "${parentTitle}"

Notes / action items:
${notes}

Available team members:
${JSON.stringify(companyList, null, 2)}`

  const raw = await call(system, userMsg)
  const parsed = parseJson<ExtractedTask[]>(raw)
  if (!Array.isArray(parsed)) {
    throw new ProfessorError(`Could not parse AI response. Raw: ${raw.slice(0, 200)}`, 'parse_error')
  }
  return parsed.filter(t => typeof t.title === 'string' && t.title.trim())
}

// ─── Legacy export (backwards compat with existing UI) ───────────────────────

export interface ProfessorMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function askProfessor(
  messages: ProfessorMessage[],
  systemContext?: string,
): Promise<string> {
  const system = `You are The Professor — a premium AI executive productivity assistant.
Your tone is authoritative yet warm, concise, and always actionable.
${systemContext ?? ''}`

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    })
    const block = msg.content.find(b => b.type === 'text')
    return block?.type === 'text' ? block.text : ''
  } catch (err) {
    throw new ProfessorError('askProfessor failed', 'api_error', err)
  }
}
