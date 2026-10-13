// ─── A company, as a circle ──────────────────────────────────────────────────
//
// One drawing, used by the rail's tile and by the picker in Settings. They are
// the same object — what you set in Settings is what you press in the rail —
// and two copies of it would drift the first time either was touched, which is
// what the colour swatch and the rail's disc had already done.
//
// - **The logo when there is one, the initials when there is not.** A company
//   with no logo is not a company with a blank circle: the tinted disc with two
//   letters is a real answer and stays the fallback for ever.
// - **The disc carries the colour; the mark carries the letters.** Measured,
//   because the other way round failed: `#3B82F6` on white is ~3.1:1, so
//   `inkOnKeeping` fell back to `--sb-ink-1` and two of three discs came out
//   identically near-black — the one thing a company tile must never do. And a
//   white disc is a 5% wash in Glass, where `--sb-card` is translucent.
// - **A logo fills the circle, edge to edge.** `logoFromFile` has already made
//   the stored square *into* a circle's worth of pixels — a transparent mark
//   drawn smaller so the tint shows round it, an opaque one extended to its
//   own corners — so there is nothing left to decide here. Padding it again
//   was what made a navy app mark read as a square floating in a circle.

import { loadDynamicCompanies, type DynamicCompany } from '@/types'
import { useInkOnKeeping } from '@/lib/ink'

/** Up to two letters, the way every company chip in the app already shortens. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** The company's own colour, 20% into the one surface token that is opaque in
 *  every theme. Exported because the picker needs the same ground to measure
 *  its own ink against. */
export function discOf(color: string): string {
  return `color-mix(in srgb, ${color} 20%, var(--sb-overlay))`
}

export type MarkCompany = Pick<DynamicCompany, 'name' | 'color'> & { logoUrl?: string }

/** The circle alone — no button, no ring, no handler. Whoever draws it decides
 *  what pressing it means. */
export function CompanyMark({ co, size }: { co: MarkCompany; size: number }) {
  const keeping = useInkOnKeeping()
  const disc = discOf(co.color)
  const mark = keeping('var(--sb-ink-1)', disc, 4.5)
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, flexShrink: 0, borderRadius: '50%',
        background: disc, color: mark, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'inherit', fontSize: Math.round(size * 0.31), fontWeight: 800,
        letterSpacing: '-0.01em',
      }}>
      {co.logoUrl ? (
        <img
          src={co.logoUrl}
          alt=""
          style={{
            // `cover`, not `contain`: the stored image is always square, so
            // the two agree — and `cover` is the one that cannot leave a gap
            // if that ever stops being true.
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          }} />
      ) : initialsOf(co.name)}
    </span>
  )
}

/** The logo a company has, by id, for a caller holding nothing but the id. */
export function logoOfCompany(companyId: string | undefined): string | undefined {
  if (!companyId) return undefined
  return loadDynamicCompanies().find(c => c.id === companyId)?.logoUrl
}
