import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'
import type { Category } from '../types'
import { CategoryGlyph } from '../components/CategoryGlyph'

// ─── The panel vocabulary ─────────────────────────────────────────────────────
// Same set the calendar's event panel uses: one pill for every value whether
// you type in it, pick from it or only read it; one label column everything
// hangs off; a black pill for the one action that commits. It lives here
// rather than inside a modal so a second panel does not have to copy it.

export const INK    = '#191712'
export const MUTED  = '#6C6553'
export const GHOST  = '#9B9180'
export const LINE   = '#E8E1CE'
export const HAIR   = '#F0EBDC'
export const OLIVE  = '#0C8140'
export const RUST   = '#C62828'
export const AMBER  = '#F5D14E'
export const DISPLAY = "'Outfit', system-ui, sans-serif"

export const PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 42, boxSizing: 'border-box',
  padding: '0 14px', borderRadius: 10, background: '#FFFFFF', border: `1px solid ${LINE}`,
  color: INK, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer', minWidth: 0,
}
export const ROUND: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%', flexShrink: 0, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#FFFFFF', border: `1px solid ${LINE}`, color: MUTED, cursor: 'pointer',
}
export const LABEL: React.CSSProperties = {
  width: 74, flexShrink: 0, fontSize: 13.5, color: MUTED, fontWeight: 500,
}
export const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
}
export const RULE: React.CSSProperties = { height: 1, background: HAIR, margin: '18px 0' }

export interface PickOption {
  id: string
  label: string
  /** Named on hover only. A sub-category shows its own name; which envelope it
   *  belongs to is a thing to check, not a thing to read every line. */
  parent?: string
  /** A lucide name, an emoji, or a data/http URL for a real picture. */
  glyph?: string
  tint?: string
  /** Sits under another entry in the list. */
  nested?: boolean
}

/** The tinted disc a picker entry sits in. It used to draw the icon itself and
 *  knew only about pictures and emoji, so once categories moved to line icons
 *  every one of them rendered the literal text "lucide:ShoppingCart" crushed
 *  into a 22px box. CategoryGlyph is the one place that knows all three. */
export function Glyph({ glyph, tint, size = 22 }: { glyph?: string; tint?: string; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: 6, flexShrink: 0, overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: tint ? `${tint}22` : '#F1ECDE',
      color: tint ?? '#6C6553',
    }}>
      <CategoryGlyph icon={glyph} size={Math.round(size * 0.68)} />
    </span>
  )
}

/** A list you can put a bank's actual logo in. The native select was the right
 *  call until the accounts needed their marks: an <option> can hold text and
 *  nothing else, so every account looked the same in the one place you pick
 *  between them. */
export function PillPicker({ value, options, onChange, placeholder, compact }: {
  value: string
  options: PickOption[]
  onChange: (id: string) => void
  placeholder: string
  /** The height a grid row can afford. */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const chosen = options.find(o => o.id === value)
  const h = compact ? 34 : 42

  // The list is drawn into the body, not next to the button. Absolutely
  // positioned it was clipped by whatever scrolling panel the field happened to
  // sit in — the bulk grid's own scroller cut it off after four entries.
  const [place, setPlace] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPlace(null); return }
    const put = () => {
      const b = box.current?.getBoundingClientRect()
      if (!b) return
      const gap = 6, margin = 12
      const below = window.innerHeight - b.bottom - gap - margin
      const above = b.top - gap - margin
      const wanted = Math.min(420, window.innerHeight * 0.6)
      // Below unless there is meaningfully more room above.
      const dropUp = below < Math.min(wanted, 220) && above > below
      const maxHeight = Math.max(140, Math.min(wanted, dropUp ? above : below))
      setPlace({
        top: dropUp ? b.top - gap - maxHeight : b.bottom + gap,
        left: b.left,
        width: b.width,
        maxHeight,
      })
    }
    put()
    window.addEventListener('resize', put)
    window.addEventListener('scroll', put, true)
    return () => { window.removeEventListener('resize', put); window.removeEventListener('scroll', put, true) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      const t = e.target as Node
      if (box.current?.contains(t) || list.current?.contains(t)) return
      setOpen(false)
    }
    const esc  = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <span ref={box} style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ ...PILL, height: h, padding: compact ? '0 10px' : '0 14px', fontSize: compact ? 12.5 : 13.5, flex: 1, justifyContent: 'space-between' }}>
        <span title={chosen?.parent ? `${chosen.label} — inside ${chosen.parent}` : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {chosen ? <Glyph glyph={chosen.glyph} tint={chosen.tint} size={compact ? 18 : 22} /> : null}
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: chosen ? INK : GHOST }}>
            {chosen?.label ?? placeholder}
          </span>
        </span>
        <ChevronDown size={13} strokeWidth={2} style={{ color: GHOST, flexShrink: 0 }} />
      </button>

      {open && place && createPortal(
        <div ref={list} style={{
          position: 'fixed', top: place.top, left: place.left, width: place.width, zIndex: 2000,
          maxHeight: place.maxHeight, overflowY: 'auto', padding: 5, boxSizing: 'border-box',
          background: '#FFFFFF', border: `1px solid ${LINE}`, borderRadius: 12,
          boxShadow: '0 12px 32px rgba(25,23,18,0.18)',
        }}>
          {options.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12.5, color: GHOST }}>Nothing to choose from yet</div>
          )}
          {options.map(o => {
            const on = o.id === value
            return (
              <button key={o.id} type="button"
                title={o.parent ? `${o.label} — inside ${o.parent}` : o.label}
                onClick={() => { onChange(o.id); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '9px 10px', paddingLeft: o.nested ? 26 : 10,
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  background: on ? 'rgba(245,209,78,0.18)' : 'transparent',
                  fontFamily: 'inherit', fontSize: 13.5, color: INK, textAlign: 'left',
                }}>
                <Glyph glyph={o.glyph} tint={o.tint} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                {on && <Check size={14} strokeWidth={2.5} style={{ color: '#8A6D0B', flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </span>
  )
}

/** Every category as one flat list: each parent followed by its own children.
 *  A child carries its own name only — the indent under its parent is what says
 *  it is a sub-category, so repeating the parent in every label just made the
 *  list wider and harder to scan. Anything whose parent has gone missing still
 *  has to be reachable, or it becomes a category you cannot pick. */
export function categoryOptions(categories: Category[], kind?: 'expense' | 'income'): PickOption[] {
  const keep = (c: Category) => !kind || c.txType === kind || c.txType === 'both'
  return [
    { id: '', label: 'Uncategorised', glyph: 'lucide:Folder' },
    ...categories.filter(c => !c.parentId && keep(c)).flatMap(parent => [
      { id: parent.id, label: parent.name, glyph: parent.icon, tint: parent.color },
      ...categories.filter(c => c.parentId === parent.id).map(child => ({
        id: child.id, label: child.name, parent: parent.name,
        glyph: child.icon, tint: child.color, nested: true,
      })),
    ]),
    ...categories.filter(c => c.parentId && keep(c) && !categories.some(p => p.id === c.parentId))
      .map(c => ({ id: c.id, label: c.name, glyph: c.icon, tint: c.color })),
  ]
}
