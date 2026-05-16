import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, RefreshCw,
  AlertTriangle, TrendingUp, Lightbulb, Trophy,
  Mic, Send, ExternalLink, Copy, X as XIcon,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { getGoogleToken } from '@/lib/tokenManager'
import { fetchCalendarEventsWithToken } from '@/lib/googleCalendar'
import type { GCalEvent } from '@/lib/googleCalendar'
import { useAuthStore } from '@/store/authStore'
import { call } from '@/lib/professor'

// ── Constants ─────────────────────────────────────────────────────────────────

const HOUR_PX = 44
const DAY_HOURS = Array.from({ length: 20 }, (_, i) => i + 4) // 4AM – 11PM

const WEEK_SUGGESTIONS = [
  'Fix my back-to-back meetings by adding buffers',
  'Block time for deep work every morning',
  'Schedule 3 workout sessions',
  'Add weekly team sync meetings',
]

// ── Insight analysis ──────────────────────────────────────────────────────────

interface Insight { type: 'warning' | 'tip' | 'win'; message: string }

function analyzeEvents(events: GCalEvent[], weekDays: Date[]): Insight[] {
  const insights: Insight[] = []
  if (!events.length) return insights

  const byDay = weekDays.map(day => {
    const ds = day.toISOString().slice(0, 10)
    return events.filter(e => (e.start?.dateTime ?? e.start?.date ?? '').startsWith(ds))
  })

  const heavyDays = byDay.filter(d => d.length > 3)
  if (heavyDays.length) insights.push({ type: 'warning', message: `${heavyDays.length} meeting-heavy day${heavyDays.length > 1 ? 's' : ''}` })

  let btbCount = 0
  for (const day of byDay) {
    const sorted = [...day].filter(e => e.start?.dateTime && e.end?.dateTime)
      .sort((a, b) => (a.start!.dateTime! > b.start!.dateTime! ? 1 : -1))
    for (let i = 0; i < sorted.length - 1; i++) {
      if (new Date(sorted[i + 1].start!.dateTime!).getTime() - new Date(sorted[i].end!.dateTime!).getTime() < 15 * 60 * 1000) btbCount++
    }
  }
  if (btbCount) insights.push({ type: 'warning', message: `${btbCount} back-to-back meeting${btbCount > 1 ? 's' : ''}` })

  const morningFree = byDay.filter(d => !d.some(e => {
    const h = e.start?.dateTime ? parseInt(e.start.dateTime.slice(11, 13), 10) : 99
    return h >= 7 && h < 11
  }))
  if (morningFree.length >= 2) insights.push({ type: 'tip', message: `${morningFree.length} free mornings — great for deep work` })

  const lightDays = byDay.filter(d => d.length <= 1)
  if (lightDays.length) insights.push({ type: 'win', message: `${lightDays.length} light day${lightDays.length > 1 ? 's' : ''} with minimal meetings` })

  return insights
}

// ── Calendar helpers ──────────────────────────────────────────────────────────

function timeToMin(dateTime: string): number {
  if (!dateTime?.includes('T')) return 0
  return parseInt(dateTime.slice(11, 13), 10) * 60 + parseInt(dateTime.slice(14, 16), 10)
}

function fmtTime(dateTime: string): string {
  if (!dateTime?.includes('T')) return ''
  const h = parseInt(dateTime.slice(11, 13), 10)
  const m = dateTime.slice(14, 16)
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m} ${suffix}`
}

const CALENDAR_COLORS = [
  '#E53935','#8E24AA','#3949AB','#039BE5',
  '#0B8043','#E4C441','#F4511E','#616161',
]

function getEventColor(_e: GCalEvent, i: number): string {
  return CALENDAR_COLORS[i % CALENDAR_COLORS.length]
}

// ── Context menu ──────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number; y: number
  event: GCalEvent
  color: string
}

function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const startStr = menu.event.start?.dateTime ? fmtTime(menu.event.start.dateTime) : ''
  const endStr   = menu.event.end?.dateTime   ? fmtTime(menu.event.end.dateTime)   : ''

  return (
    <>
      {/* Dismiss backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 8000 }} />
      <div style={{
        position: 'fixed', left: menu.x, top: menu.y, zIndex: 8001,
        background: 'var(--color-surface, #161929)',
        border: '1px solid var(--color-border, #252A3E)',
        borderRadius: 10, overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)', minWidth: 220,
      }}>
        {/* Event info header */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border, #252A3E)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: menu.color, flexShrink: 0 }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {menu.event.summary ?? 'Event'}
            </div>
          </div>
          {(startStr || endStr) && (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)', marginTop: 4, paddingLeft: 18 }}>
              {startStr}{endStr ? ` – ${endStr}` : ''}
            </div>
          )}
          {menu.event.location && (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)', marginTop: 2, paddingLeft: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              📍 {menu.event.location}
            </div>
          )}
        </div>
        {/* Actions */}
        {[
          {
            icon: <Copy size={12} />, label: 'Copy title',
            action: () => { navigator.clipboard.writeText(menu.event.summary ?? '').catch(() => {}); onClose() },
          },
          menu.event.htmlLink ? {
            icon: <ExternalLink size={12} />, label: 'Open in Google Calendar',
            action: () => { window.open(menu.event.htmlLink, '_blank'); onClose() },
          } : null,
          {
            icon: <XIcon size={12} />, label: 'Dismiss',
            action: onClose,
          },
        ].filter(Boolean).map((item, i) => item && (
          <button key={i} onClick={item.action} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, color: 'var(--color-text-dim, #C0C4D6)', textAlign: 'left',
            borderBottom: i < 1 ? '1px solid var(--color-border, #252A3E)' : 'none',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>
    </>
  )
}

// ── Week Calendar ─────────────────────────────────────────────────────────────

interface WeekCalendarProps {
  events: GCalEvent[]
  weekStart: Date
  viewMode: 'week' | 'day'
  selectedDay: number
  onSelectDay: (i: number) => void
  onEventContextMenu: (e: React.MouseEvent, event: GCalEvent, color: string) => void
}

function WeekCalendar({ events, weekStart, viewMode, selectedDay, onSelectDay, onEventContextMenu }: WeekCalendarProps) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d
  })
  const visibleDays = viewMode === 'day' ? [days[selectedDay]] : days
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Day headers */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border, #252A3E)', flexShrink: 0 }}>
        <div style={{ width: 52, flexShrink: 0 }} />
        {visibleDays.map((d, i) => {
          const ds = d.toISOString().slice(0, 10)
          const isToday = ds === today
          return (
            <div key={i} onClick={() => onSelectDay(days.indexOf(d))} style={{
              flex: 1, padding: '8px 0', textAlign: 'center', cursor: 'pointer',
              borderLeft: i > 0 ? '1px solid var(--color-border, #252A3E)' : undefined,
            }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)', fontWeight: 600, letterSpacing: '0.04em' }}>
                {d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}
              </div>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', margin: '4px auto 0',
                background: isToday ? '#F97316' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 14, fontWeight: isToday ? 700 : 500, color: isToday ? '#fff' : 'var(--color-text, #E8EAF6)' }}>
                  {d.getDate()}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex' }}>
        <div style={{ width: 52, flexShrink: 0 }}>
          {DAY_HOURS.map(h => (
            <div key={h} style={{ height: HOUR_PX, display: 'flex', alignItems: 'flex-start', paddingTop: 4, paddingRight: 8, justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted, #6B7280)', fontWeight: 500 }}>
                {h === 12 ? '12PM' : h < 12 ? `${h}AM` : `${h - 12}PM`}
              </span>
            </div>
          ))}
        </div>
        {visibleDays.map((d, di) => {
          const ds = d.toISOString().slice(0, 10)
          const dayEvents = events.filter(e => {
            const s = e.start?.dateTime ?? e.start?.date ?? ''
            return s.startsWith(ds) && e.start?.dateTime
          }).sort((a, b) => (a.start!.dateTime! > b.start!.dateTime! ? 1 : -1))

          const startMin = DAY_HOURS[0] * 60
          const endMin   = (DAY_HOURS[DAY_HOURS.length - 1] + 1) * 60
          const totalMin = endMin - startMin

          return (
            <div key={di} style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--color-border, #252A3E)', minHeight: HOUR_PX * DAY_HOURS.length }}>
              {DAY_HOURS.map(h => (
                <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - DAY_HOURS[0]) * HOUR_PX, height: HOUR_PX, borderBottom: '1px solid rgba(255,255,255,0.04)' }} />
              ))}
              {dayEvents.map((evt, ei) => {
                const sMin = timeToMin(evt.start!.dateTime!)
                const eMin = timeToMin(evt.end?.dateTime ?? evt.start!.dateTime!)
                const dur  = Math.max(eMin - sMin, 30)
                const top  = ((sMin - startMin) / totalMin) * (HOUR_PX * DAY_HOURS.length)
                const height = (dur / totalMin) * (HOUR_PX * DAY_HOURS.length)
                const color = getEventColor(evt, ei)
                return (
                  <div key={ei}
                    onContextMenu={e => { e.preventDefault(); onEventContextMenu(e, evt, color) }}
                    style={{
                      position: 'absolute',
                      top: Math.max(0, top), left: 2, right: 2,
                      height: Math.max(18, height - 2),
                      background: color, borderRadius: 4,
                      padding: '2px 5px', overflow: 'hidden', cursor: 'context-menu',
                    }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {evt.summary ?? 'Event'}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Chat message ──────────────────────────────────────────────────────────────

interface ChatMessage { role: 'user' | 'assistant'; text: string }

// ── Main component ────────────────────────────────────────────────────────────

export function PlanningAssistant() {
  const user = useAuthStore(s => s.user)

  const [events, setEvents]           = useState<GCalEvent[]>([])
  const [loading, setLoading]         = useState(false)
  const [weekOffset, setWeekOffset]   = useState(0)
  const [viewMode, setViewMode]       = useState<'week' | 'day'>('week')
  const [selectedDay, setSelectedDay] = useState(() => {
    const d = new Date().getDay(); return d === 0 ? 6 : d - 1
  })
  const [chatInput, setChatInput]     = useState('')
  const [messages, setMessages]       = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  const weekStart = useMemo(() => {
    const now  = new Date()
    const day  = now.getDay()
    const diff = (day === 0 ? -6 : 1 - day) + weekOffset * 7
    const start = new Date(now); start.setDate(now.getDate() + diff); start.setHours(0, 0, 0, 0)
    return start
  }, [weekOffset])

  const weekEnd = useMemo(() => {
    const end = new Date(weekStart); end.setDate(end.getDate() + 7); return end
  }, [weekStart])

  const weekLabel = (() => {
    const s = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const e = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${s} – ${e}`
  })()

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const token = await getGoogleToken(user?.email ?? '')
        if (!token || cancelled) return
        const evts = await fetchCalendarEventsWithToken(token, 'primary', weekStart, weekEnd)
        if (!cancelled) setEvents(evts)
      } catch { /**/ }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [weekStart, user?.email])

  const insights = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart); d.setDate(d.getDate() + i); return d
    })
    return analyzeEvents(events, days)
  }, [events, weekStart])

  const warnings = insights.filter(i => i.type === 'warning')
  const tips     = insights.filter(i => i.type === 'tip')
  const wins     = insights.filter(i => i.type === 'win')

  async function sendChat() {
    const q = chatInput.trim()
    if (!q || chatLoading) return
    setMessages(prev => [...prev, { role: 'user', text: q }])
    setChatInput('')
    setChatLoading(true)
    try {
      const system = 'You are The Professor — a premium AI executive productivity assistant. Help the user plan their schedule with actionable advice. Be concise (2-3 sentences).'
      const prompt = `Calendar this week: ${events.length} events. Insights: ${insights.map(i => i.message).join('; ')}. User: "${q}"`
      const reply = await call(system, prompt)
      setMessages(prev => [...prev, { role: 'assistant', text: reply }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Could not analyze your schedule right now.' }])
    } finally { setChatLoading(false) }
    setTimeout(() => chatRef.current?.scrollTo({ top: 9999, behavior: 'smooth' }), 50)
  }

  const handleEventContextMenu = useCallback((e: React.MouseEvent, event: GCalEvent, color: string) => {
    e.stopPropagation()
    // Keep menu inside viewport
    const x = Math.min(e.clientX, window.innerWidth - 240)
    const y = Math.min(e.clientY, window.innerHeight - 200)
    setContextMenu({ x, y, event, color })
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <TopBar title="Planning Assistant" subtitle="Plan your schedule with AI" />

      {/* Context menu */}
      {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />}

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* ── Left panel: fixed layout, no outer scroll ── */}
        <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border, #252A3E)', overflow: 'hidden' }}>

          {/* Scrollable top: insights + suggestions */}
          <div style={{ flexShrink: 0, overflowY: 'auto', padding: '20px 20px 0', maxHeight: '58%' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <span style={{ fontSize: 20 }}>✦</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-text, #E8EAF6)' }}>Planning Assistant</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)' }}>Plan your schedule with AI</div>
              </div>
              <button onClick={() => { setWeekOffset(0); setEvents([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', display: 'flex', padding: 4, borderRadius: 6 }}>
                <RefreshCw size={14} />
              </button>
            </div>

            {/* Schedule Insights */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <TrendingUp size={14} color="var(--color-accent, #7F77DD)" />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text, #E8EAF6)' }}>Schedule Insights</span>
              </div>
              {loading ? (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted, #6B7280)', fontStyle: 'italic' }}>Analyzing your week…</div>
              ) : insights.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted, #6B7280)', fontStyle: 'italic' }}>Connect your calendar to see insights</div>
              ) : (
                <>
                  {insights.map((ins, i) => (
                    <div key={i} onClick={() => setChatInput(`Help me with: ${ins.message}`)} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, marginBottom: 6, cursor: 'pointer',
                      background: ins.type === 'warning' ? 'rgba(251,191,36,0.08)' : ins.type === 'win' ? 'rgba(52,211,153,0.08)' : 'rgba(127,119,221,0.08)',
                      border: `1px solid ${ins.type === 'warning' ? 'rgba(251,191,36,0.2)' : ins.type === 'win' ? 'rgba(52,211,153,0.2)' : 'rgba(127,119,221,0.2)'}`,
                    }}>
                      {ins.type === 'warning' && <AlertTriangle size={13} color="#FBBF24" />}
                      {ins.type === 'tip'     && <Lightbulb size={13} color="#7F77DD" />}
                      {ins.type === 'win'     && <Trophy size={13} color="#34D399" />}
                      <span style={{ fontSize: 12, color: 'var(--color-text-dim, #C0C4D6)', fontWeight: 500 }}>{ins.message}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {warnings.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: 'rgba(251,191,36,0.12)', color: '#FBBF24' }}>{warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>}
                    {tips.length > 0    && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: 'rgba(127,119,221,0.12)', color: '#9B94E8' }}>{tips.length} tip{tips.length > 1 ? 's' : ''}</span>}
                    {wins.length > 0    && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: 'rgba(52,211,153,0.12)', color: '#34D399' }}>{wins.length} win{wins.length > 1 ? 's' : ''}</span>}
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--color-text-muted, #6B7280)', fontStyle: 'italic' }}>Click an insight to get help</p>
                </>
              )}
            </div>

            <div style={{ height: 1, background: 'var(--color-border, #252A3E)', margin: '4px 0 20px' }} />

            {/* Plan Your Week */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 14 }}>📅</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text, #E8EAF6)' }}>Plan Your Week</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {WEEK_SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => setChatInput(s)} style={{
                    padding: '8px 12px', borderRadius: 8, textAlign: 'left', cursor: 'pointer', fontSize: 12,
                    background: 'var(--color-bg, #0D0F1A)', border: '1px solid var(--color-border, #252A3E)',
                    color: 'var(--color-text-dim, #C0C4D6)', fontWeight: 400,
                  }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Chat messages — grows to fill remaining space */}
          <div ref={chatRef} style={{
            flex: 1, overflowY: 'auto', padding: '8px 20px',
            display: 'flex', flexDirection: 'column', gap: 8,
            borderTop: '1px solid var(--color-border, #252A3E)',
          }}>
            {messages.length === 0 && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted, #6B7280)', textAlign: 'center', fontStyle: 'italic' }}>
                  Ask me anything about your schedule…
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                padding: '8px 11px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                background: m.role === 'user' ? 'var(--color-accent, #7F77DD)' : 'var(--color-bg, #0D0F1A)',
                color: m.role === 'user' ? '#fff' : 'var(--color-text-dim, #C0C4D6)',
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                border: m.role === 'assistant' ? '1px solid var(--color-border, #252A3E)' : 'none',
              }}>
                {m.text}
              </div>
            ))}
            {chatLoading && (
              <div style={{ padding: '8px 11px', borderRadius: 8, fontSize: 12, color: 'var(--color-text-muted, #6B7280)', border: '1px solid var(--color-border, #252A3E)', background: 'var(--color-bg, #0D0F1A)', alignSelf: 'flex-start' }}>
                Thinking…
              </div>
            )}
          </div>

          {/* Chat input — pinned to bottom */}
          <div style={{ flexShrink: 0, padding: '10px 20px 16px', borderTop: '1px solid var(--color-border, #252A3E)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat() } }}
                  placeholder="Describe your ideal schedule…"
                  style={{
                    width: '100%', background: 'var(--color-bg, #0D0F1A)',
                    border: `1.5px solid ${chatInput ? 'var(--color-accent, #7F77DD)' : 'var(--color-border, #252A3E)'}`,
                    borderRadius: 20, padding: '9px 36px 9px 14px',
                    color: 'var(--color-text, #E8EAF6)', fontSize: 12.5, outline: 'none',
                    boxSizing: 'border-box', transition: 'border-color 0.15s',
                  }}
                />
                <button style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', display: 'flex', padding: 0 }}>
                  <Mic size={13} />
                </button>
              </div>
              <button onClick={() => void sendChat()} disabled={!chatInput.trim() || chatLoading} style={{
                width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: chatInput.trim() ? 'pointer' : 'default',
                background: chatInput.trim() ? 'var(--color-accent, #7F77DD)' : 'var(--color-border, #252A3E)',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.15s', flexShrink: 0,
              }}>
                <Send size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Right panel: calendar ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--color-border, #252A3E)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <button onClick={() => setWeekOffset(o => o - 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', display: 'flex', padding: 4, borderRadius: 6 }}>
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => setWeekOffset(o => o + 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', display: 'flex', padding: 4, borderRadius: 6 }}>
              <ChevronRight size={18} />
            </button>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text, #E8EAF6)', flex: 1 }}>{weekLabel}</span>
            <div style={{ display: 'flex', background: 'var(--color-bg, #0D0F1A)', borderRadius: 8, padding: 2, border: '1px solid var(--color-border, #252A3E)' }}>
              {(['day', 'week'] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)} style={{
                  padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: viewMode === m ? 'var(--color-surface, #161929)' : 'transparent',
                  border: 'none',
                  color: viewMode === m ? 'var(--color-text, #E8EAF6)' : 'var(--color-text-muted, #6B7280)',
                  transition: 'all 0.12s',
                }}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <WeekCalendar
            events={events} weekStart={weekStart}
            viewMode={viewMode} selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            onEventContextMenu={handleEventContextMenu}
          />
        </div>
      </div>
    </div>
  )
}
