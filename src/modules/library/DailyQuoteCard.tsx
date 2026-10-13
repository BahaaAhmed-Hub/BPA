import { useMemo, useState } from 'react'
import { Quote as QuoteIcon, RefreshCw } from 'lucide-react'
import { ICON, STROKE } from '@/lib/type'
import { useUIStore } from '@/store/uiStore'
import { quoteOfTheDay, hasWords } from './dailyQuote'
import { dailyQuoteWanted, requestOpenBook, useLibraryOff } from './libraryPrefs'
import { useLibraryStore } from './libraryStore'
import { todayISO } from './readingStats'

/**
 * One of your own quotes, on Today.
 *
 * It draws **nothing** unless there is something to show: no Library, the
 * person turned it off, or no quote with words in it. An empty card with a
 * "save a quote" nag is exactly the kind of thing a home screen should not
 * grow. The pick is `quoteOfTheDay` (the same on every device, no storage);
 * **Another** steps past it for this visit only, and tomorrow is tomorrow's.
 */
export function DailyQuoteCard() {
  const off = useLibraryOff()
  const quotes = useLibraryStore(s => s.quotes)
  const books = useLibraryStore(s => s.books)
  const setActiveModule = useUIStore(s => s.setActiveModule)
  const [shift, setShift] = useState(0)
  const today = todayISO()
  const q = useMemo(() => quoteOfTheDay(quotes, today, shift), [quotes, today, shift])
  const count = useMemo(() => quotes.filter(hasWords).length, [quotes])

  if (off || !dailyQuoteWanted() || !q) return null
  const book = books.find(b => b.id === q.bookId)

  return (
    <figure aria-label="Quote of the day" style={{
      margin: 0, padding: '18px 22px 16px', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
      borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-control)', minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <QuoteIcon aria-hidden size={ICON.md} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-border)' }} />
        <span style={{ flex: 1, fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sb-ink-3)' }}>From your library</span>
        {count > 1 && (
          <button type="button" onClick={() => setShift(n => n + 1)} title="Another quote" aria-label="Another quote"
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, padding: 4 }}>
            <RefreshCw size={ICON.sm} /> Another
          </button>
        )}
      </div>
      <blockquote style={{
        margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', lineHeight: 1.4, letterSpacing: '-0.01em',
        color: 'var(--sb-ink-1)', textWrap: 'balance', whiteSpace: 'pre-line',
      }}>{q.body}</blockquote>
      {book && (
        <figcaption style={{ marginTop: 10, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
          <button type="button" onClick={() => { requestOpenBook(book.id); setActiveModule('library') }}
            style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, color: 'var(--sb-ink-2)', textDecoration: 'underline', textUnderlineOffset: 3 }}>{book.title}</button>
          {book.authors[0] ? ` · ${book.authors[0]}` : ''}{q.page ? ` · p. ${q.page}` : ''}
        </figcaption>
      )}
    </figure>
  )
}
