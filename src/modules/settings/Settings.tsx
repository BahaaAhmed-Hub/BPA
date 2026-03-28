// ─── CHUNK 1: Types, constants, localStorage helpers ─────────────────────────
// (remaining chunks appended below)

import { useState, useEffect, useRef } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus, Trash2, GripVertical, LogIn, LogOut,
  ChevronDown, ChevronUp, User, Clock, Building2, Flame,
  Brain, Bell, Palette, Link, X, RefreshCw,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { connectAdditionalGoogleAccount, signOut as googleSignOut } from '@/lib/google'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { THEMES, getTheme, applyThemeVars } from '@/lib/themes'
import { useHabitsStore, getHabitColors } from '@/store/habitsStore'
import { loadAccounts, removeAccount, type ConnectedAccount } from '@/lib/multiAccount'
import {
  saveProfileToDB, savePrefsToDB, saveCompaniesToDB, loadCompaniesFromDB,
  saveHabitsToDB, saveHabitLogsToDB, loadSettingsFromDB,
  saveAccountsToDB, loadAccountsFromDB,
  type CompanyRow as DbSyncCompanyRow,
} from '@/lib/dbSync'
import { loadLogs } from '@/store/habitsStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppSettings {
  fullName: string; timezone: string; workWeek: string[]; framework: string
  focusStart: string; focusEnd: string; earliestMeeting: string
  bufferMins: number; physicalBufferMins: number
  endOfDay: string; familyStart: string
  protectFocus: boolean; autoDeclineEarly: boolean
  commStyle: 'brief' | 'balanced' | 'detailed'; proactive: boolean
  briefTime: string; reviewDay: string; customInstructions: string
  morningReminderOn: boolean; morningReminderTime: string
  windDownOn: boolean; windDownTime: string; followUpNudges: boolean
  weeklyReviewOn: boolean; weeklyReviewDay: string; weeklyReviewTime: string
  theme: string; sidebarDefault: boolean; compact: boolean
}

interface CompanyUser { id: string; name: string; email?: string }

interface CompanyRow {
  id: string; name: string; color: string
  calendarId: string; emailDomain: string; accountId: string; isActive: boolean
  users: CompanyUser[]
}

const SECTION_IDS = ['profile','schedule','companies','habits','accounts','professor','notifications','appearance'] as const
type SectionId = typeof SECTION_IDS[number]

interface SectionMeta { id: SectionId; title: string; icon: React.ElementType; description: string }
const SECTION_META: SectionMeta[] = [
  { id: 'profile',       title: 'Profile',            icon: User,      description: 'Name, timezone, work week & framework' },
  { id: 'schedule',      title: 'Schedule Rules',     icon: Clock,     description: 'Focus hours, buffers, meeting protections' },
  { id: 'companies',     title: 'Companies',          icon: Building2, description: 'Contexts, colors, calendar & email domain mapping' },
  { id: 'habits',        title: 'Habits',             icon: Flame,     description: 'Configure daily habits — synced with Habits page' },
  { id: 'accounts',      title: 'Connected Accounts', icon: Link,      description: 'Google accounts, calendars & Gmail access' },
  { id: 'professor',     title: 'Professor AI',       icon: Brain,     description: 'Communication style, daily brief & review day' },
  { id: 'notifications', title: 'Notifications',      icon: Bell,      description: 'Morning reminder, wind-down & weekly review nudges' },
  { id: 'appearance',    title: 'Appearance',         icon: Palette,   description: 'Theme, density & sidebar default' },
]

// ─── Constants ────────────────────────────────────────────────────────────────

function getUtcOffset(tz: string): string {
  try {
    const v = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? 'UTC'
    return v === 'GMT' ? 'UTC+0' : v.replace('GMT', 'UTC')
  } catch { return 'UTC' }
}
const ALL_TZ = (() => {
  const zones: string[] = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone')
    : ['America/New_York','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Dubai','Asia/Tokyo']
  return zones.map(tz => {
    const o = getUtcOffset(tz)
    const s = o.includes('-') ? -1 : 1
    const p = o.replace('UTC','').replace('+','').replace('-','').split(':')
    return { value: tz, label: `(${o}) ${tz.replace(/_/g,' ')}`, offset: s*((parseInt(p[0])||0)*60+(parseInt(p[1])||0)) }
  }).sort((a,b) => a.offset - b.offset || a.value.localeCompare(b.value))
})()

const FRAMEWORKS = [
  {value:'time_blocking',label:'Time Blocking'},{value:'gtd',label:'GTD'},
  {value:'deep_work',label:'Deep Work'},{value:'eisenhower',label:'Eisenhower Matrix'},
  {value:'pomodoro',label:'Pomodoro'},{value:'12_week_year',label:'12-Week Year'},
]
const WORK_DAYS    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const C_COLORS     = ['#1E40AF','#7F77DD','#1D9E75','#E05252','#888780','#5B9BD5','#E0944A']
const BUFFER_STEPS = [0,15,30,45,60]
const PHYS_STEPS   = [0,30,60,90]
const HABIT_EMOJIS = ['🎯','💪','📚','🏃','💧','🧘','🍎','💤','🌿','✍️','🧠','🔥','🎨','🏋️','🎵']
const FREQ_OPTS    = ['daily','weekdays','weekly'] as const

const DEFAULTS: AppSettings = {
  fullName:'', timezone:'America/New_York', workWeek:['Mon','Tue','Wed','Thu','Fri'], framework:'time_blocking',
  focusStart:'09:00', focusEnd:'11:00', earliestMeeting:'10:00',
  bufferMins:30, physicalBufferMins:60, endOfDay:'17:00', familyStart:'18:00',
  protectFocus:true, autoDeclineEarly:true,
  commStyle:'balanced', proactive:true, briefTime:'07:00', reviewDay:'Sunday', customInstructions:'',
  morningReminderOn:true, morningReminderTime:'07:00',
  windDownOn:true, windDownTime:'21:00', followUpNudges:true,
  weeklyReviewOn:true, weeklyReviewDay:'Sunday', weeklyReviewTime:'18:00',
  theme:'navy-night', sidebarDefault:false, compact:false,
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function ls<T>(key: string, fb: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T : fb } catch { return fb }
}
function lsSet<T>(key: string, v: T) { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /**/ } }

function loadSettings():   AppSettings   { return { ...DEFAULTS, ...ls<Partial<AppSettings>>('professor-settings', {}) } }
function saveSettings(s:   AppSettings)  { lsSet('professor-settings', s) }
function loadCompanies():  CompanyRow[]  { return ls('professor-companies', []) }
function saveCompanies(c:  CompanyRow[]) {
  lsSet('professor-companies', c)
  // Backup users separately so DB recovery can restore them
  const usersMap: Record<string, CompanyUser[]> = {}
  c.forEach(co => { if (co.users?.length) usersMap[co.id] = co.users })
  lsSet('professor-company-users', usersMap)
}
function loadSectionOrder(): SectionId[] {
  const saved = ls<SectionId[]>('professor-section-order', [])
  const valid = saved.filter(id => (SECTION_IDS as readonly string[]).includes(id))
  const miss  = SECTION_IDS.filter(id => !valid.includes(id))
  return [...valid, ...miss]
}
function saveSectionOrder(ids: SectionId[]) { lsSet('professor-section-order', ids) }

// ─── Google Calendars fetch ───────────────────────────────────────────────────

interface GCalCal { id: string; summary: string; primary?: boolean }
async function fetchGCals(token: string): Promise<GCalCal[]> {
  try {
    const r = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return []
    return ((await r.json()) as { items?: GCalCal[] }).items ?? []
  } catch { return [] }
}

// ─── Supabase check ───────────────────────────────────────────────────────────

async function checkSupabase(): Promise<boolean> {
  try { const { error } = await supabase.from('users').select('id').limit(1); return !error }
  catch { return false }
}

// ─── CHUNK 2: Shared UI atoms ─────────────────────────────────────────────────

// Card style using CSS variables for full theme support
const card: React.CSSProperties = {
  background: 'var(--color-surface, #161929)',
  border: '1px solid var(--color-border, #252A3E)',
  borderRadius: 14, padding: '0',
  marginBottom: 12, overflow: 'hidden',
}
const inputStyle: React.CSSProperties = {
  background: 'var(--color-surface2, #0D0F1A)',
  border: '1px solid var(--color-border, #252A3E)',
  borderRadius: 7, color: 'var(--color-text, #E8EAF6)',
  fontSize: 13.5, padding: '7px 11px', outline: 'none',
  fontFamily: 'DM Sans, sans-serif', width: '100%', boxSizing: 'border-box' as const,
}
const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer', width: 'auto',
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const accent = 'var(--color-accent, #1E40AF)'
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      style={{
        width: 42, height: 24, borderRadius: 12, flexShrink: 0,
        background: checked ? accent : 'var(--color-border, #252A3E)',
        border: 'none', cursor: 'pointer', position: 'relative', padding: 0, transition: 'background 0.2s',
      }}>
      <span style={{
        position: 'absolute', top: 4, left: checked ? 22 : 4,
        width: 16, height: 16, borderRadius: '50%', display: 'block',
        background: checked ? 'var(--color-surface, #161929)' : 'var(--color-text-muted, #6B7280)',
        transition: 'left 0.2s',
      }} />
    </button>
  )
}

function FieldRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '10px 0', borderBottom: '1px solid var(--color-border, #252A3E)',
    }}>
      <div style={{ width: 140, flexShrink: 0, paddingTop: 2 }}>
        <span style={{ fontSize: 12.5, color: 'var(--color-text, #E8EAF6)' }}>{label}</span>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--color-text-muted, #6B7280)', lineHeight: 1.4 }}>{sub}</p>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}


// ─── Sortable Section Shell ────────────────────────────────────────────────────

function SectionShell({
  id, meta, children, defaultOpen = false, saveLabel, onSave,
}: {
  id: SectionId
  meta: SectionMeta
  children: React.ReactNode
  defaultOpen?: boolean
  saveLabel?: string
  onSave?: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const Icon = meta.icon

  return (
    <div
      ref={setNodeRef}
      style={{
        ...card,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        boxShadow: isDragging ? '0 8px 32px rgba(0,0,0,0.4)' : 'none',
      }}
    >
      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '16px 20px', cursor: 'pointer',
        borderBottom: open ? '1px solid var(--color-border, #252A3E)' : 'none',
        userSelect: 'none',
      }}>
        {/* Drag handle */}
        <span
          {...attributes} {...listeners}
          style={{ color: 'var(--color-text-muted, #4B5563)', cursor: 'grab', flexShrink: 0, display: 'flex', touchAction: 'none' }}
          title="Drag to reorder"
        >
          <GripVertical size={16} />
        </span>

        {/* Icon */}
        <div style={{
          width: 30, height: 30, borderRadius: 7, flexShrink: 0,
          background: 'var(--color-accent-fill, rgba(30,64,175,0.12))',
          border: '1px solid var(--color-accent, #1E40AF)30',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={14} color="var(--color-accent, #1E40AF)" />
        </div>

        {/* Title + description */}
        <div style={{ flex: 1 }} onClick={() => setOpen(o => !o)}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text, #E8EAF6)' }}>
            {meta.title}
          </p>
          {!open && (
            <p style={{ margin: '1px 0 0', fontSize: 11.5, color: 'var(--color-text-muted, #4B5563)' }}>
              {meta.description}
            </p>
          )}
        </div>

        {/* Save button — always visible in header */}
        {onSave && (
          <button
            onClick={e => { e.stopPropagation(); onSave() }}
            style={{
              padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: saveLabel?.includes('✓') ? 'rgba(29,158,117,0.12)' : saveLabel?.includes('✗') ? 'rgba(224,82,82,0.12)' : 'var(--color-accent-fill, rgba(30,64,175,0.12))',
              border: `1px solid ${saveLabel?.includes('✓') ? '#1D9E7560' : saveLabel?.includes('✗') ? '#E0525260' : 'var(--color-accent, #1E40AF)40'}`,
              color: saveLabel?.includes('✓') ? '#1D9E75' : saveLabel?.includes('✗') ? '#E05252' : 'var(--color-accent, #1E40AF)',
              transition: 'all 0.15s', flexShrink: 0,
            }}
          >
            {saveLabel ?? 'Save'}
          </button>
        )}

        {/* Chevron */}
        <button onClick={() => setOpen(o => !o)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #4B5563)', display: 'flex', padding: 4 }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* Body */}
      {open && (
        <div style={{ padding: '20px 24px 24px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── CHUNK 3: Profile & Schedule sections ────────────────────────────────────

function ProfileSection({
  s, set,
}: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  return (
    <div>
      <FieldRow label="Full name">
        <input value={s.fullName} onChange={e => set({ fullName: e.target.value })}
          placeholder="Your name" style={inputStyle} />
      </FieldRow>
      <FieldRow label="Framework">
        <select value={s.framework} onChange={e => set({ framework: e.target.value })} style={{ ...selectStyle, width: '100%' }}>
          {FRAMEWORKS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </FieldRow>
      <FieldRow label="Timezone">
        <select value={s.timezone} onChange={e => set({ timezone: e.target.value })} style={{ ...selectStyle, width: '100%' }}>
          {ALL_TZ.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
        </select>
      </FieldRow>
      <FieldRow label="Work days">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {WORK_DAYS.map(d => {
            const on = s.workWeek.includes(d)
            return (
              <button key={d} onClick={() => set({ workWeek: on ? s.workWeek.filter(x => x !== d) : [...s.workWeek, d] })}
                style={{
                  padding: '4px 9px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer', fontWeight: 500,
                  background: on ? 'var(--color-accent-fill, rgba(30,64,175,0.15))' : 'var(--color-surface2, #0D0F1A)',
                  border: `1px solid ${on ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
                  color: on ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)',
                }}>{d}</button>
            )
          })}
        </div>
      </FieldRow>
    </div>
  )
}

function ScheduleSection({
  s, set,
}: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  return (
    <div>
      <FieldRow label="Focus window" sub="Deep work block">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="time" value={s.focusStart} onChange={e => set({ focusStart: e.target.value })}
            style={{ ...inputStyle, width: 100 }} />
          <span style={{ color: 'var(--color-text-muted, #6B7280)', fontSize: 11 }}>to</span>
          <input type="time" value={s.focusEnd} onChange={e => set({ focusEnd: e.target.value })}
            style={{ ...inputStyle, width: 100 }} />
        </div>
      </FieldRow>
      <FieldRow label="Earliest meeting" sub="No calls before">
        <input type="time" value={s.earliestMeeting} onChange={e => set({ earliestMeeting: e.target.value })}
          style={{ ...inputStyle, width: 110 }} />
      </FieldRow>
      <FieldRow label="End of day">
        <input type="time" value={s.endOfDay} onChange={e => set({ endOfDay: e.target.value })}
          style={{ ...inputStyle, width: 110 }} />
      </FieldRow>
      <FieldRow label="Family time">
        <input type="time" value={s.familyStart} onChange={e => set({ familyStart: e.target.value })}
          style={{ ...inputStyle, width: 110 }} />
      </FieldRow>
      <FieldRow label="Meeting buffer" sub="Virtual gap">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {BUFFER_STEPS.map(n => (
            <button key={n} onClick={() => set({ bufferMins: n })}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer', fontWeight: 500,
                background: s.bufferMins === n ? 'var(--color-accent-fill)' : 'var(--color-surface2, #0D0F1A)',
                border: `1px solid ${s.bufferMins === n ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
                color: s.bufferMins === n ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)',
              }}>{n === 0 ? 'None' : `${n}m`}</button>
          ))}
        </div>
      </FieldRow>
      <FieldRow label="Physical buffer" sub="Travel time">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {PHYS_STEPS.map(n => (
            <button key={n} onClick={() => set({ physicalBufferMins: n })}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer', fontWeight: 500,
                background: s.physicalBufferMins === n ? 'var(--color-accent-fill)' : 'var(--color-surface2, #0D0F1A)',
                border: `1px solid ${s.physicalBufferMins === n ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
                color: s.physicalBufferMins === n ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)',
              }}>{n === 0 ? 'None' : `${n}m`}</button>
          ))}
        </div>
      </FieldRow>
      <FieldRow label="Protect focus">
        <Toggle checked={s.protectFocus} onChange={v => set({ protectFocus: v })} />
      </FieldRow>
      <FieldRow label="Auto-decline early">
        <Toggle checked={s.autoDeclineEarly} onChange={v => set({ autoDeclineEarly: v })} />
      </FieldRow>
    </div>
  )
}

// ─── CHUNK 4: Companies + Habits sections ────────────────────────────────────

function CompanyCard({
  co, accounts, onUpdate, onDelete,
}: {
  co: CompanyRow
  accounts: ConnectedAccount[]
  onUpdate: (patch: Partial<CompanyRow>) => void
  onDelete: () => void
}) {
  const [usersOpen, setUsersOpen]     = useState(false)
  const [colorOpen, setColorOpen]     = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft]     = useState(co.name)
  const [editingDomain, setEditingDomain] = useState(false)
  const [domainDraft, setDomainDraft] = useState(co.emailDomain)
  const [newUserName, setNewUserName]   = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [userDrafts, setUserDrafts] = useState<Record<string, { name: string; email: string }>>({})
  const colorRef = useRef<HTMLDivElement>(null)

  const users: CompanyUser[] = co.users ?? []

  useEffect(() => {
    if (!colorOpen) return
    function handler(e: MouseEvent) {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setColorOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [colorOpen])

  function saveName() {
    const v = nameDraft.trim(); if (v) onUpdate({ name: v }); else setNameDraft(co.name)
    setEditingName(false)
  }
  function saveDomain() { onUpdate({ emailDomain: domainDraft.trim() }); setEditingDomain(false) }

  function addUser() {
    if (!newUserName.trim()) return
    onUpdate({ users: [...users, { id: crypto.randomUUID(), name: newUserName.trim(), email: newUserEmail.trim() || undefined }] })
    setNewUserName(''); setNewUserEmail('')
  }
  function removeUser(id: string) { onUpdate({ users: users.filter(u => u.id !== id) }) }

  function startEditUser(u: CompanyUser) {
    setEditingUserId(u.id)
    setUserDrafts(d => ({ ...d, [u.id]: { name: u.name, email: u.email ?? '' } }))
  }
  function saveUser(id: string) {
    const draft = userDrafts[id]; if (!draft) return
    onUpdate({ users: users.map(u => u.id === id ? { ...u, name: draft.name.trim() || u.name, email: draft.email.trim() || undefined } : u) })
    setEditingUserId(null)
  }

  const tinp: React.CSSProperties = {
    background: 'transparent', border: 'none', borderBottom: '1px solid #7F77DD',
    outline: 'none', color: '#E8EAF6', fontFamily: 'inherit', padding: '0 2px',
  }

  return (
    <div style={{ background: '#0D0F1A', border: '1px solid #252A3E', borderRadius: 10, marginBottom: 8, overflow: 'visible' }}>
      {/* Company header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px' }}>

        {/* Color circle → color picker */}
        <div ref={colorRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setColorOpen(o => !o)}
            title="Change color"
            style={{
              width: 18, height: 18, borderRadius: '50%', background: co.color, cursor: 'pointer',
              border: `2px solid ${co.color}60`, flexShrink: 0,
            }}
          />
          {colorOpen && (
            <div style={{
              position: 'absolute', top: 24, left: 0, zIndex: 200,
              background: '#1a1f35', border: '1px solid #2e3450', borderRadius: 10,
              padding: '7px 8px', display: 'flex', gap: 5,
              boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
            }}>
              {C_COLORS.map(c => (
                <button key={c} onClick={() => { onUpdate({ color: c }); setColorOpen(false) }}
                  style={{
                    width: 16, height: 16, borderRadius: '50%', background: c,
                    border: 'none', cursor: 'pointer', flexShrink: 0,
                    boxShadow: co.color === c ? `0 0 0 2px #1a1f35, 0 0 0 3.5px ${c}` : 'none',
                    transform: co.color === c ? 'scale(1.2)' : 'scale(1)',
                    transition: 'transform 0.1s ease',
                  }} />
              ))}
            </div>
          )}
        </div>

        {/* Name + domain stacked */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          {editingName ? (
            <input autoFocus value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameDraft(co.name); setEditingName(false) } }}
              style={{ ...tinp, fontSize: 13.5, fontWeight: 600, width: 160 }}
            />
          ) : (
            <span onClick={() => setEditingName(true)} title="Click to rename"
              style={{ fontSize: 13.5, fontWeight: 600, color: '#E8EAF6', cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {co.name || 'Untitled'}
            </span>
          )}
          {editingDomain ? (
            <input autoFocus value={domainDraft}
              onChange={e => setDomainDraft(e.target.value)}
              onBlur={saveDomain}
              onKeyDown={e => { if (e.key === 'Enter') saveDomain(); if (e.key === 'Escape') { setDomainDraft(co.emailDomain); setEditingDomain(false) } }}
              placeholder="@domain.com"
              style={{ ...tinp, fontSize: 10.5, color: '#6B7280', width: 140 }}
            />
          ) : (
            <span onClick={() => setEditingDomain(true)} title="Click to set domain"
              style={{ fontSize: 10.5, color: co.emailDomain ? '#6B7280' : '#3a3f55', cursor: 'text' }}>
              {co.emailDomain || ''}
            </span>
          )}
        </div>

        {/* Account selector — compact */}
        {accounts.length > 0 && (
          <select value={co.accountId} onChange={e => onUpdate({ accountId: e.target.value })}
            style={{ ...selectStyle, fontSize: 11, padding: '3px 6px', maxWidth: 130 }}>
            <option value="">No account</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>
        )}

        {/* Users expand toggle */}
        <button onClick={() => setUsersOpen(o => !o)} title={usersOpen ? 'Collapse members' : 'Expand members'} style={{
          display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
          padding: '2px 7px', borderRadius: 5, fontSize: 10.5, cursor: 'pointer',
          background: 'transparent', border: '1px solid #252A3E',
          color: '#6B7280',
        }}>
          <span style={{ color: co.color, fontWeight: 600 }}>{users.length}</span>
          {usersOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>

        <Toggle checked={co.isActive} onChange={v => onUpdate({ isActive: v })} />

        <button onClick={onDelete}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 3, display: 'flex', alignItems: 'center' }}>
          <Trash2 size={12} />
        </button>
      </div>

      {/* Users tree */}
      {usersOpen && (
        <div style={{ borderTop: '1px solid #1a1f35', padding: '8px 14px 10px 46px' }}>
          {users.length === 0 && (
            <p style={{ margin: '0 0 6px', fontSize: 11, color: '#3a3f55', fontStyle: 'italic' }}>No members yet</p>
          )}

          {users.map(u => {
            const isEditing = editingUserId === u.id
            const draft = userDrafts[u.id]
            return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #1a1f35' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: co.color, flexShrink: 0 }} />

                {isEditing ? (
                  <>
                    <input autoFocus value={draft?.name ?? u.name}
                      onChange={e => setUserDrafts(d => ({ ...d, [u.id]: { ...d[u.id], name: e.target.value } }))}
                      onBlur={() => saveUser(u.id)}
                      onKeyDown={e => { if (e.key === 'Enter') saveUser(u.id); if (e.key === 'Escape') setEditingUserId(null) }}
                      style={{ ...tinp, fontSize: 12, width: 120 }}
                    />
                    <input value={draft?.email ?? (u.email ?? '')}
                      onChange={e => setUserDrafts(d => ({ ...d, [u.id]: { ...d[u.id], email: e.target.value } }))}
                      onBlur={() => saveUser(u.id)}
                      onKeyDown={e => { if (e.key === 'Enter') saveUser(u.id); if (e.key === 'Escape') setEditingUserId(null) }}
                      placeholder="email"
                      style={{ ...tinp, fontSize: 11, color: '#6B7280', flex: 1 }}
                    />
                  </>
                ) : (
                  <>
                    <span onClick={() => startEditUser(u)} style={{ fontSize: 12, color: '#E8EAF6', cursor: 'text', minWidth: 60 }}>{u.name}</span>
                    <span onClick={() => startEditUser(u)} style={{ fontSize: 11, color: '#6B7280', cursor: 'text', flex: 1 }}>
                      {u.email || <span style={{ color: '#3a3f55' }}>+ email</span>}
                    </span>
                  </>
                )}

                <button onClick={() => removeUser(u.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <Trash2 size={10} />
                </button>
              </div>
            )
          })}

          {/* Add user row */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <Plus size={10} color="#6B7280" style={{ flexShrink: 0 }} />
            <input value={newUserName} onChange={e => setNewUserName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addUser() }}
              placeholder="Name"
              style={{ ...inputStyle, fontSize: 11, padding: '3px 7px', width: 110 }} />
            <input value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addUser() }}
              placeholder="Email (optional)"
              style={{ ...inputStyle, fontSize: 11, padding: '3px 7px', flex: 1 }} />
            <button onClick={addUser} disabled={!newUserName.trim()} style={{
              padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              background: '#7F77DD18', border: '1px solid #7F77DD50',
              color: '#7F77DD', opacity: newUserName.trim() ? 1 : 0.4,
            }}>Add</button>
          </div>
        </div>
      )}
    </div>
  )
}

function CompaniesSection({
  companies, setCompanies, accounts,
}: {
  companies: CompanyRow[]
  setCompanies: (c: CompanyRow[]) => void
  accounts: ConnectedAccount[]
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(C_COLORS[0])
  const [newDomain, setNewDomain] = useState('')
  const [newAccountId, setNewAccountId] = useState('')

  function persistCompanies(next: CompanyRow[]) {
    setCompanies(next)
    saveCompanies(next)
    saveCompaniesToDB(next as unknown as DbSyncCompanyRow[]).catch(e => console.error('[persistCompanies]', e))
  }

  function addCompany() {
    if (!newName.trim()) return
    persistCompanies([...companies, {
      id: crypto.randomUUID(), name: newName.trim(),
      color: newColor, calendarId: '', emailDomain: newDomain.trim(),
      accountId: newAccountId, isActive: true, users: [],
    }])
    setNewName(''); setNewDomain(''); setAdding(false)
  }

  function updateCompany(id: string, patch: Partial<CompanyRow>) {
    persistCompanies(companies.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  function deleteCompany(id: string) {
    persistCompanies(companies.filter(c => c.id !== id))
  }

  return (
    <div>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--color-text-muted, #6B7280)', lineHeight: 1.55 }}>
        Companies are your work contexts. Assign a colour, link to a Google account, and optionally map an email domain for automatic tagging.
      </p>

      {companies.map(co => (
        <CompanyCard key={co.id} co={co} accounts={accounts}
          onUpdate={patch => updateCompany(co.id, patch)}
          onDelete={() => deleteCompany(co.id)} />
      ))}

      {adding ? (
        <div style={{ marginTop: 14, padding: '14px', background: 'var(--color-surface2, #0D0F1A)', borderRadius: 10, border: '1px solid var(--color-border, #252A3E)' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Company name"
              style={{ ...inputStyle, width: 160 }} autoFocus />
            <input value={newDomain} onChange={e => setNewDomain(e.target.value)} placeholder="@domain.com"
              style={{ ...inputStyle, width: 170 }} />
            {accounts.length > 0 && (
              <select value={newAccountId} onChange={e => setNewAccountId(e.target.value)} style={{ ...selectStyle, width: 180 }}>
                <option value="">No account</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {C_COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)}
                style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', outline: newColor === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setAdding(false); setNewName('') }}
              style={{ padding: '6px 14px', borderRadius: 7, background: 'transparent', border: '1px solid var(--color-border, #252A3E)', color: 'var(--color-text-dim, #94A3B8)', fontSize: 12, cursor: 'pointer', display: 'flex', gap: 5, alignItems: 'center' }}>
              <X size={11} /> Cancel
            </button>
            <button onClick={addCompany} disabled={!newName.trim()}
              style={{ padding: '6px 16px', borderRadius: 7, background: 'var(--color-accent-fill)', border: '1px solid var(--color-accent, #1E40AF)50', color: 'var(--color-accent, #1E40AF)', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: newName.trim() ? 1 : 0.4, display: 'flex', gap: 5, alignItems: 'center' }}>
              <Plus size={11} /> Add Company
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{
          marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, width: '100%',
          padding: '11px 16px', borderRadius: 9, background: 'transparent',
          border: '1px dashed var(--color-border, #252A3E)',
          color: 'var(--color-text-muted, #6B7280)', fontSize: 13, cursor: 'pointer',
        }}>
          <Plus size={13} /> Add a company / context
        </button>
      )}
    </div>
  )
}

function HabitsSection() {
  const COLORS = getHabitColors()
  const { habits, addHabit: storeAdd, updateHabit, deleteHabit: storeDel } = useHabitsStore()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName]     = useState('')
  const [newEmoji, setNewEmoji]   = useState('🎯')
  const [newColor, setNewColor]   = useState(COLORS[0])
  const [newFreq, setNewFreq]     = useState<typeof FREQ_OPTS[number]>('daily')

  function addHabit() {
    if (!newName.trim()) return
    storeAdd({ name: newName.trim(), emoji: newEmoji, color: newColor, frequency: newFreq, isActive: true })
    setNewName(''); setAdding(false)
  }
  function toggle(id: string) {
    const h = habits.find(x => x.id === id)
    if (h) updateHabit(id, { isActive: !h.isActive })
  }
  function del(id: string) {
    storeDel(id)
  }

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--color-text-muted, #6B7280)' }}>
        Changes here instantly sync with the Habits Tracker page.
      </p>

      {habits.map(h => (
        <div key={h.id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 0', borderBottom: '1px solid var(--color-border, #252A3E)',
          opacity: h.isActive ? 1 : 0.5,
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>{h.emoji}</span>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: h.color, flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 13.5, color: 'var(--color-text, #E8EAF6)' }}>{h.name}</span>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)', background: 'var(--color-surface2, #0D0F1A)', padding: '2px 8px', borderRadius: 4 }}>
            {h.frequency}
          </span>
          <Toggle checked={h.isActive} onChange={() => toggle(h.id)} />
          <button onClick={() => del(h.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', padding: 4 }}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      {adding ? (
        <div style={{ marginTop: 12, padding: 14, background: 'var(--color-surface2, #0D0F1A)', borderRadius: 10, border: '1px solid var(--color-border, #252A3E)' }}>
          {/* Emoji picker */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {HABIT_EMOJIS.map(e => (
              <button key={e} onClick={() => setNewEmoji(e)} style={{
                fontSize: 16, width: 34, height: 34, borderRadius: 7, cursor: 'pointer',
                background: newEmoji === e ? 'var(--color-accent-fill)' : 'transparent',
                border: `1px solid ${newEmoji === e ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
              }}>{e}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus placeholder="Habit name"
              style={{ ...inputStyle, width: 200 }}
              onKeyDown={e => { if (e.key === 'Enter') addHabit(); if (e.key === 'Escape') setAdding(false) }} />
            <select value={newFreq} onChange={e => setNewFreq(e.target.value as typeof FREQ_OPTS[number])}
              style={{ ...selectStyle, width: 120 }}>
              {FREQ_OPTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)} style={{
                width: 22, height: 22, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                outline: newColor === c ? `2px solid ${c}` : 'none', outlineOffset: 2,
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setAdding(false); setNewName('') }} style={{ padding: '6px 14px', borderRadius: 7, background: 'transparent', border: '1px solid var(--color-border, #252A3E)', color: 'var(--color-text-dim, #94A3B8)', fontSize: 12, cursor: 'pointer', display: 'flex', gap: 5, alignItems: 'center' }}>
              <X size={11} /> Cancel
            </button>
            <button onClick={addHabit} disabled={!newName.trim()} style={{ padding: '6px 16px', borderRadius: 7, background: 'var(--color-accent-fill)', border: '1px solid var(--color-accent, #1E40AF)50', color: 'var(--color-accent, #1E40AF)', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: newName.trim() ? 1 : 0.4, display: 'flex', gap: 5, alignItems: 'center' }}>
              <Plus size={11} /> Add Habit
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{
          marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, width: '100%',
          padding: '11px 16px', borderRadius: 9, background: 'transparent',
          border: '1px dashed var(--color-border, #252A3E)',
          color: 'var(--color-text-muted, #6B7280)', fontSize: 13, cursor: 'pointer',
        }}>
          <Plus size={13} /> Add a habit
        </button>
      )}
    </div>
  )
}

// ─── CHUNK 5: Connected Accounts (multi-Google) ───────────────────────────────

function AccountsSection({
  accounts, setAccounts, primaryEmail,
}: {
  accounts: ConnectedAccount[]
  setAccounts: (a: ConnectedAccount[]) => void
  primaryEmail: string
}) {
  const [adding, setAdding]         = useState(false)
  const [calendars, setCalendars]   = useState<Record<string, string[]>>({}) // accountId → calendar names
  const [loadingCals, setLoading]   = useState<string | null>(null)

  async function connectAdditional() {
    setAdding(true)
    try {
      // Saves current session, redirects to Google with account picker forced.
      // On return, App.tsx detects the pending flag, stores the new token as
      // an additional account, and restores the original session.
      await connectAdditionalGoogleAccount()
    } catch { setAdding(false) }
  }

  async function loadCalendars(acc: ConnectedAccount) {
    setLoading(acc.id)
    const cals = await fetchGCals(acc.providerToken)
    setCalendars(prev => ({ ...prev, [acc.id]: cals.map(c => c.summary) }))
    setLoading(null)
  }

  function removeAcc(id: string) {
    removeAccount(id)
    const updated = loadAccounts()
    setAccounts(updated)
    saveAccountsToDB(updated).catch(console.warn)
  }

  // Primary account row (from Supabase session)
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''

  return (
    <div>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--color-text-muted, #6B7280)', lineHeight: 1.55 }}>
        Connect multiple Google accounts to aggregate all your calendars and Gmail inboxes in one place.
        Primary account is your sign-in account.
      </p>

      {/* Primary account */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 10, marginBottom: 10,
        background: 'var(--color-surface2, #0D0F1A)',
        border: '1px solid var(--color-accent, #1E40AF)30',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: 'var(--color-accent-fill)', border: '1px solid var(--color-accent, #1E40AF)40',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--color-accent, #1E40AF)',
        }}>
          {primaryEmail ? primaryEmail[0].toUpperCase() : 'G'}
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text, #E8EAF6)' }}>{primaryEmail || 'Primary Google Account'}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#1D9E75' }}>✓ Primary · Calendar + Gmail access</p>
        </div>
        <span style={{ fontSize: 10.5, padding: '3px 10px', borderRadius: 20, background: 'rgba(29,158,117,0.1)', color: '#1D9E75', border: '1px solid rgba(29,158,117,0.2)' }}>
          Active
        </span>
        {primaryToken && (
          <button onClick={() => loadCalendars({ id: 'primary', email: primaryEmail, name: '', providerToken: primaryToken, scopes: [], connectedAt: '', isPrimary: true })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', padding: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
            title="Load calendars">
            <RefreshCw size={12} style={{ animation: loadingCals === 'primary' ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        )}
      </div>

      {/* Show primary calendars */}
      {calendars['primary'] && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: 'var(--color-surface2, #0D0F1A)', borderRadius: 8, border: '1px solid var(--color-border, #252A3E)' }}>
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted, #6B7280)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Calendars in this account</p>
          {calendars['primary'].map(name => (
            <p key={name} style={{ margin: '3px 0', fontSize: 12, color: 'var(--color-text-dim, #94A3B8)' }}>• {name}</p>
          ))}
        </div>
      )}

      {/* Additional connected accounts */}
      {accounts.filter(a => !a.isPrimary).map(acc => (
        <div key={acc.id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', borderRadius: 10, marginBottom: 8,
          background: 'var(--color-surface2, #0D0F1A)',
          border: '1px solid var(--color-border, #252A3E)',
        }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: '#7F77DD18', border: '1px solid #7F77DD40', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#7F77DD' }}>
            {acc.email ? acc.email[0].toUpperCase() : 'G'}
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text, #E8EAF6)' }}>{acc.email || acc.name}</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-muted, #6B7280)' }}>
              Connected {new Date(acc.connectedAt).toLocaleDateString()}
            </p>
          </div>
          <button onClick={() => loadCalendars(acc)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', padding: 4, display: 'flex' }} title="Load calendars">
            <RefreshCw size={12} style={{ animation: loadingCals === acc.id ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <button onClick={() => removeAcc(acc.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E05252', padding: 4, display: 'flex' }}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      {/* Show calendars for additional accounts */}
      {accounts.filter(a => !a.isPrimary).map(acc => calendars[acc.id] ? (
        <div key={`${acc.id}-cals`} style={{ marginBottom: 8, padding: '8px 14px', background: 'var(--color-surface2, #0D0F1A)', borderRadius: 8, border: '1px solid var(--color-border, #252A3E)' }}>
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted, #6B7280)', textTransform: 'uppercase' }}>{acc.email} calendars</p>
          {calendars[acc.id].map(name => <p key={name} style={{ margin: '3px 0', fontSize: 12, color: 'var(--color-text-dim, #94A3B8)' }}>• {name}</p>)}
        </div>
      ) : null)}

      {/* Add account button */}
      <button onClick={() => void connectAdditional()} disabled={adding}
        style={{
          marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '12px 16px', borderRadius: 9,
          background: 'var(--color-surface2, #0D0F1A)',
          border: '1px dashed var(--color-border, #252A3E)',
          color: 'var(--color-accent, #1E40AF)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          opacity: adding ? 0.6 : 1,
        }}>
        <LogIn size={14} />
        {adding ? 'Connecting…' : '+ Connect another Google account'}
      </button>

      <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--color-text-muted, #6B7280)', lineHeight: 1.55 }}>
        All connected accounts are used for calendar aggregation and inbox triage. Tokens are stored locally only.
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── CHUNK 6: Professor AI + Notifications + Appearance sections ──────────────

function ProfessorSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  return (
    <div>
      <FieldRow label="Comm. style" sub="Response verbosity">
        <div style={{ display: 'flex', gap: 6 }}>
          {(['brief','balanced','detailed'] as const).map(v => (
            <button key={v} onClick={() => set({ commStyle: v })}
              style={{
                padding: '5px 12px', borderRadius: 7, fontSize: 11.5, cursor: 'pointer', fontWeight: 500, textTransform: 'capitalize',
                background: s.commStyle === v ? 'var(--color-accent-fill)' : 'var(--color-surface2, #0D0F1A)',
                border: `1px solid ${s.commStyle === v ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
                color: s.commStyle === v ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)',
              }}>{v}</button>
          ))}
        </div>
      </FieldRow>
      <FieldRow label="Proactive" sub="Offers advice unprompted">
        <Toggle checked={s.proactive} onChange={v => set({ proactive: v })} />
      </FieldRow>
      <FieldRow label="Morning brief">
        <input type="time" value={s.briefTime} onChange={e => set({ briefTime: e.target.value })}
          style={{ ...inputStyle, width: 110 }} />
      </FieldRow>
      <FieldRow label="Review day">
        <select value={s.reviewDay} onChange={e => set({ reviewDay: e.target.value })} style={{ ...selectStyle, width: '100%' }}>
          {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(d =>
            <option key={d} value={d}>{d}</option>)}
        </select>
      </FieldRow>
      <FieldRow label="Instructions" sub="Personality & priorities">
        <textarea value={s.customInstructions} onChange={e => set({ customInstructions: e.target.value })}
          rows={3} placeholder="e.g. Always be concise. Prioritise Teradix work…"
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, width: '100%' }} />
      </FieldRow>
    </div>
  )
}

function NotificationsSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  return (
    <div>
      <FieldRow label="Morning brief">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Toggle checked={s.morningReminderOn} onChange={v => set({ morningReminderOn: v })} />
          {s.morningReminderOn && (
            <input type="time" value={s.morningReminderTime} onChange={e => set({ morningReminderTime: e.target.value })}
              style={{ ...inputStyle, width: 100 }} />
          )}
        </div>
      </FieldRow>
      <FieldRow label="Wind-down">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Toggle checked={s.windDownOn} onChange={v => set({ windDownOn: v })} />
          {s.windDownOn && (
            <input type="time" value={s.windDownTime} onChange={e => set({ windDownTime: e.target.value })}
              style={{ ...inputStyle, width: 100 }} />
          )}
        </div>
      </FieldRow>
      <FieldRow label="Follow-up nudges" sub="Delegated/waiting tasks">
        <Toggle checked={s.followUpNudges} onChange={v => set({ followUpNudges: v })} />
      </FieldRow>
      <FieldRow label="Weekly review">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Toggle checked={s.weeklyReviewOn} onChange={v => set({ weeklyReviewOn: v })} />
          {s.weeklyReviewOn && (
            <>
              <select value={s.weeklyReviewDay} onChange={e => set({ weeklyReviewDay: e.target.value })} style={{ ...selectStyle, width: 100 }}>
                {['Sunday','Monday','Saturday'].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input type="time" value={s.weeklyReviewTime} onChange={e => set({ weeklyReviewTime: e.target.value })}
                style={{ ...inputStyle, width: 95 }} />
            </>
          )}
        </div>
      </FieldRow>
    </div>
  )
}

function AppearanceSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const { setThemeId } = useUIStore()

  function pickTheme(id: string) {
    set({ theme: id })
    setThemeId(id)
    applyThemeVars(getTheme(id))
  }

  return (
    <div>
      <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--color-border, #252A3E)', marginBottom: 4 }}>
        <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 500, color: 'var(--color-text, #E8EAF6)' }}>Theme</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 7 }}>
          {THEMES.map(t => {
            const active = s.theme === t.id
            return (
              <button key={t.id} onClick={() => pickTheme(t.id)}
                style={{
                  padding: '8px 4px', borderRadius: 9, cursor: 'pointer', flexDirection: 'column',
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: t.surface, border: `2px solid ${active ? t.accent : t.border}`,
                  boxShadow: active ? `0 0 10px ${t.accent}40` : 'none',
                  transition: 'all 0.15s',
                }}>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[t.accent, t.accentFill ? t.accentBright : t.textDim, t.textMuted].map((c, i) => (
                    <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
                  ))}
                </div>
                <span style={{ fontSize: 13 }}>{t.emoji}</span>
                <span style={{ fontSize: 9.5, color: t.text, fontWeight: active ? 700 : 400, whiteSpace: 'nowrap' }}>{t.name}</span>
              </button>
            )
          })}
        </div>
      </div>
      <FieldRow label="Sidebar expanded">
        <Toggle checked={!s.sidebarDefault} onChange={v => set({ sidebarDefault: !v })} />
      </FieldRow>
      <FieldRow label="Compact density" sub="Tighter spacing">
        <Toggle checked={s.compact} onChange={v => set({ compact: v })} />
      </FieldRow>
    </div>
  )
}

// ─── CHUNK 7: Main Settings component ────────────────────────────────────────

export function Settings() {
  const [settings, setSettings]         = useState<AppSettings>(loadSettings)
  const [companies, setCompanies]       = useState<CompanyRow[]>(loadCompanies)
  const [accounts, setAccounts]         = useState<ConnectedAccount[]>(loadAccounts)
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(loadSectionOrder)

  const [supaOk, setSupaOk]             = useState<boolean | null>(null)
  // Per-section save states + error messages
  const [sectionSaving, setSectionSaving] = useState<Record<string, 'idle'|'saving'|'saved'|'error'>>({})
  const [sectionError,  setSectionError]  = useState<Record<string, string>>({})
  const authUser = useAuthStore(s => s.user)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => { void checkSupabase().then(setSupaOk) }, [])

  // ── On mount: load all data from DB (authoritative source) ───────────────────
  useEffect(() => {
    void (async () => {
      try {
        // Settings
        const dbSettings = await loadSettingsFromDB(DEFAULTS)
        setSettings(dbSettings)
        saveSettings(dbSettings)

        // Companies (full — with users, emailDomain, accountId)
        const dbCompanies = await loadCompaniesFromDB()
        if (dbCompanies.length > 0) {
          // Merge: DB wins for metadata, but preserve localStorage users if DB has none yet
          const localBackup: Record<string, CompanyUser[]> = ls('professor-company-users', {})
          const merged = dbCompanies.map(c => ({
            ...c,
            users: c.users?.length ? c.users : (localBackup[c.id] ?? []),
          }))
          setCompanies(merged)
          saveCompanies(merged)
        } else if (companies.length === 0) {
          // DB empty too — nothing to recover
        }

        // Connected accounts metadata from DB
        const dbAccounts = await loadAccountsFromDB()
        if (dbAccounts.length > 0) {
          // Merge: keep local providerTokens, fill in metadata from DB for any missing
          setAccounts(prev => {
            const merged = [...prev]
            for (const dba of dbAccounts) {
              if (!merged.find(a => a.email === dba.email)) {
                merged.push({ ...dba, providerToken: '' })
              }
            }
            return merged
          })
        }
      } catch { /* offline / not signed in */ }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Local-only field updates (immediate localStorage) ────────────────────────
  function update(patch: Partial<AppSettings>) {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }

  // ── Per-section DB save helper ───────────────────────────────────────────────
  function withSectionSave(sectionId: string, fn: () => Promise<void>) {
    return async () => {
      setSectionSaving(p => ({ ...p, [sectionId]: 'saving' }))
      setSectionError(p => ({ ...p, [sectionId]: '' }))
      try {
        await fn()
        setSectionSaving(p => ({ ...p, [sectionId]: 'saved' }))
        setTimeout(() => setSectionSaving(p => ({ ...p, [sectionId]: 'idle' })), 2000)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[Settings save:${sectionId}]`, msg)
        setSectionError(p => ({ ...p, [sectionId]: msg }))
        setSectionSaving(p => ({ ...p, [sectionId]: 'error' }))
        setTimeout(() => setSectionSaving(p => ({ ...p, [sectionId]: 'idle' })), 5000)
      }
    }
  }

  // ── DnD sensors ─────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = sectionOrder.indexOf(active.id as SectionId)
    const newIdx = sectionOrder.indexOf(over.id as SectionId)
    const next = arrayMove(sectionOrder, oldIdx, newIdx)
    setSectionOrder(next)
    saveSectionOrder(next)
  }

  // ── Section renderer ─────────────────────────────────────────────────────────
  function renderSection(id: SectionId) {
    const meta = SECTION_META.find(m => m.id === id)!
    const saving = sectionSaving[id] ?? 'idle'

    // Wrap save button label with state feedback
    const saveLabel = saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved ✓' : saving === 'error' ? 'Error ✗' : undefined

    // Map section id → its DB save function
    const saveFns: Partial<Record<SectionId, () => Promise<void>>> = {
      profile:       () => saveProfileToDB(settingsRef.current),
      schedule:      () => saveProfileToDB(settingsRef.current),
      companies:     () => saveCompaniesToDB(companies as DbSyncCompanyRow[]),
      habits:        async () => { const { habits } = useHabitsStore.getState(); await saveHabitsToDB(habits); await saveHabitLogsToDB(loadLogs()) },
      professor:     () => savePrefsToDB(settingsRef.current),
      notifications: () => savePrefsToDB(settingsRef.current),
      appearance:    () => savePrefsToDB(settingsRef.current),
    }
    const saveFn = saveFns[id]

    const errMsg = sectionError[id]

    return (
      <SectionShell key={id} id={id} meta={meta}
        saveLabel={saveLabel}
        onSave={saveFn ? withSectionSave(id, saveFn) : undefined}
      >
        {saving === 'error' && errMsg && (
          <div style={{ margin: '0 0 14px', padding: '8px 12px', borderRadius: 8, background: 'rgba(224,82,82,0.08)', border: '1px solid rgba(224,82,82,0.25)', fontSize: 12, color: '#E05252' }}>
            ✗ {errMsg}
          </div>
        )}
        {id === 'profile'       && <ProfileSection       s={settings} set={update} />}
        {id === 'schedule'      && <ScheduleSection      s={settings} set={update} />}
        {id === 'companies'     && <CompaniesSection     companies={companies}
                                      setCompanies={c => { setCompanies(c); saveCompanies(c) }}
                                      accounts={accounts} />}
        {id === 'habits'        && <HabitsSection />}
        {id === 'accounts'      && <AccountsSection      accounts={accounts}
                                      setAccounts={a => { setAccounts(a) }}
                                      primaryEmail={authUser?.email ?? ''} />}
        {id === 'professor'     && <ProfessorSection     s={settings} set={update} />}
        {id === 'notifications' && <NotificationsSection s={settings} set={update} />}
        {id === 'appearance'    && <AppearanceSection    s={settings} set={update} />}
      </SectionShell>
    )
  }

  async function handleSignOut() {
    await googleSignOut()
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1080, margin: '0 auto' }}>
      {/* ── Top bar: user info + status ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24, padding: '16px 20px',
        background: 'var(--color-surface, #161929)',
        border: '1px solid var(--color-border, #252A3E)',
        borderRadius: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {authUser?.avatarUrl
            ? <img src={authUser.avatarUrl} alt="avatar" style={{ width: 40, height: 40, borderRadius: '50%', border: '2px solid var(--color-border, #252A3E)' }} />
            : <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-accent-fill, rgba(30,64,175,0.15))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <User size={18} color="var(--color-accent, #1E40AF)" />
              </div>
          }
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text, #E8EAF6)' }}>
              {authUser?.name ?? authUser?.email ?? 'Professor User'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: supaOk === null ? '#888780' : supaOk ? '#1D9E75' : '#E05252' }} />
                <span style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)' }}>
                  {supaOk === null ? 'Checking...' : supaOk ? 'Supabase connected' : 'Offline (local only)'}
                </span>
              </div>
              <span style={{ color: 'var(--color-border, #252A3E)' }}>·</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)' }}>
                {accounts.length + 1} account{accounts.length !== 0 ? 's' : ''} connected
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => void checkSupabase().then(setSupaOk)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 8, background: 'transparent', border: '1px solid var(--color-border, #252A3E)', color: 'var(--color-text-dim, #94A3B8)', fontSize: 12, cursor: 'pointer' }}>
            <RefreshCw size={12} /> Refresh
          </button>
          <button onClick={() => void handleSignOut()}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 8, background: 'transparent', border: '1px solid rgba(224,82,82,0.3)', color: '#E05252', fontSize: 12, cursor: 'pointer' }}>
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </div>

      {/* ── Drag-reorderable sections (2-column grid) ───────────────────────── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sectionOrder} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
            {sectionOrder.map(id => renderSection(id))}
          </div>
        </SortableContext>
      </DndContext>

      {/* ── Footer hint ─────────────────────────────────────────────────────── */}
      <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--color-text-muted, #6B7280)', marginTop: 24 }}>
        Drag sections to reorder · Changes save automatically
      </p>
    </div>
  )
}
