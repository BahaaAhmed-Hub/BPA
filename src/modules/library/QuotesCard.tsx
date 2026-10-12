import { useState } from 'react'
import { Bookmark, Pencil, Trash2 } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { ICON } from '@/lib/type'
import { useHeldText } from '@/lib/useHeldText'
import { Eyebrow, Row } from './fields'
import { inputStyle } from './fieldStyle'
import { QuoteNotes } from './Notes'
import { SPINE_COLORS } from './spine'
import { useLibraryStore } from './libraryStore'
import { placeOf, type Quote } from './types'

const QUOTE_COLORS = SPINE_COLORS.slice(0, 6)

function QuoteBody({ quote }: { quote: Quote }) {
  const update = useLibraryStore(s => s.updateQuote)
  const { text, onChange, onBlur } = useHeldText(quote.body ?? '', v => { if (v.trim()) update(quote.id, { body: v.trim() }) })
  return (
    <textarea value={text} rows={Math.min(8, Math.max(2, Math.ceil(text.length / 38)))} aria-label="Quote text"
      onChange={e => onChange(e.target.value)} onBlur={onBlur}
      style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, fontStyle: 'italic' }} />
  )
}

function QuoteItem({ quote }: { quote: Quote }) {
  const del = useLibraryStore(s => s.deleteQuote)
  const update = useLibraryStore(s => s.updateQuote)
  const marked = useLibraryStore(s => s.bookmarks.some(m => m.kind === 'quote' && m.quoteId === quote.id))
  const toggle = useLibraryStore(s => s.toggleBookmark)
  const noteCount = useLibraryStore(s => s.notes.filter(n => n.quoteId === quote.id).length)
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(false)
  const place = placeOf(quote)

  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
      <span aria-hidden style={{ width: 4, flexShrink: 0, borderRadius: 'var(--sb-r-pill)', background: quote.color ?? QUOTE_COLORS[0] }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {editing
          ? <QuoteBody quote={quote} />
          : <p style={{ margin: 0, fontStyle: 'italic', lineHeight: 1.55, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>“{quote.body}”</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginRight: 'auto' }}>{place}</span>
          {/* The colour is a thing you choose while editing, not a permanent row of six dots. */}
          {editing && <div style={{ display: 'flex', gap: 3, flexBasis: '100%', order: 5, paddingTop: 2 }} role="group" aria-label="Quote colour">
            {QUOTE_COLORS.map((c, i) => (
              <button key={c} type="button" aria-label={`Colour ${i + 1}`} aria-pressed={(quote.color ?? QUOTE_COLORS[0]) === c}
                onClick={() => update(quote.id, { color: c })}
                style={{ width: 18, height: 18, borderRadius: 'var(--sb-r-pill)', background: c, border: 'none', cursor: 'pointer', padding: 0,
                  outline: (quote.color ?? QUOTE_COLORS[0]) === c ? '2px solid var(--sb-ink-1)' : 'none', outlineOffset: 1 }} />
            ))}
          </div>}
          <Button variant="ghost" size="sm" iconOnly title={marked ? 'Remove bookmark' : 'Bookmark this quote'} aria-label={marked ? 'Remove bookmark' : 'Bookmark this quote'}
            aria-pressed={marked} onClick={() => toggle({ kind: 'quote', bookId: quote.bookId, quoteId: quote.id })}>
            <Bookmark size={ICON.sm} fill={marked ? 'var(--sb-accent)' : 'none'} color={marked ? 'var(--sb-accent-deep)' : 'currentColor'} />
          </Button>
          <Button variant="ghost" size="sm" iconOnly title={editing ? 'Done editing' : 'Edit this quote'} aria-label={editing ? 'Done editing' : 'Edit this quote'} aria-pressed={editing}
            onClick={() => setEditing(e => !e)}><Pencil size={ICON.sm} /></Button>
          <Button variant="ghost" size="sm" iconOnly title="Delete this quote" aria-label="Delete this quote" onClick={() => del(quote.id)}><Trash2 size={ICON.sm} /></Button>
        </div>
        <button type="button" onClick={() => setNotes(n => !n)} aria-expanded={notes}
          style={{ all: 'unset', cursor: 'pointer', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', textDecoration: 'underline', alignSelf: 'flex-start' }}>
          {noteCount ? `${noteCount} note${noteCount === 1 ? '' : 's'}` : 'Add a note'}
        </button>
        {notes && <QuoteNotes quoteId={quote.id} />}
      </div>
    </div>
  )
}

/** A book's quotes: typed in with where they sit, kept in the order of the
 *  book (page, then line), each colourable, bookmarkable and noteable. */
export function QuotesCard({ bookId, disabled }: { bookId: string; disabled?: boolean }) {
  const quotes = useLibraryStore(s => s.quotes).filter(q => q.bookId === bookId)
  const add = useLibraryStore(s => s.addQuote)
  const [body, setBody] = useState('')
  const [page, setPage] = useState('')
  const [line, setLine] = useState('')

  const ordered = [...quotes].sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9) || (a.line ?? 1e9) - (b.line ?? 1e9) || a.createdAt.localeCompare(b.createdAt))

  function commit() {
    if (!body.trim()) return
    const p = parseInt(page, 10), l = parseInt(line, 10)
    const hasPage = Number.isFinite(p) && p >= 0
    add(bookId, { body: body.trim(), page: hasPage ? p : undefined, line: hasPage && Number.isFinite(l) && l >= 0 ? l : undefined })
    // Cleared with the words: a page left behind would be attached to the next
    // quote without anyone choosing it, and a wrong page is worse than none.
    setBody(''); setPage(''); setLine('')
  }

  return (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Eyebrow>Quotes{quotes.length ? ` · ${quotes.length}` : ''}</Eyebrow>
      {!disabled && (
        <>
          <textarea value={body} rows={3} placeholder="Type or paste a passage" aria-label="New quote" onChange={e => setBody(e.target.value)}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, fontStyle: 'italic' }} />
          <Row>
            <input value={page} inputMode="numeric" placeholder="Page" aria-label="Quote page (optional)" onChange={e => setPage(e.target.value)} style={{ ...inputStyle, flex: '1 1 70px' }} />
            <input value={line} inputMode="numeric" placeholder="Line" aria-label="Quote line (optional)" disabled={!page.trim()} onChange={e => setLine(e.target.value)} style={{ ...inputStyle, flex: '1 1 70px' }} />
            <Button variant="secondary" disabled={!body.trim()} onClick={commit}>Save quote</Button>
          </Row>
        </>
      )}
      {disabled && <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-warning)' }}>Quotes need migration <code>20260026_library_quotes.sql</code>.</p>}
      {ordered.map(q => <QuoteItem key={q.id} quote={q} />)}
    </Card>
  )
}
