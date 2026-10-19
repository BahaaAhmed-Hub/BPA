import { useState } from 'react'

/**
 * The assistant's face. One component for every place it appears — the floating
 * button, the panel header, each reply, the tab it leaves when put aside — so
 * there is one picture to replace.
 *
 * The picture is `public/assistant-avatar.png`. Until that file exists (or if it
 * fails to load) a drawn portrait stands in, so the assistant never shows an
 * empty box or a broken-image glyph. The fallback is deliberately a person, not
 * an icon.
 */
const SRC = `${import.meta.env.BASE_URL}assistant-avatar.png`
/** The same portrait with its background removed — for where it floats on its own, with no tile behind it. */
const CUTOUT = `${import.meta.env.BASE_URL}assistant-avatar-cutout.png`

function Drawn({ bare = false }: { bare?: boolean }) {
  return (
    <svg viewBox="0 0 96 96" width="100%" height="100%" aria-hidden focusable="false" style={{ display: 'block' }}>
      {!bare && <rect width="96" height="96" fill="var(--sb-accent-tint)" />}
      {/* shoulders and collar */}
      <path d="M8 96c2-17 15-27 40-27s38 10 40 27z" fill={ART.ink} />
      <path d="M36 70l12 12 12-12-5-3H41z" fill="var(--sb-accent)" />
      {/* neck and face */}
      <rect x="41" y="56" width="14" height="16" rx="5" fill={ART.neck} />
      <ellipse cx="48" cy="40" rx="17" ry="19.5" fill={ART.face} />
      {/* hair */}
      <path d="M30.5 38c-1.5-14 7-22 18-22s19 7.5 17.5 22c-2-7-6.5-11-17.5-11S32.5 31 30.5 38z" fill={ART.hair} />
      {/* round glasses */}
      <g fill="none" stroke={ART.ink} strokeWidth="2.4">
        <circle cx="40.5" cy="41" r="6.2" /><circle cx="55.5" cy="41" r="6.2" />
        <path d="M46.7 41h2.6M34.3 40l-3-1.2M61.7 40l3-1.2" strokeLinecap="round" />
      </g>
      <circle cx="40.5" cy="41" r="1.7" fill={ART.ink} /><circle cx="55.5" cy="41" r="1.7" fill={ART.ink} />
      {/* friendly mouth */}
      <path d="M42 51.5c3.4 3.2 8.6 3.2 12 0" fill="none" stroke={ART.mouth} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

// The portrait is artwork, not interface: skin, hair and ink stay the same
// in every theme (a face does not invert in Glass). Ground and collar follow
// the theme.
const ART = {
  neck:  '#C98B64', // ui-guard: user-colour
  face:  '#D9996F', // ui-guard: user-colour
  hair:  '#2A2118', // ui-guard: user-colour
  mouth: '#7A3E26', // ui-guard: user-colour
  ink:   '#191712', // ui-guard: user-colour
}
export function AssistantAvatar({ size = 48, radius = 'var(--sb-r-card)', name, ring = true, bare = false }: {
  size?: number
  /** A CSS radius: the theme's own token by default; pass '50%' for a circle. */
  radius?: string
  /** Read out by a screen reader; the picture alone says nothing. */
  name?: string
  ring?: boolean
  /** The transparent cut-out, drawn with no tile, border or clipping — the person alone. */
  bare?: boolean
}) {
  const [broken, setBroken] = useState(false)
  if (bare) {
    return (
      <span role="img" aria-label={name ? `${name}, your assistant` : 'Your assistant'}
        style={{ display: 'inline-block', width: size, height: size, flexShrink: 0, position: 'relative' }}>
        {broken
          ? <Drawn bare />
          : <img src={CUTOUT} alt="" width={size} height={size} draggable={false} onError={() => setBroken(true)}
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none' }} />}
      </span>
    )
  }
  return (
    <span role="img" aria-label={name ? `${name}, your assistant` : 'Your assistant'}
      style={{
        display: 'inline-block', width: size, height: size, flexShrink: 0, overflow: 'hidden', borderRadius: radius,
        background: 'var(--sb-accent-tint)', boxShadow: ring ? 'inset 0 0 0 1.5px color-mix(in srgb, var(--sb-ink-1) 22%, transparent)' : undefined,
        position: 'relative',
      }}>
      {broken
        ? <Drawn />
        : <img src={SRC} alt="" width={size} height={size} draggable={false} onError={() => setBroken(true)}
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />}
      {ring && <span aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: radius, boxShadow: 'inset 0 0 0 1.5px color-mix(in srgb, var(--sb-ink-1) 22%, transparent)' }} />}
    </span>
  )
}
