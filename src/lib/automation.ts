// ─── The engine behind Settings → Automation ─────────────────────────────────
//
// The seven rules were written down, synced between devices, and read back by
// nothing. This is what reads them. It ticks once a minute while you are signed
// in, asks each enabled rule whether its moment has come, does the thing, and
// writes one line to a run log the settings page shows. Three limits it keeps:
//
// - **It never sends, deletes or moves money.** Drafting a reply fills the box
//   under the mail; archiving is a label Gmail can put back; a task dated today
//   is a task you can undo. Nothing here is outside what a tap could take back.
// - **Each rule runs once per moment.** A daily rule that fires at 06:40 fires
//   again tomorrow, not on every tick after 06:40; the record of the last run
//   is kept per rule in localStorage, so a reload does not re-run the morning.
// - **A tick is quiet when nothing applied.** The log holds what was done, not
//   that the clock was looked at.

import { useTaskStore } from '@/store/taskStore'
import { useAuthStore } from '@/store/authStore'
import { suppressUndo, notify } from '@/lib/undo'
import { isTaskHidden, type Task } from '@/types'
import type { DbTask } from '@/types/database'
import { suggestPlacement, suggestColumn } from '@/modules/tasks/BrainDumpRail'
import { writeMorningPlan, buildMockUser } from '@/modules/morning/dayPlan'
import { mailAccounts } from '@/modules/inbox/mailAccounts'
import {
  listUnreadThreadIds, getThread, header, extractBody, batchModify,
  type GmailMessage, type GmailPart,
} from '@/lib/gmail'
import { looksLikeBulk, classifyMail } from '@/lib/mailClasses'
import { briefsFor, cachedDraft } from '@/lib/mailBriefs'
import { weeklyInsight } from '@/lib/professor'
import { loadHabits, loadLogs, calcStreak } from '@/store/habitsStore'
import { mondayOf, todayLocal, wasReviewOpened, saveWeekInsight, loadWeekInsight } from '@/lib/weekReview'

// ─── The rules ───────────────────────────────────────────────────────────────

export interface AutomationRule {
  id: string
  action: string
  trigger: string
  enabled: boolean
}

export const DEFAULT_AUTOMATION_RULES: AutomationRule[] = [
  { id: 'morning-brief',    action: 'Write the morning brief',             trigger: 'every day at 06:40, before you wake',                        enabled: true  },
  { id: 'draft-replies',    action: 'Draft replies for NEEDS YOU mail',    trigger: 'a thread is marked needs-you and sits over 4 hours',          enabled: true  },
  { id: 'block-focus',      action: 'Block focus time for P0 tasks',       trigger: 'a P0 task has no calendar block by 09:00',                    enabled: true  },
  { id: 'distribute-dump',  action: 'Distribute the dump',                 trigger: 'the brain dump passes 12 tasks',                             enabled: false },
  { id: 'roll-forward',     action: 'Roll unfinished tasks forward',        trigger: 'a scheduled task ends the day untouched',                    enabled: true  },
  { id: 'archive-news',     action: 'Archive newsletters',                  trigger: 'a thread is promotional and nobody replied in 3 days',       enabled: true  },
  { id: 'close-week',       action: 'Close the week',                       trigger: 'Sunday 20:00, if the review has not been opened',            enabled: false },
]

const RULES_KEY = 'professor-automation-rules'
const LOG_KEY   = 'professor-automation-log'
const LAST_KEY  = 'professor-automation-last'
export const AUTOMATION_EVENT = 'professor:automationRan'

/** The saved switches over the defaults, so a rule added later still appears. */
export function loadAutomationRules(): AutomationRule[] {
  let saved: AutomationRule[] = []
  try { saved = JSON.parse(localStorage.getItem(RULES_KEY) ?? '[]') as AutomationRule[] } catch { /* defaults */ }
  return DEFAULT_AUTOMATION_RULES.map(d => {
    const s = saved.find(r => r.id === d.id)
    return s ? { ...d, enabled: s.enabled } : d
  })
}

export function saveAutomationRules(rules: AutomationRule[]): void {
  try { localStorage.setItem(RULES_KEY, JSON.stringify(rules)) } catch { /* quota */ }
}

// ─── The log ─────────────────────────────────────────────────────────────────

export interface RunEntry {
  at: string
  ruleId: string
  /** What was done, in a sentence. */
  text: string
  /** How many things it touched — 0 for a failure. */
  count: number
  ok: boolean
}

export function loadRunLog(): RunEntry[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as RunEntry[] } catch { return [] }
}

function log(ruleId: string, text: string, count: number, ok = true): void {
  const next = [{ at: new Date().toISOString(), ruleId, text, count, ok }, ...loadRunLog()].slice(0, 200)
  try { localStorage.setItem(LOG_KEY, JSON.stringify(next)) } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent(AUTOMATION_EVENT))
}

// ─── When a rule is due ──────────────────────────────────────────────────────

function lastRuns(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, string> } catch { return {} }
}

function markRan(ruleId: string): void {
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ ...lastRuns(), [ruleId]: new Date().toISOString() })) } catch { /* quota */ }
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Once a day, from `at` onwards. */
function dueDaily(ruleId: string, at: string, now: Date): boolean {
  if (now.getHours() * 60 + now.getMinutes() < minutesOf(at)) return false
  const last = lastRuns()[ruleId]
  return !last || todayLocal(new Date(last)) !== todayLocal(now)
}

/** Once a week, on `weekday` (0 = Sunday) from `at` onwards. */
function dueWeekly(ruleId: string, weekday: number, at: string, now: Date): boolean {
  if (now.getDay() !== weekday) return false
  if (now.getHours() * 60 + now.getMinutes() < minutesOf(at)) return false
  const last = lastRuns()[ruleId]
  return !last || mondayOf(todayLocal(new Date(last))) !== mondayOf(todayLocal(now))
}

/** Whenever the last run is older than `ms`. */
function dueEvery(ruleId: string, ms: number, now: Date): boolean {
  const last = lastRuns()[ruleId]
  return !last || now.getTime() - new Date(last).getTime() >= ms
}

// ─── Mail helpers ────────────────────────────────────────────────────────────

function* parts(p: GmailPart | GmailMessage['payload'] | undefined): Generator<GmailPart> {
  if (!p) return
  yield p as GmailPart
  for (const child of p.parts ?? []) yield* parts(child)
}

function carriesInvitation(msg: GmailMessage): boolean {
  for (const p of parts(msg.payload)) {
    if (/^text\/calendar/i.test(p.mimeType ?? '') || /\.ics$/i.test(p.filename ?? '')) return true
  }
  return false
}

function fromOf(msg: GmailMessage): { name: string; email: string } {
  const from = header(msg.payload?.headers ?? [], 'From')
  const email = from.match(/<(.+)>/)?.[1] ?? from
  const name = from.replace(/<.*>/, '').replace(/"/g, '').trim()
  return { name: name || email, email }
}

// ─── The rules themselves ────────────────────────────────────────────────────

type Ctx = {
  now: Date
  user: { id: string; email: string; name?: string; avatarUrl?: string }
  tasks: Task[]
  updateTask: (id: string, patch: Partial<Task>) => void
}

const HOUR = 3_600_000

async function morningBrief(c: Ctx): Promise<void> {
  const wrote = await writeMorningPlan(c.user, c.tasks)
  if (wrote) log('morning-brief', 'Wrote the morning brief', 1)
}

async function draftReplies(c: Ctx): Promise<void> {
  const me = c.user.email.toLowerCase()
  const rows: Parameters<typeof briefsFor>[0] = []
  for (const account of mailAccounts(c.user.email)) {
    let ids: string[] = []
    try { ids = (await listUnreadThreadIds(15, undefined, account)).ids } catch { continue }
    for (const id of ids) {
      let msgs: GmailMessage[] = []
      try { msgs = (await getThread(id, account)).messages ?? [] } catch { continue }
      const last = msgs.at(-1)
      if (!last) continue
      const headers = last.payload?.headers ?? []
      const to = header(headers, 'To').toLowerCase()
      const mine = account.email.toLowerCase()
      const { name, email } = fromOf(last)
      const body = extractBody(last)
      const age = c.now.getTime() - Number(last.internalDate ?? c.now.getTime())
      const needsYou = !looksLikeBulk(headers, email, body) && to.includes(mine) && email.toLowerCase() !== mine
      if (!needsYou || age < 4 * HOUR || carriesInvitation(last)) continue
      if (cachedDraft(id, last.id)) continue
      rows.push({
        id, messageId: last.id, fromName: name, fromEmail: email,
        subject: header(headers, 'Subject') || '(no subject)',
        receivedAt: new Date(Number(last.internalDate)).toISOString(),
        addressedToMe: true, body,
      })
    }
  }
  if (rows.length === 0) return
  const { briefs, unavailable } = await briefsFor(rows.slice(0, 8), { user: buildMockUser(c.user), companies: [], me })
  if (unavailable) { log('draft-replies', unavailable, 0, false); return }
  const n = Object.values(briefs).filter(b => b.draft.trim()).length
  if (n) log('draft-replies', `Drafted ${n} ${n === 1 ? 'reply' : 'replies'} — nothing sent`, n)
}

function blockFocus(c: Ctx): void {
  const today = todayLocal(c.now)
  // A dated, placed, open task is pushed to the calendar by the app itself; a
  // P0 with no date, or a date that has passed, is the one nothing puts there.
  const undated = c.tasks.filter(t =>
    t.priority === 'P0' && !t.completed && t.status === 'open' && t.quadrant != null &&
    !t.gcalEventId && !isTaskHidden(t) && (!t.dueDate || t.dueDate < today))
  if (undated.length === 0) return
  useTaskStore.getState()._remember(`Dated ${undated.length} P0 ${undated.length === 1 ? 'task' : 'tasks'} today`)
  suppressUndo(() => { for (const t of undated) c.updateTask(t.id, { dueDate: today }) })
  log('block-focus', `Dated ${undated.length} P0 ${undated.length === 1 ? 'task' : 'tasks'} today so they get a block`, undated.length)
}

function distributeDump(c: Ctx): void {
  const dump = c.tasks.filter(t => t.quadrant == null && !t.completed && t.status !== 'cancelled' && !isTaskHidden(t))
  if (dump.length <= 12) return
  useTaskStore.getState()._remember(`Distributed ${dump.length} tasks`)
  suppressUndo(() => {
    for (const t of dump) c.updateTask(t.id, { quadrant: suggestPlacement(t).quadrant, boardStatus: suggestColumn(t) })
  })
  log('distribute-dump', `Distributed ${dump.length} tasks out of the brain dump`, dump.length)
}

function rollForward(c: Ctx): void {
  const today = todayLocal(c.now)
  const late = c.tasks.filter(t =>
    t.quadrant != null && !!t.dueDate && t.dueDate < today &&
    !t.completed && t.status === 'open' && !isTaskHidden(t))
  if (late.length === 0) return
  useTaskStore.getState()._remember(`Rolled ${late.length} ${late.length === 1 ? 'task' : 'tasks'} forward`)
  // The date moves; a block already on the calendar stays where it was, since
  // deleting or moving an event is not something to do unasked at midnight.
  suppressUndo(() => { for (const t of late) c.updateTask(t.id, { dueDate: today }) })
  log('roll-forward', `Rolled ${late.length} unfinished ${late.length === 1 ? 'task' : 'tasks'} forward to today`, late.length)
}

async function archiveNews(c: Ctx): Promise<void> {
  let archived = 0
  for (const account of mailAccounts(c.user.email)) {
    const mine = account.email.toLowerCase()
    let ids: string[] = []
    try {
      ids = (await listUnreadThreadIds(25, undefined, account, 'in:inbox older_than:3d -is:starred -is:important')).ids
    } catch { continue }
    const gone: string[] = []
    for (const id of ids) {
      let msgs: GmailMessage[] = []
      try { msgs = (await getThread(id, account)).messages ?? [] } catch { continue }
      const last = msgs.at(-1)
      if (!last) continue
      // A thread you wrote in is a conversation, whatever the sender's headers say.
      if (msgs.some(m => fromOf(m).email.toLowerCase() === mine)) continue
      const headers = last.payload?.headers ?? []
      const klass = classifyMail({
        headers, fromEmail: fromOf(last).email, to: header(headers, 'To').toLowerCase(),
        cc: header(headers, 'Cc'), subject: header(headers, 'Subject'),
        body: extractBody(last).slice(0, 4000), mailbox: account.email, isInvitation: carriesInvitation(last),
      })
      if (klass === 'newsletter') gone.push(...msgs.map(m => m.id))
    }
    if (gone.length === 0) continue
    try { await batchModify(gone, { remove: ['INBOX'] }, account); archived += gone.length }
    catch (e) { log('archive-news', `Could not archive in ${account.email} — ${e instanceof Error ? e.message : 'Gmail refused'}`, 0, false) }
  }
  if (archived) log('archive-news', `Archived ${archived} newsletter ${archived === 1 ? 'message' : 'messages'} — still in All Mail`, archived)
}

async function closeWeek(c: Ctx): Promise<void> {
  const monday = mondayOf(todayLocal(c.now))
  if (wasReviewOpened(monday) || loadWeekInsight(monday)) return
  const today = todayLocal(c.now)
  const days = new Set(Array.from({ length: 7 }, (_, i) => {
    const [y, m, d] = monday.split('-').map(Number)
    return todayLocal(new Date(y, m - 1, d + i))
  }))
  const done = c.tasks.filter(t => (t.completed || t.status === 'done') && days.has(t.completedAt ?? t.dueDate ?? ''))
  const slipped = c.tasks.filter(t => !t.completed && t.status === 'open' && !!t.dueDate && t.dueDate < today).length
  let hours = { focus: 0, meeting: 0 }
  try { hours = JSON.parse(localStorage.getItem('professor-review-hours') ?? '{"focus":0,"meeting":0}') as typeof hours } catch { /* none */ }
  const logs = loadLogs()
  const habits = loadHabits().filter(h => h.isActive && !h.archived).map(h => ({
    name: h.name,
    streak: calcStreak(logs[h.id] ?? []),
    completedThisWeek: (logs[h.id] ?? []).filter(d => days.has(d)).length,
    target: h.frequency === 'daily' ? 7 : h.frequency === 'weekdays' ? 5 : 1,
  }))
  const dbUser = buildMockUser(c.user)
  const completedTasks: DbTask[] = done.map(t => ({
    id: t.id, user_id: dbUser.id, company_id: t.company, title: t.title, description: t.description ?? null,
    quadrant: null, effort_minutes: null, due_date: t.dueDate ?? null, status: 'done' as DbTask['status'],
    delegated_to: null, done_looks_like: null, created_at: t.createdAt, completed_at: t.completedAt ?? null,
  }))
  try {
    const text = await weeklyInsight({
      user: dbUser, companies: [],
      review: {
        id: monday, user_id: dbUser.id, week_of: monday, shipped_count: done.length, slipped_count: slipped,
        focus_hours: hours.focus, meeting_hours: hours.meeting, professor_insight: null, created_at: c.now.toISOString(),
      },
      completedTasks, habits,
    })
    saveWeekInsight(monday, text)
    log('close-week', 'Closed the week — the review is written, read it in Weekly Review', 1)
    notify('Your week is closed — the review is written')
  } catch (e) {
    log('close-week', `Could not write the review — ${e instanceof Error ? e.message : 'unknown'}`, 0, false)
  }
}

// ─── The tick ────────────────────────────────────────────────────────────────

let running = false

/**
 * One pass over the enabled rules. `force` ignores the "already ran" record for
 * the rules whose moment is a time — the Run now button — but never makes a
 * rule act on something that is not there.
 */
export async function runAutomation(opts: { force?: boolean } = {}): Promise<void> {
  if (running) return
  const user = useAuthStore.getState().user
  if (!user) return
  running = true
  try {
    const now = new Date()
    const ts = useTaskStore.getState()
    const c: Ctx = { now, user, tasks: ts.tasks, updateTask: ts.updateTask }
    const on = new Set(loadAutomationRules().filter(r => r.enabled).map(r => r.id))
    const f = !!opts.force

    const step = async (id: string, due: boolean, run: () => void | Promise<void>) => {
      if (!on.has(id) || !(due || f)) return
      markRan(id)
      try { await run() }
      catch (e) { log(id, e instanceof Error ? e.message : 'failed', 0, false) }
    }

    await step('morning-brief',   dueDaily('morning-brief', '06:40', now),        () => morningBrief(c))
    await step('roll-forward',    dueDaily('roll-forward', '00:05', now),         () => rollForward(c))
    await step('block-focus',     dueDaily('block-focus', '09:00', now),          () => blockFocus(c))
    await step('distribute-dump', dueEvery('distribute-dump', 5 * 60_000, now),   () => distributeDump(c))
    await step('draft-replies',   dueEvery('draft-replies', 30 * 60_000, now),    () => draftReplies(c))
    await step('archive-news',    dueEvery('archive-news', 6 * HOUR, now),        () => archiveNews(c))
    await step('close-week',      dueWeekly('close-week', 0, '20:00', now),       () => closeWeek(c))
  } finally {
    running = false
  }
}

/** Start the minute tick. Returns the stop function — App calls it on sign-out. */
export function startAutomation(): () => void {
  // A few seconds in, so the stores have hydrated and the first tick sees the
  // real task list rather than an empty one.
  const first = window.setTimeout(() => void runAutomation(), 5_000)
  const id = window.setInterval(() => void runAutomation(), 60_000)
  const onWake = () => { if (document.visibilityState === 'visible') void runAutomation() }
  document.addEventListener('visibilitychange', onWake)
  return () => {
    window.clearTimeout(first)
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', onWake)
  }
}
