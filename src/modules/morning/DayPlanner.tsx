/**
 * DayPlanner — 4-phase interactive AI day planner
 *
 * Phase 1 – Q&A       : 2 targeted questions (deadlines + deep-work pref)
 * Phase 2 – Generating: AI builds a structured slot plan avoiding conflicts
 * Phase 3 – Review    : user confirms / skips / reschedules each block
 * Phase 4 – Apply     : create / update / delete events on the correct calendar
 */
import { useState, useCallback } from 'react'
import {
  Sparkles, RefreshCw, ChevronRight,
  Check, X, RotateCcw,
  Shield, AlertTriangle, CreditCard,
} from 'lucide-react'
import type { Task } from '@/types'
import type { RichMeetingEvent } from './MorningBriefTypes'
import {
  generateSlotPlan,
  type PlanSlot, type BlockType, type SlotPlanPrefs, type SlotPlanPriorityTask,
} from '@/lib/professor'
import type { DbCalendarEvent, DbTask } from '@/types/database'
import { loadDynamicCompanies } from '@/types'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Decision = 'pending' | 'confirmed' | 'skipped'
type Phase    = 'idle' | 'qa' | 'generating' | 'review' | 'applying' | 'done'

interface SlotUI extends PlanSlot {
  decision: Decision
  overrideStart?: string  // HH:MM — set when user reschedules
  overrideEnd?: string
}

interface ApplyResult {
  slotId: string
  title: string
  status: 'created' | 'updated' | 'deleted' | 'skipped' | 'error'
  error?: string
}

export interface DayPlannerProps {
  energyLevel: number | null
  tasks: Task[]
  todayEvents: RichMeetingEvent[]
  eventsLoading: boolean
  dbUser: import('@/types/database').DbUser
  companies: import('@/types/database').DbCompany[]
  date: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const BLOCK_COLORS: Record<BlockType, string> = {
  focus:   '#7F77DD',
  meeting: '#1E40AF',
  task:    '#1D9E75',
  buffer:  '#6B7280',
  break:   '#F59E0B',
  admin:   '#0891B2',
}

const BLOCK_LABELS: Record<BlockType, string> = {
  focus:   'Deep Focus',
  meeting: 'Meeting',
  task:    'Task',
  buffer:  'Buffer',
  break:   'Break',
  admin:   'Admin',
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function hhmm(iso: string): string {
  // Accepts "HH:MM" or full ISO — returns local "HH:MM"
  if (!iso.includes('T')) return iso.slice(0, 5)  // already HH:MM
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch { return iso.slice(11, 16) }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function slotDurationMins(s: SlotUI): number {
  const [sh, sm] = (s.overrideStart ?? s.startTime).split(':').map(Number)
  const [eh, em] = (s.overrideEnd   ?? s.endTime  ).split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

/** Find the next free slot >= afterTime that fits `durationMins`, given confirmed slots. */
function nextFreeSlot(
  allSlots: SlotUI[],
  durationMins: number,
  afterTime: string,
): { start: string; end: string } | null {
  const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const end = 18 * 60 // 18:00

  const busyRanges = allSlots
    .filter(s => s.decision !== 'skipped')
    .map(s => ({
      s: toMins(s.overrideStart ?? s.startTime),
      e: toMins(s.overrideEnd   ?? s.endTime),
    }))
    .sort((a, b) => a.s - b.s)

  let cursor = toMins(afterTime)
  for (const busy of busyRanges) {
    if (cursor + durationMins <= busy.s) {
      return { start: toHHMM(cursor), end: toHHMM(cursor + durationMins) }
    }
    if (busy.e > cursor) cursor = busy.e
  }
  if (cursor + durationMins <= end) {
    return { start: toHHMM(cursor), end: toHHMM(cursor + durationMins) }
  }
  return null
}

/** Resolve calendar + token for a slot using cal-intel-cals-cache. */
async function resolveCalendar(
  slot: SlotUI,
): Promise<{ calendarId: string; token: string }> {
  const { loadAccounts } = await import('@/lib/multiAccount')
  const accounts     = loadAccounts()
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''

  const getToken = (email?: string) => {
    if (!email) return primaryToken
    const acc = accounts.find(a => a.email === email)
    if (!acc)         return primaryToken
    if (acc.isPrimary) return primaryToken
    return acc.providerToken || primaryToken
  }

  try {
    type CacheItem = { id: string; summary?: string; accountEmail: string }
    const cache = JSON.parse(localStorage.getItem('cal-intel-cals-cache') ?? '[]') as CacheItem[]

    // Match by company name if provided
    if (slot.company) {
      const q = slot.company.toLowerCase()
      const cal = cache.find(c => (c.summary ?? '').toLowerCase().includes(q))
      if (cal) return { calendarId: cal.id, token: getToken(cal.accountEmail) }
    }

    // Fall back to primary calendar
    const primaryCal = cache.find(c => {
      const acc = accounts.find(a => a.email === c.accountEmail)
      return acc?.isPrimary
    })
    if (primaryCal) return { calendarId: primaryCal.id, token: primaryToken }
  } catch { /* ignore */ }

  return { calendarId: 'primary', token: primaryToken }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Skel({ w = '100%', h = 12 }: { w?: string | number; h?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 6,
      background: 'linear-gradient(90deg, var(--color-border, #252A3E) 25%, var(--color-surface2, #4A3E28) 50%, var(--color-border, #252A3E) 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.6s infinite',
    }} />
  )
}

function GeneratingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <RefreshCw size={13} color="#7F77DD" style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 12, color: '#7F77DD' }}>Analyzing your calendar and tasks…</span>
      </div>
      {[80, 65, 90, 55, 75].map((w, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Skel w={3} h={36} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skel w={42} h={10} />
            <Skel w={`${w}%`} h={12} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main DayPlanner component ────────────────────────────────────────────────

export function DayPlanner({ energyLevel, tasks, todayEvents, eventsLoading, dbUser, companies, date }: DayPlannerProps) {
  const [phase,            setPhase]            = useState<Phase>('idle')
  const [selectedTaskIds,  setSelectedTaskIds]  = useState<Set<string>>(new Set())
  const [deepWork,         setDeepWork]         = useState<SlotPlanPrefs['deepWorkPref']>('morning')
  const [slots,       setSlots]       = useState<SlotUI[]>([])
  const [applying,    setApplying]    = useState<Record<string, 'pending' | 'done' | 'error'>>({})
  const [results,     setResults]     = useState<ApplyResult[]>([])
  const [error,       setError]       = useState<string | null>(null)
  const [errorType,   setErrorType]   = useState<'credit' | 'generic'>('generic')

  // ── Phase 2: generate ──────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    setPhase('generating')
    setError(null)
    try {
      const pendingTasks: DbTask[] = tasks.filter(t => !t.completed).map(t => ({
        id: t.id, user_id: dbUser.id, company_id: t.company ?? null,
        title: t.title, description: t.description ?? null,
        quadrant: t.quadrant ? ({
          do: 'urgent_important', schedule: 'important_not_urgent',
          delegate: 'urgent_not_important', eliminate: 'neither',
        } as Record<string, DbTask['quadrant']>)[t.quadrant] ?? null : null,
        effort_minutes: null, due_date: t.dueDate ?? null,
        status: 'todo' as const, delegated_to: null, done_looks_like: null,
        created_at: t.createdAt, completed_at: null,
      }))

      const todayDbEvents: DbCalendarEvent[] = todayEvents.map(e => ({
        id: e.id, user_id: e.user_id, company_id: e.company_id,
        google_event_id: e.google_event_id, title: e.title,
        start_time: e.start_time, end_time: e.end_time,
        location: e.location, meeting_type: e.meeting_type,
        prep_notes: e.prep_notes, is_synced: e.is_synced,
      }))

      const dynCompanies = loadDynamicCompanies()
      const priorityTasks: SlotPlanPriorityTask[] = tasks
        .filter(t => selectedTaskIds.has(t.id))
        .map(t => {
          const co = dynCompanies.find(c => c.id === t.company || c.name === t.company)
          return { id: t.id, title: t.title, company: co?.name ?? t.company, dueDate: t.dueDate }
        })

      const raw = await generateSlotPlan(
        { user: dbUser, companies, todayEvents: todayDbEvents, pendingTasks, energyLevel: energyLevel ?? undefined, date },
        { priorityTasks, deepWorkPref: deepWork },
      )

      // Merge: existing events get action='keep' if AI didn't include them
      const aiIds = new Set(raw.map(s => s.existingEventId).filter(Boolean))
      const kept: PlanSlot[] = todayEvents
        .filter(e => !aiIds.has(e.google_event_id ?? e.id))
        .map(e => ({
          id:              `existing-${e.id}`,
          title:           e.title,
          startTime:       hhmm(e.start_time),
          endTime:         hhmm(e.end_time),
          type:            'meeting' as BlockType,
          action:          'keep' as const,
          existingEventId: e.google_event_id ?? e.id,
          isExisting:      true,
          note:            'Existing calendar event',
        }))

      const merged: SlotUI[] = [...kept, ...raw].map(s => ({
        ...s,
        decision: (s.action === 'keep' ? 'confirmed' : 'pending') as Decision,
      })).sort((a, b) => a.startTime.localeCompare(b.startTime))

      setSlots(merged)
      setPhase('review')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isCredit = msg.includes('credit balance') || msg.includes('402') || msg.includes('billing') || msg.includes('invalid_request_error')
      setErrorType(isCredit ? 'credit' : 'generic')
      setError(isCredit ? 'credit_balance' : msg)
      setPhase('qa')
    }
  }, [tasks, todayEvents, dbUser, companies, date, energyLevel, selectedTaskIds, deepWork])

  // ── Phase 3: slot decision helpers ────────────────────────────────────────
  function decide(id: string, d: Decision) {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, decision: d } : s))
  }

  function reschedule(id: string) {
    setSlots(prev => {
      const slot = prev.find(s => s.id === id)
      if (!slot) return prev
      const dur   = slotDurationMins(slot)
      const after = slot.overrideStart ?? slot.startTime
      const free  = nextFreeSlot(prev, dur, after)
      if (!free) return prev
      return prev.map(s => s.id === id ? { ...s, overrideStart: free.start, overrideEnd: free.end, decision: 'confirmed' } : s)
    })
  }

  // ── Phase 4: apply ────────────────────────────────────────────────────────
  const applyAll = useCallback(async () => {
    setPhase('applying')
    const confirmed = slots.filter(s => s.decision === 'confirmed')
    const out: ApplyResult[] = []

    const {
      createCalendarEventWithToken,
      updateCalendarEventTimes,
      deleteCalendarEventWithToken,
    } = await import('@/lib/googleCalendar')

    for (const slot of confirmed) {
      setApplying(p => ({ ...p, [slot.id]: 'pending' }))
      const { calendarId, token } = await resolveCalendar(slot)
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

      const toISO = (hhmm: string) => {
        const [h, m] = hhmm.split(':').map(Number)
        const d = new Date(); d.setHours(h, m, 0, 0)
        return d.toISOString()
      }

      const start = slot.overrideStart ?? slot.startTime
      const end   = slot.overrideEnd   ?? slot.endTime

      try {
        if (slot.action === 'create') {
          const { event, error: e } = await createCalendarEventWithToken(token, calendarId, {
            summary: slot.title,
            start: { dateTime: toISO(start), timeZone: tz },
            end:   { dateTime: toISO(end),   timeZone: tz },
          })
          out.push({ slotId: slot.id, title: slot.title, status: event ? 'created' : 'error', error: e })

        } else if (slot.action === 'reschedule' && slot.existingEventId) {
          const ok = await updateCalendarEventTimes(
            token, calendarId, slot.existingEventId,
            new Date(toISO(start)), new Date(toISO(end)), tz,
          )
          out.push({ slotId: slot.id, title: slot.title, status: ok ? 'updated' : 'error' })

        } else if (slot.action === 'remove' && slot.existingEventId) {
          const ok = await deleteCalendarEventWithToken(token, calendarId, slot.existingEventId)
          out.push({ slotId: slot.id, title: slot.title, status: ok ? 'deleted' : 'error' })

        } else {
          // keep / already exists — no write needed
          out.push({ slotId: slot.id, title: slot.title, status: 'skipped' })
        }
      } catch (e) {
        out.push({ slotId: slot.id, title: slot.title, status: 'error', error: String(e) })
      }
      setApplying(p => ({ ...p, [slot.id]: out.at(-1)?.status === 'error' ? 'error' : 'done' }))
    }

    // Mark skipped slots
    slots.filter(s => s.decision === 'skipped').forEach(s =>
      out.push({ slotId: s.id, title: s.title, status: 'skipped' })
    )

    setResults(out)
    setPhase('done')
  }, [slots])

  // ──────────────────────────────────────────────────────────────────────────
  // Renders
  // ──────────────────────────────────────────────────────────────────────────

  // ── Phase: idle ──────────────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <button
        onClick={() => setPhase('qa')}
        style={{
          width: '100%', padding: '14px 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--color-bg, #0D0F1A)', border: '1px dashed #7F77DD40',
          borderRadius: 12, cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: '#7F77DD18', border: '1px solid #7F77DD30',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Sparkles size={13} color="#7F77DD" />
          </div>
          <div style={{ textAlign: 'left' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text, #E8EAF6)' }}>Build My Day</p>
            <p style={{ margin: 0, fontSize: 11, color: '#6B7280' }}>AI-powered time blocking + calendar sync</p>
          </div>
        </div>
        <ChevronRight size={15} color="#6B7280" />
      </button>
    )
  }

  // ── Phase: Q&A ────────────────────────────────────────────────────────────
  if (phase === 'qa') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {error && (
          <div style={{
            borderRadius: 10, background: '#1C1410', border: '1px solid #92400E40', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid #92400E30' }}>
              <CreditCard size={14} color="#F59E0B" style={{ marginTop: 1, flexShrink: 0 }} />
              <div>
                <p style={{ margin: '0 0 3px', fontSize: 12.5, fontWeight: 600, color: '#FCD34D' }}>
                  {errorType === 'credit' ? 'API Credit Balance Too Low' : 'Generation Failed'}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: '#FFFFFF', lineHeight: 1.5 }}>
                  {errorType === 'credit'
                    ? 'Top up at console.anthropic.com → Billing, then try again.'
                    : error}
                </p>
              </div>
            </div>
            <div style={{ padding: '10px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
              <AlertTriangle size={10} color="#6B7280" />
              <span style={{ fontSize: 10.5, color: '#6B7280' }}>Only AI planning is affected — other features work normally.</span>
            </div>
          </div>
        )}

        {/* Q1 — Priority tasks (task multi-select from companies) */}
        {(() => {
          const dynCompanies = loadDynamicCompanies()
          const today        = todayISO()
          const pending      = tasks.filter(t => !t.completed && t.status !== 'done')
          if (pending.length === 0) return null

          // Group by company; tasks with no company go under 'other'
          type Group = { id: string; name: string; color: string; tasks: Task[] }
          const groups: Group[] = dynCompanies.map(co => ({
            id: co.id, name: co.name, color: co.color,
            tasks: pending.filter(t => t.company === co.id || t.company === co.name),
          })).filter(g => g.tasks.length > 0)

          const uncategorised = pending.filter(t =>
            !dynCompanies.some(co => t.company === co.id || t.company === co.name)
          )
          if (uncategorised.length > 0) {
            groups.push({ id: 'other', name: 'Other', color: '#6B7280', tasks: uncategorised })
          }

          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  What must get done today?
                </label>
                {selectedTaskIds.size > 0 && (
                  <span style={{ fontSize: 10.5, color: '#7F77DD' }}>
                    {selectedTaskIds.size} selected
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 280, overflowY: 'auto' }}>
                {groups.map(group => (
                  <div key={group.id}>
                    {/* Company header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: group.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, fontWeight: 600, color: group.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {group.name}
                      </span>
                    </div>

                    {/* Tasks for this company */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {group.tasks.map(task => {
                        const isSelected = selectedTaskIds.has(task.id)
                        const isDueToday = task.dueDate === today
                        return (
                          <button
                            key={task.id}
                            onClick={() => setSelectedTaskIds(prev => {
                              const next = new Set(prev)
                              if (next.has(task.id)) next.delete(task.id); else next.add(task.id)
                              return next
                            })}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 9,
                              padding: '8px 10px', borderRadius: 7,
                              background: isSelected ? `${group.color}12` : 'var(--color-bg, #0D0F1A)',
                              border: `1px solid ${isSelected ? `${group.color}40` : 'var(--color-border, #252A3E)'}`,
                              cursor: 'pointer', textAlign: 'left',
                              transition: 'all 0.12s',
                            }}
                          >
                            {/* Checkbox */}
                            <div style={{
                              width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                              background: isSelected ? group.color : 'transparent',
                              border: `1.5px solid ${isSelected ? group.color : '#6B7280'}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {isSelected && <Check size={9} color="#fff" strokeWidth={3} />}
                            </div>

                            <span style={{
                              flex: 1, fontSize: 12, color: 'var(--color-text, #E8EAF6)',
                              lineHeight: 1.3,
                              textDecoration: 'none',
                            }}>
                              {task.title}
                            </span>

                            {isDueToday && (
                              <span style={{
                                fontSize: 9.5, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                                background: '#EF444418', border: '1px solid #EF444430', color: '#EF4444',
                              }}>
                                today
                              </span>
                            )}
                            {task.quadrant === 'do' && !isDueToday && (
                              <span style={{
                                fontSize: 9.5, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                                background: '#F59E0B15', border: '1px solid #F59E0B30', color: '#F59E0B',
                              }}>
                                urgent
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Today's fixed meetings — so you know what the AI will work around */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Today's calendar
            </label>
            {eventsLoading && (
              <span style={{ fontSize: 10.5, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} />
                Loading…
              </span>
            )}
          </div>

          {eventsLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[70, 55, 80].map((w, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ width: 3, height: 28, borderRadius: 2, background: 'var(--color-border, #252A3E)', flexShrink: 0 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ height: 9, width: 38, borderRadius: 4, background: 'var(--color-border, #252A3E)' }} />
                    <div style={{ height: 11, width: `${w}%`, borderRadius: 4, background: '#1A1D2E' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : todayEvents.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: '#6B7280', fontStyle: 'italic' }}>
              No meetings today — AI will fill your entire day.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {todayEvents.map(ev => {
                const color = ev.calendarColor ?? '#1E40AF'
                return (
                  <div key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ width: 3, height: '100%', minHeight: 28, borderRadius: 2, background: color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#6B7280' }}>
                        {hhmm(ev.start_time)}–{hhmm(ev.end_time)}
                      </span>
                      <p style={{ margin: '1px 0 0', fontSize: 12, color: 'var(--color-text, #E8EAF6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {ev.title}
                      </p>
                    </div>
                    {ev.calendarName && (
                      <span style={{
                        fontSize: 9.5, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                        background: `${color}18`, border: `1px solid ${color}30`, color,
                      }}>
                        {ev.calendarName}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Q2 — Deep work pref */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 8 }}>
            When do you prefer deep work?
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['morning', 'afternoon', 'flexible'] as const).map(opt => (
              <button
                key={opt}
                onClick={() => setDeepWork(opt)}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer',
                  fontSize: 12, fontWeight: deepWork === opt ? 600 : 400,
                  background: deepWork === opt ? '#7F77DD18' : 'var(--color-bg, #0D0F1A)',
                  border: `1px solid ${deepWork === opt ? '#7F77DD40' : 'var(--color-border, #252A3E)'}`,
                  color: deepWork === opt ? '#7F77DD' : '#6B7280',
                  transition: 'all 0.15s',
                  textTransform: 'capitalize',
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => { setPhase('idle'); setError(null); setSelectedTaskIds(new Set()) }}
            style={{
              padding: '9px 16px', borderRadius: 8, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--color-border, #252A3E)',
              color: '#6B7280', fontSize: 12,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => void generate()}
            disabled={eventsLoading}
            title={eventsLoading ? 'Waiting for calendar to load…' : undefined}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8, cursor: eventsLoading ? 'not-allowed' : 'pointer',
              background: '#7F77DD', border: 'none',
              color: '#fff', fontSize: 12.5, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              opacity: eventsLoading ? 0.45 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {eventsLoading
              ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading calendar…</>
              : <><Sparkles size={13} /> Generate My Day Plan</>
            }
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: generating ────────────────────────────────────────────────────
  if (phase === 'generating') return <GeneratingSkeleton />

  // ── Phase: review ────────────────────────────────────────────────────────
  if (phase === 'review') {
    const confirmed = slots.filter(s => s.decision === 'confirmed').length
    const toCreate  = slots.filter(s => s.decision === 'confirmed' && s.action === 'create').length
    const toUpdate  = slots.filter(s => s.decision === 'confirmed' && s.action === 'reschedule').length
    const toRemove  = slots.filter(s => s.decision === 'confirmed' && s.action === 'remove').length

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--color-text, #E8EAF6)' }}>Review Your Day Plan</p>
            <p style={{ margin: '2px 0 0', fontSize: 10.5, color: '#6B7280' }}>
              {confirmed} confirmed
              {toCreate > 0 && ` · ${toCreate} to create`}
              {toUpdate > 0 && ` · ${toUpdate} to reschedule`}
              {toRemove > 0 && ` · ${toRemove} to remove`}
            </p>
          </div>
          <button
            onClick={() => setPhase('qa')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 11, padding: '4px 8px' }}
          >
            ← Edit preferences
          </button>
        </div>

        {/* Slot list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {slots.map(slot => {
            const color   = BLOCK_COLORS[slot.type]
            const isPast  = slot.decision === 'skipped'
            const start   = slot.overrideStart ?? slot.startTime
            const end     = slot.overrideEnd   ?? slot.endTime

            return (
              <div
                key={slot.id}
                style={{
                  display: 'flex', gap: 10, alignItems: 'stretch',
                  padding: '10px 12px', borderRadius: 10,
                  background: isPast ? 'var(--color-surface2, #252A3E)' : 'var(--color-bg, #0D0F1A)',
                  border: `1px solid ${slot.decision === 'confirmed' ? `${color}30` : 'var(--color-border, #252A3E)'}`,
                  opacity: isPast ? 0.45 : 1,
                  transition: 'all 0.15s',
                }}
              >
                {/* Color bar */}
                <div style={{ width: 3, borderRadius: 2, background: color, flexShrink: 0, alignSelf: 'stretch', minHeight: 30 }} />

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: color, whiteSpace: 'nowrap' }}>
                      {start}–{end}
                    </span>
                    <span style={{
                      fontSize: 9.5, padding: '1px 6px', borderRadius: 3,
                      background: `${color}15`, border: `1px solid ${color}25`, color,
                      fontWeight: 600,
                    }}>
                      {BLOCK_LABELS[slot.type]}
                    </span>
                    {slot.isExisting && (
                      <span style={{
                        fontSize: 9.5, padding: '1px 6px', borderRadius: 3,
                        background: '#25283618', border: '1px solid #25283640', color: '#6B7280',
                      }}>
                        existing
                      </span>
                    )}
                    {slot.action === 'reschedule' && (
                      <span style={{
                        fontSize: 9.5, padding: '1px 6px', borderRadius: 3,
                        background: '#F59E0B15', border: '1px solid #F59E0B30', color: '#F59E0B',
                      }}>
                        move
                      </span>
                    )}
                    {slot.action === 'remove' && (
                      <span style={{
                        fontSize: 9.5, padding: '1px 6px', borderRadius: 3,
                        background: '#EF444415', border: '1px solid #EF444430', color: '#EF4444',
                      }}>
                        remove
                      </span>
                    )}
                  </div>

                  <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--color-text, #E8EAF6)', fontWeight: 500, lineHeight: 1.3 }}>
                    {slot.title}
                  </p>

                  {slot.company && (
                    <p style={{ margin: '3px 0 0', fontSize: 10.5, color: '#6B7280' }}>{slot.company}</p>
                  )}

                  {slot.note && (
                    <p style={{ margin: '4px 0 0', fontSize: 10.5, color: '#6B7280', fontStyle: 'italic', lineHeight: 1.4 }}>
                      {slot.note}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, justifyContent: 'center' }}>
                  {slot.decision !== 'confirmed' ? (
                    <button
                      onClick={() => decide(slot.id, 'confirmed')}
                      title="Confirm"
                      style={{
                        width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
                        background: '#1D9E7518', border: '1px solid #1D9E7540',
                        color: '#1D9E75', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Check size={12} />
                    </button>
                  ) : (
                    <button
                      onClick={() => decide(slot.id, 'pending')}
                      title="Unconfirm"
                      style={{
                        width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
                        background: '#1D9E7530', border: '1px solid #1D9E7560',
                        color: '#1D9E75', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Check size={12} />
                    </button>
                  )}

                  {slot.decision !== 'skipped' && !slot.isExisting && (
                    <button
                      onClick={() => decide(slot.id, 'skipped')}
                      title="Skip"
                      style={{
                        width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
                        background: '#EF444418', border: '1px solid #EF444430',
                        color: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}

                  {(slot.action === 'reschedule' || (slot.decision === 'skipped' && !slot.isExisting)) && (
                    <button
                      onClick={() => reschedule(slot.id)}
                      title="Find next free slot"
                      style={{
                        width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
                        background: '#F59E0B18', border: '1px solid #F59E0B30',
                        color: '#F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <RotateCcw size={11} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Apply button */}
        <button
          onClick={() => void applyAll()}
          disabled={slots.filter(s => s.decision === 'confirmed' && s.action !== 'keep').length === 0}
          style={{
            padding: '12px 0', borderRadius: 10, cursor: 'pointer',
            background: '#7F77DD', border: 'none',
            color: '#fff', fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: slots.filter(s => s.decision === 'confirmed' && s.action !== 'keep').length === 0 ? 0.4 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          <Shield size={14} />
          Apply to Calendar
        </button>
      </div>
    )
  }

  // ── Phase: applying ──────────────────────────────────────────────────────
  if (phase === 'applying') {
    const active = slots.filter(s => s.decision === 'confirmed')
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <RefreshCw size={13} color="#7F77DD" style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 12, color: '#7F77DD' }}>Applying changes to your calendar…</span>
        </div>
        {active.map(slot => {
          const st = applying[slot.id]
          return (
            <div key={slot.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                background: st === 'done' ? '#1D9E75' : st === 'error' ? '#EF4444' : 'var(--color-surface2, #252A3E)',
                border: `1px solid ${st === 'done' ? '#1D9E75' : st === 'error' ? '#EF4444' : '#7F77DD'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {st === 'done'  && <Check size={9} color="#fff" />}
                {st === 'error' && <X     size={9} color="#fff" />}
                {!st && <RefreshCw size={8} color="#7F77DD" style={{ animation: 'spin 1s linear infinite' }} />}
              </div>
              <span style={{ fontSize: 12, color: st === 'error' ? '#EF4444' : 'var(--color-text, #E8EAF6)' }}>
                {slot.title}
              </span>
              <span style={{ fontSize: 10.5, color: '#6B7280', marginLeft: 'auto' }}>
                {slot.action === 'create' ? 'Creating' : slot.action === 'reschedule' ? 'Moving' : slot.action === 'remove' ? 'Removing' : 'Keeping'}…
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  // ── Phase: done ──────────────────────────────────────────────────────────
  const created  = results.filter(r => r.status === 'created').length
  const updated  = results.filter(r => r.status === 'updated').length
  const deleted  = results.filter(r => r.status === 'deleted').length
  const errored  = results.filter(r => r.status === 'error')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        padding: '16px 18px', borderRadius: 12,
        background: '#0D1A14', border: '1px solid #1D9E7530',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7, flexShrink: 0,
            background: '#1D9E7518', border: '1px solid #1D9E7530',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Check size={13} color="#1D9E75" />
          </div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1D9E75' }}>Plan Applied</p>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {created > 0 && <span style={{ fontSize: 12, color: 'var(--color-text, #E8EAF6)' }}>{created} created</span>}
          {updated > 0 && <span style={{ fontSize: 12, color: 'var(--color-text, #E8EAF6)' }}>{updated} rescheduled</span>}
          {deleted > 0 && <span style={{ fontSize: 12, color: 'var(--color-text, #E8EAF6)' }}>{deleted} removed</span>}
          {errored.length > 0 && <span style={{ fontSize: 12, color: '#EF4444' }}>{errored.length} failed</span>}
        </div>
        {errored.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {errored.map(r => (
              <p key={r.slotId} style={{ margin: 0, fontSize: 11, color: '#EF4444' }}>
                ✗ {r.title}{r.error ? `: ${r.error}` : ''}
              </p>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => { setPhase('idle'); setSlots([]); setResults([]); setApplying({}) }}
        style={{
          padding: '9px 0', borderRadius: 8, cursor: 'pointer',
          background: 'transparent', border: '1px solid var(--color-border, #252A3E)',
          color: '#6B7280', fontSize: 12,
        }}
      >
        Build another plan
      </button>
    </div>
  )
}
