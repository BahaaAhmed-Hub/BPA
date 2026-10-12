import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useInkOn } from '@/lib/ink'
import { authorLine, spineColorOf, spineSize } from './spine'
import type { Book } from './types'

const GAP = 6
const SIDE = 20

/**
 * The shelf: books standing as spines, row by row, each row on its own board.
 * Rows are worked out from the width the shelf actually has — a book's width is
 * its page count, so there is no fixed number to a row — and re-worked when it
 * changes, which is what an iPad turning round does.
 */
export function Shelf({ books, pickedId, onPick }: {
  books: Book[]
  pickedId: string | null
  onPick: (b: Book, el: HTMLElement) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const inkOn = useInkOn()

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rows = useMemo(() => {
    const room = Math.max(120, width - SIDE * 2)
    const out: Book[][] = [[]]
    let used = 0
    for (const b of books) {
      const w = spineSize(b).w + GAP
      if (used + w > room && out[out.length - 1].length) { out.push([]); used = 0 }
      out[out.length - 1].push(b)
      used += w
    }
    return out
  }, [books, width])

  return (
    <div ref={wrap} role="group" aria-label="Your books" style={{ display: 'flex', flexDirection: 'column', gap: 26, padding: '14px 0 28px' }}>
      {rows.map((row, i) => (
        <div key={i}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: GAP, padding: `0 ${SIDE}px`, minHeight: 190 }}>
            {row.map(b => {
              const { w, h } = spineSize(b)
              const bg = spineColorOf(b)
              const ink = inkOn(bg)
              return (
                <button key={b.id} className="lib-spine" data-picked={pickedId === b.id ? '' : undefined}
                  aria-label={`${b.title}${b.authors.length ? ` by ${authorLine(b)}` : ''}`}
                  title={b.title}
                  onClick={e => onPick(b, e.currentTarget)}
                  style={{ width: w, height: h, background: bg, color: ink }}>
                  {b.status === 'reading' && (
                    <span aria-hidden style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', width: 8, height: 8, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-accent)', boxShadow: '0 0 0 1.5px rgba(0,0,0,.25)' }} />
                  )}
                  {b.status === 'finished' && (
                    <span aria-hidden style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 8, height: 8, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-positive)', boxShadow: '0 0 0 1.5px rgba(255,255,255,.7)' }} />
                  )}
                  <span style={{
                    writingMode: 'vertical-rl', transform: 'rotate(180deg)', alignSelf: 'center',
                    // Clear of the status dots at either end, or a long title runs through one.
                    maxHeight: h - 58, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontFamily: 'var(--sb-font-num)', fontWeight: 600, fontSize: 12.5, letterSpacing: '0.01em', padding: '0 4px',
                  }}>{b.title}</span>
                </button>
              )
            })}
          </div>
          <div className="lib-board" />
        </div>
      ))}
    </div>
  )
}
