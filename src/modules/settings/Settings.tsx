import { useState, useRef, useEffect, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
} from '@dnd-kit/core'

type DndListeners = Record<string, React.EventHandler<React.SyntheticEvent>>
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Trash2, GripVertical, Check, RefreshCw, Wifi, WifiOff, LogIn, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { signInWithGoogle, signOut as googleSignOut } from '@/lib/google'
import { useUIStore } from '@/store/uiStore'
import { THEMES, getTheme, applyThemeVars, resolveThemeId } from '@/lib/themes'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AppSettings {
  // Profile
  fullName: string
  timezone: string
  workWeek: string[]
  framework: string
  // Schedule
  focusStart: string
  focusEnd: string
  earliestMeeting: string
  bufferMins: number
  physicalBufferMins: number
  endOfDay: string
  familyStart: string
  protectFocus: boolean
  autoDeclineEarly: boolean
  // Professor AI
  commStyle: 'brief' | 'balanced' | 'detailed'
  proactive: boolean
  briefTime: string
  reviewDay: string
  customInstructions: string
  // Notifications
  morningReminderOn: boolean
  morningReminderTime: string
  windDownOn: boolean
  windDownTime: string
  followUpNudges: boolean
  weeklyReviewOn: boolean
  weeklyReviewDay: string
  weeklyReviewTime: string
  // Appearance
  theme: string
  sidebarDefault: boolean
  compact: boolean
}

interface CompanyRow {
  id: string
  name: string
  color: string
  calendarId: string
  isActive: boolean
}

interface HabitRow {
  id: string
  emoji: string
  name: string
  frequency: 'daily' | 'weekdays' | 'weekly'
  isActive: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

function getUtcOffset(tz: string): string {
  try {
    const offset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value ?? 'UTC'
    return offset === 'GMT' ? 'UTC+0' : offset.replace('GMT', 'UTC')
  } catch {
    return 'UTC'
  }
}

const ALL_TIMEZONES: { value: string; label: string; offset: number }[] = (() => {
  const zones: string[] = Intl.supportedValuesOf
    ? Intl.supportedValuesOf('timeZone')
    : ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
       'America/Toronto', 'America/Vancouver', 'Europe/London', 'Europe/Paris',
       'Europe/Berlin', 'Europe/Amsterdam', 'Asia/Dubai', 'Asia/Kolkata',
       'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland']
  return zones.map(tz => {
    const offsetStr = getUtcOffset(tz)
    const sign = offsetStr.includes('-') ? -1 : 1
    const parts = offsetStr.replace('UTC', '').replace('+', '').replace('-', '').split(':')
    const offsetMins = sign * ((parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0))
    return { value: tz, label: `(${offsetStr}) ${tz.replace(/_/g, ' ')}`, offset: offsetMins }
  }).sort((a, b) => a.offset - b.offset || a.value.localeCompare(b.value))
})()

const FRAMEWORKS = [
  { value: 'time_blocking', label: 'Time Blocking' },
  { value: 'gtd',           label: 'GTD (Getting Things Done)' },
  { value: 'deep_work',     label: 'Deep Work' },
  { value: 'eisenhower',    label: 'Eisenhower Matrix' },
  { value: 'pomodoro',      label: 'Pomodoro' },
  { value: '12_week_year',  label: '12-Week Year' },
]

const WORK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const C_COLORS = ['#1E40AF', '#7F77DD', '#1D9E75', '#E05252', '#888780', '#5B9BD5']

const EMOJIS = [
  '💼','🎯','🚀','📊','💡','🔧','📝','🌟','⚡','🎨',
  '🏆','📱','💻','🤝','📈','🌿','🔬','🏗️','💰','🌍',
]

const BUFFER_STEPS  = [0, 15, 30, 45, 60]
const PHYS_STEPS    = [0, 30, 60, 90]

const DEFAULTS: AppSettings = {
  fullName: '', timezone: 'America/New_York',
  workWeek: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], framework: 'time_blocking',
  focusStart: '09:00', focusEnd: '11:00', earliestMeeting: '10:00',
  bufferMins: 30, physicalBufferMins: 60,
  endOfDay: '17:00', familyStart: '18:00',
  protectFocus: true, autoDeclineEarly: true,
  commStyle: 'balanced', proactive: true,
  briefTime: '07:00', reviewDay: 'Sunday', customInstructions: '',
  morningReminderOn: true, morningReminderTime: '07:00',
  windDownOn: true, windDownTime: '21:00', followUpNudges: true,
  weeklyReviewOn: true, weeklyReviewDay: 'Sunday', weeklyReviewTime: '18:00',
  theme: 'navy-night', sidebarDefault: false, compact: false,
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function localSaveSettings(s: AppSettings) {
  try { localStorage.setItem('professor-settings', JSON.stringify(s)) } catch { /* quota */ }
}

function localLoadSettings(): AppSettings | null {
  try {
    const raw = localStorage.getItem('professor-settings')
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) } : null
  } catch { return null }
}

function localSaveCompanies(companies: CompanyRow[]) {
  try { localStorage.setItem('professor-companies', JSON.stringify(companies)) } catch { /* quota */ }
}

function localLoadCompanies(): CompanyRow[] {
  try {
    const raw = localStorage.getItem('professor-companies')
    return raw ? (JSON.parse(raw) as CompanyRow[]) : []
  } catch { return [] }
}

function localSaveHabits(habits: HabitRow[]) {
  try { localStorage.setItem('professor-habit-config', JSON.stringify(habits)) } catch { /* quota */ }
}

function localLoadHabits(): HabitRow[] {
  try {
    const raw = localStorage.getItem('professor-habit-config')
    return raw ? (JSON.parse(raw) as HabitRow[]) : []
  } catch { return [] }
}

// ─── Google Calendar list helper ──────────────────────────────────────────────

interface GCalCalendar { id: string; summary: string; primary?: boolean }

async function fetchGCalendars(token: string): Promise<GCalCalendar[]> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const data = (await res.json()) as { items?: GCalCalendar[] }
  return data.items ?? []
}

// ─── Theme (delegates to themes.ts) ───────────────────────────────────────────

function applyTheme(id: string) {
  applyThemeVars(getTheme(id))
}

// ─── Shared style objects ─────────────────────────────────────────────────────

const S = {
  card: {
    background: '#161929',
    border: '1px solid #252A3E',
    borderRadius: 12,
    padding: '24px 28px',
    marginBottom: 20,
  } as React.CSSProperties,

  input: {
    background: '#0D0F1A',
    border: '1px solid #252A3E',
    borderRadius: 7,
    color: '#E8EAF6',
    fontSize: 13.5,
    padding: '7px 11px',
    outline: 'none',
    fontFamily: 'DM Sans, sans-serif',
    width: '100%',
  } as React.CSSProperties,

  select: {
    background: '#0D0F1A',
    border: '1px solid #252A3E',
    borderRadius: 7,
    color: '#E8EAF6',
    fontSize: 13.5,
    padding: '7px 11px',
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  } as React.CSSProperties,
}

// ─── Shared UI components ─────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 3, height: 13, background: 'var(--color-accent, #60A5FA)', borderRadius: 2, flexShrink: 0 }} />
        <span style={{
          fontSize: 10.5, fontWeight: 700,
          color: 'var(--color-accent-bright, #93C5FD)',
          textTransform: 'uppercase', letterSpacing: '1.4px',
        }}>
          {title}
        </span>
      </div>
      {description && (
        <p style={{ margin: '5px 0 0 11px', fontSize: 12, color: 'var(--color-text-dim, #94A3B8)', lineHeight: 1.55 }}>
          {description}
        </p>
      )}
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 16,
      padding: '11px 0', borderBottom: '1px solid var(--color-border, #252A3E)',
    }}>
      <span style={{ width: 210, fontSize: 13, color: 'var(--color-text, #E8EAF6)', flexShrink: 0, paddingTop: 2 }}>
        {label}
      </span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 42, height: 24, borderRadius: 12,
        background: checked ? '#1E40AF' : '#252A3E',
        border: 'none', cursor: 'pointer', position: 'relative',
        transition: 'background 0.2s', flexShrink: 0, padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 4,
        left: checked ? 22 : 4,
        width: 16, height: 16, borderRadius: '50%',
        background: checked ? '#0D0F1A' : '#6B7280',
        transition: 'left 0.2s', display: 'block',
      }} />
    </button>
  )
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ ...S.input, width: 130, colorScheme: 'dark' }}
    />
  )
}

function StepSlider({
  value, onChange, steps, unit = 'min',
}: { value: number; onChange: (v: number) => void; steps: number[]; unit?: string }) {
  const idx = Math.max(0, steps.indexOf(value))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <input
        type="range"
        min={0} max={steps.length - 1} step={1}
        value={idx}
        onChange={e => onChange(steps[Number(e.target.value)])}
        style={{ width: 160, accentColor: '#1E40AF', cursor: 'pointer' }}
      />
      <span style={{ fontSize: 13, color: '#E8EAF6', minWidth: 55 }}>
        {value} {unit}
      </span>
    </div>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {C_COLORS.map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          style={{
            width: 20, height: 20, borderRadius: '50%', background: c,
            border: value === c ? '2px solid #E8EAF6' : '2px solid transparent',
            outline: value === c ? `2px solid ${c}` : 'none',
            outlineOffset: 1, cursor: 'pointer', padding: 0,
          }}
        />
      ))}
    </div>
  )
}

function EmojiPickerBtn({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 18, background: '#0D0F1A', border: '1px solid #252A3E',
          borderRadius: 7, width: 38, height: 34, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {value}
      </button>
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 49 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: 'absolute', top: 40, left: 0, zIndex: 50,
            background: '#161929', border: '1px solid #252A3E', borderRadius: 10,
            padding: 10, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}>
            {EMOJIS.map(em => (
              <button
                key={em}
                onClick={() => { onChange(em); setOpen(false) }}
                style={{
                  fontSize: 18, background: 'transparent', border: 'none',
                  cursor: 'pointer', width: 34, height: 34, borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#252A3E')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {em}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SaveBadge({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') return null
  const isErr = status === 'error'
  return (
    <div style={{
      position: 'fixed', top: 76, right: 24,
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 13px', borderRadius: 20,
      background: isErr ? 'rgba(224,82,82,0.12)' : 'rgba(29,158,117,0.12)',
      border: `1px solid ${isErr ? 'rgba(224,82,82,0.3)' : 'rgba(29,158,117,0.3)'}`,
      color: isErr ? '#E05252' : '#1D9E75',
      fontSize: 12, fontWeight: 500, zIndex: 100,
    }}>
      {status === 'saving'
        ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} />
        : <Check size={11} />
      }
      {status === 'saving' ? 'Saving…' : isErr ? 'Save failed' : 'Saved'}
    </div>
  )
}

function SortableRow({
  id, children,
}: {
  id: string
  children: (drag: { listeners: DndListeners | undefined; attributes: DraggableAttributes }) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition, opacity: isDragging ? 0.45 : 1,
        position: 'relative', zIndex: isDragging ? 10 : 'auto',
      }}
    >
      {children({ listeners: listeners as DndListeners | undefined, attributes })}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function Settings() {
  const { setSidebarCollapsed, setThemeId } = useUIStore()
  const [s, setS] = useState<AppSettings>(() => localLoadSettings() ?? DEFAULTS)
  const [companies,   setCompanies]   = useState<CompanyRow[]>(() => localLoadCompanies())
  const [habits,      setHabits]      = useState<HabitRow[]>(() => localLoadHabits())
  const [saveStatus,  setSaveStatus]  = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [connected,   setConnected]   = useState(false)
  const [connEmail,   setConnEmail]   = useState('')
  const [gcalendars,  setGcalendars]  = useState<GCalCalendar[]>([])
  const [calLoading,  setCalLoading]  = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const uid   = useRef<string | null>(null)

  // ── Apply persisted settings on mount ───────────────────────────────────
  useEffect(() => {
    const saved = localLoadSettings()
    if (saved) {
      const id = resolveThemeId(saved.theme)
      applyTheme(id)
      setThemeId(id)
      if (saved.sidebarDefault) setSidebarCollapsed(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Sync companies & habits to localStorage whenever they change ─────────
  useEffect(() => { localSaveCompanies(companies) }, [companies])
  useEffect(() => { localSaveHabits(habits) }, [habits])

  // ── Load from Supabase on mount ──────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session) return
      uid.current = session.session.user.id

      // Google connection status
      const providerToken = session.session.provider_token
      if (providerToken) {
        setConnected(true)
        setConnEmail(session.session.user.email ?? '')
        setCalLoading(true)
        const cals = await fetchGCalendars(providerToken)
        setGcalendars(cals)
        setCalLoading(false)
      }

      const { data: u } = await supabase
        .from('users')
        .select('full_name, active_framework, schedule_rules')
        .eq('id', uid.current)
        .single()

      if (u) {
        const r = (u.schedule_rules ?? {}) as Record<string, unknown>
        const loaded: AppSettings = {
          ...DEFAULTS,
          fullName:            (u.full_name as string)                           ?? DEFAULTS.fullName,
          framework:           (u.active_framework as string)                    ?? DEFAULTS.framework,
          timezone:            (r.timezone as string)                            ?? DEFAULTS.timezone,
          workWeek:            (r.work_week as string[])                         ?? DEFAULTS.workWeek,
          focusStart:          (r.focus_start as string)                         ?? DEFAULTS.focusStart,
          focusEnd:            (r.focus_end as string)                           ?? DEFAULTS.focusEnd,
          earliestMeeting:     (r.earliest_meeting as string)                    ?? DEFAULTS.earliestMeeting,
          bufferMins:          (r.buffer_mins as number)                         ?? DEFAULTS.bufferMins,
          physicalBufferMins:  (r.physical_buffer_mins as number)                ?? DEFAULTS.physicalBufferMins,
          endOfDay:            (r.end_of_day as string)                          ?? DEFAULTS.endOfDay,
          familyStart:         (r.family_start as string)                        ?? DEFAULTS.familyStart,
          protectFocus:        (r.protect_focus as boolean)                      ?? DEFAULTS.protectFocus,
          autoDeclineEarly:    (r.auto_decline_early as boolean)                 ?? DEFAULTS.autoDeclineEarly,
          commStyle:           (r.comm_style as AppSettings['commStyle'])        ?? DEFAULTS.commStyle,
          proactive:           (r.proactive as boolean)                          ?? DEFAULTS.proactive,
          briefTime:           (r.brief_time as string)                          ?? DEFAULTS.briefTime,
          reviewDay:           (r.review_day as string)                          ?? DEFAULTS.reviewDay,
          customInstructions:  (r.custom_instructions as string)                 ?? DEFAULTS.customInstructions,
          morningReminderOn:   (r.morning_reminder_on as boolean)                ?? DEFAULTS.morningReminderOn,
          morningReminderTime: (r.morning_reminder_time as string)               ?? DEFAULTS.morningReminderTime,
          windDownOn:          (r.wind_down_on as boolean)                       ?? DEFAULTS.windDownOn,
          windDownTime:        (r.wind_down_time as string)                      ?? DEFAULTS.windDownTime,
          followUpNudges:      (r.follow_up_nudges as boolean)                   ?? DEFAULTS.followUpNudges,
          weeklyReviewOn:      (r.weekly_review_on as boolean)                   ?? DEFAULTS.weeklyReviewOn,
          weeklyReviewDay:     (r.weekly_review_day as string)                   ?? DEFAULTS.weeklyReviewDay,
          weeklyReviewTime:    (r.weekly_review_time as string)                  ?? DEFAULTS.weeklyReviewTime,
          theme:               (r.theme as AppSettings['theme'])                 ?? DEFAULTS.theme,
          sidebarDefault:      (r.sidebar_default as boolean)                    ?? DEFAULTS.sidebarDefault,
          compact:             (r.compact as boolean)                            ?? DEFAULTS.compact,
        }
        setS(loaded)
        const resolvedId = resolveThemeId(loaded.theme)
        applyTheme(resolvedId)
        setThemeId(resolvedId)
      }

      const { data: cos } = await supabase
        .from('companies').select('id,name,color_tag,calendar_id,is_active')
        .eq('user_id', uid.current).order('name')
      if (cos) setCompanies(cos.map(c => ({
        id: c.id, name: c.name ?? '', color: c.color_tag ?? C_COLORS[0],
        calendarId: c.calendar_id ?? '', isActive: c.is_active ?? true,
      })))

      const { data: hbs } = await supabase
        .from('habits').select('id,name,frequency,is_active')
        .eq('user_id', uid.current).order('name')
      if (hbs) setHabits(hbs.map(h => ({
        id: h.id, emoji: '🎯', name: h.name ?? '',
        frequency: (h.frequency as HabitRow['frequency']) ?? 'daily',
        isActive: h.is_active ?? true,
      })))
    })()
  }, [])

  // ── Auto-save main settings ──────────────────────────────────────────────
  const scheduleSave = useCallback((next: AppSettings) => {
    clearTimeout(timer.current)
    setSaveStatus('saving')
    localSaveSettings(next) // always save to localStorage immediately
    timer.current = setTimeout(async () => {
      try {
        if (uid.current) {
          const { data: sessionData } = await supabase.auth.getSession()
          await supabase.from('users').upsert({
            id: uid.current,
            email: sessionData.session?.user.email ?? '',
            full_name: next.fullName,
            active_framework: next.framework,
            schedule_rules: {
              timezone: next.timezone, work_week: next.workWeek,
              focus_start: next.focusStart, focus_end: next.focusEnd,
              earliest_meeting: next.earliestMeeting,
              buffer_mins: next.bufferMins, physical_buffer_mins: next.physicalBufferMins,
              end_of_day: next.endOfDay, family_start: next.familyStart,
              protect_focus: next.protectFocus, auto_decline_early: next.autoDeclineEarly,
              comm_style: next.commStyle, proactive: next.proactive,
              brief_time: next.briefTime, review_day: next.reviewDay,
              custom_instructions: next.customInstructions,
              morning_reminder_on: next.morningReminderOn, morning_reminder_time: next.morningReminderTime,
              wind_down_on: next.windDownOn, wind_down_time: next.windDownTime,
              follow_up_nudges: next.followUpNudges,
              weekly_review_on: next.weeklyReviewOn, weekly_review_day: next.weeklyReviewDay,
              weekly_review_time: next.weeklyReviewTime,
              theme: next.theme, sidebar_default: next.sidebarDefault, compact: next.compact,
            },
          }, { onConflict: 'id' })
        }
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('error')
        setTimeout(() => setSaveStatus('idle'), 3000)
      }
    }, 800)
  }, [])

  function update<K extends keyof AppSettings>(key: K, val: AppSettings[K]) {
    const next = { ...s, [key]: val }
    setS(next)
    scheduleSave(next)
    if (key === 'theme') {
      const id = resolveThemeId(val as string)
      applyTheme(id)
      setThemeId(id)
    }
    if (key === 'sidebarDefault') setSidebarCollapsed(val as boolean)
  }

  // ── Company helpers ──────────────────────────────────────────────────────
  async function addCompany() {
    const id = crypto.randomUUID()
    const row: CompanyRow = { id, name: '', color: C_COLORS[0], calendarId: '', isActive: true }
    setCompanies(prev => [...prev, row])
    if (uid.current)
      await supabase.from('companies').insert({ id, user_id: uid.current, name: '', color_tag: C_COLORS[0], is_active: true })
  }

  function updateCompany(id: string, patch: Partial<CompanyRow>) {
    setCompanies(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
    setSaveStatus('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      // Read from current DOM state via functional update to avoid stale closure
      setCompanies(prev => {
        const row = prev.find(c => c.id === id)
        if (row && uid.current) {
          void supabase.from('companies').update({
            name: row.name, color_tag: row.color,
            calendar_id: row.calendarId || null, is_active: row.isActive,
          }).eq('id', id)
        }
        return prev // no state change, just side-effect
      })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }, 800)
  }

  async function deleteCompany(id: string) {
    setCompanies(prev => prev.filter(c => c.id !== id))
    if (uid.current) await supabase.from('companies').delete().eq('id', id)
  }

  const cSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function onCompaniesDragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id)
      setCompanies(prev => arrayMove(prev, prev.findIndex(c => c.id === active.id), prev.findIndex(c => c.id === over.id)))
  }

  // ── Habit helpers ────────────────────────────────────────────────────────
  async function addHabit() {
    const id = crypto.randomUUID()
    const row: HabitRow = { id, emoji: '🎯', name: '', frequency: 'daily', isActive: true }
    setHabits(prev => [...prev, row])
    if (uid.current)
      await supabase.from('habits').insert({ id, user_id: uid.current, name: '', frequency: 'daily', is_active: true })
  }

  function updateHabit(id: string, patch: Partial<HabitRow>) {
    setHabits(prev => prev.map(h => h.id === id ? { ...h, ...patch } : h))
    setSaveStatus('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setHabits(prev => {
        const row = prev.find(h => h.id === id)
        if (row && uid.current) {
          void supabase.from('habits').update({
            name: row.name, frequency: row.frequency, is_active: row.isActive,
          }).eq('id', id)
        }
        return prev
      })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }, 800)
  }

  async function deleteHabit(id: string) {
    setHabits(prev => prev.filter(h => h.id !== id))
    if (uid.current) await supabase.from('habits').delete().eq('id', id)
  }

  const hSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function onHabitsDragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id)
      setHabits(prev => arrayMove(prev, prev.findIndex(h => h.id === active.id), prev.findIndex(h => h.id === over.id)))
  }

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '28px 32px 60px', maxWidth: 820, margin: '0 auto' }}>
      <SaveBadge status={saveStatus} />

      {/* ── 1. PROFILE ─────────────────────────────────────────────────── */}
      <div style={S.card}>
        <SectionHeader title="Profile" />
        <FieldRow label="Full name">
          <input style={{ ...S.input, width: 280 }} value={s.fullName} placeholder="Your name"
            onChange={e => update('fullName', e.target.value)} />
        </FieldRow>
        <FieldRow label="Display timezone">
          <select style={{ ...S.select, width: 300 }} value={s.timezone} onChange={e => update('timezone', e.target.value)}>
            {ALL_TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Work week">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {WORK_DAYS.map(d => {
              const on = s.workWeek.includes(d)
              return (
                <button key={d} onClick={() => update('workWeek', on ? s.workWeek.filter(x => x !== d) : [...s.workWeek, d])}
                  style={{
                    width: 38, height: 30, borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--color-accent, #60A5FA)' : 'var(--color-border, #252A3E)'}`,
                    background: on ? 'var(--color-accent-fill, rgba(59,130,246,0.18))' : 'transparent',
                    color: on ? '#FFFFFF' : 'var(--color-text-muted, #6B7280)',
                  }}>
                  {d}
                </button>
              )
            })}
          </div>
        </FieldRow>
        <FieldRow label="Default active framework">
          <select style={{ ...S.select, width: 230 }} value={s.framework} onChange={e => update('framework', e.target.value)}>
            {FRAMEWORKS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </FieldRow>
      </div>

      {/* ── 2. SCHEDULE RULES ──────────────────────────────────────────── */}
      <div style={S.card}>
        <SectionHeader title="Schedule Rules" description="These feed directly into The Professor's system prompt." />
        <FieldRow label="Focus block start"><TimeInput value={s.focusStart} onChange={v => update('focusStart', v)} /></FieldRow>
        <FieldRow label="Focus block end"><TimeInput value={s.focusEnd} onChange={v => update('focusEnd', v)} /></FieldRow>
        <FieldRow label="Earliest meeting time"><TimeInput value={s.earliestMeeting} onChange={v => update('earliestMeeting', v)} /></FieldRow>
        <FieldRow label="Buffer between meetings">
          <StepSlider value={s.bufferMins} onChange={v => update('bufferMins', v)} steps={BUFFER_STEPS} />
        </FieldRow>
        <FieldRow label="Physical meeting extra buffer">
          <StepSlider value={s.physicalBufferMins} onChange={v => update('physicalBufferMins', v)} steps={PHYS_STEPS} />
        </FieldRow>
        <FieldRow label="End of work day"><TimeInput value={s.endOfDay} onChange={v => update('endOfDay', v)} /></FieldRow>
        <FieldRow label="Family time start"><TimeInput value={s.familyStart} onChange={v => update('familyStart', v)} /></FieldRow>
        <FieldRow label="Protect focus block">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle checked={s.protectFocus} onChange={v => update('protectFocus', v)} />
            <span style={{ fontSize: 12, color: '#FFFFFF' }}>Prevent events from being booked during focus time</span>
          </div>
        </FieldRow>
        <FieldRow label="Auto-decline early meetings">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle checked={s.autoDeclineEarly} onChange={v => update('autoDeclineEarly', v)} />
            <span style={{ fontSize: 12, color: '#FFFFFF' }}>Decline meetings before earliest meeting time</span>
          </div>
        </FieldRow>
      </div>

      {/* ── 3. COMPANIES & CONTEXTS ────────────────────────────────────── */}
      <div style={S.card}>
        <SectionHeader title="Companies & Contexts" />
        <DndContext sensors={cSensors} collisionDetection={closestCenter} onDragEnd={onCompaniesDragEnd}>
          <SortableContext items={companies.map(c => c.id)} strategy={verticalListSortingStrategy}>
            {companies.map(co => (
              <SortableRow key={co.id} id={co.id}>
                {({ listeners, attributes }) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid rgba(58,48,32,0.5)' }}>
                    <button {...(listeners ?? {})} {...attributes}
                      style={{ background: 'none', border: 'none', cursor: 'grab', color: '#252A3E', padding: 2, flexShrink: 0 }}>
                      <GripVertical size={15} />
                    </button>
                    <input style={{ ...S.input, flex: 1, minWidth: 0, width: 'auto' }} value={co.name} placeholder="Company name"
                      onChange={e => updateCompany(co.id, { name: e.target.value })} />
                    <ColorPicker value={co.color} onChange={c => updateCompany(co.id, { color: c })} />
                    <input style={{ ...S.input, width: 170, fontSize: 12 }} value={co.calendarId} placeholder="Calendar ID (optional)"
                      onChange={e => updateCompany(co.id, { calendarId: e.target.value })} />
                    <Toggle checked={co.isActive} onChange={v => updateCompany(co.id, { isActive: v })} />
                    <button onClick={() => void deleteCompany(co.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FFFFFF', padding: 4, flexShrink: 0 }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#E05252')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#6B7280')}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </SortableRow>
            ))}
          </SortableContext>
        </DndContext>
        <button onClick={() => void addCompany()} style={{
          marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          width: '100%', padding: '8px 14px', background: 'transparent',
          border: '1px dashed #252A3E', borderRadius: 7, color: '#FFFFFF', fontSize: 13, cursor: 'pointer',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#1E40AF'; e.currentTarget.style.color = '#1E40AF' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#252A3E'; e.currentTarget.style.color = '#6B7280' }}>
          <Plus size={14} /> Add Company
        </button>
      </div>

      {/* ── 4. HABITS CONFIGURATION ────────────────────────────────────── */}
      <div style={S.card}>
        <SectionHeader title="Habits Configuration" />
        <DndContext sensors={hSensors} collisionDetection={closestCenter} onDragEnd={onHabitsDragEnd}>
          <SortableContext items={habits.map(h => h.id)} strategy={verticalListSortingStrategy}>
            {habits.map(h => (
              <SortableRow key={h.id} id={h.id}>
                {({ listeners, attributes }) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid rgba(58,48,32,0.5)' }}>
                    <button {...(listeners ?? {})} {...attributes}
                      style={{ background: 'none', border: 'none', cursor: 'grab', color: '#252A3E', padding: 2, flexShrink: 0 }}>
                      <GripVertical size={15} />
                    </button>
                    <EmojiPickerBtn value={h.emoji} onChange={em => updateHabit(h.id, { emoji: em })} />
                    <input style={{ ...S.input, flex: 1, minWidth: 0, width: 'auto' }} value={h.name} placeholder="Habit name"
                      onChange={e => updateHabit(h.id, { name: e.target.value })} />
                    <select style={{ ...S.select, width: 115 }} value={h.frequency}
                      onChange={e => updateHabit(h.id, { frequency: e.target.value as HabitRow['frequency'] })}>
                      <option value="daily">Daily</option>
                      <option value="weekdays">Weekdays</option>
                      <option value="weekly">Weekly</option>
                    </select>
                    <Toggle checked={h.isActive} onChange={v => updateHabit(h.id, { isActive: v })} />
                    <button onClick={() => void deleteHabit(h.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FFFFFF', padding: 4, flexShrink: 0 }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#E05252')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#6B7280')}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </SortableRow>
            ))}
          </SortableContext>
        </DndContext>
        <button onClick={() => void addHabit()} style={{
          marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          width: '100%', padding: '8px 14px', background: 'transparent',
          border: '1px dashed #252A3E', borderRadius: 7, color: '#FFFFFF', fontSize: 13, cursor: 'pointer',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#1E40AF'; e.currentTarget.style.color = '#1E40AF' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#252A3E'; e.currentTarget.style.color = '#6B7280' }}>
          <Plus size={14} /> Add Habit
        </button>
      </div>

      {/* ── 5. THE PROFESSOR (AI) ──────────────────────────────────────── */}
      <div style={S.card}>
        <SectionHeader title="The Professor (AI)" />
        <FieldRow label="Communication style">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['brief', 'balanced', 'detailed'] as const).map(opt => (
              <button key={opt} onClick={() => update('commStyle', opt)} style={{
                padding: '6px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                border: `1px solid ${s.commStyle === opt ? 'var(--color-accent, #60A5FA)' : 'var(--color-border, #252A3E)'}`,
                background: s.commStyle === opt ? 'var(--color-accent-fill, rgba(59,130,246,0.18))' : 'transparent',
                color: s.commStyle === opt ? '#FFFFFF' : 'var(--color-text-muted, #6B7280)',
              }}>
                {opt === 'brief' ? 'Direct & Brief' : opt === 'balanced' ? 'Balanced' : 'Detailed & Thorough'}
              </button>
            ))}
          </div>
        </FieldRow>
        <FieldRow label="Proactive suggestions">
          <Toggle checked={s.proactive} onChange={v => update('proactive', v)} />
        </FieldRow>
        <FieldRow label="Morning brief auto-generate">
          <TimeInput value={s.briefTime} onChange={v => update('briefTime', v)} />
        </FieldRow>
        <FieldRow label="Weekly review day">
          <select style={{ ...S.select, width: 160 }} value={s.reviewDay} onChange={e => update('reviewDay', e.target.value)}>
            {['Sunday', 'Saturday', 'Friday'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Custom instructions">
          <div>
            <textarea value={s.customInstructions}
              onChange={e => update('customInstructions', e.target.value.slice(0, 500))}
              placeholder="e.g. Always prioritize DX client work over internal tasks"
              rows={3}
              style={{ ...S.input, width: '100%', resize: 'vertical', lineHeight: 1.55, minHeight: 72 }}
            />
            <div style={{ textAlign: 'right', fontSize: 11, color: '#FFFFFF', marginTop: 4 }}>
              {s.customInstructions.length}/500
            </div>
          </div>
        </FieldRow>
      </div>

      {/* ── 6. INTEGRATIONS ────────────────────────────────────────────── */}
      <div style={S.card}>
        <SectionHeader title="Integrations" description="Connect Google to sync your calendar and inbox." />

        {/* Google Account */}
        <div style={{ background: '#0D0F1A', border: '1px solid #252A3E', borderRadius: 10, padding: '18px 20px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>🔗</span>
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#E8EAF6' }}>Google Account</p>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#FFFFFF' }}>
                  {connected ? connEmail : 'Not connected — no calendar or Gmail data'}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {connected ? <Wifi size={14} color="#1D9E75" /> : <WifiOff size={14} color="#6B7280" />}
              {connected ? (
                <button
                  onClick={() => void googleSignOut().then(() => { setConnected(false); setConnEmail(''); setGcalendars([]) })}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, background: 'transparent', border: '1px solid rgba(224,82,82,0.3)', color: '#E05252', fontSize: 12, cursor: 'pointer' }}
                >
                  <LogOut size={11} /> Disconnect
                </button>
              ) : (
                <button
                  onClick={() => void signInWithGoogle()}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 7, background: 'rgba(30,64,175,0.12)', border: '1px solid rgba(30,64,175,0.25)', color: '#1E40AF', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                >
                  <LogIn size={11} /> Connect Google
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Google Calendars list */}
        {connected && (
          <div style={{ background: '#0D0F1A', border: '1px solid #252A3E', borderRadius: 10, padding: '18px 20px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#E8EAF6' }}>
                📅 Your Google Calendars
              </p>
              {calLoading && <RefreshCw size={13} color="#1E40AF" style={{ animation: 'spin 1s linear infinite' }} />}
            </div>
            {gcalendars.length === 0 && !calLoading && (
              <p style={{ margin: 0, fontSize: 12.5, color: '#FFFFFF' }}>No calendars found.</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {gcalendars.map(cal => (
                <div key={cal.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: 8, background: '#161929', border: '1px solid #252A3E' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 13, color: '#E8EAF6', fontWeight: cal.primary ? 600 : 400 }}>
                      {cal.summary}
                      {cal.primary && <span style={{ marginLeft: 6, fontSize: 10, color: '#1E40AF', background: '#1E40AF18', padding: '1px 6px', borderRadius: 3 }}>Primary</span>}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: '#5A4E3A', fontFamily: 'monospace' }}>{cal.id}</p>
                  </div>
                  <button
                    onClick={() => { void navigator.clipboard.writeText(cal.id) }}
                    style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, background: 'transparent', border: '1px solid #252A3E', color: '#FFFFFF', cursor: 'pointer' }}
                    title="Copy Calendar ID"
                  >
                    Copy ID
                  </button>
                </div>
              ))}
            </div>
            <p style={{ margin: '12px 0 0', fontSize: 11.5, color: '#5A4E3A', lineHeight: 1.5 }}>
              Copy a Calendar ID and paste it into the corresponding company row above to filter events by company.
            </p>
          </div>
        )}

        {/* Coming soon */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[{ name: 'Slack', icon: '💬' }, { name: 'Notion', icon: '📝' }].map(item => (
            <div key={item.name} style={{ background: '#0D0F1A', border: '1px solid #252A3E', borderRadius: 10, padding: '14px 16px', opacity: 0.45 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#E8EAF6' }}>{item.name}</span>
                <WifiOff size={13} color="#6B7280" style={{ marginLeft: 'auto' }} />
              </div>
              <span style={{ fontSize: 11, color: '#FFFFFF', background: '#252A3E', padding: '2px 7px', borderRadius: 4 }}>Coming soon</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 7. NOTIFICATIONS ───────────────────────────────────────────── */}
      <div style={S.card}>
        <SectionHeader title="Notifications" />
        <FieldRow label="Morning brief reminder">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Toggle checked={s.morningReminderOn} onChange={v => update('morningReminderOn', v)} />
            {s.morningReminderOn && <TimeInput value={s.morningReminderTime} onChange={v => update('morningReminderTime', v)} />}
          </div>
        </FieldRow>
        <FieldRow label="Daily wind-down reminder">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Toggle checked={s.windDownOn} onChange={v => update('windDownOn', v)} />
            {s.windDownOn && <TimeInput value={s.windDownTime} onChange={v => update('windDownTime', v)} />}
          </div>
        </FieldRow>
        <FieldRow label="Follow-up nudges">
          <Toggle checked={s.followUpNudges} onChange={v => update('followUpNudges', v)} />
        </FieldRow>
        <FieldRow label="Weekly review reminder">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Toggle checked={s.weeklyReviewOn} onChange={v => update('weeklyReviewOn', v)} />
            {s.weeklyReviewOn && (
              <>
                <select style={{ ...S.select, width: 110 }} value={s.weeklyReviewDay} onChange={e => update('weeklyReviewDay', e.target.value)}>
                  {['Sunday', 'Monday', 'Friday', 'Saturday'].map(d => <option key={d}>{d}</option>)}
                </select>
                <TimeInput value={s.weeklyReviewTime} onChange={v => update('weeklyReviewTime', v)} />
              </>
            )}
          </div>
        </FieldRow>
      </div>

      {/* ── 8. APPEARANCE ──────────────────────────────────────────────── */}
      <div style={S.card}>
        <SectionHeader title="Appearance" />

        {/* ── 10-theme grid ── */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text, #E8EAF6)' }}>Theme</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {THEMES.map(t => {
              const active = resolveThemeId(s.theme) === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => update('theme', t.id)}
                  title={t.name}
                  style={{
                    padding: '10px 8px 8px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    border: `2px solid ${active ? t.accent : t.border}`,
                    background: active ? t.accentFill : t.surface,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    transition: 'all 0.15s ease',
                    position: 'relative',
                  }}
                >
                  {/* Color preview strip */}
                  <div style={{
                    width: '100%', height: 28, borderRadius: 6,
                    background: t.bg,
                    border: `1px solid ${t.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.accent }} />
                    <div style={{ width: 20, height: 4, borderRadius: 2, background: t.surface }} />
                    <div style={{ width: 12, height: 4, borderRadius: 2, background: t.border }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11 }}>{t.emoji}</span>
                    <span style={{
                      fontSize: 11, fontWeight: active ? 700 : 400,
                      color: active ? '#FFFFFF' : t.textDim,
                      whiteSpace: 'nowrap',
                    }}>
                      {t.name}
                    </span>
                  </div>
                  {active && (
                    <div style={{
                      position: 'absolute', top: 5, right: 5,
                      width: 14, height: 14, borderRadius: '50%',
                      background: t.accent,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Check size={9} color={t.isDark ? '#000' : '#fff'} />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        <FieldRow label="Sidebar collapsed by default">
          <Toggle checked={s.sidebarDefault} onChange={v => { update('sidebarDefault', v); setSidebarCollapsed(v) }} />
        </FieldRow>
        <FieldRow label="Compact density">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle checked={s.compact} onChange={v => update('compact', v)} />
            <span style={{ fontSize: 12, color: '#FFFFFF' }}>Reduces padding throughout the interface</span>
          </div>
        </FieldRow>
      </div>
    </div>
  )
}
