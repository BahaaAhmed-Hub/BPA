// ─── A dropdown you can type into ────────────────────────────────────────────
// A native <select> cannot be searched. That is fine for "Spending / Earning"
// and useless for four hundred timezones, every calendar on three Google
// accounts, or a company list that grows all year — you scroll a list you
// cannot read, looking for a name you already know.
//
// This is the same object as finance's PillPicker, minus the tinted glyph disc:
// the app's own pill, a list drawn into the body so a scrolling panel cannot
// clip it, and a search box that appears only once the list is long enough to
// earn one (SEARCH_FROM). Under that, a filter box is furniture that pushes the
// answers down the panel.
//
// It keeps a native <select>'s contract — a string value and a string back — so
// converting a call site is a swap, not a rewrite. The one thing it does not
// do is a form POST; nothing in this app submits a form.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Search } from 'lucide-react'
import { ICON, STROKE } from '@/lib/type'
import { SEARCH_FROM, searchTerms, matchesTerms } from '@/lib/pickSearch'

export interface SelectOption {
  value: string
  label: string
  /** A quiet second line: which account a calendar is on, what a company does. */
  hint?: string
  /** Searchable, never drawn. For the words people type that are not the label. */
  keywords?: string
  disabled?: boolean
}

export function SearchSelect({
  value, options, onChange, placeholder = 'Choose', style, title, ariaLabel, disabled, align = 'left',
}: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  placeholder?: string
  /** The call site's own pill, so a converted <select> looks unchanged. */
  style?: React.CSSProperties
  title?: string
  ariaLabel?: string
  disabled?: boolean
  /** Which edge of the button the list lines up with when it is wider. */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const box = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const chosen = options.find(o => o.value === value)
  const searchable = options.length >= SEARCH_FROM
  const shown = useMemo(() => {
    const terms = searchTerms(query)
    if (terms.length === 0) return options
    return options.filter(o => matchesTerms(terms, o.label, o.hint, o.keywords))
  }, [options, query])

  // Drawn into the body rather than beside the button: absolutely positioned it
  // is clipped by whatever scrolling panel the field happens to sit in, and in
  // this app almost every field sits in one.
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
      const dropUp = below < Math.min(wanted, 220) && above > below
      // Never narrower than the button, never wider than the window allows.
      const width = Math.max(b.width, Math.min(280, window.innerWidth - 2 * margin))
      const left = align === 'right'
        ? Math.max(margin, Math.min(b.right - width, window.innerWidth - width - margin))
        : Math.max(margin, Math.min(b.left, window.innerWidth - width - margin))
      setPlace({
        top: dropUp ? b.top - gap - Math.max(140, Math.min(wanted, above)) : b.bottom + gap,
        left,
        width,
        maxHeight: Math.max(140, Math.min(wanted, dropUp ? above : below)),
      })
    }
    put()
    window.addEventListener('resize', put)
    window.addEventListener('scroll', put, true)
    return () => { window.removeEventListener('resize', put); window.removeEventListener('scroll', put, true) }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      const t = e.target as Node
      if (box.current?.contains(t) || list.current?.contains(t)) return
      setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  // Open on what is already chosen, so Enter on an untouched list re-picks it
  // rather than silently taking the first row.
  useEffect(() => {
    if (!open) { setQuery(''); return }
    const at = options.findIndex(o => o.value === value)
    setActive(at < 0 ? 0 : at)
  }, [open, options, value])

  // Typing moves the highlight home: the row that was active is usually no
  // longer in the filtered list, and a highlight on nothing is worse than none.
  useEffect(() => { setActive(0) }, [query])

  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>('[data-active="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active, shown.length])

  const commit = (o: SelectOption) => { if (o.disabled) return; onChange(o.value); setOpen(false); box.current?.focus() }

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (shown.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive(i => (i + step + shown.length) % shown.length)
      return
    }
    if (e.key === 'Enter') { e.preventDefault(); const o = shown[active]; if (o) commit(o); return }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); box.current?.focus() }
  }

  return (
    <>
      <button
        ref={box}
        type="button"
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={e => {
          // Arrowing into a closed list opens it, the way a native select does.
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) { e.preventDefault(); setOpen(true) }
        }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1,
          fontFamily: 'inherit', textAlign: 'left', minWidth: 0,
          ...style,
        }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: chosen ? 'inherit' : 'var(--sb-ink-4)' }}>
          {chosen?.label ?? placeholder}
        </span>
        <ChevronDown size={ICON.sm} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-ink-4)', flexShrink: 0 }} />
      </button>

      {open && place && createPortal(
        <div
          ref={list}
          role="listbox"
          onKeyDown={keys}
          className="sb-blur-surface"
          style={{
            position: 'fixed', top: place.top, left: place.left, width: place.width, zIndex: 2000,
            maxHeight: place.maxHeight, overflowY: 'auto', padding: 5, boxSizing: 'border-box',
            // An overlay, never --sb-card: a card colour is a 5% wash in the
            // dark theme and the list would be drawn straight through.
            background: 'var(--sb-overlay)',
            border: 'var(--sb-border-width) solid var(--sb-border)',
            borderRadius: 'var(--sb-r-nav)',
            boxShadow: 'var(--sb-shadow-menu)',
          }}>
          {searchable && (
            // Sticky: the list scrolls under it, and a search box that scrolls
            // away is one you have to scroll back up to correct.
            <div style={{ position: 'sticky', top: -5, zIndex: 1, background: 'var(--sb-overlay)', padding: '1px 0 6px', margin: '-1px 0 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 9px', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)' }}>
                <Search size={ICON.sm} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-ink-4)', flexShrink: 0 }} />
                <input
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
            const on = o.value === value
            const hot = i === active
            return (
              <button
                key={o.value || `_${i}`}
                type="button"
                role="option"
                aria-selected={on}
                data-active={hot ? '1' : '0'}
                title={o.hint ? `${o.label} — ${o.hint}` : o.label}
                onPointerEnter={() => setActive(i)}
                onClick={() => commit(o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '9px 10px', border: 'none', borderRadius: 'var(--sb-r-chip)',
                  cursor: o.disabled ? 'default' : 'pointer',
                  opacity: o.disabled ? 0.5 : 1,
                  background: on ? 'rgba(var(--sb-accent-rgb),0.18)' : hot ? 'var(--sb-field)' : 'transparent',
                  fontFamily: 'inherit', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', textAlign: 'left',
                }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                  {o.hint && (
                    <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.hint}
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
    </>
  )
}
