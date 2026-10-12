import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { ICON } from '@/lib/type'
import { useHeldText } from '@/lib/useHeldText'
import { Eyebrow, Row } from './fields'
import { inputStyle } from './fieldStyle'
import { useLibraryStore } from './libraryStore'
import { placeOf, type Note } from './types'

/** One note: its words write straight through (held 700ms), and the place it
 *  belongs to — a page, a line — is said above it. */
function NoteRow({ note }: { note: Note }) {
  const update = useLibraryStore(s => s.updateNote)
  const del = useLibraryStore(s => s.deleteNote)
  const { text, onChange, onBlur } = useHeldText(note.body, v => { if (v.trim()) update(note.id, v.trim()) })
  const place = placeOf(note)
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {place && <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginBottom: 2 }}>{place}</div>}
        <textarea value={text} rows={Math.min(6, Math.max(2, text.split('\n').length))} aria-label="Note"
          onChange={e => onChange(e.target.value)} onBlur={onBlur}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, minHeight: 0 }} />
      </div>
      <Button variant="ghost" size="sm" iconOnly title="Delete this note" aria-label="Delete this note" onClick={() => del(note.id)}>
        <Trash2 size={ICON.sm} />
      </Button>
    </div>
  )
}

/** Add a line of words at a fixed anchor; Enter adds, Shift+Enter breaks. */
function AddNote({ placeholder, onAdd }: { placeholder: string; onAdd: (body: string) => void }) {
  const [v, setV] = useState('')
  const commit = () => { if (v.trim()) { onAdd(v.trim()); setV('') } }
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input value={v} placeholder={placeholder} aria-label={placeholder} onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} style={inputStyle} />
      <Button size="sm" variant="secondary" disabled={!v.trim()} onClick={commit}>Add</Button>
    </div>
  )
}

/** The notes under one quote. */
export function QuoteNotes({ quoteId }: { quoteId: string }) {
  const notes = useLibraryStore(s => s.notes).filter(n => n.quoteId === quoteId)
  const add = useLibraryStore(s => s.addNote)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {notes.map(n => <NoteRow key={n.id} note={n} />)}
      <AddNote placeholder="Note on this quote" onAdd={body => add({ scope: 'quote', quoteId }, body)} />
    </div>
  )
}

/** The book's notes: about the whole book, or pinned to a page or a line. A
 *  page (and a line) typed beside the words decides the scope — there is no
 *  separate "kind" to choose. */
export function BookNotesCard({ bookId, disabled }: { bookId: string; disabled?: boolean }) {
  const notes = useLibraryStore(s => s.notes).filter(n => n.bookId === bookId && (n.scope === 'book' || n.scope === 'page' || n.scope === 'line'))
  const add = useLibraryStore(s => s.addNote)
  const [body, setBody] = useState('')
  const [page, setPage] = useState('')
  const [line, setLine] = useState('')

  const p = parseInt(page, 10), l = parseInt(line, 10)
  const hasPage = Number.isFinite(p) && p >= 0
  const hasLine = hasPage && Number.isFinite(l) && l >= 0

  function commit() {
    if (!body.trim()) return
    add(hasLine ? { scope: 'line', bookId, page: p, line: l } : hasPage ? { scope: 'page', bookId, page: p } : { scope: 'book', bookId }, body.trim())
    setBody(''); setPage(''); setLine('')
  }

  const ordered = [...notes].sort((a, b) => (a.page ?? -1) - (b.page ?? -1) || (a.line ?? -1) - (b.line ?? -1))

  return (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Eyebrow>Notes{notes.length ? ` · ${notes.length}` : ''}</Eyebrow>
      {ordered.map(n => <NoteRow key={n.id} note={n} />)}
      {!disabled && (
        <>
          <textarea value={body} rows={2} placeholder="A thought about this book" aria-label="New note" onChange={e => setBody(e.target.value)}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          <Row>
            <input value={page} inputMode="numeric" placeholder="Page" aria-label="Page (optional)" onChange={e => setPage(e.target.value)} style={{ ...inputStyle, flex: '1 1 70px' }} />
            <input value={line} inputMode="numeric" placeholder="Line" aria-label="Line (optional)" disabled={!hasPage} onChange={e => setLine(e.target.value)} style={{ ...inputStyle, flex: '1 1 70px' }} />
            <Button variant="secondary" disabled={!body.trim()} onClick={commit}>Add note</Button>
          </Row>
        </>
      )}
    </Card>
  )
}
