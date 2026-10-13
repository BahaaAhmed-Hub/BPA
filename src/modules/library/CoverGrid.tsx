import { useMemo } from 'react'
import { Bay, Bookcase, MIN_BAYS, useCaseWidth } from './Bookcase'
import { CoverArt } from './CoverArt'
import { authorLine } from './spine'
import type { Book } from './types'

const COVER_W = 112
const GAP = 14
const SIDE = 20
const COVER_H = Math.round(COVER_W * 1.5)

/**
 * The same books, face out — a display case, where the cover is how you
 * recognise it. Covers stand on the boards like the spines do, packed into rows
 * from the width the case has. The title is the cover's own (a book with no
 * image draws a title-page), so there is no caption to sit on the wood.
 */
export function CoverGrid({ books, pickedId, onPick }: {
  books: Book[]
  pickedId: string | null
  onPick: (b: Book, el: HTMLElement) => void
}) {
  const { ref, width } = useCaseWidth()
  const rows = useMemo(() => {
    const per = Math.max(1, Math.floor((Math.max(120, width - SIDE * 2) + GAP) / (COVER_W + GAP)))
    const out: Book[][] = []
    for (let i = 0; i < books.length; i += per) out.push(books.slice(i, i + per))
    while (out.length < MIN_BAYS) out.push([])
    return out
  }, [books, width])

  return (
    <Bookcase label="Your books" caseRef={ref}>
      {rows.map((row, i) => (
        <Bay key={i} minHeight={row.length ? COVER_H + 6 : 120}>
          {row.map(b => (
            <button key={b.id} className="lib-cover" data-picked={pickedId === b.id ? '' : undefined}
              aria-label={`${b.title}${b.authors.length ? ` by ${authorLine(b)}` : ''}`}
              title={b.title}
              style={{ width: COVER_W, flex: '0 0 auto' }}
              onClick={e => onPick(b, e.currentTarget.querySelector<HTMLElement>('[data-cover-face]') ?? e.currentTarget)}>
              <div data-cover-face><CoverArt book={b} /></div>
            </button>
          ))}
        </Bay>
      ))}
    </Bookcase>
  )
}
