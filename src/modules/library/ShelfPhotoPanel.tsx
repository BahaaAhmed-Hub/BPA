import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, Card, Segmented } from '@/components/ui'
import { notify } from '@/lib/undo'
import { applyBlank } from './shelfRow'
import { CoverArt } from './CoverArt'
import { Eyebrow } from './fields'
import { inputStyle } from './fieldStyle'
import { SidePanel } from './SidePanel'
import { lookupBooks, shelfMatch } from './bookLookup'
import { pickMatch } from './shelfEnrich'
import { newCategoryNames, resolveCategory } from './shelfCategories'
import { useLibraryStore } from './libraryStore'
import { readShelf, ShelfError, type Spine } from './readShelf'
import { cutTiles, type Tile } from './shelfTiles'
import { isHeic, readableImage } from './heic'
import type { Book, BookStatus } from './types'

/** `busy` is being looked up, `found` matched a catalogue entry, `none` did not, `down` could not be asked. */
type Lookup = 'busy' | 'found' | 'none' | 'down'
interface Row extends Spine {
  key: string; include: boolean; filed: string
  lookup: Lookup
  year?: number; coverUrl?: string
  /** What a catalogue match brought besides the four fields above (pages, ISBN, publisher…). */
  extra: Partial<Book>
  /** The title and author last asked about, so a field left unchanged is not asked again. */
  asked: string
  /** A cover or year typed by hand is the person's, and no later lookup replaces it. */
  handCover?: boolean; handYear?: boolean
}

const STATUS: { value: BookStatus; label: string }[] = [{ value: 'want', label: 'Want to read' }, { value: 'finished', label: 'Already read' }]
const CHECK: Record<'medium' | 'low', string> = { medium: 'Small print — worth a glance', low: 'Not sure — check this one' }
const CONCURRENCY = 3
const small = { ...inputStyle, minHeight: 32, fontSize: 'var(--sb-t-body-s)' } as const

/**
 * A photographed shelf, turned into books — in the panel beside the shelf, like
 * every other way of adding one.
 *
 * The photo is cut into overlapping pieces (`shelfTiles`) because a whole shelf
 * shrunk to the model's size is unreadable; each is read and the results merged.
 * **Every row is a draft the person can change on the spot**: as soon as a title
 * is read it is looked up in the online catalogues, and a confident match fills
 * the cover, the proper title and author, the year and the details; anything
 * can still be edited, and changing a title or author asks again. Nothing is
 * added until it is ticked and saved. A book already on the shelf is shown as
 * such and cannot be ticked.
 */
export function ShelfPhotoPanel({ file, narrow, onClose, onAdded }: { file: File; narrow?: boolean; onClose: () => void; onAdded: (ids: string[]) => void }) {
  const shelf = useLibraryStore(s => s.books)
  const addBooks = useLibraryStore(s => s.addBooks)
  const lists = useLibraryStore(s => s.lists)
  const catNames = useMemo(() => lists.filter(l => l.kind === 'category').map(l => l.name), [lists])
  const [sort, setSort] = useState(true)
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

  const patchKey = useCallback((key: string, p: Partial<Row> | ((r: Row) => Partial<Row>)) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...(typeof p === 'function' ? p(r) : p) } : r))), [])

  /** Ask the catalogues about one row. `fromEdit`: the person typed this title or author, so it stays as typed. */
  const lookup = useCallback(async (key: string, title: string, author: string | undefined, mine: number, fromEdit: boolean) => {
    patchKey(key, { lookup: 'busy', asked: `${title}|${author ?? ''}` })
    let result: Lookup = 'none', hit: ReturnType<typeof pickMatch> = null
    try {
      const r = await lookupBooks(`${title} ${author ?? ''}`.trim(), undefined, 8)
      if (r.failed.length >= 2) result = 'down'
      else { hit = pickMatch({ title, authors: author ? [author] : [] }, r.candidates); result = hit ? 'found' : 'none' }
    } catch { result = 'down' }
    if (mine !== run.current) return
    if (!hit) { patchKey(key, { lookup: result }); return }
    const h = hit
    patchKey(key, r => ({
      lookup: 'found',
      ...(fromEdit ? {} : { title: h.title, author: h.authors.join(', ') || r.author }),
      ...(r.handCover ? {} : { coverUrl: h.coverUrl }),
      ...(r.handYear ? {} : { year: h.publishedYear }),
      extra: { subtitle: h.subtitle, isbn: h.isbn, publisher: h.publisher, pages: h.pages, language: h.language, description: h.description, source: h.source, sourceKey: h.sourceKey },
    }))
  }, [patchKey])

  /** Every row is asked about, three at a time: two catalogues each is six requests in flight, plenty to ask of someone else's server. */
  const lookupAll = useCallback(async (list: Row[], mine: number) => {
    const queue = [...list]
    const worker = async () => { for (let r = queue.shift(); r; r = queue.shift()) { if (mine !== run.current) return; await lookup(r.key, r.title, r.author, mine, false) } }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker))
  }, [lookup])

  const read = useCallback(async (t: Tile[]) => {
    const mine = ++run.current
    setPhase('reading'); setNote(null); setProgress([0, t.length])
    try {
      const r = await readShelf(t, (d, of) => { if (mine === run.current) setProgress([d, of]) }, catRef.current)
      if (mine !== run.current) return
      if (r.error) { setNote(r.error); setRows([]) }
      else {
        const made: Row[] = r.books.map((b, i) => ({ ...b, key: `${i}-${b.title}`, include: b.sureness !== 'low', filed: resolveCategory(b.category, catRef.current)?.name ?? '', lookup: 'busy', extra: {}, asked: `${b.title}|${b.author ?? ''}` }))
        setRows(made)
        const parts: string[] = []
        if (made.length === 0) parts.push('No readable titles were found. Try a closer, straighter photo of one shelf — or add the books by hand.')
        if (r.failedParts) parts.push(`${r.failedParts} of ${r.parts} parts of the photo could not be read, so some books may be missing. “Read again” tries the whole photo once more.`)
        if (r.unreadable) parts.push(`${r.unreadable} spine${r.unreadable === 1 ? '' : 's'} could not be read — those are not listed.`)
        setNote(parts.join(' ') || null)
        setPhase('ready')
        void lookupAll(made, mine)
        return
      }
    } catch (e) {
      if (mine !== run.current) return
      setNote(e instanceof ShelfError ? e.message : 'The shelf could not be read just now. You can still add books by hand.')
      setRows([])
    }
    setPhase('ready')
  }, [lookupAll])

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
    // `run` is a request counter, not a DOM node: bumping it on the way out stops an in-flight read writing into a closed panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { live = false; run.current++; if (url) URL.revokeObjectURL(url) }
  }, [file, read])

  // Whether a row is already on the shelf follows the text, so correcting a title can clear (or cause) the flag.
  const dups = useMemo(() => rows.map(r => r.title.trim() ? shelfMatch(shelf, { title: r.title, authors: r.author ? [r.author] : [], source: 'manual' }) : undefined), [rows, shelf])
  const patch = (key: string, p: Partial<Row>) => patchKey(key, p)
  const chosen = rows.filter((r, i) => r.include && !dups[i] && r.title.trim())
  const busy = phase !== 'ready'
  const looking = rows.filter(r => r.lookup === 'busy').length
  // Categories this would make: the new names among the rows that will actually be added.
  const makes = sort ? newCategoryNames(chosen.map(r => r.filed), catNames) : []
  // What the pickers offer: yours, then any new name the photo suggested for a row (labelled new).
  const offered = newCategoryNames(rows.map(r => r.filed), catNames)

  /** Leaving the title or author box with different words asks the catalogues again. */
  const reask = (r: Row) => { if (r.title.trim() && `${r.title}|${r.author ?? ''}` !== r.asked) void lookup(r.key, r.title, r.author, run.current, true) }

  function add() {
    if (!chosen.length) return
    const made = addBooks(chosen.map(r => applyBlank({ ...r.extra, title: r.title.trim(), authors: r.author?.trim() ? r.author.split(',').map(a => a.trim()).filter(Boolean) : [], publishedYear: r.year, coverUrl: r.coverUrl?.trim() || undefined, status, category: sort ? r.filed || undefined : undefined })))
    notify(`Added ${made.length} book${made.length === 1 ? '' : 's'} from your shelf`)
    onAdded(made.map(b => b.id))
  }

  return (
    <SidePanel label="Books from a shelf photo" eyebrow="Scan shelf" narrow={narrow} onClose={onClose}
      footer={<>
        {tiles && !fatal && <Button variant="ghost" disabled={busy} onClick={() => void read(tiles)} style={{ marginRight: 'auto' }}><RefreshCw size={14} /> Read again</Button>}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="accent" disabled={busy || chosen.length === 0} onClick={add}>{chosen.length ? `Add ${chosen.length} book${chosen.length === 1 ? '' : 's'}` : 'Add books'}</Button>
      </>}>
      {fatal ? (
        <Card style={{ padding: '16px 18px' }}><div role="alert" style={{ color: 'var(--sb-negative-deep)', fontSize: 'var(--sb-t-body)' }}>{fatal}</div></Card>
      ) : (
        <>
          <Card style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {preview && <img src={preview} alt="The photographed shelf" style={{ width: '100%', maxHeight: 170, objectFit: 'contain', borderRadius: 'var(--sb-r-sm)', background: 'var(--sb-field)' }} />}
            <div aria-live="polite" style={{ fontSize: 'var(--sb-t-body-s)', color: note ? 'var(--sb-accent-deep)' : 'var(--sb-ink-3)', minHeight: phase === 'ready' ? 58 : 20 }}>
              {phase === 'preparing' && 'Preparing the photo…'}
              {phase === 'reading' && (progress[1] > 1 ? `Reading the shelf — part ${Math.min(progress[0] + 1, progress[1])} of ${progress[1]}…` : 'Reading the shelf…')}
              {phase === 'ready' && note}
              {phase === 'ready' && !note && rows.length > 0 && (looking ? `Finding covers online — ${rows.length - looking} of ${rows.length}…` : 'Covers and details are filled in where a catalogue matched. Fix anything that is wrong, and untick any you do not want.')}
            </div>
          </Card>

          {rows.length > 0 && (
            <>
              <Card style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Eyebrow>{rows.length} found</Eyebrow>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <Button size="sm" variant="ghost" onClick={() => setRows(rs => rs.map(r => ({ ...r, include: true })))}>All</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRows(rs => rs.map(r => ({ ...r, include: false })))}>None</Button>
                  </span>
                </div>
                <Segmented value={status} onChange={setStatus} options={STATUS} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>
                  <input type="checkbox" checked={sort} onChange={e => setSort(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--sb-accent-deep)' }} /> Sort into categories
                </label>
                {makes.length > 0 && <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Makes {makes.length} new categor{makes.length === 1 ? 'y' : 'ies'}: {makes.join(', ')}.</div>}
              </Card>

              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rows.map((r, i) => {
                  const dup = dups[i]
                  const hint = dup ? `Already on your shelf as “${dup.title}”.`
                    : r.lookup === 'busy' ? 'Finding cover and details…'
                    : r.lookup === 'found' ? 'Matched online — edit anything that is wrong.'
                    : r.lookup === 'down' ? 'Could not reach the book catalogues.'
                    : 'No match online — edit the title or author to look again.'
                  return (
                    <li key={r.key}>
                      <Card style={{ padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <input type="checkbox" aria-label={`Add ${r.title}`} checked={r.include && !dup} disabled={!!dup} onChange={e => patch(r.key, { include: e.target.checked })}
                          style={{ width: 20, height: 20, marginTop: 6, flexShrink: 0, accentColor: 'var(--sb-accent-deep)' }} />
                        <div data-lookup={r.lookup} style={{ width: 52, flexShrink: 0, opacity: r.lookup === 'busy' ? .55 : 1 }}>
                          <CoverArt book={{ id: r.key, title: r.title || 'Untitled', authors: r.author ? [r.author] : [], coverUrl: r.coverUrl }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <input aria-label={`Title ${i + 1}`} value={r.title} onChange={e => patch(r.key, { title: e.target.value })} onBlur={() => reask(r)} style={inputStyle} />
                          <input aria-label={`Author ${i + 1}`} value={r.author ?? ''} placeholder="Author" onChange={e => patch(r.key, { author: e.target.value })} onBlur={() => reask(r)} style={small} />
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input aria-label={`Published ${i + 1}`} inputMode="numeric" value={r.year ?? ''} placeholder="Year" style={{ ...small, width: 72, flexShrink: 0 }}
                              onChange={e => { const n = parseInt(e.target.value.replace(/\D/g, '').slice(0, 4), 10); patch(r.key, { year: Number.isFinite(n) ? n : undefined, handYear: true }) }} />
                            {sort && !dup && (
                              <select aria-label={`Category ${i + 1}`} value={r.filed} onChange={e => patch(r.key, { filed: e.target.value })} style={{ ...small, flex: 1, minWidth: 0 }}>
                                <option value="">No category</option>
                                {catNames.map(c => <option key={c} value={c}>{c}</option>)}
                                {offered.map(c => <option key={c} value={c}>{c} (new)</option>)}
                              </select>
                            )}
                          </div>
                          <span title={hint} style={{ height: 16, lineHeight: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--sb-t-meta)', color: r.sureness !== 'high' && !dup ? 'var(--sb-accent-deep)' : 'var(--sb-ink-3)' }}>
                            {hint}{!dup && r.sureness !== 'high' ? ` ${CHECK[r.sureness]}.` : ''}
                          </span>
                        </div>
                      </Card>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </>
      )}
    </SidePanel>
  )
}
