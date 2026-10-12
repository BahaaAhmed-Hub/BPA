// The Library's form primitives — one place, so the panel, the add dialog and
// the list editor draw a field the same way. Each is a platform token away from
// the controls in the calendar composer: field ground, hairline border,
// --sb-r-sm corners, and 16px type on touch so iOS does not zoom the page when
// one is focused.
import type { ReactNode } from 'react'
import { Star } from 'lucide-react'
import { useHeldText } from '@/lib/useHeldText'
import { CAPS, ICON } from '@/lib/type'
import { inputStyle } from './fieldStyle'


export function Eyebrow({ children }: { children: ReactNode }) {
  return <div style={{ ...CAPS, color: 'var(--sb-ink-3)', marginBottom: 8 }}>{children}</div>
}

export function Field({ label, children, grow = 1 }: { label: string; children: ReactNode; grow?: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: `${grow} 1 0`, minWidth: 0 }}>
      <span style={{ ...CAPS, color: 'var(--sb-ink-4)' }}>{label}</span>
      {children}
    </label>
  )
}

export function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>{children}</div>
}

export function TextField({ label, value, onPush, placeholder, grow }: {
  label: string; value: string; onPush: (v: string) => void; placeholder?: string; grow?: number
}) {
  const { text, onChange, onBlur } = useHeldText(value, onPush)
  return (
    <Field label={label} grow={grow}>
      <input value={text} placeholder={placeholder} onChange={e => onChange(e.target.value)} onBlur={onBlur}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} style={inputStyle} />
    </Field>
  )
}

export function NumField({ label, value, onPush, placeholder, grow }: {
  label: string; value: number | undefined; onPush: (v: number | undefined) => void; placeholder?: string; grow?: number
}) {
  const { text, onChange, onBlur } = useHeldText(value === undefined ? '' : String(value), v => {
    const t = v.trim()
    if (!t) return onPush(undefined)
    const n = parseInt(t, 10)
    // A half-typed number is not a reason to write a zero.
    if (Number.isFinite(n) && n >= 0) onPush(n)
  })
  return (
    <Field label={label} grow={grow}>
      <input value={text} inputMode="numeric" placeholder={placeholder} onChange={e => onChange(e.target.value)} onBlur={onBlur}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} style={inputStyle} />
    </Field>
  )
}

export function AreaField({ label, value, onPush, placeholder, rows = 4 }: {
  label: string; value: string; onPush: (v: string) => void; placeholder?: string; rows?: number
}) {
  const { text, onChange, onBlur } = useHeldText(value, onPush)
  return (
    <Field label={label}>
      <textarea value={text} rows={rows} placeholder={placeholder} onChange={e => onChange(e.target.value)} onBlur={onBlur}
        style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
    </Field>
  )
}

export function DateField({ label, value, onPush }: { label: string; value: string | undefined; onPush: (v: string | undefined) => void }) {
  return (
    <Field label={label}>
      <input type="date" value={value ?? ''} onChange={e => onPush(e.target.value || undefined)} style={inputStyle} />
    </Field>
  )
}

/** 0 is unrated. Pressing the star you are on takes the rating back off — the
 *  only way to say "I have not decided" after having decided. 36px targets. */
export function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Rating" style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => onChange(value === n ? 0 : n)}
          style={{ width: 36, height: 36, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Star size={ICON.lg + 4} strokeWidth={1.75}
            color={n <= value ? 'var(--sb-accent-deep)' : 'var(--sb-ink-4)'}
            fill={n <= value ? 'var(--sb-accent)' : 'none'} />
        </button>
      ))}
    </div>
  )
}
