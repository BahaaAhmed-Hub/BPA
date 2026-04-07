import { useState, useEffect, useCallback, useRef } from 'react'
import {
  RefreshCw, Calendar, Users, Video,
  CheckCircle2, Circle, Sparkles,
  X, MapPin, ExternalLink, CreditCard, AlertTriangle,
} from 'lucide-react'
import { planMyDay } from '@/lib/professor'
import type { DayPlan, DayContext } from '@/lib/professor'
import { fetchWeekEvents, detectMeetingType } from '@/lib/googleCalendar'
import type { GCalEvent } from '@/lib/googleCalendar'
import { useAuthStore } from '@/store/authStore'
import { useTaskStore } from '@/store/taskStore'
import type { DbUser, DbCompany, DbCalendarEvent, DbTask } from '@/types/database'
import type { Task } from '@/types'

// ─── Rich meeting event (extends DbCalendarEvent with raw GCal data) ─────────

interface RichMeetingEvent extends DbCalendarEvent {
  calendarId?: string
  calendarName?: string
  calendarColor?: string
  accountEmail?: string
  attendees?: GCalEvent['attendees']
  description?: string
  htmlLink?: string
  conferenceData?: GCalEvent['conferenceData']
}

type CalCacheItem = {
  id: string
  accountEmail: string
  summary?: string
  backgroundColor?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CO_COLOR: Record<string, string> = {
  teradix:    '#1E40AF',
  dxtech:     '#7F77DD',
  consulting: '#1D9E75',
  personal:   '#888780',
}

const CO_NAME: Record<string, string> = {
  teradix:    'Teradix',
  dxtech:     'DX Tech',
  consulting: 'Consulting',
  personal:   'Personal',
}

const ENERGY_META = [
  null,
  { label: 'Depleted', color: '#888780' },
  { label: 'Low',      color: '#FFFFFF' },
  { label: 'Steady',   color: '#1E40AF' },
  { label: 'Energized',color: '#1D9E75' },
  { label: 'Peak',     color: '#7F77DD' },
] as const

const QUADRANT_MAP: Record<string, DbTask['quadrant']> = {
  do:       'urgent_important',
  schedule: 'important_not_urgent',
  delegate: 'urgent_not_important',
  eliminate:'neither',
}

const MOCK_COMPANIES: DbCompany[] = [
  { id: 'teradix',    user_id: 'demo', name: 'Teradix',    color_tag: '#1E40AF', calendar_id: null, is_active: true },
  { id: 'dxtech',     user_id: 'demo', name: 'DX Tech',    color_tag: '#7F77DD', calendar_id: null, is_active: true },
  { id: 'consulting', user_id: 'demo', name: 'Consulting', color_tag: '#1D9E75', calendar_id: null, is_active: true },
  { id: 'personal',   user_id: 'demo', name: 'Personal',   color_tag: '#888780', calendar_id: null, is_active: true },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadStoredHabits(): { id: string; name: string }[] {
  try {
    const raw = localStorage.getItem('professor-habits')
    if (!raw) return []
    return (JSON.parse(raw) as { id: string; name: string }[]).slice(0, 6)
  } catch { return [] }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function fmtDuration(startIso: string, endIso: string): string {
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60); const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function getEventStatus(start: string, end: string): 'live' | 'soon' | 'upcoming' | 'past' {
  const now = Date.now()
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (now >= s && now <= e) return 'live'
  if (s - now > 0 && s - now <= 30 * 60 * 1000) return 'soon'
  if (now < s) return 'upcoming'
  return 'past'
}

function getJoinLink(conferenceData?: GCalEvent['conferenceData']): string | null {
  if (!conferenceData?.entryPoints) return null
  const video = conferenceData.entryPoints.find(ep => ep.entryPointType === 'video')
  return video?.uri ?? null
}

function avatarInitials(name?: string, email?: string): string {
  if (name) return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
  return (email ?? '?')[0].toUpperCase()
}

function responseColor(status?: string): string {
  if (status === 'accepted')  return '#1D9E75'
  if (status === 'declined')  return '#EF4444'
  if (status === 'tentative') return '#F59E0B'
  return '#6B7280'
}

function responseSymbol(status?: string): string {
  if (status === 'accepted')  return '✓'
  if (status === 'declined')  return '✗'
  if (status === 'tentative') return '~'
  return '?'
}

function getFirstName(name: string | null | undefined, email: string): string {
  if (name) return name.trim().split(' ')[0]
  return email.split('@')[0]
}

function buildMockUser(user: { id: string; email: string; name?: string; avatarUrl?: string } | null): DbUser {
  return {
    id: user?.id ?? 'demo',
    email: user?.email ?? 'bahaa@example.com',
    full_name: user?.name ?? 'Bahaa Ahmed',
    avatar_url: user?.avatarUrl ?? null,
    active_framework: 'time_blocking',
    schedule_rules: {
      focus_hours: '09:00–12:00',
      buffer_minutes: 15,
      no_meeting_days: 'Wednesday',
      max_meetings_per_day: 4,
    },
    created_at: new Date().toISOString(),
  }
}

function buildContext(dbUser: DbUser, tasks: Task[], energyLevel: number | null, todayEvents: DbCalendarEvent[]): DayContext {
  const pendingTasks: DbTask[] = tasks
    .filter(t => !t.completed)
    .map(t => ({
      id: t.id,
      user_id: dbUser.id,
      company_id: t.company,
      title: t.title,
      description: t.description ?? null,
      quadrant: t.quadrant ? (QUADRANT_MAP[t.quadrant] ?? null) : null,
      effort_minutes: null,
      due_date: t.dueDate ?? null,
      status: 'todo' as const,
      delegated_to: null,
      done_looks_like: null,
      created_at: t.createdAt,
      completed_at: null,
    }))

  return {
    user: dbUser,
    companies: MOCK_COMPANIES,
    todayEvents,
    pendingTasks,
    energyLevel: energyLevel ?? undefined,
    date: todayKey(),
  }
}

function loadCachedPlan(): DayPlan | null {
  try {
    const raw = localStorage.getItem(`professor-dayplan-${todayKey()}`)
    return raw ? (JSON.parse(raw) as DayPlan) : null
  } catch {
    return null
  }
}

function savePlan(plan: DayPlan): void {
  try {
    localStorage.setItem(`professor-dayplan-${todayKey()}`, JSON.stringify(plan))
  } catch { /* quota full — skip */ }
}

function matchCompany(title: string, tasks: Task[]): string | null {
  const t = title.toLowerCase()
  const match = tasks.find(task =>
    task.title.toLowerCase().includes(t.slice(0, 12)) ||
    t.includes(task.title.toLowerCase().slice(0, 12)),
  )
  return match?.company ?? null
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skel({ w = '100%', h = 14, radius = 8 }: { w?: string | number; h?: number; radius?: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        background: 'linear-gradient(90deg, #252A3E 25%, #4A3E28 50%, #252A3E 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.6s infinite',
        flexShrink: 0,
      }}
    />
  )
}

function PlanSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Skel w={52} h={13} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <Skel w={`${70 - i * 8}%`} h={13} />
            {i % 2 === 0 && <Skel w="25%" h={10} />}
          </div>
        </div>
      ))}
    </div>
  )
}

function PrioritySkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: '#161929', border: '1px solid #252A3E',
            borderRadius: 12, padding: '14px 16px',
          }}
        >
          <Skel w={32} h={32} radius={50} />
          <Skel w={`${60 - i * 8}%`} h={14} />
        </div>
      ))}
    </div>
  )
}

// ─── Meeting icon ──────────────────────────────────────────────────────────────

function MeetingTypeIcon({ type, size = 12 }: { type: string | null; size?: number }) {
  if (type === 'video')       return <Video    size={size} color="#7F77DD" />
  if (type === 'one_on_one')  return <Users    size={size} color="#1D9E75" />
  if (type === 'external')    return <Calendar size={size} color="#1E40AF" />
  return                             <Users    size={size} color="#6B7280" />
}

function MeetingTypeLabel({ type }: { type: string | null }) {
  if (type === 'video')      return 'Video call'
  if (type === 'one_on_one') return '1-on-1'
  if (type === 'external')   return 'External meeting'
  return 'Team meeting'
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ReturnType<typeof getEventStatus> }) {
  const cfg = {
    live:     { label: 'Live',     bg: '#1D9E7518', border: '#1D9E7540', color: '#1D9E75', pulse: true  },
    soon:     { label: 'Soon',     bg: '#F59E0B18', border: '#F59E0B40', color: '#F59E0B', pulse: false },
    upcoming: { label: 'Upcoming', bg: '#1E40AF18', border: '#1E40AF40', color: '#1E40AF', pulse: false },
    past:     { label: 'Done',     bg: '#25283618', border: '#25283640', color: '#6B7280', pulse: false },
  }[status]

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 9.5, fontWeight: 600, letterSpacing: '0.5px',
      padding: '2px 7px', borderRadius: 4,
      background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color,
    }}>
      {cfg.pulse && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%', background: cfg.color,
          animation: 'livePulse 1.5s ease-in-out infinite',
          display: 'inline-block',
        }} />
      )}
      {cfg.label}
    </span>
  )
}

// ─── Event detail panel ────────────────────────────────────────────────────────

function EventDetailPanel({ event, onClose }: { event: RichMeetingEvent; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const status   = getEventStatus(event.start_time, event.end_time)
  const joinLink = getJoinLink(event.conferenceData)

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const accentColor = event.calendarColor ?? '#1E40AF'
  const attendees   = event.attendees ?? []

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'fadeIn 0.18s ease both',
    }}>
      <div
        ref={panelRef}
        style={{
          width: 420, maxHeight: '80vh',
          background: '#11131E',
          border: `1px solid ${accentColor}40`,
          borderTop: `3px solid ${accentColor}`,
          borderRadius: 16,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: `0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px ${accentColor}20`,
          animation: 'slideUp 0.22s ease both',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid #252A3E' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#E8EAF6', lineHeight: 1.35, flex: 1 }}>
              {event.title}
            </h3>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#6B7280', flexShrink: 0 }}
            >
              <X size={16} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <StatusBadge status={status} />
            <span style={{ fontSize: 11, color: '#FFFFFF' }}>
              {fmtTime(event.start_time)} – {fmtTime(event.end_time)}
              <span style={{ marginLeft: 6, color: '#6B7280' }}>({fmtDuration(event.start_time, event.end_time)})</span>
            </span>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '16px 22px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Calendar chip */}
          {event.calendarName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: accentColor, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#FFFFFF' }}>{event.calendarName}</span>
              {event.accountEmail && (
                <span style={{ fontSize: 10.5, color: '#6B7280' }}>· {event.accountEmail}</span>
              )}
            </div>
          )}

          {/* Meeting type */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MeetingTypeIcon type={event.meeting_type} size={13} />
            <span style={{ fontSize: 12, color: '#FFFFFF' }}>
              <MeetingTypeLabel type={event.meeting_type} />
            </span>
          </div>

          {/* Location */}
          {event.location && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MapPin size={13} color="#6B7280" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#FFFFFF' }}>{event.location}</span>
            </div>
          )}

          {/* Join video call */}
          {joinLink && (
            <a
              href={joinLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', borderRadius: 8,
                background: '#7F77DD18', border: '1px solid #7F77DD40',
                color: '#7F77DD', fontSize: 12.5, fontWeight: 600,
                textDecoration: 'none', transition: 'all 0.15s',
              }}
            >
              <Video size={14} />
              Join video call
              <ExternalLink size={11} style={{ marginLeft: 'auto', opacity: 0.6 }} />
            </a>
          )}

          {/* Description */}
          {event.description && (
            <div style={{
              padding: '12px 14px', borderRadius: 8,
              background: '#161929', border: '1px solid #252A3E',
            }}>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Description
              </p>
              <p style={{
                margin: 0, fontSize: 12, color: '#FFFFFF', lineHeight: 1.6,
                maxHeight: 100, overflowY: 'auto',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {event.description.replace(/<[^>]+>/g, ' ').trim()}
              </p>
            </div>
          )}

          {/* Attendees */}
          {attendees.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Attendees ({attendees.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {attendees.slice(0, 8).map((att, i) => {
                  const rc = responseColor(att.responseStatus)
                  const rs = responseSymbol(att.responseStatus)
                  const initials = avatarInitials(att.displayName, att.email)
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                        background: `${accentColor}22`, border: `1px solid ${accentColor}40`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9.5, fontWeight: 700, color: accentColor,
                      }}>
                        {initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 12, color: '#E8EAF6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {att.displayName ?? att.email}
                          {att.self && <span style={{ fontSize: 10, color: '#6B7280', marginLeft: 5 }}>(you)</span>}
                        </p>
                        {att.displayName && (
                          <p style={{ margin: 0, fontSize: 10, color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {att.email}
                          </p>
                        )}
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: rc,
                        width: 16, textAlign: 'center', flexShrink: 0,
                      }} title={att.responseStatus ?? 'No response'}>
                        {rs}
                      </span>
                    </div>
                  )
                })}
                {attendees.length > 8 && (
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#6B7280' }}>
                    +{attendees.length - 8} more attendees
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Open in Google Calendar link */}
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, color: '#6B7280', textDecoration: 'none',
                marginTop: 4,
              }}
            >
              <ExternalLink size={11} />
              Open in Google Calendar
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      margin: '0 0 14px',
      fontSize: 11,
      fontWeight: 600,
      color: '#FFFFFF',
      textTransform: 'uppercase',
      letterSpacing: '1px',
    }}>
      {children}
    </p>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export function MorningBrief() {
  const user    = useAuthStore(s => s.user)
  const tasks   = useTaskStore(s => s.tasks)

  const [energyLevel, setEnergyLevel]   = useState<number | null>(null)
  const [plan, setPlan]                 = useState<DayPlan | null>(loadCachedPlan)
  const [isGenerating, setIsGenerating] = useState(!loadCachedPlan())
  const [error, setError]               = useState<string | null>(null)
  const [errorType, setErrorType]       = useState<'credit' | 'generic'>('generic')
  // Today's Habits — read real completion state from logs
  const [habits, setHabits] = useState(() => {
    const todayStr = todayKey()
    const logs     = (() => { try { const r = localStorage.getItem('professor-habit-logs'); return r ? JSON.parse(r) as Record<string, string[]> : {} } catch { return {} } })()
    return loadStoredHabits().map(h => ({ ...h, checked: (logs[h.id] ?? []).includes(todayStr) }))
  })
  const [todayEvents, setTodayEvents]   = useState<RichMeetingEvent[]>([])
  const [selectedEvent, setSelectedEvent] = useState<RichMeetingEvent | null>(null)

  const firstName = getFirstName(user?.name, user?.email ?? '')
  const dateStr   = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  // Fetch today's calendar events from ALL connected accounts via cal-intel cache
  useEffect(() => {
    const today = new Date()
    const start = new Date(today); start.setHours(0, 0, 0, 0)
    const end   = new Date(today); end.setHours(23, 59, 59, 999)
    const uid   = user?.id ?? ''

    function mapRichEvent(
      e: GCalEvent & { calendarId?: string; calendarColor?: string },
      calName?: string,
      accountEmail?: string,
    ): RichMeetingEvent {
      return {
        id: e.id,
        user_id: uid,
        company_id: null,
        google_event_id: e.id,
        title: e.summary ?? '(No title)',
        start_time: e.start.dateTime ?? e.start.date ?? '',
        end_time:   e.end.dateTime   ?? e.end.date   ?? '',
        location:   e.location ?? null,
        meeting_type: detectMeetingType(e),
        prep_notes: null,
        is_synced: true,
        calendarId:    e.calendarId,
        calendarName:  calName,
        calendarColor: e.calendarColor,
        accountEmail,
        attendees:     e.attendees,
        description:   e.description,
        htmlLink:      e.htmlLink,
        conferenceData: e.conferenceData,
      }
    }

    // Try multi-account fetch using cal-intel cache (same as CalendarIntelligence)
    const tryMultiAccount = async () => {
      try {
        const cacheRaw = localStorage.getItem('cal-intel-cals-cache')
        if (cacheRaw) {
          const cached = JSON.parse(cacheRaw) as CalCacheItem[]

          // ── Respect Cal Intel visibility toggles ────────────────────────────
          // 1. Hidden calendar IDs (eye toggle per calendar in Cal Intel sidebar)
          const hiddenCalIds: Set<string> = (() => {
            try { return new Set(JSON.parse(localStorage.getItem('cal-intel-hidden') ?? '[]') as string[]) }
            catch { return new Set<string>() }
          })()
          // 2. Hidden account emails (account-level eye toggle in Settings)
          const hiddenAccEmails: Set<string> = (() => {
            try { return new Set(JSON.parse(localStorage.getItem('cal-intel-hidden-accounts') ?? '[]') as string[]) }
            catch { return new Set<string>() }
          })()

          const visible = cached.filter(c =>
            !hiddenCalIds.has(c.id) && !hiddenAccEmails.has(c.accountEmail)
          )

          if (visible.length > 0) {
            const { fetchCalendarEventsWithToken } = await import('@/lib/googleCalendar')
            const { loadAccounts, silentRefreshAccountToken } = await import('@/lib/multiAccount')
            const accounts     = loadAccounts()
            // Always use the freshest primary token from localStorage, not the
            // stale copy that may be saved inside professor-connected-accounts
            const primaryToken = localStorage.getItem('google_provider_token') ?? ''

            const allEvents = await Promise.all(visible.map(async c => {
              const acc = accounts.find(a => a.email === c.accountEmail)
              // Primary: use google_provider_token; extra: use providerToken from account
              const token = acc?.isPrimary ? primaryToken : (acc?.providerToken ?? primaryToken)
              if (!token) return [] as RichMeetingEvent[]

              let evs = await fetchCalendarEventsWithToken(token, c.id, start, end, c.backgroundColor)

              // If extra account returns nothing, attempt a silent token refresh + retry
              if (evs.length === 0 && acc && !acc.isPrimary) {
                const refreshed = await silentRefreshAccountToken(acc)
                if (refreshed) {
                  evs = await fetchCalendarEventsWithToken(refreshed, c.id, start, end, c.backgroundColor)
                }
              }

              return evs.map(e =>
                mapRichEvent(
                  e as GCalEvent & { calendarId?: string; calendarColor?: string },
                  c.summary ?? c.id,
                  c.accountEmail,
                )
              )
            }))

            const flat = allEvents.flat()
            // Commit result even if some calendars returned 0 — that just means
            // those calendars have no events today, not that fetch failed.
            setTodayEvents(flat.sort((a, b) =>
              new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
            ))
            return
          }
        }
      } catch { /* fall through to primary only */ }

      // Fallback: primary account only (no Cal Intel cache yet)
      void fetchWeekEvents(start, end).then(({ events }) =>
        setTodayEvents(
          events
            .map(e => mapRichEvent(
              e as GCalEvent & { calendarId?: string; calendarColor?: string },
              'Primary calendar',
              user?.email ?? undefined,
            ))
            .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
        )
      )
    }
    void tryMultiAccount()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const generate = useCallback(async (energy: number | null = energyLevel) => {
    setIsGenerating(true)
    setError(null)
    try {
      const dbUser  = buildMockUser(user)
      const context = buildContext(dbUser, tasks, energy, todayEvents)
      const result  = await planMyDay(context)
      setPlan(result)
      savePlan(result)
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Could not generate plan.'
      const isCredit = raw.includes('credit balance') || raw.includes('402') || raw.includes('billing') || raw.includes('invalid_request_error')
      setErrorType(isCredit ? 'credit' : 'generic')
      setError(isCredit ? 'credit_balance' : raw)
    } finally {
      setIsGenerating(false)
    }
  }, [user, tasks, energyLevel, todayEvents])

  // Generate on first load only if no cache
  useEffect(() => {
    if (!plan) generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleEnergySelect(level: number) {
    setEnergyLevel(level)
    // Regenerate if we already have a plan so it reflects new energy level
    if (plan) generate(level)
  }

  function handleHabitToggle(id: string) {
    setHabits(prev => prev.map(h => h.id === id ? { ...h, checked: !h.checked } : h))
  }

  const checkedHabits = habits.filter(h => h.checked).length

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* Event detail panel */}
      {selectedEvent && (
        <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}

      {/* Shimmer keyframe */}
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.7); }
        }
        .brief-section { animation: fadeIn 0.35s ease both; }
        .event-row:hover { background: #1A1D2E !important; cursor: pointer; }
      `}</style>

      <div style={{ padding: '36px 32px 60px', maxWidth: 1080, margin: '0 auto' }}>

        {/* ─── 1. Greeting ───────────────────────────────────────────────── */}
        <div className="brief-section" style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ margin: '0 0 2px', fontSize: 15, color: '#FFFFFF', fontWeight: 400 }}>
                Good morning,
              </p>
              <h1 style={{
                margin: 0,
                fontSize: 48,
                fontWeight: 800,
                color: '#E8EAF6',
                fontFamily: "'Cabinet Grotesk', sans-serif",
                letterSpacing: '-1.5px',
                lineHeight: 1.05,
              }}>
                {firstName}.
              </h1>
              <p style={{ margin: '10px 0 0', fontSize: 13, color: '#FFFFFF' }}>
                {dateStr}
              </p>
            </div>

            <button
              onClick={() => generate()}
              disabled={isGenerating}
              title="Regenerate plan"
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 14px', borderRadius: 8,
                background: 'transparent',
                border: '1px solid #252A3E',
                color: '#FFFFFF', fontSize: 12, cursor: 'pointer',
                transition: 'all 0.15s',
                opacity: isGenerating ? 0.5 : 1,
              }}
            >
              <RefreshCw size={13} style={{ animation: isGenerating ? 'spin 1s linear infinite' : 'none' }} />
              Regenerate plan
            </button>
          </div>

          {/* Divider */}
          <div style={{
            marginTop: 24,
            height: 1,
            background: 'linear-gradient(90deg, #1E40AF40 0%, #252A3E 60%, transparent 100%)',
          }} />
        </div>

        {/* ─── Energy check-in ───────────────────────────────────────────── */}
        <div className="brief-section" style={{
          marginBottom: 36,
          background: '#161929',
          border: '1px solid #252A3E',
          borderRadius: 14,
          padding: '20px 24px',
        }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: '#FFFFFF' }}>
            How's your energy this morning?
          </p>
          <div style={{ display: 'flex', gap: 14 }}>
            {([1, 2, 3, 4, 5] as const).map(level => {
              const meta     = ENERGY_META[level]!
              const selected = energyLevel === level
              return (
                <button
                  key={level}
                  onClick={() => handleEnergySelect(level)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  }}
                >
                  <span style={{
                    width: 44, height: 44, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700,
                    border: `1.5px solid ${selected ? meta.color : '#252A3E'}`,
                    background: selected ? `${meta.color}22` : 'transparent',
                    color: selected ? meta.color : '#6B7280',
                    boxShadow: selected ? `0 0 14px ${meta.color}40` : 'none',
                    transition: 'all 0.15s',
                  }}>
                    {level}
                  </span>
                  <span style={{
                    fontSize: 10, color: selected ? meta.color : '#6B7280',
                    fontWeight: selected ? 600 : 400, transition: 'color 0.15s',
                    whiteSpace: 'nowrap',
                  }}>
                    {meta.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ─── Main grid: left 2/3, right 1/3 ───────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>

          {/* LEFT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ─── 2. AI Day Plan ──────────────────────────────────────── */}
            <div className="brief-section" style={{
              background: '#161929',
              border: '1px solid #252A3E',
              borderRadius: 14,
              padding: '24px 26px',
              borderLeft: '3px solid #1E40AF50',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 20 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: '#1E40AF18', border: '1px solid #1E40AF30',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Sparkles size={13} color="#1E40AF" />
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#1E40AF', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                  AI Day Plan
                </span>
                {isGenerating && (
                  <span style={{ fontSize: 11, color: '#FFFFFF', marginLeft: 'auto' }}>
                    Generating…
                  </span>
                )}
              </div>

              {/* Focus tip */}
              {!isGenerating && plan?.focusTip && (
                <div style={{
                  marginBottom: 22,
                  padding: '12px 16px',
                  background: 'rgba(30,64,175,0.07)',
                  borderLeft: '2px solid #1E40AF',
                  borderRadius: '0 8px 8px 0',
                }}>
                  <p style={{ margin: 0, fontSize: 13, color: '#E8EAF6', lineHeight: 1.55 }}>
                    {plan.focusTip}
                  </p>
                </div>
              )}

              {/* Schedule */}
              {isGenerating ? (
                <PlanSkeleton />
              ) : error ? (
                errorType === 'credit' ? (
                  /* ── Credit balance error ── */
                  <div style={{
                    borderRadius: 12,
                    background: '#1C1410',
                    border: '1px solid #92400E40',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'flex', gap: 14, alignItems: 'flex-start',
                      padding: '18px 20px',
                      borderBottom: '1px solid #92400E30',
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                        background: '#92400E22', border: '1px solid #92400E40',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <CreditCard size={16} color="#F59E0B" />
                      </div>
                      <div>
                        <p style={{ margin: '0 0 4px', fontSize: 13.5, fontWeight: 600, color: '#FCD34D' }}>
                          API Credit Balance Too Low
                        </p>
                        <p style={{ margin: 0, fontSize: 12.5, color: '#FFFFFF', lineHeight: 1.55 }}>
                          Your Anthropic account has insufficient credits to generate an AI plan.
                          Visit <strong>console.anthropic.com → Billing</strong> to top up.
                        </p>
                      </div>
                    </div>
                    <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <AlertTriangle size={11} color="#6B7280" />
                      <span style={{ fontSize: 11, color: '#6B7280' }}>
                        Other features are unaffected. Only AI-powered planning requires API credits.
                      </span>
                    </div>
                  </div>
                ) : (
                  /* ── Generic error ── */
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <p style={{ margin: '0 0 14px', fontSize: 13, color: '#FFFFFF' }}>{error}</p>
                    <button
                      onClick={() => generate()}
                      style={{
                        padding: '7px 16px', borderRadius: 7,
                        background: '#1E40AF18', border: '1px solid #1E40AF30',
                        color: '#1E40AF', fontSize: 12, cursor: 'pointer',
                      }}
                    >
                      Try again
                    </button>
                  </div>
                )
              ) : plan?.schedule.length ? (
                <div>
                  {plan.schedule.map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, paddingBottom: i < plan.schedule.length - 1 ? 18 : 0 }}>
                      {/* Time */}
                      <span style={{
                        fontSize: 12, fontFamily: 'monospace',
                        color: '#1E40AF', width: 48, flexShrink: 0, paddingTop: 1,
                      }}>
                        {item.time}
                      </span>

                      {/* Dot + line */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#1E40AF', marginTop: 4 }} />
                        {i < plan.schedule.length - 1 && (
                          <div style={{ width: 1, flex: 1, background: '#252A3E', minHeight: 18, marginTop: 4 }} />
                        )}
                      </div>

                      {/* Activity */}
                      <div style={{ flex: 1, paddingBottom: 4 }}>
                        <p style={{ margin: 0, fontSize: 13.5, color: '#E8EAF6', lineHeight: 1.4 }}>
                          {item.activity}
                        </p>
                        {item.company && (
                          <span style={{
                            display: 'inline-block', marginTop: 4,
                            fontSize: 10.5, fontWeight: 500,
                            padding: '2px 8px', borderRadius: 4,
                            color: CO_COLOR[item.company] ?? '#6B7280',
                            background: `${CO_COLOR[item.company] ?? '#6B7280'}18`,
                          }}>
                            {CO_NAME[item.company] ?? item.company}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF' }}>
                  No schedule generated. Try regenerating.
                </p>
              )}
            </div>

            {/* ─── 3. Top 3 Priorities ─────────────────────────────────── */}
            <div className="brief-section" style={{
              background: '#161929',
              border: '1px solid #252A3E',
              borderRadius: 14,
              padding: '24px 26px',
            }}>
              <SectionLabel>Top 3 Priorities</SectionLabel>

              {isGenerating ? (
                <PrioritySkeleton />
              ) : plan?.top3.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {plan.top3.map((title, i) => {
                    const co    = matchCompany(title, tasks)
                    const color = co ? (CO_COLOR[co] ?? '#6B7280') : '#6B7280'
                    return (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        background: '#0D0F1A',
                        border: `1px solid ${i === 0 ? '#1E40AF30' : '#252A3E'}`,
                        borderRadius: 12, padding: '13px 16px',
                        position: 'relative', overflow: 'hidden',
                      }}>
                        {/* Rank badge */}
                        <span style={{
                          width: 28, height: 28, borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, flexShrink: 0,
                          background: i === 0 ? '#1E40AF20' : '#252A3E',
                          color: i === 0 ? '#1E40AF' : '#6B7280',
                        }}>
                          {i + 1}
                        </span>

                        <p style={{ margin: 0, flex: 1, fontSize: 13.5, color: '#E8EAF6', fontWeight: 500 }}>
                          {title}
                        </p>

                        {co && (
                          <span style={{
                            fontSize: 10.5, padding: '2px 8px', borderRadius: 4, flexShrink: 0,
                            color, background: `${color}18`, fontWeight: 500,
                          }}>
                            {CO_NAME[co]}
                          </span>
                        )}

                        {/* Top-priority gold accent */}
                        {i === 0 && (
                          <div style={{
                            position: 'absolute', top: 0, left: 0,
                            width: 3, height: '100%', background: '#1E40AF',
                            borderRadius: '12px 0 0 12px',
                          }} />
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF' }}>
                  Priorities will appear once the plan is generated.
                </p>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ─── 4. Today's Meetings ─────────────────────────────────── */}
            <div className="brief-section" style={{
              background: '#161929',
              border: '1px solid #252A3E',
              borderRadius: 14,
              padding: '24px 22px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                <SectionLabel>Today's Meetings</SectionLabel>
                {todayEvents.length > 0 && (
                  <span style={{ fontSize: 11, color: '#6B7280' }}>
                    {todayEvents.filter(e => getEventStatus(e.start_time, e.end_time) !== 'past').length} remaining
                  </span>
                )}
              </div>

              {todayEvents.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: '#FFFFFF' }}>
                  No meetings today — or connect Google Calendar to see them.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {todayEvents.map(event => {
                    const status     = getEventStatus(event.start_time, event.end_time)
                    const isPast     = status === 'past'
                    const accentClr  = event.calendarColor ?? '#1E40AF'
                    return (
                      <div
                        key={event.id}
                        className="event-row"
                        onClick={() => setSelectedEvent(event)}
                        style={{
                          display: 'flex', gap: 10, alignItems: 'stretch',
                          padding: '10px 12px',
                          borderRadius: 10,
                          background: '#0D0F1A',
                          border: '1px solid #252A3E',
                          opacity: isPast ? 0.5 : 1,
                          transition: 'background 0.15s',
                          cursor: 'pointer',
                        }}
                      >
                        {/* Colored accent bar */}
                        <div style={{
                          width: 3, borderRadius: 2, flexShrink: 0,
                          background: accentClr, alignSelf: 'stretch', minHeight: 32,
                        }} />

                        {/* Time column */}
                        <div style={{ width: 50, flexShrink: 0, textAlign: 'right', paddingTop: 2 }}>
                          <p style={{ margin: 0, fontSize: 11, color: '#E8EAF6', fontWeight: 500 }}>
                            {fmtTime(event.start_time)}
                          </p>
                          <p style={{ margin: '1px 0 0', fontSize: 10, color: '#6B7280' }}>
                            {fmtTime(event.end_time)}
                          </p>
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                            <p style={{
                              margin: 0, fontSize: 12.5, color: '#E8EAF6',
                              fontWeight: 500, lineHeight: 1.3,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              maxWidth: 160,
                            }}>
                              {event.title}
                            </p>
                            <StatusBadge status={status} />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                            <MeetingTypeIcon type={event.meeting_type} />
                            {event.calendarName && (
                              <span style={{
                                fontSize: 10, padding: '1px 6px', borderRadius: 3,
                                background: `${accentClr}15`, border: `1px solid ${accentClr}30`,
                                color: accentClr, fontWeight: 500,
                              }}>
                                {event.calendarName}
                              </span>
                            )}
                            {event.attendees && event.attendees.length > 0 && (
                              <span style={{ fontSize: 10, color: '#6B7280' }}>
                                {event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ─── 5. Habit Status ─────────────────────────────────────── */}
            <div className="brief-section" style={{
              background: '#161929',
              border: '1px solid #252A3E',
              borderRadius: 14,
              padding: '24px 22px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                <SectionLabel>Today's Habits</SectionLabel>
                <span style={{ fontSize: 11, color: checkedHabits === habits.length ? '#1D9E75' : '#6B7280' }}>
                  {checkedHabits}/{habits.length}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {habits.map(habit => (
                  <button
                    key={habit.id}
                    onClick={() => handleHabitToggle(habit.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', borderRadius: 9, width: '100%',
                      background: habit.checked ? '#1D9E7512' : '#0D0F1A',
                      border: `1px solid ${habit.checked ? '#1D9E7540' : '#252A3E'}`,
                      color: habit.checked ? '#1D9E75' : '#6B7280',
                      fontSize: 13, cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    {habit.checked
                      ? <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
                      : <Circle size={15} style={{ flexShrink: 0 }} />}
                    <span style={{ textDecoration: habit.checked ? 'line-through' : 'none', opacity: habit.checked ? 0.75 : 1 }}>
                      {habit.name}
                    </span>
                  </button>
                ))}
              </div>

              {checkedHabits === habits.length && (
                <p style={{
                  margin: '14px 0 0', fontSize: 12, color: '#1D9E75',
                  textAlign: 'center', fontWeight: 500,
                }}>
                  All habits done. Exceptional day ahead. ✓
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
