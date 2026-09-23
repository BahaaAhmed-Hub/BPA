import Anthropic from '@anthropic-ai/sdk'
import type { DbUser, DbCompany, DbTask, DbCalendarEvent, DbWeeklyReview } from '@/types/database'
import type { AIConfig } from '@/modules/settings/Settings'

// ─── Client ──────────────────────────────────────────────────────────────────

// ─── The key is the person's, and it is never in the bundle ──────────────────
// `VITE_ANTHROPIC_API_KEY` was read at build time, which means Vite inlines it
// into a JavaScript file served to everyone who opens the page — a public
// GitHub Pages site. A key in a client bundle is not a secret, whatever the
// variable is called, and `dangerouslyAllowBrowser` is the SDK saying so.
//
// The app was already able to do this properly: Settings → AI takes a key and
// keeps it in `professor-ai-config`, on that browser and nowhere else. The
// build-time value was only ever a fallback, so removing it leaves one way of
// answering the question instead of two.
//
// There is no module-level client any more either — one built at import time
// would capture whatever the config said then, and the key is a thing the
// person can change while the app is open.
export function anthropicKey(): string {
  return getAIConfig().anthropicKey
}

function anthropic(): Anthropic {
  const apiKey = anthropicKey()
  if (!apiKey) throw new ProfessorError(
    'No Anthropic API key. Go to Settings → AI and enter one, or switch to Groq.',
    'config_error',
  )
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4000

// ─── AI config helpers ────────────────────────────────────────────────────────

function getAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem('professor-ai-config')
    const saved = raw ? JSON.parse(raw) as Partial<AIConfig> : {}
    return {
      provider: saved.provider ?? 'anthropic',
      anthropicKey: saved.anthropicKey ?? '',
      groqKey: saved.groqKey ?? '',
      groqModel: saved.groqModel ?? 'llama-3.3-70b-versatile',
    }
  } catch {
    return { provider: 'anthropic', anthropicKey: '', groqKey: '', groqModel: 'llama-3.3-70b-versatile' }
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

// ─── Slot plan types ─────────────────────────────────────────────────────────

export type BlockType   = 'focus' | 'meeting' | 'buffer' | 'break' | 'task' | 'admin'
export type BlockAction = 'create' | 'keep' | 'reschedule' | 'remove'

export interface PlanSlot {
  id: string
  title: string
  startTime: string         // "HH:MM"
  endTime: string           // "HH:MM"
  type: BlockType
  action: BlockAction
  company?: string          // company slug/name — used to resolve target calendar
  taskId?: string           // linked task ID if this block covers a task
  existingEventId?: string  // Google event ID if this is an existing event
  isExisting: boolean
  note?: string             // AI reasoning shown in review phase
}

export interface SlotPlanPriorityTask {
  id: string
  title: string
  company?: string
  dueDate?: string
}

export interface SlotPlanPrefs {
  priorityTasks: SlotPlanPriorityTask[]         // tasks user flagged as today's priorities
  deepWorkPref: 'morning' | 'afternoon' | 'flexible'
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
  // `?? {}`: the column is nullable, and `Object.entries(null)` throws — which
  // would take down every AI feature in the app for a user whose row has no
  // rules, not just the one being asked for.
  const rules = (user.schedule_rules ?? {}) as Record<string, string | number | boolean | string[]>

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

export async function call(system: string, userMessage: string): Promise<string> {
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
  const apiKey = aiCfg.anthropicKey
  if (!apiKey) throw new ProfessorError(
    'Anthropic API key not set. Go to Settings → AI and enter your key, or switch to Groq (free).',
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

// ─── generateSlotPlan ────────────────────────────────────────────────────────

export async function generateSlotPlan(
  context: DayContext,
  prefs: SlotPlanPrefs,
): Promise<PlanSlot[]> {
  const system = baseSystem(context.user, context.companies) + `

TASK: Build a structured, time-blocked day plan for ${context.date}.

Rules:
1. Never overlap with existing calendar events (those are fixed unless action=reschedule).
2. Respect schedule rules: buffer_minutes between blocks, focus_hours window, max_meetings_per_day.
3. Insert 5–15 min buffer blocks between deep work sessions.
4. Suggest rescheduling an existing event only if it conflicts with a critical task or the user's preference.
5. Mark existing events as action "keep" unless there is a clear reason to reschedule or remove.
6. The workday ends at 18:00 unless context says otherwise.

Return ONLY a JSON array — no prose, no wrapping object:
[
  {
    "id": "unique-kebab-id",
    "title": "...",
    "startTime": "HH:MM",
    "endTime": "HH:MM",
    "type": "focus|meeting|buffer|break|task|admin",
    "action": "create|keep|reschedule|remove",
    "company": "company name or omit",
    "taskId": "task id or omit",
    "existingEventId": "google event id or omit",
    "isExisting": true or false,
    "note": "one-sentence reasoning"
  }
]`

  // Convert ISO timestamp to local HH:MM (handles both offset and Z-suffix UTC)
  const toLocalHHMM = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    } catch { return iso.slice(11, 16) }
  }

  const existingEvents = context.todayEvents.length
    ? context.todayEvents
        .map(e => `  [FIXED id=${e.google_event_id ?? e.id}] ${toLocalHHMM(e.start_time)}–${toLocalHHMM(e.end_time)}: ${e.title}`)
        .join('\n')
    : '  (no calendar events today — entire day is free to fill)'

  const tasks = context.pendingTasks
    .slice(0, 20)
    .map(t => `  [id=${t.id} quad=${t.quadrant ?? 'unset'}${t.company_id ? ` co=${t.company_id}` : ''}] ${t.title}${t.due_date ? ` (due ${t.due_date})` : ''}`)
    .join('\n') || '  (no pending tasks)'

  const priorityBlock = prefs.priorityTasks.length
    ? `Today's priority tasks (user-selected, schedule these first):\n${
        prefs.priorityTasks.map(t =>
          `  - [id=${t.id}] "${t.title}"${t.company ? ` (${t.company})` : ''}${t.dueDate ? ` — due ${t.dueDate}` : ''}`
        ).join('\n')}`
    : ''

  const userMsg = [
    `Today's FIXED calendar events (do NOT overlap these):\n${existingEvents}`,
    `All pending tasks:\n${tasks}`,
    priorityBlock,
    context.energyLevel ? `Energy level this morning: ${context.energyLevel}/5` : '',
    `Deep work preference: ${prefs.deepWorkPref}`,
  ].filter(Boolean).join('\n\n')

  try {
    const raw     = await call(system, userMsg)
    const parsed  = parseJson<PlanSlot[]>(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(s =>
      s.id && s.title && s.startTime && s.endTime && s.type && s.action
    )
  } catch (err) {
    if (err instanceof ProfessorError) throw err
    throw new ProfessorError('Failed to generate slot plan', 'parse_error', err)
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

  const apiKey = anthropicKey()
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
    const msg = await anthropic().messages.create({
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

// ─── briefInbox ──────────────────────────────────────────────────────────────
// One call for the whole card, not one per message. A morning inbox is six or
// eight threads; six round trips is six times the latency and six times the
// spend, for an answer that is better when the model can see them together —
// it can tell the invitation from the thread the invitation is about.

export type MailAction = 'reply' | 'schedule' | 'decide' | 'read'

export const MAIL_ACTIONS: MailAction[] = ['reply', 'schedule', 'decide', 'read']

export interface InboxBrief {
  /** The id the caller passed in, so a batch can be matched back to its rows. */
  id: string
  /** What the message is, in one line. This replaces its first 140 characters. */
  summary: string
  /** What it wants. `read` is the only one that wants nothing. */
  action: MailAction
  /** A reply ready to send, when the message asks for one. Empty otherwise. */
  draft: string
}

export interface InboxMessage {
  id: string
  fromName: string
  fromEmail: string
  subject: string
  receivedAt: string
  /** Whether it was addressed to the reader rather than copied to them. */
  addressedToMe: boolean
  body: string
}

/** As much of a message as is worth sending — the ask is nearly always at the
 *  top, and a quoted thread underneath it is mostly the reader's own words. */
const BODY_CHARS = 1400

export async function briefInbox(
  input: UserContext & { me: string; messages: InboxMessage[] },
): Promise<InboxBrief[]> {
  if (input.messages.length === 0) return []

  const system = baseSystem(input.user, input.companies) + `

TASK: Read the unread messages below and, for each one, say what it is and what
it wants. Where it wants an answer from ${input.user.full_name ?? input.me},
write that answer — ready to send, not a template.

Return ONLY a valid JSON array, one object per message, in the order given:
[{"id":"<the id given>","summary":"...","action":"reply|schedule|decide|read","draft":"..."}]

summary — ONE sentence, under 130 characters, in the third person: what the
  sender is saying or asking. Name the specific thing (a date, a figure, a
  document) rather than describing the message. Never "this email is about".
action — "reply" when it asks something answerable in words; "schedule" when it
  proposes or asks for a time; "decide" when it needs a call only the reader can
  make; "read" when it is information and wants nothing back.
draft — for "reply" and "schedule", the full reply body: greeting, answer, sign
  off as ${input.user.full_name ?? 'the reader'}. Plain text, short (under 90
  words), in the reader's register — direct, warm, no corporate padding, no
  placeholders like [name] or [date]. If a fact is genuinely missing, ask for it
  in the reply rather than inventing it. For "decide" give the reply that states
  the decision the reader most likely wants, so it can be edited rather than
  written. For "read" use an empty string.
Never invent an attachment, a figure, a commitment or a meeting that is not in
the message.`

  const userMsg = input.messages.map((m, i) => [
    `--- MESSAGE ${i + 1} (id: ${m.id}) ---`,
    `From: ${m.fromName} <${m.fromEmail}>`,
    `Subject: ${m.subject}`,
    `Received: ${m.receivedAt}`,
    m.addressedToMe ? 'Addressed directly to the reader.' : 'The reader is copied, not addressed.',
    '',
    m.body.replace(/\s+\n/g, '\n').trim().slice(0, BODY_CHARS),
  ].join('\n')).join('\n\n')

  const raw = await call(system, `The reader is ${input.me}.\n\n${userMsg}`)
  const parsed = parseJson<InboxBrief[]>(raw)
  if (!Array.isArray(parsed)) {
    throw new ProfessorError('The inbox brief came back in a shape we could not read', 'parse_error')
  }

  // Only what was asked for, and only for messages that were actually sent.
  const known = new Set(input.messages.map(m => m.id))
  return parsed
    .filter(b => b && typeof b.id === 'string' && known.has(b.id))
    .map(b => ({
      id: b.id,
      summary: typeof b.summary === 'string' ? b.summary.trim() : '',
      action: MAIL_ACTIONS.includes(b.action) ? b.action : 'read',
      draft: typeof b.draft === 'string' ? b.draft.trim() : '',
    }))
}

// ─── Triage for the smart mail view ──────────────────────────────────────────
//
//  The deterministic half of the smart view — who a thread is addressed to,
//  whether you have replied, how long it has been sitting — is worked out from
//  the thread itself in `mailSmart.ts` and never asked here. What is left is
//  the part only reading the words can answer, and it is exactly three things:
//
//    direct  — is a deliverable, a decision or an answer actually attributed to
//              the reader in this thread? Being on the To line is already known;
//              this is the softer case the headers cannot see, including a
//              meeting recap that assigns them an action.
//    need    — one line saying what is wanted from them. Not a summary of the
//              message: the thing they have to do.
//    draft   — the reply, where a reply is what is needed.
//
//  It is asked **only about threads whose newest message has not been read
//  before**, so a tab reopened with no new mail costs nothing at all.

export interface TriageInput {
  id: string
  subject: string
  fromName: string
  fromEmail: string
  receivedAt: string
  /** Already known from the headers; given so the model does not contradict it. */
  addressedToMe: boolean
  replyState: 'replied' | 'pending' | 'none'
  body: string
}

export interface TriageResult {
  id: string
  direct: boolean
  need: string
  draft: string
}

export async function triageMail(
  input: UserContext & { me: string; threads: TriageInput[] },
): Promise<TriageResult[]> {
  if (input.threads.length === 0) return []
  const name = input.user.full_name ?? input.me

  const system = baseSystem(input.user, input.companies) + `

TASK: These are business email threads. For each one decide whether ${name} personally
owes something, say in one line what is wanted from them, and where that is a reply,
write it.

Return ONLY a valid JSON array, one object per thread, in the order given:
[{"id":"<the id given>","direct":true|false,"need":"...","draft":"..."}]

direct — true only when a specific deliverable, decision, answer or action is
  attributed to ${name} in this thread: asked of them by name, assigned to them in
  a meeting recap, or someone stating they are waiting on them. Being merely
  copied, informed, thanked or included in a group update is false. When in doubt,
  false — a list that flags everything is a list nobody reads.
need — ONE line, under 110 characters, naming the thing to be done and by when if a
  date is given: "Confirm the October figure", "Approve the revised scope by Friday".
  Not a description of the email. Where nothing is owed, say what the thread is
  waiting on instead: "Awaiting their confirmation".
draft — the reply body when a written answer is what is needed, otherwise an empty
  string. Plain text, under 90 words, signed off as ${name}. No placeholders like
  [name] or [date]: where a fact is missing, ask for it in the reply rather than
  inventing it.

Write plainly. No enthusiasm, no filler, no "I hope this finds you well". Never
invent a figure, an attachment, a commitment or a date that is not in the thread.`

  const userMsg = input.threads.map((t, i) => [
    `--- THREAD ${i + 1} (id: ${t.id}) ---`,
    `From: ${t.fromName} <${t.fromEmail}>`,
    `Subject: ${t.subject}`,
    `Latest message: ${t.receivedAt}`,
    t.addressedToMe ? 'The reader is on the To line.' : 'The reader is copied, not addressed.',
    t.replyState === 'none' ? 'The reader has never written in this thread.'
      : t.replyState === 'pending' ? 'The reader replied, and the other side has written since.'
      : 'The reader wrote the most recent message.',
    '',
    t.body.replace(/\s+\n/g, '\n').trim().slice(0, BODY_CHARS),
  ].join('\n')).join('\n\n')

  const raw = await call(system, `The reader is ${name} <${input.me}>.\n\n${userMsg}`)
  const parsed = parseJson<TriageResult[]>(raw)
  if (!Array.isArray(parsed)) {
    throw new ProfessorError('The mail triage came back in a shape we could not read', 'parse_error')
  }
  const known = new Set(input.threads.map(t => t.id))
  return parsed
    .filter(r => r && typeof r.id === 'string' && known.has(r.id))
    .map(r => ({
      id: r.id,
      direct: r.direct === true,
      need: typeof r.need === 'string' ? r.need.trim() : '',
      draft: typeof r.draft === 'string' ? r.draft.trim() : '',
    }))
}
