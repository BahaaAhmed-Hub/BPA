import type { ReactNode } from 'react'

// ─── What is not built yet, said out loud ────────────────────────────────────
//
// A control that looks live and does nothing is worse than no control: you
// press it, nothing happens, and you spend the next ten minutes deciding
// whether the app is broken or you are. Everything here that is drawn but not
// wired says so — dimmed by half, with a label — so the answer takes no time
// at all.
//
// Two pieces, because there are two cases. `Soon` is the label. `NotYet` wraps
// a block that is on screen for the shape of it: it dims the block, takes it
// out of the tab order, and stops clicks reaching what is underneath.

const AMBER_INK = '#7A5F09'
const AMBER_BG  = 'rgba(var(--sb-accent-rgb),0.22)'
const AMBER_EDGE = 'rgba(197,163,44,0.45)'

/** The label on its own — for a row or a card that has its own layout. */
export function Soon({ text = 'Coming soon', style }: { text?: string; style?: React.CSSProperties }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
      height: 18, padding: '0 8px', borderRadius: 'var(--sb-r-pill)',
      background: AMBER_BG, border: `1px solid ${AMBER_EDGE}`, color: AMBER_INK,
      fontFamily: 'inherit', fontSize: 'var(--sb-t-micro)', fontWeight: 700,
      letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
      ...style,
    }}>
      {/* A small ring rather than a clock face: at 8px a clock is a smudge. */}
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden focusable="false">
        <circle cx="4" cy="4" r="3.1" fill="none" stroke={AMBER_INK} strokeWidth="1.4" opacity="0.75" />
      </svg>
      {text}
    </span>
  )
}

/**
 *  A block that is drawn but not yet working: half opacity, unclickable, out of
 *  the tab order, and labelled. The label sits top-right of the block unless
 *  `label` is false — some places have somewhere better to put it.
 */
export function NotYet({ children, text, label = true, style }: {
  children: ReactNode
  text?: string
  label?: boolean
  style?: React.CSSProperties
}) {
  return (
    <div style={{ position: 'relative', ...style }}>
      <div
        aria-hidden
        // `inert` would be the right word for this and Safari only learned it
        // recently; opacity plus pointer-events plus aria-hidden is the part
        // every browser agrees on.
        style={{ opacity: 0.5, pointerEvents: 'none', filter: 'saturate(0.75)' }}
      >
        {children}
      </div>
      {label && (
        <Soon text={text} style={{ position: 'absolute', top: 8, right: 10, zIndex: 2 }} />
      )}
    </div>
  )
}
