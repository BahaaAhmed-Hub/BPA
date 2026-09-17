import { useCallback, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Card } from './Card'
import { ICON, STROKE } from '@/lib/type'

// ─── A card that folds ───────────────────────────────────────────────────────
//
//  A list long enough to need sections is a list long enough to need them shut.
//  The smart view grew one of these and the grouped mail list needed the same
//  thing the next day, which is the moment a pattern becomes a component rather
//  than a shape copied twice — two copies drift, and then two lists that look
//  identical fold differently.
//
//  Three rules it exists to keep:
//  - **The whole header folds it.** A chevron 14px wide is not the target; the
//    title you are already reading is.
//  - **A shut section still says how many.** That is the point of shutting it:
//    you can see there are four without reading four rows.
//  - **Which are open is the caller's to remember**, because it belongs to the
//    view rather than to the card — `useOpenSections` below is that memory,
//    kept against a localStorage key, so a fold survives a reload.

export interface SectionCardProps {
  title: string
  /** The count beside the title. Absent, or 0, draws nothing. */
  count?: number
  /** A small round mark in the section's own colour, left of the title. */
  dot?: string
  open: boolean
  onToggle: () => void
  /** Sits hard right on the header row — a Select all, a total, a pill. */
  right?: ReactNode
  /** Drawn under the header, inside the card, above the body. */
  banner?: ReactNode
  children: ReactNode
}

export function SectionCard({
  title, count, dot, open, onToggle, right, banner, children,
}: SectionCardProps) {
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '13px 16px',
        borderBottom: open ? 'var(--sb-border-width) solid var(--sb-hairline)' : 'none',
      }}>
        <button
          onClick={onToggle}
          aria-expanded={open}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0,
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'inherit', textAlign: 'left', color: 'inherit',
          }}>
          {open
            ? <ChevronDown size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: 'var(--sb-ink-4)' }} />
            : <ChevronRight size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: 'var(--sb-ink-4)' }} />}
          {dot && (
            <span aria-hidden style={{
              width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0,
            }} />
          )}
          <span style={{
            fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-body)',
            fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{title}</span>
          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
            {count || ''}
          </span>
        </button>
        {open && right}
      </div>
      {open && banner}
      {open && children}
    </Card>
  )
}

/** Which sections are open, remembered against a key.
 *
 *  `defaultOpen` is what an id nobody has touched does, so a section added
 *  later arrives open rather than silently shut for everyone who has ever used
 *  the view before. */
export function useOpenSections(storageKey: string, defaultOpen = true): {
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
} {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? JSON.parse(raw) as Record<string, boolean> : {}
    } catch { return {} }
  })

  const isOpen = useCallback((id: string) => open[id] ?? defaultOpen, [open, defaultOpen])

  const toggle = useCallback((id: string) => {
    setOpen(prev => {
      const next = { ...prev, [id]: !(prev[id] ?? defaultOpen) }
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
  }, [storageKey, defaultOpen])

  return { isOpen, toggle }
}
