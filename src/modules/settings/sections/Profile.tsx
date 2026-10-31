import { useState } from 'react'
import { RefreshCw, LocateFixed } from 'lucide-react'
import { loadWeekStart, saveWeekStart, WEEKDAY_NAMES, type Weekday } from '@/lib/weekStart'
import { syncTimezoneFromLocation } from '@/lib/weather'
import { ICON } from '@/lib/type'
import { SearchSelect } from '@/components/SearchSelect'
import { type AppSettings } from '../model'
import { DRow, GhostPill } from '../ui'
import { PILL_BASE, pillSelectStyle } from '../pillStyles'

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

/** ALL_TZ as the shared picker wants it. `keywords` carries the bare city so
 *  "cairo" finds it without the label having to repeat itself. */
const TZ_OPTIONS = ALL_TZ.map(tz => ({
  value: tz.value,
  label: tz.label,
  keywords: tz.value.replace(/[_/]/g, ' '),
}))

const WORK_DAYS    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

// ─── Sortable Section Shell ────────────────────────────────────────────────────

// SectionShell removed — Settings now uses a left-rail + single-panel layout.

// ─── CHUNK 3: Profile & Schedule sections ────────────────────────────────────

/** "Sunday to Thursday" / "Mon, Wed, Fri" summary of the selected work week. */
function workWeekSummary(days: string[]): string {
  const ordered = WORK_DAYS.filter(d => days.includes(d))
  if (ordered.length === 0) return 'No work days selected'
  const full: Record<string, string> = {
    Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
    Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday',
  }
  const idx = ordered.map(d => WORK_DAYS.indexOf(d))
  const contiguous = idx.every((n, i) => i === 0 || n === idx[i - 1] + 1)
  if (contiguous && ordered.length > 1) return `${full[ordered[0]]} to ${full[ordered[ordered.length - 1]]}`
  if (ordered.length === 1) return full[ordered[0]]
  return ordered.join(', ')
}

export function ProfileSection({
  s, set, name, email, avatarUrl, onSignOut, onRefresh, refreshing,
}: {
  s: AppSettings
  set: (p: Partial<AppSettings>) => void
  name: string
  email: string
  avatarUrl?: string
  onSignOut: () => void
  onRefresh: () => void
  refreshing: boolean
}) {
  const tzLabel = ALL_TZ.find(t => t.value === s.timezone)?.label ?? s.timezone
  const [tzSyncing, setTzSyncing] = useState(false)
  const [tzSyncNote, setTzSyncNote] = useState<string | undefined>(undefined)
  const initials = (s.fullName || name || 'P').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const [weekStartDay, setWeekStartDay] = useState<Weekday>(() => loadWeekStart())

  return (
    <div>
      {/* Identity block */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        paddingBottom: 18, borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
      }}>
        {avatarUrl
          ? <img src={avatarUrl} alt="" style={{ width: 46, height: 46, borderRadius: 'var(--sb-r-pill)', border: 'var(--sb-border-width) solid var(--sb-border)', flexShrink: 0, objectFit: 'cover' }} />
          : <div style={{
              width: 46, height: 46, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
              background: 'var(--sb-hairline)', border: 'var(--sb-border-width) solid var(--sb-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 'var(--sb-t-h3)', fontWeight: 700, color: 'var(--sb-ink-3)', letterSpacing: '0.02em',
            }}>{initials}</div>
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600,
            letterSpacing: '-0.02em', color: 'var(--sb-ink-1)', lineHeight: 1.25,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{s.fullName || name || 'Professor User'}</p>
          <p style={{
            margin: '2px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{[email, tzLabel].filter(Boolean).join(' · ')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <GhostPill icon={RefreshCw} onClick={onRefresh}>{refreshing ? 'Refreshing…' : 'Refresh'}</GhostPill>
          <GhostPill tone="rust" onClick={onSignOut}>Sign out</GhostPill>
        </div>
      </div>

      {/* Fields */}
      <DRow label="Full name">
        <input
          value={s.fullName}
          onChange={e => set({ fullName: e.target.value })}
          placeholder="Your name"
          style={{ ...PILL_BASE, width: 220 }}
        />
      </DRow>

      <DRow label="Timezone" sub={tzSyncNote}>
        {/* Four hundred zones. A native select here is a list you scroll
            past the one you wanted; this one you type into. */}
        <SearchSelect
          value={s.timezone}
          onChange={v => set({ timezone: v })}
          options={TZ_OPTIONS}
          placeholder="Choose a timezone"
          ariaLabel="Timezone"
          style={pillSelectStyle}
        />
        {/* Nothing asks for your location until you press this. */}
        <button
          onClick={async () => {
            setTzSyncing(true); setTzSyncNote(undefined)
            const tz = await syncTimezoneFromLocation()
            setTzSyncing(false)
            if (!tz) { setTzSyncNote('Could not read your location — pick a zone above.'); return }
            const known = ALL_TZ.some(t => t.value === tz)
            set({ timezone: tz })
            setTzSyncNote(known ? `Set from your location — ${tz.replace(/_/g, ' ')}` : `Set to ${tz.replace(/_/g, ' ')}`)
          }}
          disabled={tzSyncing}
          title="Set the timezone from where you are"
          style={{
            width: 'var(--sb-h-nav)', height: 'var(--sb-h-nav)', borderRadius: 'var(--sb-r-sm)', flexShrink: 0, padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
            color: tzSyncing ? 'var(--sb-ink-3)' : 'var(--sb-ink-3)',
            cursor: tzSyncing ? 'default' : 'pointer',
          }}>
          <LocateFixed size={ICON.md} style={tzSyncing ? { opacity: 0.5 } : undefined} />
        </button>
      </DRow>

      <DRow label="Week starts on" sub={`Every calendar draws its week from ${WEEKDAY_NAMES[weekStartDay]}`}>
        <select
          value={weekStartDay}
          onChange={e => { const d = Number(e.target.value) as Weekday; setWeekStartDay(d); saveWeekStart(d) }}
          style={pillSelectStyle}>
          {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </DRow>

      <DRow label="Work days" sub={workWeekSummary(s.workWeek)} last>
        <div style={{ display: 'flex', gap: 6 }}>
          {WORK_DAYS.map(d => {
            const on = s.workWeek.includes(d)
            return (
              <button
                key={d}
                onClick={() => set({ workWeek: on ? s.workWeek.filter(x => x !== d) : [...s.workWeek, d] })}
                style={{
                  padding: '7px 11px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: on ? 600 : 500,
                  background: on ? 'var(--sb-ink-1)' : 'var(--sb-field)',
                  border: `var(--sb-border-width) solid ${on ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
                  color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                  transition: 'all 0.12s',
                }}>{d}</button>
            )
          })}
        </div>
      </DRow>
    </div>
  )
}
