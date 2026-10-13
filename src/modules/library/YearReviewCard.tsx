import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { ICON } from '@/lib/type'
import { notify } from '@/lib/undo'
import { Eyebrow } from './fields'
import { useLibraryStore } from './libraryStore'
import { fmtMinutes, todayISO } from './readingStats'
import { fmtMoney, unplaced } from './spendStats'
import { MONTH, ratingsOf, yearMarkdown, yearReview, type YearReview } from './yearStats'
import type { Book } from './types'

const LETTER = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 26, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--sb-ink-1)', fontVariantNumeric: 'tabular-nums', marginTop: -6 }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{sub}</div>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)', fontSize: 'var(--sb-t-body-s)' }}>
      <span style={{ width: 112, flexShrink: 0, color: 'var(--sb-ink-3)' }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, color: 'var(--sb-ink-1)' }}>{children}</span>
    </div>
  )
}

/**
 * The year in books, counted from what is already there — finished books, the
 * session log, the quotes. Nothing is stored. A book belongs to the year it was
 * *finished* in, by its finish date; books marked read without one are in no
 * year, and the card says how many it left out instead of quietly shrinking.
 *
 * Lines that would say nothing true are not drawn: no "0 hours listening", no
 * "longest streak: 1 day", no top author unless someone was read twice.
 */
export function YearReviewCard({ onOpenBook }: { onOpenBook: (id: string) => void }) {
  const books = useLibraryStore(s => s.books)
  const sessions = useLibraryStore(s => s.sessions)
  const quotes = useLibraryStore(s => s.quotes)
  const links = useLibraryStore(s => s.links)
  const lists = useLibraryStore(s => s.lists)
  const today = todayISO()
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const lost = useMemo(() => unplaced(books), [books])
  const r: YearReview = useMemo(() => yearReview(year, books, sessions, quotes, links, lists, today), [year, books, sessions, quotes, links, lists, today])
  const all = useMemo(() => ratingsOf(books.filter(b => b.status === 'finished')), [books])
  const maxMonth = Math.max(1, ...r.months)
  const maxDist = Math.max(1, ...r.ratings.dist)
  const open = (b: Book) => (
    <button type="button" onClick={() => onOpenBook(b.id)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}>{b.title}</button>
  )

  async function copy() {
    try { await navigator.clipboard.writeText(yearMarkdown(r)); notify(`Copied ${year} in books`) }
    catch { notify('Could not copy — your browser did not allow it') }
  }

  return (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1 }}><Eyebrow>Year in review</Eyebrow></div>
        {(r.count > 0 || r.spent.length > 0) && <Button size="sm" variant="ghost" onClick={() => void copy()} title="Copy this as Markdown" style={{ marginTop: -8 }}><Copy size={ICON.sm} /> Copy summary</Button>}
        <button type="button" onClick={() => setYear(y => y - 1)} aria-label="Previous year" style={yearBtn}><ChevronLeft size={ICON.sm} /></button>
        <span aria-live="polite" style={{ minWidth: 44, textAlign: 'center', fontWeight: 600, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', marginTop: -8 }}>{year}</span>
        <button type="button" onClick={() => setYear(y => y + 1)} aria-label="Next year" style={yearBtn}><ChevronRight size={ICON.sm} /></button>
      </div>

      {r.count === 0 ? (
        <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
          No books finished in {year} yet. A book counts toward the year it has a finish date in — mark one finished, or set the date on its page.
          {r.spent.length > 0 && <div style={{ marginTop: 6, color: 'var(--sb-ink-2)' }}>Spent on books: {r.spent.map(x => fmtMoney(x.amount, x.currency)).join(' · ')}</div>}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14 }}>
            <Stat label="Books" value={String(r.count)} sub={r.pagesKnown ? `${r.pages.toLocaleString('en-US')} pages${r.pagesKnown < r.count ? ` (${r.pagesKnown} counted)` : ''}` : undefined} />
            {(r.readMinutes > 0 || r.listenMinutes > 0) && (
              <Stat label="Time" value={fmtMinutes(r.readMinutes + r.listenMinutes)} sub={[r.readMinutes ? `${fmtMinutes(r.readMinutes)} reading` : '', r.listenMinutes ? `${fmtMinutes(r.listenMinutes)} listening` : ''].filter(Boolean).join(' · ')} />
            )}
            {r.daysRead > 0 && <Stat label="Days" value={String(r.daysRead)} sub={r.longestStreak > 1 ? `longest streak ${r.longestStreak}` : 'with a session'} />}
            {r.ratings.avg !== null && <Stat label="Rating" value={`${r.ratings.avg} ★`} sub={`${r.ratings.rated} rated`} />}
          </div>

          <div role="list" aria-label="Books finished each month" style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 96 }}>
            {r.months.map((n, i) => (
              <div key={i} role="listitem" aria-label={`${MONTH[i]}: ${n} book${n === 1 ? '' : 's'}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', minHeight: 14, fontVariantNumeric: 'tabular-nums' }}>{n || ''}</span>
                <div aria-hidden style={{ width: '100%', maxWidth: 28, height: `${(n / maxMonth) * 56}px`, minHeight: n ? 4 : 2, borderRadius: 'var(--sb-r-chip)', background: n ? 'var(--sb-accent)' : 'var(--sb-hairline)' }} />
                <span aria-hidden style={{ fontSize: 'var(--sb-t-meta)', color: r.busiest?.month === i ? 'var(--sb-ink-1)' : 'var(--sb-ink-3)', fontWeight: r.busiest?.month === i ? 700 : 500 }}>{LETTER[i]}</span>
              </div>
            ))}
          </div>

          {r.ratings.rated > 0 && (
            <div role="list" aria-label="How you rated them" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[5, 4, 3, 2, 1].map(star => {
                const n = r.ratings.dist[star - 1]
                return (
                  <div key={star} role="listitem" aria-label={`${star} star${star === 1 ? '' : 's'}: ${n}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
                    <span style={{ width: 28 }}>{star} ★</span>
                    <div aria-hidden style={{ flex: 1, height: 8, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-field)', overflow: 'hidden' }}>
                      <div style={{ width: `${(n / maxDist) * 100}%`, height: '100%', background: 'var(--sb-accent)' }} />
                    </div>
                    <span style={{ width: 20, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                  </div>
                )
              })}
            </div>
          )}
          {r.ratings.unrated > 0 && <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{r.ratings.unrated} of these {r.ratings.unrated === 1 ? 'has' : 'have'} no rating yet.</div>}

          <div>
            {r.top.length > 0 && <Row label="Five stars">{r.top.map((b, i) => <span key={b.id}>{i ? ' · ' : ''}{open(b)}</span>)}</Row>}
            {r.busiest && <Row label="Busiest month">{MONTH[r.busiest.month]} — {r.busiest.count} book{r.busiest.count === 1 ? '' : 's'}</Row>}
            {r.longest && r.shortest && r.longest.id !== r.shortest.id && (
              <Row label="Longest · shortest">{open(r.longest)} ({r.longest.pages} p.) · {open(r.shortest)} ({r.shortest.pages} p.)</Row>
            )}
            {r.fastest && r.slowest && r.fastest.book.id !== r.slowest.book.id && (
              <Row label="Fastest · slowest">{open(r.fastest.book)} ({r.fastest.days} day{r.fastest.days === 1 ? '' : 's'}) · {open(r.slowest.book)} ({r.slowest.days})</Row>
            )}
            {r.topAuthor && <Row label="Most read">{r.topAuthor.name} — {r.topAuthor.count} books</Row>}
            {r.categories.length > 0 && <Row label="By category">{r.categories.map(c => `${c.name} ${c.count}`).join(' · ')}</Row>}
            {r.spent.length > 0 && <Row label="Spent on books">{r.spent.map(x => `${fmtMoney(x.amount, x.currency)} (${x.books})`).join(' · ')}</Row>}
            {r.quotes > 0 && <Row label="Quotes saved">{r.quotes}</Row>}
          </div>
        </>
      )}

      {lost > 0 && <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{lost} priced book{lost === 1 ? ' has' : 's have'} no currency or purchase date, so {lost === 1 ? 'is' : 'are'} in no total.</div>}
      {r.undated > 0 && (
        <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
          {r.undated} finished book{r.undated === 1 ? ' has' : 's have'} no finish date, so {r.undated === 1 ? 'it is' : 'they are'} in no year. Set the date on the book&rsquo;s page to count {r.undated === 1 ? 'it' : 'them'}.
        </div>
      )}
      {all.rated > 0 && <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>All time: {all.avg} ★ across {all.rated} rated book{all.rated === 1 ? '' : 's'}.</div>}
    </Card>
  )
}

const yearBtn = { all: 'unset', cursor: 'pointer', display: 'flex', padding: 6, color: 'var(--sb-ink-2)', marginTop: -8 } as const
