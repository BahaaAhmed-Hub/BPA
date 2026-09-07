// ─── The Be mark ─────────────────────────────────────────────────────────────
//
// Built from the design handoff (`design_handoff_be_logo`): the wordmark **Be**
// plus a square period, inside a rounded square, in three approved colourways.
//
// Everything derives from one scale factor, k = size / 148, exactly as the
// handoff's own reference implementation does. That matters because the
// handoff's size table and its reference HTML disagree about the 44px icon
// (the table says radius 9 / font 22 / dot 4 / gap 2; the HTML and the
// reference code both give 6 / 23 / 3 / 1). The README calls the HTML the
// authoritative visual reference and the code agrees with it, so the scale
// formula is what is implemented here — one rule, no special cases, and it
// reproduces every size in the reference at a pixel.
//
// The dot is dropped below 26px, as specified. Instrument Sans 600 is already
// loaded in index.html; without it the mark still sets, in the system stack, at
// the same metrics.

export type BeVariant = 'white' | 'black' | 'amber'

interface Colourway {
  bg: string
  border: string | null
  word: string
  dot: string
  radius: number
}

/** The three approved pairings. The dot is the only element allowed to differ
 *  from the ground and the word, and each pairing is contrast-checked — so
 *  these are not to be mixed. */
export const BE_VARIANTS: Record<BeVariant, Colourway> = {
  white: { bg: '#FAF6F6', border: '#E8E8EE', word: '#000000', dot: '#FAD10C', radius: 14 },
  black: { bg: '#000000', border: '#E8E8EE', word: '#E8E8EE', dot: '#F8D31E', radius: 14 },
  amber: { bg: '#E9A23B', border: null,      word: '#050505', dot: '#F2F2F8', radius: 16 },
}

/**
 *  The one measurement the scale factor gets wrong.
 *
 *  Everything else in the handoff agrees with k = size/148, but the border does
 *  not: the size table and the reference HTML both give 3 / 2 / 1.5px at
 *  148 / 44 / 26, where the formula would give 3 / 1.5 / 1.5. Two sources out
 *  of three say 2px at icon size, and a hairline there is visibly thinner than
 *  the reference — so the steps win over the formula here.
 */
function borderFor(size: number): number {
  if (size >= 100) return 3
  if (size >= 36)  return 2
  return 1.5
}

export function BeLogo({ variant = 'black', size = 148, title }: {
  variant?: BeVariant
  size?: number
  /** A name for it, where the mark stands alone as a link or a button. */
  title?: string
}) {
  const v = BE_VARIANTS[variant]
  const k = size / 148

  return (
    <div
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      title={title}
      style={{
        boxSizing: 'border-box',
        width: size, height: size, flexShrink: 0,
        borderRadius: Math.max(6, Math.round(v.radius * k)),
        border: v.border ? `${borderFor(size)}px solid ${v.border}` : undefined,
        background: v.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* The word and the dot share a baseline; the pair is centred on both
          axes. The 0.72 line-height is what removes the dead space above the
          caps — without it the mark sits low in its container. */}
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <span style={{
          fontFamily: 'var(--sb-font-ui)',
          fontSize: Math.round(76 * k),
          fontWeight: 600,
          letterSpacing: '-0.06em',
          lineHeight: 0.72,
          color: v.word,
        }}>Be</span>
        {/* Below 26px the dot is dropped and the word carries the mark. */}
        {size >= 26 && (
          <span style={{
            width: Math.max(3, Math.round(9 * k)),
            height: Math.max(3, Math.round(9 * k)),
            borderRadius: 2,
            background: v.dot,
            marginLeft: Math.max(1, Math.round(5 * k)),
            marginBottom: Math.max(1, Math.round(4 * k)),
          }} />
        )}
      </div>
    </div>
  )
}
