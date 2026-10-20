import { inputStyle } from '@/lib/fields'
import { type AppSettings } from '../model'
import { FieldRow, Toggle } from '../ui'

const BUFFER_STEPS = [0,15,30,45,60]
const PHYS_STEPS   = [0,30,60,90]

export function ScheduleSection({
  s, set,
}: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  return (
    <div>
      <FieldRow label="Focus window" sub="Deep work block">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="time" value={s.focusStart} onChange={e => set({ focusStart: e.target.value })}
            style={{ ...inputStyle, width: 118 }} />
          <span style={{ color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-meta)' }}>to</span>
          <input type="time" value={s.focusEnd} onChange={e => set({ focusEnd: e.target.value })}
            style={{ ...inputStyle, width: 118 }} />
        </div>
      </FieldRow>
      <FieldRow label="Earliest meeting" sub="No calls before">
        <input type="time" value={s.earliestMeeting} onChange={e => set({ earliestMeeting: e.target.value })}
          style={{ ...inputStyle, width: 118 }} />
      </FieldRow>
      <FieldRow label="End of day">
        <input type="time" value={s.endOfDay} onChange={e => set({ endOfDay: e.target.value })}
          style={{ ...inputStyle, width: 118 }} />
      </FieldRow>
      <FieldRow label="Family time">
        <input type="time" value={s.familyStart} onChange={e => set({ familyStart: e.target.value })}
          style={{ ...inputStyle, width: 118 }} />
      </FieldRow>
      <FieldRow label="Meeting buffer" sub="Virtual gap">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {BUFFER_STEPS.map(n => (
            <button key={n} onClick={() => set({ bufferMins: n })}
              style={{
                padding: '4px 10px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)', cursor: 'pointer', fontWeight: 500,
                background: s.bufferMins === n ? 'rgba(var(--sb-accent-rgb),0.12)' : 'var(--sb-field)',
                border: `var(--sb-border-width) solid ${s.bufferMins === n ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                // `--sb-accent-deep`, never `--sb-accent`: the fill behind a
                // chosen pill is the accent at 12%, and the accent itself on
                // that tint measures **1.42:1** — a label that is not there.
                // The border stays the accent, which is a line rather than
                // text and holds no contrast duty. Found the day the ink audit
                // could finally reach this screen at all.
                color: s.bufferMins === n ? 'var(--sb-accent-deep)' : 'var(--sb-ink-3)',
              }}>{n === 0 ? 'None' : `${n}m`}</button>
          ))}
        </div>
      </FieldRow>
      <FieldRow label="Physical buffer" sub="Travel time">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {PHYS_STEPS.map(n => (
            <button key={n} onClick={() => set({ physicalBufferMins: n })}
              style={{
                padding: '4px 10px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)', cursor: 'pointer', fontWeight: 500,
                background: s.physicalBufferMins === n ? 'rgba(var(--sb-accent-rgb),0.12)' : 'var(--sb-field)',
                border: `var(--sb-border-width) solid ${s.physicalBufferMins === n ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                color: s.physicalBufferMins === n ? 'var(--sb-accent-deep)' : 'var(--sb-ink-3)',
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
