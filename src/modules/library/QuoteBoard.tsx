import { useState } from 'react'
import { Bookmark, Search } from 'lucide-react'
import { Card, Pill, Segmented } from '@/components/ui'
import { ICON } from '@/lib/type'
import { inputStyle } from './fieldStyle'
import { ExplainView } from './ExplainView'
import { PosterView } from './PosterView'
import { QuotePhoto } from './QuotesCard'
import { useLibraryStore } from './libraryStore'
import { useBoardQuotes, withText, type BoardItem } from './quoteBoardData'
import { SPINE_COLORS } from './spine'
import { placeOf } from './types'

type Mode = 'cards' | 'poster' | 'explain'
const MODE_KEY = 'library-quote-mode'
const loadMode = (): Mode => { try { const v = localStorage.getItem(MODE_KEY); return v === 'poster' || v === 'explain' ? v : 'cards' } catch { return 'cards' } }

function QuoteCard({ item, marked, onOpen }: { item: BoardItem; marked: boolean; onOpen: () => void }) {
  const { quote, book } = item
  const colour = quote.color ?? SPINE_COLORS[0]
  return (
    <Card variant="interactive" style={{ padding: 0, breakInside: 'avoid', marginBottom: 14, overflow: 'hidden', position: 'relative' }}>
      <button type="button" onClick={onOpen} aria-label={`Open this quote from ${book.title} as a poster`}
        style={{ all: 'unset', display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px 14px', cursor: 'pointer', width: '100%', boxSizing: 'border-box',
          borderTop: `4px solid ${colour}` }}>
        {quote.imagePath && !quote.body && <QuotePhoto path={quote.imagePath} />}
        {quote.body && <span style={{ fontFamily: 'var(--sb-font-num)', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.35, fontSize: quote.body.length > 220 ? 15 : 18, color: 'var(--sb-ink-1)', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{quote.body}</span>}
        <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
          <strong style={{ color: 'var(--sb-ink-2)' }}>{book.title}</strong>{book.authors[0] ? ` · ${book.authors[0]}` : ''}{placeOf(quote) ? ` · ${placeOf(quote)}` : ''}
        </span>
      </button>
      {marked && <Bookmark aria-label="Bookmarked" size={ICON.sm} fill="var(--sb-accent)" color="var(--sb-accent-deep)" style={{ position: 'absolute', top: 12, right: 12 }} />}
    </Card>
  )
}

/**
 * Every quote you have kept, across every book, drawn three ways: a wall of
 * cards to scan, a poster to sit with one, and the explanation view to ask what
 * one means. A card opens its poster — the same thought, larger.
 */
export function QuoteBoard({ onOpenBook }: { onOpenBook: (bookId: string) => void }) {
  const books = useLibraryStore(s => s.books)
  const bookmarks = useLibraryStore(s => s.bookmarks)
  const extrasMissing = useLibraryStore(s => s.extrasMissing)
  const [mode, setModeState] = useState<Mode>(loadMode)
  const [query, setQuery] = useState('')
  const [bookId, setBookId] = useState('')
  const [onlyMarked, setOnlyMarked] = useState(false)
  const [index, setIndex] = useState(0)
  const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m) } catch { /* private window */ } }

  const { items, all } = useBoardQuotes({ query, bookId, onlyMarked })
  const marked = new Set(bookmarks.filter(m => m.kind === 'quote').map(m => m.quoteId))
  const lettered = withText(items)
  const wordless = items.length - lettered.length
  const shown = mode === 'cards' ? items : lettered
  const withQuotes = books.filter(b => all && items.some(i => i.book.id === b.id) || b.id === bookId)

  if (extrasMissing) {
    return <Card style={{ padding: '20px 22px', maxWidth: 560 }}>Quotes need migration <code>20260026_library_quotes.sql</code>.</Card>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Segmented value={mode} onChange={setMode} options={[
          { value: 'cards', label: 'Cards' }, { value: 'poster', label: 'Poster' }, { value: 'explain', label: 'Explain' },
        ]} />
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
          <Search size={ICON.md} color="var(--sb-ink-4)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={e => { setQuery(e.target.value); setIndex(0) }} placeholder="Search quotes" aria-label="Search quotes" style={{ ...inputStyle, paddingLeft: 32 }} />
        </div>
        <select value={bookId} onChange={e => { setBookId(e.target.value); setIndex(0) }} aria-label="Only this book" style={{ ...inputStyle, width: 'auto', maxWidth: 220 }}>
          <option value="">All books</option>
          {withQuotes.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
        <Pill on={onlyMarked} onClick={() => { setOnlyMarked(o => !o); setIndex(0) }}>
          <Bookmark size={ICON.sm} /> Bookmarked
        </Pill>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
          {shown.length} of {all} quote{all === 1 ? '' : 's'}
        </span>
      </div>

      {all === 0 ? (
        <Card style={{ padding: '26px 24px', maxWidth: 520 }}>
          <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>No quotes yet</div>
          <p style={{ margin: 0, color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
            Open a book and type a passage, photograph a page, or select text while reading its PDF. They gather here.
          </p>
        </Card>
      ) : shown.length === 0 ? (
        <p style={{ color: 'var(--sb-ink-3)' }}>
          {mode !== 'cards' && wordless > 0 && items.length > 0 ? 'The quotes that match are photos with no text yet — type what they say to see them here.' : 'No quote matches that.'}
        </p>
      ) : mode === 'cards' ? (
        <div style={{ columnWidth: 260, columnGap: 14 }}>
          {shown.map(it => (
            <QuoteCard key={it.quote.id} item={it} marked={marked.has(it.quote.id)}
              onOpen={() => { if (it.quote.body) { setIndex(withText(items).findIndex(x => x.quote.id === it.quote.id)); setMode('poster') } else onOpenBook(it.book.id) }} />
          )).filter((_, i) => i < 400)}
        </div>
      ) : mode === 'poster' ? (
        <PosterView items={shown} index={index} setIndex={setIndex} onOpenBook={onOpenBook} />
      ) : (
        <ExplainView items={shown} onOpenBook={onOpenBook} />
      )}
      {mode !== 'cards' && wordless > 0 && shown.length > 0 && (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
          {wordless} photo quote{wordless === 1 ? '' : 's'} with no text yet {wordless === 1 ? 'is' : 'are'} not shown here.
        </p>
      )}
    </div>
  )
}
