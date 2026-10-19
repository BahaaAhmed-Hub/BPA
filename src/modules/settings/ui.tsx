import { type ReactNode } from 'react'
import { AssistantAvatar } from '@/modules/assistant/AssistantAvatar'
import { PILL_BASE } from './pillStyles'

// ─── CHUNK 2: Shared UI atoms ─────────────────────────────────────────────────


export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const accent = 'var(--sb-accent)'
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      style={{
        width: 42, height: 24, borderRadius: 'var(--sb-r-nav)', flexShrink: 0,
        background: checked ? accent : 'var(--sb-border)',
        border: 'none', cursor: 'pointer', position: 'relative', padding: 0, transition: 'background 0.2s',
      }}>
      <span style={{
        position: 'absolute', top: 4, left: checked ? 22 : 4,
        width: 16, height: 16, borderRadius: 'var(--sb-r-pill)', display: 'block',
        background: checked ? 'var(--sb-card)' : 'var(--sb-ink-3)',
        transition: 'left 0.2s',
      }} />
    </button>
  )
}

/** The assistant's face where a lucide icon is expected (the rail and the card header). */
export function AssistantNavIcon({ size = 15 }: { size?: number; strokeWidth?: number; color?: string; style?: React.CSSProperties }) {
  return <span style={{ display: 'inline-flex', flexShrink: 0 }}><AssistantAvatar size={size + 5} radius="50%" ring={false} /></span>
}

export function FieldRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    // Wraps rather than spills: when the control cannot fit beside the label
    // it drops to its own line, instead of overflowing onto the next card.
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
      padding: '5px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
    }}>
      <div style={{ flex: '1 1 150px', minWidth: 0, maxWidth: 172, paddingTop: 2 }}>
        <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)' }}>{label}</span>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>{sub}</p>}
      </div>
      <div style={{
        flex: '1 1 auto', minWidth: 0, display: 'flex',
        justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 6,
      }}>{children}</div>
    </div>
  )
}

/** Ghost pill button — optional leading icon, optional rust tone. */
export function GhostPill({ icon: Icon, children, onClick, tone, title }: {
  icon?: React.ElementType
  children: ReactNode
  onClick?: () => void
  tone?: 'default' | 'rust'
  title?: string
}) {
  return (
    <button onClick={onClick} title={title} style={{
      ...PILL_BASE,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      cursor: 'pointer',
      color: tone === 'rust' ? 'var(--sb-negative)' : 'var(--sb-ink-1)',
      borderColor: tone === 'rust' ? 'color-mix(in srgb, var(--sb-negative) 35.0%, transparent)' : 'var(--sb-border)',
      background: tone === 'rust' ? 'var(--sb-card)' : 'var(--sb-field)',
    }}>
      {Icon && <Icon size={13} strokeWidth={2} />}
      {children}
    </button>
  )
}

/** Static cream pill for values that are displayed, not edited here. */
export function PillValue({ children }: { children: ReactNode }) {
  return <span style={{ ...PILL_BASE, display: 'inline-block', color: 'var(--sb-ink-1)' }}>{children}</span>
}

/** Label (+sub) on the left, control hard-right — the artboard row rhythm. */
export function DRow({ label, sub, children, last }: {
  label: string; sub?: string; children: ReactNode; last?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      padding: '12px 0',
      borderBottom: last ? 'none' : 'var(--sb-border-width) solid var(--sb-hairline)',
    }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', fontWeight: 500, color: 'var(--sb-ink-1)', lineHeight: 1.3 }}>{label}</p>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.35 }}>{sub}</p>}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>{children}</div>
    </div>
  )
}
