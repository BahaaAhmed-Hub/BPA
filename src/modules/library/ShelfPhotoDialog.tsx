import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { Button, Segmented } from '@/components/ui'
import { ICON } from '@/lib/type'
import { notify } from '@/lib/undo'
import { Eyebrow } from './fields'
import { inputStyle } from './fieldStyle'
import { shelfMatch } from './bookLookup'
import { newCategoryNames, resolveCategory } from './shelfCategories'
import { useLibraryStore } from './libraryStore'
import { readShelf, ShelfError, type Spine } from './readShelf'
import { cutTiles, type Tile } from './shelfTiles'
import { isHeic, readableImage } from './heic'
import type { BookStatus } from './types'

interface Row extends Spine { key: string; include: boolean; /** The name to file under; '' is none. */ filed: string }

const STATUS: { value: BookStatus; label: string }[] = [{ value: 'want', label: 'Want to read' }, { value: 'finished', label: 'Already read' }]
const CHECK: Record<'medium' | 'low', string> = { medium: 'Small print — worth a glance', low: 'Not sure — check this one' }

/**
 * A photographed shelf, turned into books.
 *
 * The photo is cut into overlapping pieces (`shelfTiles`) because a whole shelf
 * shrunk to the model's size is unreadable; each is read and the results merged.
 * **Every row is a draft**: a title, an author, and how sure the model was, all
 * editable, none added until ticked. A book already on the shelf is shown as
 * such and cannot be ticked — adding it twice is the one mistake this screen
 * could make for you.
 *
 * A piece that fails costs its piece: the rest are listed and the screen says
 * how many parts did not read. With no key, a refused key, no books found, or an
 * unreadable photo, the way back to adding by hand is in the words.
 */
export function ShelfPhotoDialog({ file, onClose, onAdded }: { file: File; onClose: () => void; onAdded: (ids: string[], enrich: boolean) => void }) {
  const shelf = useLibraryStore(s => s.books)
  const addBooks = useLibraryStore(s => s.addBooks)
  const lists = useLibraryStore(s => s.lists)
  const catNames = useMemo(() => lists.filter(l => l.kind === 'category').map(l => l.name), [lists])
  const [sort, setSort] = useState(true)
  const [enrich, setEnrich] = useState(true)
  // Read through a ref: a background reload replaces `lists`, and a callback that depended on the names
  // would re-run the effect below and read (and bill for) the photo all over again, losing your edits.
  const catRef = useRef(catNames)
  useEffect(() => { catRef.current = catNames }, [catNames])
  const [tiles, setTiles] = useState<Tile[] | null>(null)
  const [phase, setPhase] = useState<'preparing' | 'reading' | 'ready'>('preparing')
  const [progress, setProgress] = useState<[number, number]>([0, 0])
  const [rows, setRows] = useState<Row[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [status, setStatus] = useState<BookStatus>('want')
  const [preview, setPreview] = useState<string | null>(null)
  const run = useRef(0)

  const read = useCallback(async (t: Tile[]) => {
    const mine = ++run.current
    setPhase('reading'); setNote(null); setProgress([0, t.length])
    try {
      const r = await readShelf(t, (d, of) => { if (mine === run.current) setProgress([d, of]) }, catRef.current)
      if (mine !== run.current) return
      if (r.error) { setNote(r.error); setRows([]) }
      else {
        setRows(r.books.map((b, i) => ({ ...b, key: `${i}-${b.title}`, include: b.sureness !== 'low', filed: resolveCategory(b.category, catRef.current)?.name ?? '' })))
        const parts: string[] = []
        if (r.books.length === 0) parts.push('No readable titles were found. Try a closer, straighter photo of one shelf — or add the books by hand.')
        if (r.failedParts) parts.push(`${r.failedParts} of ${r.parts} parts of the photo could not be read, so some books may be missing. “Read again” tries the whole photo once more.`)
        if (r.unreadable) parts.push(`${r.unreadable} spine${r.unreadable === 1 ? '' : 's'} could not be read — those are not listed.`)
        setNote(parts.join(' ') || null)
      }
    } catch (e) {
      if (mine !== run.current) return
      setNote(e instanceof ShelfError ? e.message : 'The shelf could not be read just now. You can still add books by hand.')
      setRows([])
    }
    setPhase('ready')
  }, [])

  useEffect(() => {
    let live = true
    let url = ''
    void (async () => {
      if (!file.type.startsWith('image/') && !isHeic(file)) { setFatal(`${file.name || 'That file'} is not an image.`); setPhase('ready'); return }
      try {
        const img = await readableImage(file)
        if (!live) return
        url = URL.createObjectURL(img)
        setPreview(url)
        const t = await cutTiles(img)
        if (!live) return
        setTiles(t)
        await read(t)
      } catch (e) {
        if (live) { setFatal(e instanceof Error ? e.message : 'That photo could not be opened.'); setPhase('ready') }
      }
    })()
    // `run` is a request counter, not a DOM node: bumping it on the way out stops an in-flight read writing into a closed dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { live = false; run.current++; if (url) URL.revokeObjectURL(url) }
  }, [file, read])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  // Whether a row is already on the shelf follows the text, so correcting a title can clear (or cause) the flag.
  const dups = useMemo(() => rows.map(r => r.title.trim() ? shelfMatch(shelf, { title: r.title, authors: r.author ? [r.author] : [], source: 'manual' }) : undefined), [rows, shelf])
  const patch = (i: number, p: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const chosen = rows.filter((r, i) => r.include && !dups[i] && r.title.trim())
  const busy = phase !== 'ready'
  // Categories this would make: the new names among the rows that will actually be added.
  const makes = sort ? newCategoryNames(chosen.map(r => r.filed), catNames) : []
  // What the pickers offer: yours, then any new name the photo suggested for a row (labelled new).
  const offered = newCategoryNames(rows.map(r => r.filed), catNames)

  function add() {
    if (!chosen.length) return
    const made = addBooks(chosen.map(r => ({ title: r.title.trim(), authors: r.author?.trim() ? [r.author.trim()] : [], status, category: sort ? r.filed || undefined : undefined })))
    notify(`Added ${made.length} book${made.length === 1 ? '' : 's'} from your shelf`)
    onAdded(made.map(b => b.id), enrich)
  }

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} className="sb-above-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--sb-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Books from a shelf photo" style={{
        width: 'min(640px, 100%)', maxHeight: '94vh', display: 'flex', flexDirection: 'column',
        background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)',
        borderRadius: 'var(--sb-r-frame)', boxShadow: 'var(--sb-shadow-frame)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 4px' }}>
          <h2 style={{ margin: 0, flex: 1, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>Books from a shelf photo</h2>
          <Button variant="ghost" iconOnly title="Close" aria-label="Close" onClick={onClose}><X size={ICON.md} /></Button>
        </div>

        <div style={{ overflowY: 'auto', padding: '8px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {fatal ? (
            <div role="alert" style={{ color: 'var(--sb-negative)', fontSize: 'var(--sb-t-body)' }}>{fatal}</div>
          ) : (
            <>
              {preview && <img src={preview} alt="The photographed shelf" style={{ width: '100%', maxHeight: '26vh', objectFit: 'contain', borderRadius: 'var(--sb-r-sm)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-hairline)' }} />}
              <div aria-live="polite" style={{ fontSize: 'var(--sb-t-body-s)', color: note ? 'var(--sb-accent-deep)' : 'var(--sb-ink-3)', minHeight: 18 }}>
                {phase === 'preparing' && 'Preparing the photo…'}
                {phase === 'reading' && (progress[1] > 1 ? `Reading the shelf — part ${Math.min(progress[0] + 1, progress[1])} of ${progress[1]}…` : 'Reading the shelf…')}
                {phase === 'ready' && note}
                {phase === 'ready' && !note && rows.length > 0 && 'These are guesses from the spines. Fix any title that is wrong, and untick any you do not want.'}
              </div>

              {rows.length > 0 && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <Eyebrow>{rows.length} found</Eyebrow>
                    <Segmented value={status} onChange={setStatus} options={STATUS} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>
                      <input type="checkbox" checked={sort} onChange={e => setSort(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--sb-accent-deep)' }} /> Sort into categories
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>
                      <input type="checkbox" checked={enrich} onChange={e => setEnrich(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--sb-accent-deep)' }} /> Look up covers and details
                    </label>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      <Button size="sm" variant="ghost" onClick={() => setRows(rs => rs.map(r => ({ ...r, include: true })))}>All</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRows(rs => rs.map(r => ({ ...r, include: false })))}>None</Button>
                    </span>
                  </div>
                  {makes.length > 0 && <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Makes {makes.length} new categor{makes.length === 1 ? 'y' : 'ies'}: {makes.join(', ')}.</div>}
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {rows.map((r, i) => {
                      const dup = dups[i]
                      return (
                        <li key={r.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
                          <input type="checkbox" aria-label={`Add ${r.title}`} checked={r.include && !dup} disabled={!!dup} onChange={e => patch(i, { include: e.target.checked })}
                            style={{ width: 20, height: 20, marginTop: 8, flexShrink: 0, accentColor: 'var(--sb-accent-deep)' }} />
                          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <input aria-label={`Title ${i + 1}`} value={r.title} onChange={e => patch(i, { title: e.target.value })} style={inputStyle} />
                            <input aria-label={`Author ${i + 1}`} value={r.author ?? ''} placeholder="Author (if printed)" onChange={e => patch(i, { author: e.target.value })} style={{ ...inputStyle, minHeight: 30, fontSize: 'var(--sb-t-body-s)' }} />
                            {sort && !dup && (
                              <select aria-label={`Category ${i + 1}`} value={r.filed} onChange={e => patch(i, { filed: e.target.value })} style={{ ...inputStyle, minHeight: 30, fontSize: 'var(--sb-t-body-s)' }}>
                                <option value="">No category</option>
                                {catNames.map(c => <option key={c} value={c}>{c}</option>)}
                                {offered.map(c => <option key={c} value={c}>{c} (new)</option>)}
                              </select>
                            )}
                            {dup ? <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Already on your shelf as “{dup.title}”.</span>
                              : r.sureness !== 'high' ? <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-accent-deep)' }}>{CHECK[r.sureness]}</span> : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '12px 56px 16px 20px', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
          {tiles && !fatal && <Button variant="ghost" disabled={busy} onClick={() => void read(tiles)} style={{ marginRight: 'auto' }}><RefreshCw size={ICON.sm} /> Read again</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="accent" disabled={busy || chosen.length === 0} onClick={add}>{chosen.length ? `Add ${chosen.length} book${chosen.length === 1 ? '' : 's'}` : 'Add books'}</Button>
        </div>
      </div>
    </div>
  )
}
