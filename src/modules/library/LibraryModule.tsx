import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Camera, Plus, Search, X } from 'lucide-react'
import { Button, Card, Pill, Segmented } from '@/components/ui'
import { CAPS, ICON } from '@/lib/type'
import { useFillsTheWindow } from '@/lib/fillsTheWindow'
import { AddBookModal } from './AddBookModal'
import { BookFlight } from './BookFlight'
import { BookPanel } from './BookPanel'
import { CoverGrid } from './CoverGrid'
import { DiscoverView } from './DiscoverView'
import { ListsView } from './ListsView'
import { QuoteBoard } from './QuoteBoard'
import { Shelf } from './Shelf'
import { ShelfPhotoDialog } from './ShelfPhotoDialog'
import { enrichAndReport } from './shelfEnrich'
import { TrackerView } from './TrackerView'
import { inputStyle } from './fieldStyle'
import { loadLibraryView, OPEN_BOOK_EVENT, saveLibraryView, takePendingOpen, type LibraryView } from './libraryPrefs'
import { useLibraryStore } from './libraryStore'
import { STATUS_LABEL, type Book, type BookStatus } from './types'

// pdf.js is large; it loads the first time a book is opened to read, not with the app.
const PdfReader = lazy(() => import('./PdfReader'))

type StatusFilter = 'all' | BookStatus

/** Under this the panel cannot sit beside the shelf — 300px of panel leaves a
 *  phone ~90px of books — so it replaces it, the way the Mail reader stacks. */
const NARROW_PX = 760
const narrowQuery = () => window.matchMedia(`(max-width: ${NARROW_PX}px)`)
function useNarrow(): boolean {
  return useSyncExternalStore(
    cb => { const mq = narrowQuery(); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb) },
    () => narrowQuery().matches,
    () => false,
  )
}

export function LibraryModule() {
  const books = useLibraryStore(s => s.books)
  const lists = useLibraryStore(s => s.lists)
  const links = useLibraryStore(s => s.links)
  const loading = useLibraryStore(s => s.loading)
  const missing = useLibraryStore(s => s.missing)

  const [view, setViewState] = useState<LibraryView>(loadLibraryView)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [listId, setListId] = useState<string | null>(null)
  const [toBuyOnly, setToBuyOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flight, setFlight] = useState<{ book: Book; from: DOMRect } | null>(null)
  const [adding, setAdding] = useState(false)
  const [shelfPhoto, setShelfPhoto] = useState<File | null>(null)
  const shelfInput = useRef<HTMLInputElement>(null)
  const [addIsbn, setAddIsbn] = useState<string | undefined>()
  const [readingId, setReadingId] = useState<string | null>(null)
  const narrow = useNarrow()
  const { ref: fillRef, height: fillHeight } = useFillsTheWindow<HTMLDivElement>(360)

  // Switched on while the app was open: nothing has loaded yet, so ask.
  useEffect(() => { if (useLibraryStore.getState().loading) void useLibraryStore.getState().loadFromDB() }, [])
  // A book asked for from another module (Today's quote of the day). Taken on mount, for a Library not yet
  // opened, and on the event, for one already open behind another tab.
  useEffect(() => {
    const open = () => {
      const id = takePendingOpen()
      if (id) { setViewState('shelf'); saveLibraryView('shelf'); setStatus('all'); setQ(''); setListId(null); setSelectedId(id) }
    }
    open()
    window.addEventListener(OPEN_BOOK_EVENT, open)
    return () => window.removeEventListener(OPEN_BOOK_EVENT, open)
  }, [])

  const setView = (v: LibraryView) => { setViewState(v); saveLibraryView(v) }

  // Derived, not reconciled in an effect: a list or a book deleted here or on
  // another device simply stops resolving, so the shelf is never left filtered
  // to a list that is gone, and the panel never shows a book that is not there.
  const list = listId ? lists.find(l => l.id === listId) : undefined
  const activeListId = list?.id ?? null
  const selected = books.find(b => b.id === selectedId) ?? null

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const inList = activeListId ? new Set(links.filter(l => l.listId === activeListId).map(l => l.bookId)) : null
    return books.filter(b =>
      (status === 'all' || b.status === status) &&
      (!toBuyOnly || b.toBuy) &&
      (!inList || inList.has(b.id)) &&
      (!needle || [b.title, b.subtitle, b.isbn, ...b.authors].some(s => s?.toLowerCase().includes(needle))))
  }, [books, links, q, status, activeListId, toBuyOnly])

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: books.length, want: 0, reading: 0, finished: 0, paused: 0, abandoned: 0 }
    for (const b of books) c[b.status]++
    return c
  }, [books])

  const pick = useCallback((b: Book, el: HTMLElement) => {
    setSelectedId(b.id)
    setFlight({ book: b, from: el.getBoundingClientRect() })
  }, [])

  // Escape closes the panel — but not out from under a dialog, which owns it.
  useEffect(() => {
    if (!selectedId) return
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      setSelectedId(null)
    }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [selectedId])

  const toBuyCount = books.filter(b => b.toBuy).length
  const filtered = status !== 'all' || !!activeListId || !!q.trim() || toBuyOnly
  const reading = counts.reading, finished = counts.finished

  return (
    <div ref={fillRef} style={{ height: fillHeight, display: 'flex', flexDirection: 'column', padding: '20px 24px 0', boxSizing: 'border-box', minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ ...CAPS, color: 'var(--sb-ink-3)', marginBottom: 4 }}>Library</div>
          <h1 style={{ margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--sb-ink-1)' }}>Your shelf</h1>
          {!loading && !missing && (
            <div style={{ marginTop: 4, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
              {books.length} book{books.length === 1 ? '' : 's'}{reading ? ` · ${reading} reading` : ''}{finished ? ` · ${finished} finished` : ''}
            </div>
          )}
        </div>
        <Segmented value={view} onChange={setView} options={[
          { value: 'shelf', label: 'Shelf' }, { value: 'covers', label: 'Covers' }, { value: 'lists', label: 'Lists' }, { value: 'quotes', label: 'Quotes' }, { value: 'discover', label: 'Discover' }, { value: 'tracker', label: 'Tracker' },
        ]} />
        <Button variant="secondary" disabled={missing} onClick={() => shelfInput.current?.click()} title="Photograph a shelf and add the books on it"><Camera size={ICON.md} /> Scan shelf</Button>
        {/* No `capture`: it would force the camera and take away the photo library, where a shelf photo usually is. */}
        <input ref={shelfInput} type="file" accept="image/*,.heic,.heif" hidden aria-label="Choose a photo of a shelf"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setShelfPhoto(f) }} />
        <Button variant="accent" disabled={missing} onClick={() => setAdding(true)}><Plus size={ICON.md} /> Add book</Button>
      </header>

      {missing ? (
        <Card style={{ padding: '20px 22px', maxWidth: 560 }}>
          <div style={{ fontWeight: 600, color: 'var(--sb-ink-1)', marginBottom: 6 }}>The Library is not set up on this account yet</div>
          <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
            Its tables come from migration <code>20260025_library.sql</code>. Once that has run, reload and the shelf appears.
          </div>
        </Card>
      ) : (
        <>
          {(view === 'shelf' || view === 'covers') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 340 }}>
                <Search size={ICON.md} color="var(--sb-ink-4)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search your books" aria-label="Search your books" style={{ ...inputStyle, paddingLeft: 32 }} />
              </div>
              <div className="sb-no-scrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto', flex: '1 1 auto', minWidth: 0 }}>
                {(['all', 'want', 'reading', 'finished', 'paused', 'abandoned'] as StatusFilter[]).map(s => (
                  <Pill key={s} on={status === s} onClick={() => setStatus(s)} style={{ flexShrink: 0 }}>
                    {s === 'all' ? 'All' : STATUS_LABEL[s]} {/* a nought prints: blank reads as not-known */}
                    <span style={{ opacity: .7, marginLeft: 4 }}>{counts[s]}</span>
                  </Pill>
                ))}
              </div>
              {(toBuyCount > 0 || toBuyOnly) && (
                <Pill on={toBuyOnly} onClick={() => setToBuyOnly(o => !o)} style={{ flexShrink: 0 }} title="Books you mean to buy">
                  To buy <span style={{ opacity: .7, marginLeft: 4 }}>{toBuyCount}</span>
                </Pill>
              )}
              {list && (
                <Pill on onClick={() => setListId(null)} title="Show every book again">
                  {list.name} <X size={ICON.sm} style={{ marginLeft: 4 }} />
                </Pill>
              )}
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 14, alignItems: 'stretch' }}>
            <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingBottom: 16, display: narrow && selected ? 'none' : undefined }}>
              {loading && books.length === 0 ? (
                <p style={{ color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body)' }}>Fetching your library…</p>
              ) : view === 'tracker' ? (
                <TrackerView onOpenBook={id => { setView('shelf'); setStatus('all'); setQ(''); setListId(null); setSelectedId(id) }} />
              ) : view === 'discover' ? (
                <DiscoverView onAddByHand={isbn => { setAddIsbn(isbn); setAdding(true) }} onOpenBook={id => { setView('shelf'); setStatus('all'); setQ(''); setListId(null); setSelectedId(id) }} />
              ) : view === 'quotes' ? (
                <QuoteBoard onOpenBook={id => setSelectedId(id)} />
              ) : view === 'lists' ? (
                <ListsView onOpen={id => { setListId(id); setStatus('all'); setQ(''); setView('shelf') }} />
              ) : books.length === 0 ? (
                <Card style={{ padding: '28px 26px', maxWidth: 520, margin: '20px 0' }}>
                  <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>Your shelf is empty</div>
                  <p style={{ margin: '0 0 16px', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
                    Type a title and its cover and details are found for you. You can shelve it under a category or a list as you add it.
                  </p>
                  <Button variant="accent" onClick={() => setAdding(true)}><Plus size={ICON.md} /> Add your first book</Button>
                </Card>
              ) : visible.length === 0 ? (
                <p style={{ color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body)' }}>
                  {filtered ? 'No book matches that.' : 'Nothing here.'}{' '}
                  {filtered && <button type="button" onClick={() => { setQ(''); setStatus('all'); setListId(null); setToBuyOnly(false) }}
                    style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</button>}
                </p>
              ) : view === 'shelf' ? (
                <Shelf books={visible} pickedId={selected?.id ?? null} onPick={pick} />
              ) : (
                <CoverGrid books={visible} pickedId={selected?.id ?? null} onPick={pick} />
              )}
            </div>

            {selected && (
              <BookPanel key={selected.id} book={selected} narrow={narrow} flying={!!flight && flight.book.id === selected.id}
                onOpenReader={() => setReadingId(selected.id)}
                onClose={() => setSelectedId(null)} onManageLists={() => { setSelectedId(null); setView('lists') }} />
            )}
          </div>
        </>
      )}

      {flight && selected && (
        <BookFlight key={flight.book.id} book={flight.book} from={flight.from}
          onDone={() => setFlight(f => (f && f.book.id === flight.book.id ? null : f))} />
      )}
      {readingId && (() => {
        const rb = books.find(b => b.id === readingId)
        // A book deleted from another device while it is open closes its reader.
        if (!rb?.filePath) return null
        return (
          <Suspense fallback={<div role="status" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--sb-overlay)', display: 'grid', placeItems: 'center', color: 'var(--sb-ink-3)' }}>Opening the reader…</div>}>
            <PdfReader book={rb} onClose={() => setReadingId(null)} />
          </Suspense>
        )
      })()}
      {shelfPhoto && (
        <ShelfPhotoDialog file={shelfPhoto} onClose={() => setShelfPhoto(null)}
          onAdded={(ids, enrich) => { setShelfPhoto(null); setStatus('all'); setQ(''); setListId(null); setView('shelf'); if (enrich) void enrichAndReport(ids) }} />
      )}
      {adding && (
        <AddBookModal defaultListIds={activeListId ? [activeListId] : []} initialIsbn={addIsbn} onClose={() => { setAdding(false); setAddIsbn(undefined) }}
          onAdded={() => { setAdding(false); setAddIsbn(undefined); setView(view === 'lists' || view === 'quotes' || view === 'discover' || view === 'tracker' ? 'shelf' : view) }} />
      )}
    </div>
  )
}
