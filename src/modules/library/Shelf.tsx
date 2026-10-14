import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useInkOn } from '@/lib/ink'
import { Bay, Bookcase, MIN_BAYS, useCaseWidth } from './Bookcase'
import { useCoverTone } from './coverTone'
import { authorLine, boxOf, hash, spineColorOf, spineStyleOf, type Box } from './spine'
import { useMeasureShelf } from './useMeasureShelf'
import type { Book } from './types'

const GAP = 1          // books on a real shelf touch
const SIDE = 20
const LEAN_ROOM = 70   // free width a row needs before its last book is allowed to lean
const LIFT = 26        // headroom above the tallest book, for the hover lift

/**
 * The shelf: real books, standing spine-out, each at the size it really has (see `boxOf`: the height,
 * thickness and cover width come from a catalogue where one could be trusted, from the page count where
 * not). Row by row on their own boards inside a bookcase.
 *
 * Every book is a small 3D box: the spine faces you; its front cover is the right-hand face and its
 * page-block the left. Hovering turns it toward you far enough to see the cover; the light on the case
 * follows the pointer. A row that is not full leans its last book against a bookend, as a real one does.
 * Rows are worked out from the width the case actually has, and re-worked when it changes.
 */
export function Shelf({ books, pickedId, onPick }: {
  books: Book[]
  pickedId: string | null
  onPick: (b: Book, el: HTMLElement) => void
}) {
  const { ref, width } = useCaseWidth()
  useMeasureShelf(books)

  // The settle-in plays once when the shelf appears, not every time a book moves to another row.
  const [entering, setEntering] = useState(true)
  useEffect(() => { const t = setTimeout(() => setEntering(false), 2200); return () => clearTimeout(t) }, [])

  const stage = useRef<HTMLDivElement>(null)
  const glow = (e: React.PointerEvent) => {
    const r = stage.current?.getBoundingClientRect()
    if (!r || !stage.current) return
    stage.current.style.setProperty('--gx', `${e.clientX - r.left}px`)
    stage.current.style.setProperty('--gy', `${e.clientY - r.top}px`)
  }

  const rows = useMemo(() => {
    const room = Math.max(120, width - SIDE * 2)
    const out: { book: Book; box: Box }[][] = [[]]
    let used = 0
    for (const book of books) {
      const box = boxOf(book)
      const w = box.w + GAP
      if (used + w > room && out[out.length - 1].length) { out.push([]); used = 0 }
      out[out.length - 1].push({ book, box })
      used += w
    }
    const free = out.map(r => room - r.reduce((n, x) => n + x.box.w + GAP, 0))
    while (out.length < MIN_BAYS) { out.push([]); free.push(room) }
    return out.map((row, i) => ({ row, lean: row.length > 0 && free[i] > LEAN_ROOM }))
  }, [books, width])

  let index = 0
  return (
    <Bookcase label="Your books" caseRef={ref}>
      <div ref={stage} className="lib-stage" data-entering={entering ? '' : undefined} onPointerMove={glow}>
        <div className="lib-glow" aria-hidden />
        {rows.map(({ row, lean }, i) => (
          <Bay key={i} gap={GAP} minHeight={row.length ? Math.max(...row.map(x => x.box.h)) + LIFT : 120}>
            {row.map(({ book, box }, j) => (
              <Spine key={book.id} book={book} box={box} index={index++} picked={pickedId === book.id}
                leaning={lean && j === row.length - 1 && row.length > 1} onPick={onPick} />
            ))}
            {lean && <span className="lib-bookend" aria-hidden style={{ height: 96, marginLeft: 34 }} />}
          </Bay>
        ))}
      </div>
    </Bookcase>
  )
}

function Spine({ book, box, index, picked, leaning, onPick }: {
  book: Book; box: Box; index: number; picked: boolean; leaning: boolean
  onPick: (b: Book, el: HTMLElement) => void
}) {
  const inkOn = useInkOn()
  const tone = useCoverTone(book.coverUrl)
  const bg = tone ?? spineColorOf(book)
  const ink = inkOn(bg)
  const look = spineStyleOf(book, box.w)
  const h = hash(book.id)
  const mark = ((book.publisher ?? book.authors[0] ?? book.title).trim()[0] ?? '').toUpperCase()
  const roomForAuthor = box.w >= 30 && book.authors.length > 0
  const label = look === 'label'

  const vars = {
    width: box.w, height: box.h, marginRight: 0,
    '--sp': bg, '--ink': ink, '--d': `${box.d}px`, '--w': `${box.w}px`,
    '--i': Math.min(index, 28), '--tilt': `${(h % 7) - 3}deg`,
  } as CSSProperties

  return (
    <button className="lib-spine" data-picked={picked ? '' : undefined} data-look={look} data-lean={leaning ? '' : undefined}
      data-status={book.status}
      aria-label={`${book.title}${book.authors.length ? ` by ${authorLine(book)}` : ''}`}
      title={book.title}
      onClick={e => onPick(book, e.currentTarget)}
      style={vars}>
      <span className="lib-book" aria-hidden>
        <span className="lib-face lib-face-spine">
          <span className="lib-cap" data-end="head" /><span className="lib-cap" data-end="tail" />
          {book.status === 'reading' && <span className="lib-ribbon" />}
          {book.status === 'finished' && <span className="lib-seal" />}
          <span className="lib-spine-text" data-label={label ? '' : undefined} style={{ maxHeight: box.h - 64 }}>
            {roomForAuthor && <span className="lib-spine-author">{authorLine(book)}</span>}
            <span className="lib-spine-title">{book.title}</span>
          </span>
          {mark && box.h > 120 && <span className="lib-mark">{mark}</span>}
        </span>
        <span className="lib-face lib-face-cover">
          {book.coverUrl
            ? <img src={book.coverUrl} alt="" loading="lazy" draggable={false} />
            : <span className="lib-cover-title">{book.title}</span>}
        </span>
        <span className="lib-face lib-face-pages" />
      </span>
    </button>
  )
}
