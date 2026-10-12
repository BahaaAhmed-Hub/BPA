import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button, Pill, Segmented } from '@/components/ui'
import { CAPS, ICON } from '@/lib/type'
import { BookLookup } from './BookLookup'
import { CoverArt } from './CoverArt'
import { Eyebrow, Field, NumField, Row, TextField } from './fields'
import { inputStyle } from './fieldStyle'
import { useLibraryStore } from './libraryStore'
import type { BookCandidate } from './bookLookup'
import { FORMAT_LABEL, STATUS_LABEL, type Book, type BookFormat, type BookStatus } from './types'

const STATUSES: BookStatus[] = ['want', 'reading', 'finished']
const FORMATS = (Object.keys(FORMAT_LABEL) as BookFormat[]).map(v => ({ value: v, label: FORMAT_LABEL[v] }))

interface Draft {
  title: string; authors: string; subtitle?: string; isbn?: string; publisher?: string
  publishedYear?: number; pages?: number; language?: string; description?: string; coverUrl?: string
  source: Book['source']; sourceKey?: string; status: BookStatus; format: BookFormat
}
const BLANK: Draft = { title: '', authors: '', source: 'manual', status: 'want', format: 'print' }

/**
 * Add a book: search first, by what you remember of it, and the form below
 * fills itself — or skip the search and type it. Either way the form is the
 * truth: nothing is written until Add, and everything the lookup put there is
 * still editable.
 *
 * Closes on Escape and on the backdrop, and only the backdrop itself — a click
 * that starts inside the dialog and ends outside it (selecting text) is not a
 * dismissal.
 */
export function AddBookModal({ onClose, onAdded, defaultListIds = [] }: {
  onClose: () => void
  onAdded: (b: Book) => void
  defaultListIds?: string[]
}) {
  const addBook = useLibraryStore(s => s.addBook)
  const lists = useLibraryStore(s => s.lists)
  const [d, setD] = useState<Draft>(BLANK)
  const [picked, setPicked] = useState<string[]>(defaultListIds)
  const set = (p: Partial<Draft>) => setD(prev => ({ ...prev, ...p }))

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  function take(c: BookCandidate) {
    setD(prev => ({
      ...prev, title: c.title, authors: c.authors.join(', '), subtitle: c.subtitle, isbn: c.isbn,
      publisher: c.publisher, publishedYear: c.publishedYear, pages: c.pages, language: c.language,
      description: c.description, coverUrl: c.coverUrl, source: c.source, sourceKey: c.sourceKey,
    }))
  }

  function add() {
    if (!d.title.trim()) return
    const { authors, ...rest } = d
    const book = addBook({
      ...rest, title: d.title.trim(),
      authors: authors.split(',').map(a => a.trim()).filter(Boolean),
      startedOn: d.status === 'reading' ? new Date().toISOString().slice(0, 10) : undefined,
    }, picked)
    onAdded(book)
  }

  const shelving = [...lists.filter(l => l.kind === 'category'), ...lists.filter(l => l.kind === 'list')]

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} className="sb-above-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--sb-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Add a book" style={{
        width: 'min(580px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)',
        borderRadius: 'var(--sb-r-frame)', boxShadow: 'var(--sb-shadow-frame)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 22px 4px' }}>
          <h2 style={{ margin: 0, flex: 1, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>Add a book</h2>
          <Button variant="ghost" iconOnly title="Close" aria-label="Close" onClick={onClose}><X size={ICON.md} /></Button>
        </div>

        <div style={{ overflowY: 'auto', padding: '10px 22px 8px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section>
            <Eyebrow>Find it</Eyebrow>
            <BookLookup autoFocus onPick={take} />
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Eyebrow>The book</Eyebrow>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 84, flexShrink: 0 }}>
                <CoverArt book={{ id: 'draft', title: d.title || 'Untitled', authors: d.authors.split(',').map(a => a.trim()).filter(Boolean), coverUrl: d.coverUrl }} />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <TextField label="Title" value={d.title} onPush={title => set({ title })} />
                <TextField label="Author" value={d.authors} placeholder="Separate several with commas" onPush={authors => set({ authors })} />
              </div>
            </div>
            <Row>
              <NumField label="Pages" value={d.pages} onPush={pages => set({ pages })} />
              <NumField label="Year" value={d.publishedYear} onPush={publishedYear => set({ publishedYear })} />
              <TextField label="ISBN" value={d.isbn ?? ''} onPush={v => set({ isbn: v.replace(/[^0-9Xx]/g, '') || undefined })} />
            </Row>
            <Field label="Cover image address">
              <input value={d.coverUrl ?? ''} placeholder="https://… (filled in when you pick a result)"
                onChange={e => set({ coverUrl: e.target.value.trim() || undefined })} style={inputStyle} />
            </Field>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Eyebrow>Where it stands</Eyebrow>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {STATUSES.map(s => <Pill key={s} on={d.status === s} onClick={() => set({ status: s })}>{STATUS_LABEL[s]}</Pill>)}
            </div>
            <Segmented value={d.format} onChange={format => set({ format })} options={FORMATS} />
          </section>

          {shelving.length > 0 && (
            <section>
              <Eyebrow>Shelve under</Eyebrow>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {shelving.map(l => (
                  <Pill key={l.id} on={picked.includes(l.id)} title={l.kind === 'category' ? 'Category' : 'List'}
                    onClick={() => setPicked(p => p.includes(l.id) ? p.filter(x => x !== l.id) : [...p, l.id])}>{l.name}</Pill>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sticky, with the right corner left clear: the assistant's floating
            button is fixed to the viewport and sat on top of the primary action. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, padding: '12px 56px 16px 22px', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
          {!d.title.trim() && <span style={{ ...CAPS, color: 'var(--sb-ink-4)', marginRight: 'auto' }}>A title is all it needs</span>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="accent" disabled={!d.title.trim()} onClick={add}>Add to library</Button>
        </div>
      </div>
    </div>
  )
}
