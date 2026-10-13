import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bookmark, ChevronLeft, ChevronRight, List, Minus, Plus, Quote, X } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { Button } from '@/components/ui'
import { notify } from '@/lib/undo'
import { ICON } from '@/lib/type'
import { inputStyle } from './fieldStyle'
import { downloadBookFile } from './libraryFiles'
import { useLibraryStore } from './libraryStore'
import { tidySelection } from './tidySelection'
import type { Book } from './types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2, 3]
const pageKey = (id: string) => `library-page:${id}`

/** Where this device last stopped. Per device on purpose: the `library_books`
 *  table has no column for it yet, and Phase 4's tracker is the thing that will
 *  keep reading progress properly. */
function lastPage(id: string): number {
  try { return Math.max(1, parseInt(localStorage.getItem(pageKey(id)) ?? '1', 10) || 1) } catch { return 1 }
}

/**
 * The reader: one page at a time, drawn to a canvas with its words laid over
 * it so they can be selected. Selecting text offers **Save as quote**, which
 * files it with the page it came from — the thing a quote typed by hand never
 * knew. A page can be bookmarked; the list of bookmarks and quotes jumps to
 * them.
 */
export default function PdfReader({ book, onClose }: { book: Book; onClose: () => void }) {
  const updateBook = useLibraryStore(s => s.updateBook)
  const addQuote = useLibraryStore(s => s.addQuote)
  const toggleMark = useLibraryStore(s => s.toggleBookmark)
  const bookmarks = useLibraryStore(s => s.bookmarks).filter(m => m.bookId === book.id)
  const quotes = useLibraryStore(s => s.quotes).filter(q => q.bookId === book.id && q.page != null)

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(() => lastPage(book.id))
  const [pageText, setPageText] = useState(String(page))
  const [zoomIdx, setZoomIdx] = useState(2)
  const [width, setWidth] = useState(0)
  const [sel, setSel] = useState('')
  const [marks, setMarks] = useState(false)

  const scroller = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)

  const total = doc?.numPages ?? 0
  const marked = bookmarks.some(m => m.kind === 'page' && m.page === page)

  // ── Open the file ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!book.filePath) return
    let dead = false
    // The loading task owns the document and its worker; destroying it frees both.
    let task: ReturnType<typeof pdfjs.getDocument> | null = null
    void (async () => {
      try {
        const data = await downloadBookFile(book.filePath!)
        task = pdfjs.getDocument({ data: new Uint8Array(data) })
        const d = await task.promise
        if (dead) return
        setDoc(d)
        setPage(p => Math.min(Math.max(1, p), d.numPages))
        // A book whose length nobody typed learns it from its own file.
        if (!book.pages) updateBook(book.id, { pages: d.numPages })
      } catch (e) {
        if (dead) return
        const name = (e as { name?: string })?.name
        setError(name === 'PasswordException' ? 'This PDF is password-protected, which the reader cannot open.'
          : name === 'InvalidPDFException' ? 'This file is not a PDF the reader can open.'
          : e instanceof Error ? e.message : 'The file could not be opened.')
      }
    })()
    return () => { dead = true; if (task) void task.destroy() }
    // The file, not the book object: an edit elsewhere must not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.filePath])

  // ── How wide a page may be ─────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Draw the page, then its words ──────────────────────────────────────────
  useEffect(() => {
    if (!doc || !width) return
    let dead = false
    let renderTask: { cancel: () => void } | null = null
    let textLayer: { cancel: () => void } | null = null
    void (async () => {
      const p = await doc.getPage(page)
      if (dead) return
      const natural = p.getViewport({ scale: 1 })
      // "Fit to width" at zoom 1, never wider than a comfortable reading line
      // on a big screen (1000px), and the zoom multiplies that.
      const fit = Math.min(width - 24, 1000) / natural.width
      const viewport = p.getViewport({ scale: fit * ZOOMS[zoomIdx] })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cv = canvas.current, tl = layer.current, bx = box.current
      if (!cv || !tl || !bx) return
      cv.width = Math.floor(viewport.width * dpr); cv.height = Math.floor(viewport.height * dpr)
      cv.style.width = `${viewport.width}px`; cv.style.height = `${viewport.height}px`
      bx.style.width = `${viewport.width}px`; bx.style.height = `${viewport.height}px`
      const ctx = cv.getContext('2d')
      if (!ctx) return
      const task = p.render({ canvas: cv, canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      renderTask = task
      tl.replaceChildren()
      tl.style.setProperty('--total-scale-factor', String(viewport.scale))
      const t = new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: tl, viewport })
      textLayer = t
      try { await Promise.all([task.promise, t.render()]) } catch { /* cancelled by the next page */ }
    })()
    return () => { dead = true; renderTask?.cancel(); textLayer?.cancel() }
  }, [doc, page, width, zoomIdx])

  // ── Keep the place, and the page box in step with the page ─────────────────
  useEffect(() => {
    try { localStorage.setItem(pageKey(book.id), String(page)) } catch { /* private window */ }
    setPageText(String(page)); setSel('')
    scroller.current?.scrollTo({ top: 0 })
  }, [page, book.id])

  const go = useCallback((n: number) => {
    if (!total) return
    const to = Math.min(total, Math.max(1, Number.isFinite(n) ? n : page))
    setPage(to)
    // Always show where it landed: asking for page 99 of 3 while already on 3
    // changes nothing else, so the box would otherwise keep saying 99.
    setPageText(String(to))
  }, [total, page])

  // ── What is selected, as long as it is on the page ─────────────────────────
  useEffect(() => {
    const on = () => {
      const s = window.getSelection()
      const text = s && !s.isCollapsed && layer.current?.contains(s.anchorNode) ? tidySelection(s.toString()) : ''
      // A tap on the Save button collapses the selection first on some
      // browsers; keep the last good one rather than losing it mid-gesture.
      if (text) setSel(text)
    }
    document.addEventListener('selectionchange', on)
    return () => document.removeEventListener('selectionchange', on)
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') go(page + 1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(page - 1)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [go, onClose, page])

  function saveQuote() {
    if (!sel) return
    addQuote(book.id, { body: sel, page })
    notify(`Saved as a quote from p. ${page}`)
    setSel(''); window.getSelection()?.removeAllRanges()
  }

  const pageMarks = bookmarks.filter(m => m.kind === 'page').sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
  const jump = (n: number) => { go(n); setMarks(false) }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Reading ${book.title}`} className="sb-above-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--sb-overlay)', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 12px', background: 'var(--sb-page)',
        borderBottom: 'var(--sb-border-width) solid var(--sb-border)',
      }}>
        <Button variant="ghost" iconOnly title="Close the reader" aria-label="Close the reader" onClick={onClose}><X size={ICON.md} /></Button>
        <div style={{ flex: '1 1 140px', minWidth: 0, fontFamily: 'var(--sb-font-num)', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.title}</div>

        <Button variant="secondary" iconOnly title="Previous page" aria-label="Previous page" disabled={page <= 1} onClick={() => go(page - 1)}><ChevronLeft size={ICON.md} /></Button>
        <input value={pageText} inputMode="numeric" aria-label="Page number" onChange={e => setPageText(e.target.value)}
          onBlur={() => go(parseInt(pageText, 10))} onKeyDown={e => { if (e.key === 'Enter') { go(parseInt(pageText, 10)); (e.target as HTMLInputElement).blur() } }}
          style={{ ...inputStyle, width: 52, textAlign: 'center', padding: '4px' }} />
        <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', minWidth: 28 }}>/ {total || '…'}</span>
        <Button variant="secondary" iconOnly title="Next page" aria-label="Next page" disabled={!total || page >= total} onClick={() => go(page + 1)}><ChevronRight size={ICON.md} /></Button>

        <Button variant="ghost" iconOnly title="Smaller" aria-label="Zoom out" disabled={zoomIdx === 0} onClick={() => setZoomIdx(i => Math.max(0, i - 1))}><Minus size={ICON.md} /></Button>
        <span aria-live="polite" style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', minWidth: 34, textAlign: 'center' }}>{Math.round(ZOOMS[zoomIdx] * 100)}%</span>
        <Button variant="ghost" iconOnly title="Larger" aria-label="Zoom in" disabled={zoomIdx === ZOOMS.length - 1} onClick={() => setZoomIdx(i => Math.min(ZOOMS.length - 1, i + 1))}><Plus size={ICON.md} /></Button>

        <Button variant="ghost" iconOnly title={marked ? 'Remove the bookmark on this page' : 'Bookmark this page'} aria-label={marked ? 'Remove the bookmark on this page' : 'Bookmark this page'}
          aria-pressed={marked} disabled={!doc} onClick={() => toggleMark({ kind: 'page', bookId: book.id, page })}>
          <Bookmark size={ICON.md} fill={marked ? 'var(--sb-accent)' : 'none'} color={marked ? 'var(--sb-accent-deep)' : 'currentColor'} />
        </Button>
        <div style={{ position: 'relative' }}>
          <Button variant="ghost" iconOnly title="Bookmarks and quotes" aria-label="Bookmarks and quotes" aria-expanded={marks} onClick={() => setMarks(m => !m)}><List size={ICON.md} /></Button>
          {marks && (
            <div role="menu" style={{
              position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 5, width: 280, maxHeight: '60vh', overflowY: 'auto', padding: 8,
              background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-menu)',
            }}>
              {pageMarks.length === 0 && quotes.length === 0 && (
                <p style={{ margin: 6, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Nothing marked yet. Bookmark a page, or select text and save it as a quote.</p>
              )}
              {pageMarks.map(m => (
                <button key={m.id} role="menuitem" onClick={() => jump(m.page ?? 1)} style={menuRow}>
                  <Bookmark size={ICON.sm} /> <span>Page {m.page}</span>
                </button>
              ))}
              {quotes.sort((a, b) => (a.page ?? 0) - (b.page ?? 0)).map(q => (
                <button key={q.id} role="menuitem" onClick={() => jump(q.page ?? 1)} style={menuRow}>
                  <Quote size={ICON.sm} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>p. {q.page}</span>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>{q.body}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Appears with a selection; keeps the corner clear for the assistant button. */}
        <Button variant="accent" disabled={!sel} onClick={saveQuote} onMouseDown={e => e.preventDefault()} style={{ marginRight: 'calc(var(--ai-fab-clear) - 56px)' }}>
          <Quote size={ICON.md} /> Save as quote
        </Button>
      </div>

      <div ref={scroller} style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--sb-field)', padding: '16px 12px 64px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
        {error ? (
          <div role="alert" style={{ marginTop: 40, maxWidth: 420, textAlign: 'center', color: 'var(--sb-ink-2)' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>This book could not be opened</div>
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>{error}</div>
          </div>
        ) : !doc ? (
          <p style={{ marginTop: 40, color: 'var(--sb-ink-3)' }}>Opening {book.title}…</p>
        ) : null}
        <div ref={box} data-pdf-page={page} style={{ position: 'relative', display: doc ? 'block' : 'none', background: 'var(--sb-card)', boxShadow: 'var(--sb-shadow-menu)', flexShrink: 0 }}>
          <canvas ref={canvas} style={{ display: 'block' }} />
          <div ref={layer} className="lib-textlayer" />
        </div>
      </div>
    </div>
  )
}

const menuRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', minHeight: 40, padding: '6px 8px', cursor: 'pointer',
  border: 'none', borderRadius: 'var(--sb-r-sm)', background: 'transparent', color: 'var(--sb-ink-1)', fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)',
}
