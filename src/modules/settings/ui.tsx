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
        // On: the label colour the theme guarantees against its own accent. `--sb-card` is a pale
        // or translucent surface and, on Glass's lilac or Sunlit's amber, left a knob you could not see.
        background: checked ? 'var(--sb-accent-ink)' : 'var(--sb-ink-3)',
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
    // `sx-row` is how Settings drops the last row's rule (see the page's <style>).
    <div className="sx-row" style={{
      display: 'flex', alignItems: 'center', gap: '10px 24px', flexWrap: 'wrap',
      padding: '14px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
    }}>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 'var(--sb-t-body)', fontWeight: 500, color: 'var(--sb-ink-1)', lineHeight: 1.3 }}>{label}</span>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>{sub}</p>}
      </div>
      {/* One control column, hard right. It takes the width its content needs,
          up to 440px — a fixed 280 squeezed the sections that put a sentence
          of help text under their control into a tall sliver. */}
      <div style={{
        flex: '0 1 auto', maxWidth: 'min(100%, 440px)', minWidth: 0, display: 'flex',
        justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 6,
      }}>{children}</div>
    </div>
  )
}

/** A titled group of rows: the title and one line above, the rows in a white
 *  rounded card. `bare` is for a section that draws its own boxes — a card
 *  inside a card is the thing this exists to avoid. */
export function Block({ title, sub, children, bare }: {
  title?: string; sub?: string; children: ReactNode; bare?: boolean
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      {(title || sub) && (
        <div style={{ margin: '0 0 10px 2px' }}>
          {title && <h3 style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{title}</h3>}
          {sub && <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>{sub}</p>}
        </div>
      )}
      {bare ? children : (
        <div style={{
          background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
          borderRadius: 'var(--sb-r-card)', padding: '8px 20px', boxShadow: 'var(--sb-shadow-control)', minWidth: 0,
        }}>{children}</div>
      )}
    </section>
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
    <div className="sx-row" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px 24px', flexWrap: 'wrap',
      padding: '14px 0',
      borderBottom: last ? 'none' : 'var(--sb-border-width) solid var(--sb-hairline)',
    }}>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', fontWeight: 500, color: 'var(--sb-ink-1)', lineHeight: 1.3 }}>{label}</p>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.35 }}>{sub}</p>}
      </div>
      <div style={{ flex: '0 1 auto', maxWidth: 'min(100%, 440px)', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10 }}>{children}</div>
    </div>
  )
}
