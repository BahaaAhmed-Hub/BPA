import { useState } from 'react'
import { Button, Card, Pill, Segmented } from '@/components/ui'
import { CAPS } from '@/lib/type'
import { SidePanel } from './SidePanel'
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
 * Add a book, in the panel beside the shelf: search first, by what you remember
 * of it, and the form below fills itself — or skip the search and type it.
 * Either way the form is the truth: nothing is written until Add, and everything
 * the lookup put there is still editable. (The one panel where a Save button
 * exists — a book that is not on the shelf yet has nothing to write through to.)
 */
export function AddBookPanel({ onClose, onAdded, defaultListIds = [], initialIsbn, narrow }: {
  narrow?: boolean
  onClose: () => void
  onAdded: (b: Book) => void
  defaultListIds?: string[]
  /** A scanned or typed ISBN no catalogue knew: the form opens with it filled in. */
  initialIsbn?: string
}) {
  const addBook = useLibraryStore(s => s.addBook)
  const lists = useLibraryStore(s => s.lists)
  const [d, setD] = useState<Draft>(() => (initialIsbn ? { ...BLANK, isbn: initialIsbn } : BLANK))
  const [picked, setPicked] = useState<string[]>(defaultListIds)
  const set = (p: Partial<Draft>) => setD(prev => ({ ...prev, ...p }))

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
    <SidePanel label="Add a book" eyebrow="New book" narrow={narrow} onClose={onClose}
      footer={<>
        {!d.title.trim() && <span style={{ ...CAPS, color: 'var(--sb-ink-4)', marginRight: 'auto' }}>Title needed</span>}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="accent" disabled={!d.title.trim()} onClick={add}>Add to library</Button>
      </>}>
      <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Eyebrow>Find it</Eyebrow>
        <BookLookup autoFocus onPick={take} />
      </Card>
      <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
      </Card>
      <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Eyebrow>Where it stands</Eyebrow>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {STATUSES.map(s => <Pill key={s} on={d.status === s} onClick={() => set({ status: s })}>{STATUS_LABEL[s]}</Pill>)}
        </div>
        <Segmented value={d.format} onChange={format => set({ format })} options={FORMATS} />
      </Card>
      {shelving.length > 0 && (
        <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow>Shelve under</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {shelving.map(l => (
              <Pill key={l.id} on={picked.includes(l.id)} title={l.kind === 'category' ? 'Category' : 'List'}
                onClick={() => setPicked(p => p.includes(l.id) ? p.filter(x => x !== l.id) : [...p, l.id])}>{l.name}</Pill>
            ))}
          </div>
      </Card>
      )}
    </SidePanel>
  )
}
