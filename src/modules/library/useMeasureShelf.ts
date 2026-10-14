import { useEffect } from 'react'
import { findDimensions } from './findDimensions'
import { dimsKnown } from './libraryDb'
import { useLibraryStore } from './libraryStore'
import type { Book } from './types'

// The shelf measures the books it is showing, quietly, a couple at a time. A size is only ever written
// once it has been looked up and validated (`findDimensions`), and a book is not asked about again.
//   - A typed size ('manual') and anything already measured is left alone.
//   - If the catalogues could not be reached the book is NOT marked: a guess made on a bad connection must
//     not stick, so it is tried again next time. It is drawn from the page-count estimate meanwhile.
//   - Nothing is attempted until a row has come back carrying the 20260041 columns (see `dimsKnown`).
//   - Not undoable on purpose: ⌘Z would otherwise undo measurements the person never asked for.

const tried = new Set<string>()

export function useMeasureShelf(books: Book[]) {
  const known = dimsKnown()
  const key = (known ? books : []).filter(b => !b.dimsSource && !tried.has(b.id)).map(b => b.id).join(',')
  useEffect(() => {
    if (!key) return
    const queue = books.filter(b => !b.dimsSource && !tried.has(b.id)).slice(0, 60)
    let live = true
    const ac = new AbortController()
    void (async () => {
      if (!dimsKnown()) return
      const worker = async () => {
        for (let b = queue.shift(); b && live; b = queue.shift()) {
          try {
            const r = await findDimensions(b, ac.signal)
            if (!live) return
            tried.add(b.id)
            // Both catalogues unreachable: say nothing about this book yet.
            if (r.failed.length >= 2) { tried.delete(b.id); continue }
            const d = r.settled.dims
            useLibraryStore.getState().patchBooks([{ id: b.id, patch: {
              heightMm: d.heightMm, widthMm: d.widthMm, thicknessMm: d.thicknessMm, dimsSource: r.settled.source,
            } }])
          } catch { /* aborted, or a book that cannot be looked up: left as it is */ }
        }
      }
      await Promise.all([worker(), worker()])
    })()
    return () => { live = false; ac.abort() }
    // The key is the list of books still to measure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
