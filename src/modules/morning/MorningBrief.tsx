import { useState, useEffect, useCallback, useRef } from 'react'
import {
  RefreshCw, Calendar, Users, Video,
  CheckCircle2, Circle, Sparkles,
  X, MapPin, ExternalLink, Copy, Link,
} from 'lucide-react'
import { planMyDay } from '@/lib/professor'
import type { DayPlan } from '@/lib/professor'
import { detectMeetingType } from '@/lib/googleCalendar'
import type { GCalEvent } from '@/lib/googleCalendar'
import { fetchVisibleEvents } from '@/lib/calendarEvents'
import { useAuthStore } from '@/store/authStore'
import { useTaskStore } from '@/store/taskStore'
import type { Task } from '@/types'
import { isTaskHidden } from '@/types'
import type { RichMeetingEvent } from './MorningBriefTypes'
import { DayPlanner } from './DayPlanner'
import { todayKey, buildMockUser, buildContext, loadCachedPlan, savePlan, MOCK_COMPANIES } from './dayPlan'
import { ICON } from '@/lib/type'
import { alpha } from '@/lib/alpha'

// ─── Constants ────────────────────────────────────────────────────────────────

const CO_COLOR: Record<string, string> = {
  teradix:    'var(--sb-info)',
  dxtech:     'var(--sb-info)',
  consulting: 'var(--sb-positive)',
  personal:   'var(--sb-ink-4)',
}

const CO_NAME: Record<string, string> = {
  teradix:    'Teradix',
  dxtech:     'DX Tech',
  consulting: 'Consulting',
  personal:   'Personal',
}

const ENERGY_META = [
  null,
  { label: 'Depleted', color: 'var(--sb-ink-4)' },
  { label: 'Low',      color: 'var(--sb-ink-4)' },
  { label: 'Steady',   color: 'var(--sb-info)' },
  { label: 'Energized',color: 'var(--sb-positive)' },
  { label: 'Peak',     color: 'var(--sb-info)' },
] as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadStoredHabits(): { id: string; name: string }[] {
  try {
    const raw = localStorage.getItem('professor-habits')
    if (!raw) return []
    return (JSON.parse(raw) as { id: string; name: string }[]).slice(0, 6)
  } catch { return [] }
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
  if (status === 'accepted')  return 'var(--sb-positive)'
  if (status === 'declined')  return 'var(--sb-negative)'
  if (status === 'tentative') return 'var(--sb-warning)'
  return 'var(--sb-ink-3)'
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

function matchCompany(title: string, tasks: Task[]): string | null {
  const t = title.toLowerCase()
  const match = tasks.find(task =>
    task.title.toLowerCase().includes(t.slice(0, 12)) ||
    t.includes(task.title.toLowerCase().slice(0, 12)),
  )
  return match?.company ?? null
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skel({ w = '100%', h = 14, radius = 'var(--sb-r-chip)' }: { w?: string | number; h?: number; radius?: string }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        background: 'linear-gradient(90deg, var(--sb-border) 25%, var(--sb-border) 50%, var(--sb-border) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.6s infinite',
        flexShrink: 0,
      }}
    />
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
            background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
            borderRadius: 'var(--sb-r-nav)', padding: '14px 16px',
          }}
        >
          <Skel w={32} h={32} radius="var(--sb-r-pill)" />
          <Skel w={`${60 - i * 8}%`} h={14} />
        </div>
      ))}
    </div>
  )
}

// ─── Meeting icon ──────────────────────────────────────────────────────────────

function MeetingTypeIcon({ type, size = 12 }: { type: string | null; size?: number }) {
  if (type === 'video')       return <Video    size={size} color="var(--sb-info)" />
  if (type === 'one_on_one')  return <Users    size={size} color="var(--sb-positive)" />
  if (type === 'external')    return <Calendar size={size} color="var(--sb-info)" />
  return                             <Users    size={size} color="var(--sb-ink-3)" />
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
    live:     { label: 'Live',     bg: 'color-mix(in srgb, var(--sb-positive) 9.4%, transparent)', border: 'color-mix(in srgb, var(--sb-positive) 25.1%, transparent)', color: 'var(--sb-positive)', pulse: true  },
    soon:     { label: 'Soon',     bg: 'color-mix(in srgb, var(--sb-warning) 9.4%, transparent)', border: 'color-mix(in srgb, var(--sb-warning) 25.1%, transparent)', color: 'var(--sb-warning)', pulse: false },
    upcoming: { label: 'Upcoming', bg: 'rgba(var(--sb-accent-rgb),0.12)', border: 'color-mix(in srgb, var(--sb-info) 40%, transparent)', color: 'var(--sb-info)', pulse: false },
    past:     { label: 'Done',     bg: 'color-mix(in srgb, var(--sb-ink-2) 9.4%, transparent)', border: 'color-mix(in srgb, var(--sb-ink-2) 25.1%, transparent)', color: 'var(--sb-ink-3)', pulse: false },
  }[status]

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 'var(--sb-t-micro)', fontWeight: 600, letterSpacing: '0.5px',
      padding: '2px 7px', borderRadius: 'var(--sb-r-chip)',
      background: cfg.bg, border: `var(--sb-border-width) solid ${cfg.border}`, color: cfg.color,
    }}>
      {cfg.pulse && (
        <span style={{
          width: 5, height: 5, borderRadius: 'var(--sb-r-pill)', background: cfg.color,
          animation: 'livePulse 1.5s ease-in-out infinite',
          display: 'inline-block',
        }} />
      )}
      {cfg.label}
    </span>
  )
}

// ─── Event context menu ───────────────────────────────────────────────────────
function EventContextMenu({
  event,
  pos,
  onClose,
  onViewDetails,
}: {
  event: RichMeetingEvent
  pos: { x: number; y: number }
  onClose: () => void
  onViewDetails: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjPos, setAdjPos] = useState(pos)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  useEffect(() => {
    if (!menuRef.current) return
    const { width, height } = menuRef.current.getBoundingClientRect()
    let x = pos.x, y = pos.y
    if (x + width  > window.innerWidth  - 8) x = pos.x - width
    if (y + height > window.innerHeight - 8) y = window.innerHeight - height - 8
    if (y < 8) y = 8
    if (x < 8) x = 8
    setAdjPos({ x, y })
  }, [pos.x, pos.y])

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [onClose])

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  const joinLink = getJoinLink(event.conferenceData)

  function formatCopyDetails(): string {
    const lines = [
      event.title,
      `${fmtTime(event.start_time)} – ${fmtTime(event.end_time)}`,
    ]
    if (event.location) lines.push(event.location)
    return lines.join('\n')
  }

  const sep: React.CSSProperties = { height: 1, background: 'var(--sb-border)', margin: '3px 8px' }

  function item(
    id: string,
    icon: React.ReactNode,
    label: string,
    action: (() => void) | undefined,
    disabled = false,
  ) {
    const hovered = hoveredItem === id && !disabled
    return (
      <div
        key={id}
        onMouseEnter={() => setHoveredItem(id)}
        onMouseLeave={() => setHoveredItem(null)}
        onClick={disabled ? undefined : () => { action?.(); onClose() }}
        style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '0 12px', height: 32, fontSize: 'var(--sb-t-body)',
          color: disabled ? 'var(--sb-ink-3)' : 'var(--sb-ink-2)',
          cursor: disabled ? 'default' : 'pointer',
          borderRadius: 'var(--sb-r-chip)', userSelect: 'none',
          background: hovered ? 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)' : 'transparent',
          transition: 'background 0.08s',
        }}
      >
        <span style={{ flexShrink: 0, opacity: disabled ? 0.4 : 1 }}>{icon}</span>
        <span>{label}</span>
      </div>
    )
  }

  return (
    <div className="sb-blur-surface"
      ref={menuRef}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
      style={{
        position: 'fixed',
        top: adjPos.y, left: adjPos.x,
        width: 210,
        background: 'var(--sb-overlay)',
        border: 'var(--sb-border-width) solid var(--sb-border)',
        borderRadius: 'var(--sb-r-nav)',
        boxShadow: 'var(--sb-shadow-menu)',
        zIndex: 9100,
        padding: '4px 0',
        overflow: 'hidden',
      }}
    >
      {item('view',   <Calendar size={ICON.sm} />,     'View Details',             onViewDetails)}
      {item('gcal',   <ExternalLink size={ICON.sm} />,  'Open in Google Calendar',  event.htmlLink ? () => window.open(event.htmlLink, '_blank') : undefined, !event.htmlLink)}
      {joinLink && item('join', <Video size={ICON.sm} />, 'Join Meeting', () => window.open(joinLink, '_blank'))}

      <div style={sep} />

      {item('copy-link',    <Link size={ICON.sm} />, 'Copy Event Link',
        event.htmlLink ? () => navigator.clipboard.writeText(event.htmlLink!).catch(() => {}) : undefined,
        !event.htmlLink)}
      {item('copy-details', <Copy size={ICON.sm} />, 'Copy Details',
        () => navigator.clipboard.writeText(formatCopyDetails()).catch(() => {}))}
    </div>
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

  const accentColor = event.calendarColor ?? 'var(--sb-info)'
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
          background: 'var(--sb-overlay)',
          border: `var(--sb-border-width) solid ${alpha(accentColor, 25.1)}`,
          borderTop: `3px solid ${accentColor}`,
          borderRadius: 'var(--sb-r-card)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: `0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px ${alpha(accentColor, 12.5)}`,
          animation: 'slideUp 0.22s ease both',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 22px 16px', borderBottom: 'var(--sb-border-width) solid var(--sb-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 'var(--sb-t-h3)', fontWeight: 700, color: 'var(--sb-ink-1)', lineHeight: 1.35, flex: 1 }}>
              {event.title}
            </h3>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--sb-ink-3)', flexShrink: 0 }}
            >
              <X size={ICON.md} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <StatusBadge status={status} />
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-1)' }}>
              {fmtTime(event.start_time)} – {fmtTime(event.end_time)}
              <span style={{ marginLeft: 6, color: 'var(--sb-ink-3)' }}>({fmtDuration(event.start_time, event.end_time)})</span>
            </span>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '16px 22px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Calendar chip */}
          {event.calendarName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 'var(--sb-r-pill)', background: accentColor, flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)' }}>{event.calendarName}</span>
              {event.accountEmail && (
                <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)' }}>· {event.accountEmail}</span>
              )}
            </div>
          )}

          {/* Meeting type */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MeetingTypeIcon type={event.meeting_type} size={13} />
            <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)' }}>
              <MeetingTypeLabel type={event.meeting_type} />
            </span>
          </div>

          {/* Location */}
          {event.location && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MapPin size={ICON.sm} color="var(--sb-ink-3)" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)' }}>{event.location}</span>
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
                padding: '10px 14px', borderRadius: 'var(--sb-r-chip)',
                background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 25.1%, transparent)',
                color: 'var(--sb-info)', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
                textDecoration: 'none', transition: 'all 0.15s',
              }}
            >
              <Video size={ICON.sm} />
              Join video call
              <ExternalLink size={ICON.sm} style={{ marginLeft: 'auto', opacity: 0.6 }} />
            </a>
          )}

          {/* Description */}
          {event.description && (
            <div style={{
              padding: '12px 14px', borderRadius: 'var(--sb-r-chip)',
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
            }}>
              <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-micro)', fontWeight: 600, color: 'var(--sb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Description
              </p>
              <p style={{
                margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', lineHeight: 1.6,
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
              <p style={{ margin: '0 0 10px', fontSize: 'var(--sb-t-micro)', fontWeight: 600, color: 'var(--sb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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
                        width: 26, height: 26, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
                        background: alpha(accentColor, 13.3), border: `var(--sb-border-width) solid ${alpha(accentColor, 25.1)}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: accentColor,
                      }}>
                        {initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {att.displayName ?? att.email}
                          {att.self && <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', marginLeft: 5 }}>(you)</span>}
                        </p>
                        {att.displayName && (
                          <p style={{ margin: 0, fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {att.email}
                          </p>
                        )}
                      </div>
                      <span style={{
                        fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: rc,
                        width: 16, textAlign: 'center', flexShrink: 0,
                      }} title={att.responseStatus ?? 'No response'}>
                        {rs}
                      </span>
                    </div>
                  )
                })}
                {attendees.length > 8 && (
                  <p style={{ margin: '4px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
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
                fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', textDecoration: 'none',
                marginTop: 4,
              }}
            >
              <ExternalLink size={ICON.sm} />
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
      fontSize: 'var(--sb-t-meta)',
      fontWeight: 600,
      color: 'var(--sb-ink-1)',
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
  const tasks   = useTaskStore(s => s.tasks).filter(t => !isTaskHidden(t))

  const [energyLevel, setEnergyLevel]   = useState<number | null>(null)
  const [plan, setPlan]                 = useState<DayPlan | null>(loadCachedPlan)
  const [isGenerating, setIsGenerating] = useState(!loadCachedPlan())
  // Today's Habits — read real completion state from logs
  const [habits, setHabits] = useState(() => {
    const todayStr = todayKey()
    const logs     = (() => { try { const r = localStorage.getItem('professor-habit-logs'); return r ? JSON.parse(r) as Record<string, string[]> : {} } catch { return {} } })()
    return loadStoredHabits().map(h => ({ ...h, checked: (logs[h.id] ?? []).includes(todayStr) }))
  })
  const [todayEvents, setTodayEvents]     = useState<RichMeetingEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [selectedEvent, setSelectedEvent] = useState<RichMeetingEvent | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ event: RichMeetingEvent; x: number; y: number } | null>(null)

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

    void fetchVisibleEvents(start, end).then(evs => {
      // Build a calendarId → {name, accountEmail} lookup from the cache
      type CacheItem = { id: string; summary?: string; accountEmail: string }
      const calMeta: Record<string, CacheItem> = {}
      try {
        const raw = localStorage.getItem('cal-intel-cals-cache')
        if (raw) {
          (JSON.parse(raw) as CacheItem[]).forEach(c => { calMeta[c.id] = c })
        }
      } catch { /* ignore */ }

      setTodayEvents(
        evs
          .map(e => {
            const rich = e as GCalEvent & { calendarId?: string; calendarColor?: string }
            const meta = rich.calendarId ? calMeta[rich.calendarId] : undefined
            return mapRichEvent(rich, meta?.summary, meta?.accountEmail)
          })
          .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
      )
    }).finally(() => setEventsLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const generate = useCallback(async (energy: number | null = energyLevel) => {
    setIsGenerating(true)
    try {
      const dbUser  = buildMockUser(user)
      const context = buildContext(dbUser, tasks, energy, todayEvents)
      const result  = await planMyDay(context)
      setPlan(result)
      savePlan(result)
    } catch { /* Top-3 errors are silent — DayPlanner shows its own errors */ }
    finally { setIsGenerating(false) }
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

      {/* Event context menu */}
      {ctxMenu && (
        <EventContextMenu
          event={ctxMenu.event}
          pos={{ x: ctxMenu.x, y: ctxMenu.y }}
          onClose={() => setCtxMenu(null)}
          onViewDetails={() => { setCtxMenu(null); setSelectedEvent(ctxMenu.event) }}
        />
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
        .event-row:hover { background: var(--sb-card) !important; cursor: pointer; }
      `}</style>

      <div style={{ padding: '36px 32px 60px', maxWidth: 1080, margin: '0 auto' }}>

        {/* ─── 1. Greeting ───────────────────────────────────────────────── */}
        <div className="brief-section" style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ margin: '0 0 2px', fontSize: 'var(--sb-t-h3)', color: 'var(--sb-ink-1)', fontWeight: 400 }}>
                Good morning,
              </p>
              <h1 style={{
                margin: 0,
                fontSize: 48,
                fontWeight: 800,
                color: 'var(--sb-ink-1)',
                fontFamily: 'var(--sb-font-num)',
                letterSpacing: '-1.5px',
                lineHeight: 1.05,
              }}>
                {firstName}.
              </h1>
              <p style={{ margin: '10px 0 0', fontSize: 'var(--sb-t-label)', color: 'var(--sb-ink-1)' }}>
                {dateStr}
              </p>
            </div>

            <button
              onClick={() => generate()}
              disabled={isGenerating}
              title="Regenerate plan"
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 14px', borderRadius: 'var(--sb-r-chip)',
                background: 'transparent',
                border: 'var(--sb-border-width) solid var(--sb-border)',
                color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer',
                transition: 'all 0.15s',
                opacity: isGenerating ? 0.5 : 1,
              }}
            >
              <RefreshCw size={ICON.sm} style={{ animation: isGenerating ? 'spin 1s linear infinite' : 'none' }} />
              Regenerate plan
            </button>
          </div>

          {/* Divider */}
          <div style={{
            marginTop: 24,
            height: 1,
            background: 'linear-gradient(90deg, color-mix(in srgb, var(--sb-info) 25.1%, transparent) 0%, var(--sb-border) 60%, transparent 100%)',
          }} />
        </div>

        {/* ─── Energy check-in ───────────────────────────────────────────── */}
        <div className="brief-section" style={{
          marginBottom: 36,
          background: 'var(--sb-card)',
          border: 'var(--sb-border-width) solid var(--sb-border)',
          borderRadius: 'var(--sb-r-card)',
          padding: '20px 24px',
        }}>
          <p style={{ margin: '0 0 16px', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>
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
                    width: 44, height: 44, borderRadius: 'var(--sb-r-pill)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 'var(--sb-t-label)', fontWeight: 700,
                    border: `var(--sb-border-width) solid ${selected ? meta.color : 'var(--sb-border)'}`,
                    background: selected ? alpha(meta.color, 13.3) : 'transparent',
                    color: selected ? meta.color : 'var(--sb-ink-3)',
                    boxShadow: selected ? `0 0 14px ${alpha(meta.color, 25.1)}` : 'none',
                    transition: 'all 0.15s',
                  }}>
                    {level}
                  </span>
                  <span style={{
                    fontSize: 'var(--sb-t-micro)', color: selected ? meta.color : 'var(--sb-ink-3)',
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

            {/* ─── 2. AI Day Planner ───────────────────────────────────── */}
            <div className="brief-section" style={{
              background: 'var(--sb-card)',
              border: 'var(--sb-border-width) solid var(--sb-border)',
              borderRadius: 'var(--sb-r-nav)',
              padding: '24px 26px',
              borderLeft: '3px solid color-mix(in srgb, var(--sb-info) 31.4%, transparent)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 20 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 'var(--sb-r-chip)',
                  background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 18.8%, transparent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Sparkles size={ICON.sm} color="var(--sb-info)" />
                </div>
                <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-info)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                  AI Day Planner
                </span>
              </div>

              <DayPlanner
                energyLevel={energyLevel}
                tasks={tasks}
                todayEvents={todayEvents}
                eventsLoading={eventsLoading}
                dbUser={buildMockUser(user)}
                companies={MOCK_COMPANIES}
                date={todayKey()}
              />
            </div>

            {/* ─── 3. Top 3 Priorities ─────────────────────────────────── */}
            <div className="brief-section" style={{
              background: 'var(--sb-card)',
              border: 'var(--sb-border-width) solid var(--sb-border)',
              borderRadius: 'var(--sb-r-card)',
              padding: '24px 26px',
            }}>
              <SectionLabel>Top 3 Priorities</SectionLabel>

              {isGenerating ? (
                <PrioritySkeleton />
              ) : plan?.top3.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {plan.top3.map((title, i) => {
                    const co    = matchCompany(title, tasks)
                    const color = co ? (CO_COLOR[co] ?? 'var(--sb-ink-3)') : 'var(--sb-ink-3)'
                    return (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        background: 'var(--sb-page)',
                        border: `var(--sb-border-width) solid ${i === 0 ? 'rgba(var(--sb-accent-rgb),0.12)' : 'var(--sb-border)'}`,
                        borderRadius: 'var(--sb-r-nav)', padding: '13px 16px',
                        position: 'relative', overflow: 'hidden',
                      }}>
                        {/* Rank badge */}
                        <span style={{
                          width: 28, height: 28, borderRadius: 'var(--sb-r-pill)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 'var(--sb-t-body-s)', fontWeight: 700, flexShrink: 0,
                          background: i === 0 ? 'color-mix(in srgb, var(--sb-info) 12.5%, transparent)' : 'var(--sb-field)',
                          color: i === 0 ? 'var(--sb-info)' : 'var(--sb-ink-3)',
                        }}>
                          {i + 1}
                        </span>

                        <p style={{ margin: 0, flex: 1, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontWeight: 500 }}>
                          {title}
                        </p>

                        {co && (
                          <span style={{
                            fontSize: 'var(--sb-t-micro)', padding: '2px 8px', borderRadius: 'var(--sb-r-chip)', flexShrink: 0,
                            color, background: alpha(color, 9.4), fontWeight: 500,
                          }}>
                            {CO_NAME[co]}
                          </span>
                        )}

                        {/* Top-priority gold accent */}
                        {i === 0 && (
                          <div style={{
                            position: 'absolute', top: 0, left: 0,
                            width: 3, height: '100%', background: 'var(--sb-info)',
                            borderRadius: 'var(--sb-r-nav) 0 0 var(--sb-r-nav)',
                          }} />
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>
                  Priorities will appear once the plan is generated.
                </p>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ─── 4. Today's Meetings ─────────────────────────────────── */}
            <div className="brief-section" style={{
              background: 'var(--sb-card)',
              border: 'var(--sb-border-width) solid var(--sb-border)',
              borderRadius: 'var(--sb-r-card)',
              padding: '24px 22px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                <SectionLabel>Today's Meetings</SectionLabel>
                {todayEvents.length > 0 && (
                  <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
                    {todayEvents.filter(e => getEventStatus(e.start_time, e.end_time) !== 'past').length} remaining
                  </span>
                )}
              </div>

              {todayEvents.length === 0 ? (
                <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>
                  No meetings today — or connect Google Calendar to see them.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {todayEvents.map(event => {
                    const status     = getEventStatus(event.start_time, event.end_time)
                    const isPast     = status === 'past'
                    const accentClr  = event.calendarColor ?? 'var(--sb-info)'
                    return (
                      <div
                        key={event.id}
                        className="event-row"
                        onClick={() => setSelectedEvent(event)}
                        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ event, x: e.clientX, y: e.clientY }) }}
                        style={{
                          display: 'flex', gap: 10, alignItems: 'stretch',
                          padding: '10px 12px',
                          borderRadius: 'var(--sb-r-nav)',
                          background: 'var(--sb-page)',
                          border: 'var(--sb-border-width) solid var(--sb-border)',
                          opacity: isPast ? 0.5 : 1,
                          transition: 'background 0.15s',
                          cursor: 'pointer',
                        }}
                      >
                        {/* Colored accent bar */}
                        <div style={{
                          width: 3, borderRadius: 'var(--sb-r-chip)', flexShrink: 0,
                          background: accentClr, alignSelf: 'stretch', minHeight: 32,
                        }} />

                        {/* Time column */}
                        <div style={{ width: 50, flexShrink: 0, textAlign: 'right', paddingTop: 2 }}>
                          <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-1)', fontWeight: 500 }}>
                            {fmtTime(event.start_time)}
                          </p>
                          <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)' }}>
                            {fmtTime(event.end_time)}
                          </p>
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                            <p style={{
                              margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)',
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
                                fontSize: 'var(--sb-t-micro)', padding: '1px 6px', borderRadius: 'var(--sb-r-chip)',
                                background: alpha(accentClr, 8.2), border: `var(--sb-border-width) solid ${alpha(accentClr, 18.8)}`,
                                color: accentClr, fontWeight: 500,
                              }}>
                                {event.calendarName}
                              </span>
                            )}
                            {event.attendees && event.attendees.length > 0 && (
                              <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)' }}>
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
              background: 'var(--sb-card)',
              border: 'var(--sb-border-width) solid var(--sb-border)',
              borderRadius: 'var(--sb-r-card)',
              padding: '24px 22px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                <SectionLabel>Today's Habits</SectionLabel>
                <span style={{ fontSize: 'var(--sb-t-meta)', color: checkedHabits === habits.length ? 'var(--sb-positive)' : 'var(--sb-ink-3)' }}>
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
                      padding: '10px 14px', borderRadius: 'var(--sb-r-sm)', width: '100%',
                      background: habit.checked ? 'color-mix(in srgb, var(--sb-positive) 7.1%, transparent)' : 'var(--sb-page)',
                      border: `var(--sb-border-width) solid ${habit.checked ? 'color-mix(in srgb, var(--sb-positive) 25.1%, transparent)' : 'var(--sb-border)'}`,
                      color: habit.checked ? 'var(--sb-positive)' : 'var(--sb-ink-3)',
                      fontSize: 'var(--sb-t-body)', cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    {habit.checked
                      ? <CheckCircle2 size={ICON.md} style={{ flexShrink: 0 }} />
                      : <Circle size={ICON.md} style={{ flexShrink: 0 }} />}
                    <span style={{ textDecoration: habit.checked ? 'line-through' : 'none', opacity: habit.checked ? 0.75 : 1 }}>
                      {habit.name}
                    </span>
                  </button>
                ))}
              </div>

              {checkedHabits === habits.length && (
                <p style={{
                  margin: '14px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-positive)',
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
