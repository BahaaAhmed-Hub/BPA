import { useMemo, useState } from 'react'
import { Segmented } from '@/components/ui'
import { loadCachedCalendars } from '@/lib/blockingRules'
import {
  DEFAULT_VIEW_OPTIONS, loadDefaultCalendar, loadDefaultView, loadHideCompleted,
  saveDefaultCalendar, saveDefaultView, saveHideCompleted, type DefaultView,
} from '@/lib/taskPrefs'
import { inputStyle } from '@/lib/fields'
import { type AppSettings } from '../model'
import { DRow, Toggle } from '../ui'

/** How the Professor plans your day. Moved here from Profile with its behaviour untouched: it is the
 *  same `framework` setting, and what each choice changes is still to be decided. */
const FRAMEWORK_SEGMENTS = [
  { value: 'time_blocking', label: 'Time blocking' },
  { value: 'eisenhower',    label: 'Eisenhower' },
  { value: 'gtd',           label: 'GTD' },
]

/** Settings → Tasks → Defaults: how the Tasks page opens, what it hides, where an unplaced task goes,
 *  and the planning framework used across the app. */
export function TaskPreferencesSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const [view, setView] = useState<DefaultView>(loadDefaultView)
  const [hide, setHide] = useState(loadHideCompleted)
  const [cal, setCal] = useState(loadDefaultCalendar)

  // Writable calendars the calendar page has seen, grouped by the account they are on.
  const calendars = useMemo(() => loadCachedCalendars()
    .filter(c => (c as { accessRole?: string }).accessRole ? ['owner', 'writer'].includes((c as { accessRole?: string }).accessRole!) : true), [])
  const accounts = [...new Set(calendars.map(c => c.accountEmail))]
  const chosen = cal ? `${cal.accountEmail ?? ''}|${cal.calendarId}` : ''

  return (
    <div data-task-defaults>
      <DRow label="Default view" sub="Which view Tasks opens on. “Last used” opens wherever you left it.">
        <Segmented aria-label="Default tasks view" value={view} options={DEFAULT_VIEW_OPTIONS}
          onChange={v => { setView(v); saveDefaultView(v) }} />
      </DRow>

      <DRow label="Hide completed tasks" sub="Done tasks stay out of the board, matrix and list until you ask for them. The Tasks page's own filter still switches it for a visit.">
        <Toggle checked={hide} onChange={on => { setHide(on); saveHideCompleted(on) }} />
      </DRow>

      <DRow label="Default calendar for tasks" sub="Where a task goes when you place it on the calendar and neither the task nor its company names a calendar.">
        <select aria-label="Default calendar for tasks" value={chosen} style={{ ...inputStyle, width: 260 }}
          onChange={e => {
            const v = e.target.value
            if (!v) { setCal(null); saveDefaultCalendar(null); return }
            const [accountEmail, calendarId] = [v.slice(0, v.indexOf('|')), v.slice(v.indexOf('|') + 1)]
            const next = { calendarId, ...(accountEmail ? { accountEmail } : {}) }
            setCal(next); saveDefaultCalendar(next)
          }}>
          <option value="">Your primary calendar</option>
          {accounts.map(a => (
            <optgroup key={a} label={a || 'Calendars'}>
              {calendars.filter(c => c.accountEmail === a).map(c => (
                <option key={c.id} value={`${a}|${c.id}`}>{c.summary ?? c.id}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </DRow>

      <DRow label="Productivity framework" sub="How the Professor plans your day, across the app. What each one changes is still being decided." last>
        <Segmented
          value={FRAMEWORK_SEGMENTS.some(f => f.value === s.framework) ? s.framework : 'time_blocking'}
          options={FRAMEWORK_SEGMENTS}
          onChange={v => set({ framework: v })}
        />
      </DRow>
    </div>
  )
}
