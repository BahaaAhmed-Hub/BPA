import { useEffect, useRef } from 'react'
import { Bookmark, ChevronLeft, ChevronRight, Shuffle } from 'lucide-react'
import { Button } from '@/components/ui'
import { ICON } from '@/lib/type'
import { useLibraryStore } from './libraryStore'
import { SPINE_COLORS } from './spine'
import { placeOf } from './types'
import type { BoardItem } from './quoteBoardData'

/** Longer passages get smaller type, in steps: a poster whose text overflows its
 *  frame is a card with a clipped sentence, and a fixed size either shouts a
 *  short line or crams a long one. */
const posterSize = (n: number): number => (n < 70 ? 46 : n < 140 ? 38 : n < 240 ? 30 : n < 400 ? 24 : 19)

/**
 * One quote at a time, set large — the aspiration view. The frame takes the
 * quote's own colour as a wash over the overlay surface (so it is a tint of the
 * theme in every theme, never a hard white card in Glass), and the words stay in
 * the ordinary ink, which is what keeps the contrast the audit measures.
 *
 * Arrow keys and a horizontal swipe turn it; both are ignored while a field has
 * focus.
 */
export function PosterView({ items, index, setIndex, onOpenBook }: {
  items: BoardItem[]; index: number; setIndex: (n: number) => void; onOpenBook: (bookId: string) => void
}) {
  const toggle = useLibraryStore(s => s.toggleBookmark)
  const n = items.length
  const at = Math.min(Math.max(0, index), Math.max(0, n - 1))
  const cur = items[at]
  const marked = useLibraryStore(s => !!cur && s.bookmarks.some(m => m.kind === 'quote' && m.quoteId === cur.quote.id))
  const down = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.key === 'ArrowRight') setIndex((at + 1) % n)
      else if (e.key === 'ArrowLeft') setIndex((at - 1 + n) % n)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [at, n, setIndex])

  if (!cur) return null
  const { quote, book } = cur
  const colour = quote.color ?? SPINE_COLORS[0]
  const text = quote.body ?? ''
  const place = placeOf(quote)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', padding: '8px 0 24px' }}>
      <figure
        onPointerDown={e => { down.current = { x: e.clientX, y: e.clientY } }}
        onPointerUp={e => {
          const d = down.current; down.current = null
          if (!d || window.getSelection()?.toString()) return
          const dx = e.clientX - d.x, dy = e.clientY - d.y
          // A swipe is mostly sideways; a drag across the words to select them is not one.
          if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) setIndex(dx < 0 ? (at + 1) % n : (at - 1 + n) % n)
        }}
        style={{
          margin: 0, width: 'min(760px, 100%)', minHeight: 'clamp(320px, calc(52 * var(--vh)), 560px)', boxSizing: 'border-box', padding: 'clamp(24px, calc(6 * var(--vw)), 56px)',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 22, position: 'relative', touchAction: 'pan-y',
          background: `color-mix(in srgb, ${colour} 16%, var(--sb-overlay))`,
          border: `var(--sb-border-width) solid color-mix(in srgb, ${colour} 40%, var(--sb-border))`,
          borderRadius: 'var(--sb-r-frame)', boxShadow: 'var(--sb-shadow-frame)',
        }}>
        <span aria-hidden style={{ position: 'absolute', top: 14, left: 24, fontFamily: 'var(--sb-font-num)', fontSize: 96, lineHeight: 1, color: colour, opacity: .55 }}>“</span>
        <blockquote style={{
          margin: '28px 0 0', fontFamily: 'var(--sb-font-num)', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.25,
          fontSize: posterSize(text.length), color: 'var(--sb-ink-1)', textWrap: 'balance', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
        }}>{text}</blockquote>
        <figcaption style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', color: 'var(--sb-ink-2)', fontSize: 'var(--sb-t-body)' }}>
          <span aria-hidden style={{ width: 28, height: 3, borderRadius: 'var(--sb-r-pill)', background: colour }} />
          <button type="button" onClick={() => onOpenBook(book.id)} title="Open this book"
            style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}>{book.title}</button>
          {book.authors.length > 0 && <span>{book.authors.join(', ')}</span>}
          {place && <span style={{ color: 'var(--sb-ink-3)' }}>· {place}</span>}
        </figcaption>
      </figure>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button variant="secondary" iconOnly title="Previous quote" aria-label="Previous quote" disabled={n < 2} onClick={() => setIndex((at - 1 + n) % n)}><ChevronLeft size={ICON.md} /></Button>
        <span aria-live="polite" style={{ minWidth: 64, textAlign: 'center', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>{at + 1} of {n}</span>
        <Button variant="secondary" iconOnly title="Next quote" aria-label="Next quote" disabled={n < 2} onClick={() => setIndex((at + 1) % n)}><ChevronRight size={ICON.md} /></Button>
        <Button variant="ghost" iconOnly title="A different quote" aria-label="A different quote" disabled={n < 2}
          onClick={() => { let r = at; while (r === at) r = Math.floor(Math.random() * n); setIndex(r) }}><Shuffle size={ICON.md} /></Button>
        <Button variant="ghost" iconOnly title={marked ? 'Remove bookmark' : 'Bookmark this quote'} aria-label={marked ? 'Remove bookmark' : 'Bookmark this quote'} aria-pressed={marked}
          onClick={() => toggle({ kind: 'quote', bookId: book.id, quoteId: quote.id })}>
          <Bookmark size={ICON.md} fill={marked ? 'var(--sb-accent)' : 'none'} color={marked ? 'var(--sb-accent-deep)' : 'currentColor'} />
        </Button>
      </div>
    </div>
  )
}
