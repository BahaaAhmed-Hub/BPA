import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Search } from 'lucide-react'
import type { Category } from '../types'
import { CategoryGlyph } from '../components/CategoryGlyph'
import { ICON, STROKE } from '@/lib/type'
import { alpha } from '@/lib/alpha'
import { SEARCH_FROM, searchTerms, matchesTerms } from '@/lib/pickSearch'
import { useInkOnKeeping } from '@/lib/ink'

// ─── The panel vocabulary ─────────────────────────────────────────────────────
// Same set the calendar's event panel uses: one pill for every value whether
// you type in it, pick from it or only read it; one label column everything
// hangs off; a black pill for the one action that commits. It lives here
// rather than inside a modal so a second panel does not have to copy it.
export const DISPLAY = 'var(--sb-font-num)'

export const PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 42, boxSizing: 'border-box',
  padding: '0 14px', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body)', fontFamily: 'inherit', cursor: 'pointer', minWidth: 0,
}
export const ROUND: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', cursor: 'pointer',
}
export const LABEL: React.CSSProperties = {
  width: 74, flexShrink: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)', fontWeight: 500,
}
export const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
}
export const RULE: React.CSSProperties = { height: 1, background: 'var(--sb-hairline)', margin: '18px 0' }

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
  /** A quiet second line: what an account is, and what it currently holds. */
  hint?: string
}

/** The tinted disc a picker entry sits in. It used to draw the icon itself and
 *  knew only about pictures and emoji, so once categories moved to line icons
 *  every one of them rendered the literal text "lucide:ShoppingCart" crushed
 *  into a 22px box. CategoryGlyph is the one place that knows all three. */
export function Glyph({ glyph, tint, size = 22, under = 'var(--sb-card)' }: {
  glyph?: string
  tint?: string
  size?: number
  /** The surface the disc is drawn on, so a translucent tint can be measured
   *  against what is actually behind it. A picker's list is an overlay. */
  under?: string
}) {
  const inkKeeping = useInkOnKeeping()
  const disc = tint ? alpha(tint, 13.3) : 'var(--sb-field)'
  return (
    <span style={{
      width: size, height: size, borderRadius: 'var(--sb-r-chip)', flexShrink: 0, overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: disc,
      // Keep the category's own colour where it reads on its own tint, which
      // is every light theme. On a dark ground both composite to nearly the
      // same near-black and the glyph disappears into its disc.
      color: tint ? inkKeeping(tint, disc, 3, under) : 'var(--sb-ink-3)',
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

  // ─── Narrowing the list ────────────────────────────────────────────────────
  // A picker holding every category, or every account, is a list you scroll
  // rather than a list you read. Typing is how you find one thing in it. The
  // box appears only once the list is long enough to be worth filtering
  // (SEARCH_FROM) — over four options it is furniture that pushes the answers
  // down the panel.
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const searchable = options.length >= SEARCH_FROM
  const shown = useMemo(() => {
    const terms = searchTerms(query)
    if (terms.length === 0) return options
    return options.filter(o => matchesTerms(terms, o.label, o.parent, o.hint))
  }, [options, query])

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

  // Opening starts from a clean query and from whatever is already chosen, so
  // Enter on an untouched picker re-picks the current value rather than the
  // first row in the list.
  useEffect(() => {
    if (!open) { setQuery(''); return }
    const at = options.findIndex(o => o.id === value)
    setActive(at < 0 ? 0 : at)
  }, [open, options, value])

  // Typing moves the highlight back to the top: the row that was active is
  // usually no longer in the filtered list, and a highlight on nothing is
  // worse than none.
  useEffect(() => { setActive(0) }, [query])

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    if (!open) return
    const el = list.current?.querySelector<HTMLElement>('[data-active="1"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, active, shown.length])

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (shown.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive(i => (i + step + shown.length) % shown.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const pick = shown[active]
      if (pick) { onChange(pick.id); setOpen(false) }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  return (
    <span ref={box} style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ ...PILL, height: h, padding: compact ? '0 10px' : '0 14px', fontSize: compact ? 12.5 : 13.5, flex: 1, justifyContent: 'space-between' }}>
        <span title={chosen?.parent ? `${chosen.label} — inside ${chosen.parent}` : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {chosen ? <Glyph glyph={chosen.glyph} tint={chosen.tint} size={compact ? 18 : 22} /> : null}
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: chosen ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>
            {chosen?.label ?? placeholder}
          </span>
        </span>
        <ChevronDown size={ICON.sm} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-ink-4)', flexShrink: 0 }} />
      </button>

      {open && place && createPortal(
        <div className="sb-blur-surface" ref={list} onKeyDown={keys} style={{
          position: 'fixed', top: place.top, left: place.left, width: place.width, zIndex: 2000,
          maxHeight: place.maxHeight, overflowY: 'auto', padding: 5, boxSizing: 'border-box',
          background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
          boxShadow: 'var(--sb-shadow-menu)',
        }}>
          {searchable && (
            // Sticky, because the list scrolls under it and a search box that
            // scrolls away is one you have to scroll back up to correct.
            <div style={{ position: 'sticky', top: -5, zIndex: 1, background: 'var(--sb-overlay)', padding: '1px 0 6px', margin: '-1px 0 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 9px', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)' }}>
                <Search size={ICON.sm} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-ink-4)', flexShrink: 0 }} />
                <input
                  ref={field}
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search"
                  aria-label="Search the list"
                  style={{
                    flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
                    fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', padding: 0,
                  }} />
              </div>
            </div>
          )}

          {options.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)' }}>Nothing to choose from yet</div>
          )}
          {options.length > 0 && shown.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)' }}>
              Nothing matches “{query.trim()}”
            </div>
          )}
          {shown.map((o, i) => {
            const on = o.id === value
            const hot = i === active
            return (
              <button key={o.id} type="button"
                data-active={hot ? '1' : '0'}
                title={o.parent ? `${o.label} — inside ${o.parent}` : o.label}
                onPointerEnter={() => setActive(i)}
                onClick={() => { onChange(o.id); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '9px 10px',
                  // A filtered list is no longer a tree, so the indent that
                  // meant "inside the row above" would be pointing at nothing.
                  paddingLeft: o.nested && !query.trim() ? 26 : 10,
                  border: 'none', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
                  background: on ? 'rgba(var(--sb-accent-rgb),0.18)' : hot ? 'var(--sb-field)' : 'transparent',
                  fontFamily: 'inherit', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', textAlign: 'left',
                }}>
                <Glyph glyph={o.glyph} tint={o.tint} under='var(--sb-overlay)' />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                  {(o.hint || (query.trim() && o.parent)) && (
                    <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.hint ?? `inside ${o.parent}`}
                    </span>
                  )}
                </span>
                {on && <Check size={ICON.sm} strokeWidth={STROKE.active} style={{ color: 'var(--sb-accent-deep)', flexShrink: 0 }} />}
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
