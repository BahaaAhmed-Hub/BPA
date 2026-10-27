import type { ReactNode } from 'react'

/** A switch that says what it switches. The track and knob are drawn in `wizard.css`. */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" className="wz-sw" role="switch" aria-checked={on} aria-label={label} aria-disabled={disabled || undefined}
      onClick={() => { if (!disabled) onChange(!on) }}>
      <span />
    </button>
  )
}

/** The highlighter stroke under the word a title leans on. */
export function Hl({ children }: { children: ReactNode }) {
  return <span className="wz-hl">{children}</span>
}
