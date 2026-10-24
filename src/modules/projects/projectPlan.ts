import { call, ProfessorError } from '@/lib/professor'
import type { Priority } from '@/types'
import type { ProjectKind } from './types'

// ─── A plan is a draft until somebody presses Add ────────────────────────────
// Everything here produces a `Draft` — milestones and tasks that do not exist
// yet. Nothing in this file writes to a store. The planner dialog shows the draft,
// lets each row be unticked, renamed or re-dated, and only then writes what is
// left. A model's answer is untrusted input: it is parsed, validated and capped
// (`normalizeDraft`) before a person ever sees it, and a person sees it before
// anything exists.

export interface DraftMilestone { key: string; title: string; dueDate?: string }
export interface DraftTask {
  key: string; title: string
  /** `DraftMilestone.key` of the phase it belongs to. */
  milestoneKey?: string
  dueDate?: string
  priority?: Priority
}
export interface Draft { milestones: DraftMilestone[]; tasks: DraftTask[] }

export const MAX_MILESTONES = 8
export const MAX_TASKS = 24
const MAX_TITLE = 120

const ISO = /^\d{4}-\d{2}-\d{2}$/
const validDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !ISO.test(s)) return false
  const d = new Date(s + 'T12:00:00Z')
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 864e5)
const cleanTitle = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : '')

// ─── Templates ───────────────────────────────────────────────────────────────

interface TemplateMilestone { title: string; day: number }
interface TemplateTask { title: string; phase: number }
export interface PlanTemplate {
  id: string; name: string; blurb: string; kind: ProjectKind | 'any'
  milestones: TemplateMilestone[]; tasks: TemplateTask[]
}

export const TEMPLATES: PlanTemplate[] = [
  { id: 'launch', name: 'Launch something', blurb: 'A site, a product or a campaign, from brief to launch day.', kind: 'work',
    milestones: [{ title: 'Brief signed off', day: 7 }, { title: 'Build complete', day: 30 }, { title: 'Beta with real users', day: 40 }, { title: 'Launch', day: 50 }],
    tasks: [
      { title: 'Write the one-page brief', phase: 0 }, { title: 'Agree what success looks like', phase: 0 }, { title: 'Get sign-off from the people who decide', phase: 0 },
      { title: 'Design the main screens', phase: 1 }, { title: 'Build the first working version', phase: 1 }, { title: 'Write the copy', phase: 1 },
      { title: 'Recruit five beta users', phase: 2 }, { title: 'Collect and sort their feedback', phase: 2 },
      { title: 'Fix what blocks launch', phase: 3 }, { title: 'Announce it', phase: 3 },
    ] },
  { id: 'trip', name: 'Plan a trip', blurb: 'Decide, book, plan the days and go.', kind: 'personal',
    milestones: [{ title: 'Destination and dates decided', day: 7 }, { title: 'Flights and stay booked', day: 21 }, { title: 'Days planned', day: 35 }, { title: 'Packed and ready', day: 45 }],
    tasks: [
      { title: 'Agree a budget', phase: 0 }, { title: 'Check passports and visas', phase: 0 },
      { title: 'Book flights', phase: 1 }, { title: 'Book somewhere to stay', phase: 1 },
      { title: 'List the things worth seeing', phase: 2 }, { title: 'Book anything that sells out', phase: 2 },
      { title: 'Sort travel insurance and money', phase: 3 }, { title: 'Pack', phase: 3 },
    ] },
  { id: 'renovation', name: 'Renovate a room', blurb: 'Scope it, get quotes, do the work, snag it.', kind: 'personal',
    milestones: [{ title: 'Scope and budget agreed', day: 7 }, { title: 'Quotes chosen', day: 21 }, { title: 'Work under way', day: 35 }, { title: 'Finished and snagged', day: 70 }],
    tasks: [
      { title: 'Measure the room and list what changes', phase: 0 }, { title: 'Set a budget with a buffer', phase: 0 },
      { title: 'Get three quotes', phase: 1 }, { title: 'Pick the contractor and agree dates', phase: 1 },
      { title: 'Order tiles, fittings and materials', phase: 2 }, { title: 'Check progress each week', phase: 2 },
      { title: 'Walk round and list what is not right', phase: 3 }, { title: 'Pay the final invoice once it is fixed', phase: 3 },
    ] },
  { id: 'learn', name: 'Learn a skill', blurb: 'Pick a path, build something, build something harder, show it.', kind: 'personal',
    milestones: [{ title: 'Path chosen', day: 3 }, { title: 'First project done', day: 30 }, { title: 'Second project done', day: 60 }, { title: 'Shown to someone', day: 90 }],
    tasks: [
      { title: 'Choose one course or book and stick to it', phase: 0 }, { title: 'Put practice in the calendar', phase: 0 },
      { title: 'Finish a small project end to end', phase: 1 }, { title: 'Write down what was hard', phase: 1 },
      { title: 'Start a harder project', phase: 2 }, { title: 'Ask someone better for feedback', phase: 2 },
      { title: 'Present or publish what you made', phase: 3 },
    ] },
  { id: 'move', name: 'Move house', blurb: 'From notice to the last box.', kind: 'personal',
    milestones: [{ title: 'Notice given and mover booked', day: 7 }, { title: 'Packing done', day: 28 }, { title: 'Moved', day: 35 }, { title: 'Settled in', day: 50 }],
    tasks: [
      { title: 'Give notice or confirm the sale', phase: 0 }, { title: 'Get quotes and book a mover', phase: 0 },
      { title: 'Sort what goes, what is sold, what is given away', phase: 1 }, { title: 'Pack room by room and label the boxes', phase: 1 },
      { title: 'Move utilities and change your address', phase: 2 }, { title: 'Do a final walk-through', phase: 2 },
      { title: 'Unpack the essentials first', phase: 3 },
    ] },
]

/** A template as a draft, with real dates. Offsets are days from `start`; when a
 *  target date is given they are stretched or squeezed so the last milestone lands
 *  on it — a six-week template for a three-week project is still a plan. A task's
 *  own date is two days before its phase's, never before the start. */
export function fromTemplate(t: PlanTemplate, start: string, target?: string): Draft {
  const last = Math.max(...t.milestones.map(m => m.day), 1)
  const span = target && validDate(target) && daysBetween(start, target) >= 1 ? daysBetween(start, target) : last
  const dayOf = (day: number) => addDays(start, Math.max(1, Math.round((day / last) * span)))
  const milestones = t.milestones.map((m, i) => ({ key: `m${i}`, title: m.title, dueDate: dayOf(m.day) }))
  const tasks = t.tasks.map((k, i) => {
    const m = milestones[k.phase]
    const due = m?.dueDate ? addDays(m.dueDate, -2) : undefined
    return { key: `t${i}`, title: k.title, milestoneKey: m?.key, dueDate: due && due >= start ? due : m?.dueDate }
  })
  return { milestones, tasks }
}

// ─── What a model said, made safe ────────────────────────────────────────────

const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3'])

/** Untrusted → draft. Anything that does not fit is dropped, not repaired: a
 *  milestone with no name, a date that is not a date, a phase that does not exist,
 *  a priority that is not one of ours, a second copy of a title, and anything
 *  past the caps. The model may be wrong; it may not be able to put nothing, or a
 *  hundred things, or a made-up date in front of a person as if it were a fact. */
export function normalizeDraft(raw: unknown): Draft {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as { milestones?: unknown; tasks?: unknown }
  const seen = new Set<string>()
  const milestones: DraftMilestone[] = []
  const rawMs = Array.isArray(obj.milestones) ? obj.milestones : []
  const keyOfRawIndex = new Map<number, string>()
  const keyOfTitle = new Map<string, string>()
  rawMs.forEach((m, i) => {
    if (milestones.length >= MAX_MILESTONES || !m || typeof m !== 'object') return
    const title = cleanTitle((m as { title?: unknown }).title)
    const id = title.toLowerCase()
    if (!title || seen.has('m:' + id)) return
    seen.add('m:' + id)
    const d = (m as { dueDate?: unknown }).dueDate
    const key = `m${milestones.length}`
    milestones.push({ key, title, ...(validDate(d) ? { dueDate: d } : {}) })
    keyOfRawIndex.set(i, key); keyOfTitle.set(id, key)
  })
  const tasks: DraftTask[] = []
  const rawTasks = Array.isArray(obj.tasks) ? obj.tasks : []
  for (const t of rawTasks) {
    if (tasks.length >= MAX_TASKS || !t || typeof t !== 'object') continue
    const title = cleanTitle((t as { title?: unknown }).title)
    const id = title.toLowerCase()
    if (!title || seen.has('t:' + id)) continue
    seen.add('t:' + id)
    const ph = (t as { milestone?: unknown }).milestone
    const milestoneKey = typeof ph === 'number' ? keyOfRawIndex.get(ph)
      : typeof ph === 'string' ? keyOfTitle.get(ph.trim().toLowerCase()) : undefined
    const d = (t as { dueDate?: unknown }).dueDate
    const p = (t as { priority?: unknown }).priority
    tasks.push({
      key: `t${tasks.length}`, title,
      ...(milestoneKey ? { milestoneKey } : {}),
      ...(validDate(d) ? { dueDate: d } : {}),
      ...(typeof p === 'string' && PRIORITIES.has(p) ? { priority: p as Priority } : {}),
    })
  }
  return { milestones, tasks }
}

const parseJson = (raw: string): unknown => {
  try { return JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()) } catch { return null }
}

export interface PlanContext { name: string; kind: ProjectKind; today: string; startDate?: string; targetDate?: string; notes?: string }

export function planPrompt(brief: string, ctx: PlanContext): { system: string; user: string } {
  const system = `You draft a project plan for a person's own planner. Return ONLY valid JSON, no prose:
{"milestones":[{"title":"short noun phrase","dueDate":"YYYY-MM-DD or omit"}],
 "tasks":[{"title":"verb-first action, under 70 characters","milestone":0,"dueDate":"YYYY-MM-DD or omit","priority":"P0|P1|P2|P3 or omit"}]}
Rules:
- At most ${MAX_MILESTONES} milestones, in date order, and at most ${MAX_TASKS} tasks. Fewer is better than padded.
- "milestone" is the 0-based index of the milestone a task belongs to, or omit it.
- Dates must lie between the project's start and target when those are given, and never before today.
- Tasks are concrete next actions someone could start on, not themes.
- Do not invent facts about the person. If the brief is thin, plan the general shape and keep it short.`
  const lines = [
    `Project: ${ctx.name} (${ctx.kind} project)`, `Today: ${ctx.today}`,
    ctx.startDate ? `Start: ${ctx.startDate}` : '', ctx.targetDate ? `Target: ${ctx.targetDate}` : 'No target date.',
    ctx.notes ? `Notes: ${ctx.notes}` : '', `What it is: ${brief.trim()}`,
  ].filter(Boolean)
  return { system, user: lines.join('\n') }
}

/** The model's draft, after validation. A reply that is not JSON, or that leaves
 *  nothing once validated, is an error with the reason — never a quietly empty plan. */
export async function draftWithAI(brief: string, ctx: PlanContext): Promise<Draft> {
  const { system, user } = planPrompt(brief, ctx)
  const raw = await call(system, user)
  const parsed = parseJson(raw)
  if (parsed === null) throw new ProfessorError('The AI did not answer in a form I could read. Try again, or start from a template.', 'parse_error')
  const draft = normalizeDraft(parsed)
  if (draft.milestones.length === 0 && draft.tasks.length === 0) throw new ProfessorError('The AI came back with nothing usable. Say a little more about the project, or start from a template.', 'parse_error')
  return draft
}

// ─── Dates for the tasks that have none ──────────────────────────────────────

export interface OpenTask { id: string; title: string; priority?: Priority; phase?: string }
export interface Proposal { id: string; dueDate: string }

/** Only ids that were asked about, only real dates inside [from, to], one per task. */
export function normalizeProposals(raw: unknown, asked: OpenTask[], from: string, to: string): Proposal[] {
  const known = new Set(asked.map(t => t.id))
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks) ? (raw as { tasks: unknown[] }).tasks : [])
  const out: Proposal[] = []
  const done = new Set<string>()
  for (const p of list) {
    if (!p || typeof p !== 'object') continue
    const id = (p as { id?: unknown }).id, d = (p as { dueDate?: unknown }).dueDate
    if (typeof id !== 'string' || !known.has(id) || done.has(id) || !validDate(d) || d < from || d > to) continue
    done.add(id); out.push({ id, dueDate: d })
  }
  return out
}

export function schedulePrompt(tasks: OpenTask[], ctx: { name: string; today: string; from: string; to: string }): { system: string; user: string } {
  const system = `You spread a project's undated tasks over a window of days. Return ONLY valid JSON, no prose:
[{"id":"the task id exactly as given","dueDate":"YYYY-MM-DD"}]
Rules:
- Use only the ids given. Skip a task rather than guess.
- Every date must be between ${ctx.from} and ${ctx.to} inclusive; weekends are fine only if nothing else fits.
- Higher priority (P0 before P3) goes earlier. Tasks in the same phase stay close together.
- No more than three tasks on one day.`
  const user = `Project: ${ctx.name}\nToday: ${ctx.today}\nWindow: ${ctx.from} to ${ctx.to}\nTasks:\n${tasks.map(t => `- ${t.id} | ${t.title}${t.priority ? ` | ${t.priority}` : ''}${t.phase ? ` | phase: ${t.phase}` : ''}`).join('\n')}`
  return { system, user }
}

export async function scheduleWithAI(tasks: OpenTask[], ctx: { name: string; today: string; from: string; to: string }): Promise<Proposal[]> {
  const { system, user } = schedulePrompt(tasks, ctx)
  const raw = await call(system, user)
  const parsed = parseJson(raw)
  if (parsed === null) throw new ProfessorError('The AI did not answer in a form I could read. Try again.', 'parse_error')
  const out = normalizeProposals(parsed, tasks, ctx.from, ctx.to)
  if (out.length === 0) throw new ProfessorError('The AI proposed no usable dates. Try again, or date them by hand.', 'parse_error')
  return out
}

export const todayISO = () => new Date().toLocaleDateString('en-CA')
export { addDays, daysBetween, validDate }
