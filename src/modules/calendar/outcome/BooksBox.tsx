// ─── Books, from the meeting ─────────────────────────────────────────────────
//
// A meeting is where a book is mentioned, recommended, or quoted, and where a
// reading habit either happens or does not. This box files that without leaving
// the window: log the pages, finish the book, keep a line from it, or put the
// one somebody named on the shelf.
//
// Rules, all the Library's own:
//
// **Two switches, either turns it off.** The plan (`my_modules()`) and the
// person's (`library-settings`). `libraryIsOff()` is the one answer, so the box
// is not drawn and nothing is read; "Fetching your library…" is never "no books".
//
// **Progress is derived, never stored on the book.** Logging pages is *a reading
// session* — `minutes` 1–1440 and a page reached — and the bar is the furthest
// page any session reached. So Undo is deleting that session, and nothing else
// needs to be put back. A sitting needs a duration (the table refuses without
// one), so the form carries it, pre-answered with the length of the last sitting.
//
// **A sitting cannot be dated in the future.** The meeting's own day is the
// default, capped at today.
//
// **A book is found the way the Library finds it.** The same two catalogues, a
// source down named and never "not found", a book already on the shelf shown as
// such — adding it twice is the one mistake this box could make for you.
//
// **Optional migrations are optional.** Without the sessions table the pages form
// says so and the rest still works; likewise quotes.

import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, Link as LinkIcon, Search } from 'lucide-react'
import { useLibraryStore } from '@/modules/library/libraryStore'
import { libraryIsOff } from '@/modules/library/libraryPrefs'
import { lookupBooks, shelfMatch, type BookCandidate } from '@/modules/library/bookLookup'
import { bookFromCandidate } from '@/modules/library/applyCandidate'
import { pagesCovered, progressOf, todayISO } from '@/modules/library/readingStats'
import type { Book } from '@/modules/library/types'
import { ICON } from '@/lib/type'
import {
  addOutcomeLink, removeOutcomeLink, linksForEvent, subscribeOutcomeLinks,
} from '@/lib/meetingOutcomes'
import { OutcomeBox, EYEBROW, FIELD, chip, type OutcomeEvent } from './shared'

const TINT = 'var(--sb-info)'

/** What this window changed on one book, so Undo puts back exactly that and
 *  the link goes when nothing is left. Session-only. */
interface Changes {
  /** The status and dates before this window changed them. */
  before?: Pick<Book, 'status' | 'startedOn' | 'finishedOn'>
  sessions: string[]
  quotes: string[]
}
const empty = (): Changes => ({ sessions: [], quotes: [] })

const STATUS_WORDS: Record<string, string> = {
  want: 'Want to read', reading: 'Reading', finished: 'Finished', paused: 'Paused', abandoned: 'Abandoned',
}

function Cover({ book }: { book: Book }) {
  return book.coverUrl
    ? <img src={book.coverUrl} alt="" referrerPolicy="no-referrer" style={{ width: 38, height: 52, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
    : <span aria-hidden style={{ width: 38, height: 52, borderRadius: 5, flexShrink: 0, background: book.spineColor ?? 'var(--sb-info)' }} />
}

function BookRow({ book, event, linkedHere, madeHere, changes, onChanges, onUndoMade }: {
  book: Book
  event: OutcomeEvent
  linkedHere: boolean
  madeHere: boolean
  changes: Changes
  onChanges: (patch: (c: Changes) => Changes) => void
  onUndoMade: () => void
}) {
  const st = useLibraryStore.getState
  const sessions = useLibraryStore(s => s.sessions)
  const quotes = useLibraryStore(s => s.quotes)
  const sessionsMissing = useLibraryStore(s => s.sessionsMissing)
  const extrasMissing = useLibraryStore(s => s.extrasMissing)

  const mine = sessions.filter(s => s.bookId === book.id)
  const prog = progressOf(book, mine)
  const lastRead = mine.filter(s => s.kind === 'read').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]

  const day = (event.date && event.date <= todayISO()) ? event.date : todayISO()
  const [page, setPage] = useState(String(prog.page ?? ''))
  const [minutes, setMinutes] = useState(String(lastRead?.minutes ?? 20))
  const [error, setError] = useState<string | null>(null)
  const [quote, setQuote] = useState('')
  const [quotePage, setQuotePage] = useState('')

  const link = (kind: 'book' | 'quote', id: string, role: 'made' | 'touched') =>
    addOutcomeLink({ eventId: event.id, eventTitle: event.title, eventDate: event.date, kind, recordId: id, role })

  const touch = () => { if (!linkedHere) link('book', book.id, 'touched') }

  function logSitting() {
    const to = Math.round(Number(page))
    const min = Math.round(Number(minutes))
    if (!(to > 0)) { setError('Which page did you reach?'); return }
    if (!(min >= 1 && min <= 1440)) { setError('Minutes must be 1 to 1440.'); return }
    if (book.pages && to > book.pages) { setError(`“${book.title}” has ${book.pages} pages; ${to} is past the end.`); return }
    setError(null)
    const made = st().addSession({
      bookId: book.id, kind: 'read', on: day, minutes: min, toPage: to,
      ...(pagesCovered(prog.page, to) !== undefined ? { pages: pagesCovered(prog.page, to) } : {}),
    })
    onChanges(c => ({ ...c, sessions: [...c.sessions, made.id] }))
    touch()
  }

  function finish() {
    const today = todayISO()
    onChanges(c => ({ ...c, before: c.before ?? { status: book.status, startedOn: book.startedOn, finishedOn: book.finishedOn } }))
    st().updateBook(book.id, { status: 'finished', finishedOn: book.finishedOn ?? today, startedOn: book.startedOn ?? today })
    touch()
  }

  function start() {
    onChanges(c => ({ ...c, before: c.before ?? { status: book.status, startedOn: book.startedOn, finishedOn: book.finishedOn } }))
    st().updateBook(book.id, { status: 'reading', startedOn: book.startedOn ?? todayISO() })
    touch()
  }

  function saveQuote() {
    const body = quote.trim()
    if (!body) return
    const p = Math.round(Number(quotePage))
    const q = st().addQuote(book.id, { kind: 'text', body, ...(p > 0 ? { page: p } : {}) })
    link('quote', q.id, 'made')
    onChanges(c => ({ ...c, quotes: [...c.quotes, q.id] }))
    touch()
    setQuote(''); setQuotePage('')
  }

  /** Put back what this window changed on the book, and the link with it when
   *  nothing is left of it. */
  function undoStatus() {
    if (!changes.before) return
    st().updateBook(book.id, { ...changes.before })
    onChanges(c => ({ ...c, before: undefined }))
  }
  function undoSession(id: string) {
    st().deleteSession(id)
    onChanges(c => ({ ...c, sessions: c.sessions.filter(x => x !== id) }))
  }
  function undoQuote(id: string) {
    st().deleteQuote(id)
    removeOutcomeLink(event.id, 'quote', id)
    onChanges(c => ({ ...c, quotes: c.quotes.filter(x => x !== id) }))
  }

  // The link to the book exists only while something this window did to it does.
  // Only *after* this window had changed something: on mount nothing is
  // outstanding, and a link made in an earlier sitting must not be taken for one
  // this window has just undone.
  const outstanding = !!changes.before || changes.sessions.length > 0 || changes.quotes.length > 0
  const hadChanges = useRef(false)
  useEffect(() => {
    if (outstanding) { hadChanges.current = true; return }
    if (hadChanges.current && !madeHere && linkedHere) removeOutcomeLink(event.id, 'book', book.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outstanding])

  const myQuotes = quotes.filter(q => changes.quotes.includes(q.id))
  const pct = prog.pct ?? 0

  return (
    <div data-outcome-book={book.id} data-status={book.status} style={{
      borderRadius: 'var(--sb-r-nav)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10,
      background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Cover book={book} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--sb-t-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.title}</div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            {[book.authors.join(', '), STATUS_WORDS[book.status], prog.page !== null ? (book.pages ? `page ${prog.page} of ${book.pages}` : `page ${prog.page}`) : ''].filter(Boolean).join(' · ')}
          </div>
          {book.status === 'reading' && book.pages ? (
            <div style={{ height: 6, borderRadius: 999, background: 'var(--sb-hairline, var(--sb-border))', marginTop: 6, overflow: 'hidden' }}>
              <div data-outcome-progress style={{ width: `${pct}%`, height: '100%', background: TINT }} />
            </div>
          ) : null}
        </div>
        {linkedHere && (
          <span title="Linked to this meeting" style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--sb-t-micro)', fontWeight: 600,
            color: 'var(--sb-ink-1)', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-pill)', padding: '3px 9px', whiteSpace: 'nowrap',
          }}><LinkIcon size={12} />this meeting</span>
        )}
        {book.status === 'want' && <button onClick={start} style={chip()}>Start reading</button>}
        {book.status === 'reading' && <button onClick={finish} style={{ ...chip(), background: TINT, color: 'var(--sb-ink-on-fill)', border: 'none', fontWeight: 700 }}>Mark finished</button>}
        {changes.before && !madeHere && <button onClick={undoStatus} style={chip()}>Undo {book.status === 'finished' ? 'finish' : 'start'}</button>}
        {madeHere && <button onClick={onUndoMade} style={chip()}>Undo</button>}
      </div>

      {book.status === 'reading' && (
        sessionsMissing ? (
          <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            Reading logs are not set up on this account yet (migration 20260030), so pages cannot be logged here.
          </p>
        ) : (
          <form onSubmit={e => { e.preventDefault(); logSitting() }} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Reached page</span>
            <input aria-label="Page reached" inputMode="numeric" value={page} onChange={e => setPage(e.target.value.replace(/\D/g, ''))}
              style={{ ...FIELD, height: 36, width: 80, borderRadius: 'var(--sb-r-pill)' }} />
            {[10, 20].map(n => (
              <button type="button" key={n} aria-label={`Add ${n} pages`}
                onClick={() => setPage(String((Number(page) || prog.page || 0) + n))} style={chip()}>+ {n}</button>
            ))}
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginLeft: 6 }}>in</span>
            <input aria-label="Minutes" inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value.replace(/\D/g, ''))}
              style={{ ...FIELD, height: 36, width: 64, borderRadius: 'var(--sb-r-pill)' }} />
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>min</span>
            <span style={{ flex: 1 }} />
            <button type="submit" style={{ ...chip(true) }}>Log sitting</button>
          </form>
        )
      )}
      {error && <span role="alert" style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative-deep)' }}>{error}</span>}
      {changes.sessions.map(id => {
        const s = sessions.find(x => x.id === id)
        return s ? (
          <div key={id} data-outcome-session={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)' }}>
            <Check size={14} color="var(--sb-positive)" />
            <span style={{ flex: 1 }}>Logged {s.minutes} min{s.toPage ? ` to page ${s.toPage}` : ''}{s.pages ? ` · ${s.pages} new pages` : ''}</span>
            <button onClick={() => undoSession(id)} style={chip()}>Undo</button>
          </div>
        ) : null
      })}

      {extrasMissing ? null : (
        <form onSubmit={e => { e.preventDefault(); saveQuote() }} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input aria-label={`Save a quote from ${book.title}`} value={quote} onChange={e => setQuote(e.target.value)}
            placeholder="Save a quote from this book…" style={{ ...FIELD, flex: 1, height: 40 }} />
          <input aria-label="Quote page" inputMode="numeric" value={quotePage} onChange={e => setQuotePage(e.target.value.replace(/\D/g, ''))}
            placeholder="p." style={{ ...FIELD, width: 64, height: 40 }} />
          <button type="submit" disabled={!quote.trim()} style={{ ...chip(), height: 40, borderRadius: 'var(--sb-r-sm)', opacity: quote.trim() ? 1 : 0.45 }}>Add quote</button>
        </form>
      )}
      {myQuotes.map(q => (
        <div key={q.id} data-outcome-quote={q.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)' }}>
          <span style={{ flex: 1, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{q.body}”{q.page ? ` · p. ${q.page}` : ''}</span>
          <button onClick={() => undoQuote(q.id)} style={chip()}>Undo</button>
        </div>
      ))}
    </div>
  )
}

// ─── Finding a book to put on the shelf ──────────────────────────────────────

function Finder({ event, onAdded, onStarted }: { event: OutcomeEvent; onAdded: (b: Book) => void; onStarted: (b: Book) => void }) {
  const books = useLibraryStore(s => s.books)
  const addBook = useLibraryStore(s => s.addBook)
  const updateBook = useLibraryStore(s => s.updateBook)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<BookCandidate[] | null>(null)
  const [failed, setFailed] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  const wants = q.trim()
  useEffect(() => {
    if (wants.length < 3) { setResults(null); setFailed([]); setBusy(false); return }
    const mine = ++seq.current
    const ctl = new AbortController()
    setBusy(true)
    const t = window.setTimeout(() => {
      lookupBooks(wants, ctl.signal, 5).then(r => {
        if (mine !== seq.current) return // a newer question has been asked
        setResults(r.candidates); setFailed(r.failed); setBusy(false)
      }).catch(() => { if (mine === seq.current) { setResults([]); setFailed(['the catalogues']); setBusy(false) } })
    }, 350)
    return () => { window.clearTimeout(t); ctl.abort() }
  }, [wants])

  function add(c: BookCandidate | null, status: 'want' | 'reading') {
    const base = c ? bookFromCandidate(c) : { title: wants, authors: [] as string[] }
    const made = addBook({ ...base, status, ...(status === 'reading' ? { startedOn: todayISO() } : {}) })
    onAdded(made)
    setQ(''); setResults(null)
  }

  function startOnShelf(b: Book) {
    // Handed back first, while the book still says what it was: that is what
    // Undo puts back, and what links the book to this meeting.
    onStarted(b)
    updateBook(b.id, { status: 'reading', startedOn: b.startedOn ?? todayISO() })
    setQ(''); setResults(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{
        height: 44, borderRadius: 'var(--sb-r-nav)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px',
        background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
      }}>
        <Search size={ICON.md} color="var(--sb-ink-3)" />
        <input aria-label="Find or add a book" value={q} onChange={e => setQ(e.target.value)} placeholder="Find or add another book…"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)' }} />
      </label>
      {busy && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Looking…</span>}
      {!busy && failed.length > 0 && (
        <span role="status" style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
          {failed.length >= 2 || failed[0] === 'the catalogues'
            ? 'Could not reach the book catalogues. You can still add it as typed.'
            : `${failed[0]} could not be reached; showing the other.`}
        </span>
      )}
      {(results ?? []).map((c, i) => {
        const own = shelfMatch(books, c)
        return (
          <div key={`${c.title}-${i}`} data-outcome-result style={{
            display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '6px 12px',
            border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-card)',
          }}>
            {c.coverUrl ? <img src={c.coverUrl} alt="" referrerPolicy="no-referrer" style={{ width: 28, height: 40, borderRadius: 4, objectFit: 'cover' }} /> : <span style={{ width: 28, height: 40 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
              <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{[c.authors.join(', '), c.publishedYear].filter(Boolean).join(' · ')}</div>
            </div>
            {own ? (
              <>
                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>On your shelf · {STATUS_WORDS[own.status]}</span>
                {own.status === 'want' && <button onClick={() => startOnShelf(own)} style={chip()}>Start reading</button>}
              </>
            ) : (
              <>
                <button onClick={() => add(c, 'want')} style={chip()}>Want to read</button>
                <button onClick={() => add(c, 'reading')} style={chip(true)}>Reading now</button>
              </>
            )}
          </div>
        )
      })}
      {!busy && results && results.length === 0 && wants.length >= 3 && (
        <button onClick={() => add(null, 'want')} style={{ ...chip(false, true), alignSelf: 'flex-start' }}>
          Add “{wants}” as typed — Want to read
        </button>
      )}
      <span hidden>{event.id}</span>
    </div>
  )
}

// ─── The box ─────────────────────────────────────────────────────────────────

function BooksInner({ event, open, onToggle }: { event: OutcomeEvent; open: boolean; onToggle: () => void }) {
  const books = useLibraryStore(s => s.books)
  const loading = useLibraryStore(s => s.loading)
  const missing = useLibraryStore(s => s.missing)
  const deleteBook = useLibraryStore(s => s.deleteBook)
  const quotesAll = useLibraryStore(s => s.quotes)

  const [, bump] = useState(0)
  useEffect(() => subscribeOutcomeLinks(() => bump(n => n + 1)), [])

  const bookLinks = linksForEvent(event.id, 'book')
  const quoteLinks = linksForEvent(event.id, 'quote')
  const linkedIds = new Set(bookLinks.map(l => l.recordId))

  const [changes, setChanges] = useState<Record<string, Changes>>({})
  const [madeHere, setMadeHere] = useState<Set<string>>(new Set())

  // One list, in an order that does not depend on what was just done: a row that
  // changed parent when its status changed would be remounted and drop focus.
  const rows = useMemo(() => {
    const here = books.filter(b => b.status === 'reading' || linkedIds.has(b.id))
    return here.sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, bookLinks.map(l => l.recordId).join(',')])

  const made = bookLinks.filter(l => l.role === 'made').length
  const pagesHere = Object.values(changes).reduce((n, c) => n + c.sessions.length, 0)
  const summary = loading ? 'Fetching your library…'
    : missing ? 'Not set up yet'
    : [
        `${books.filter(b => b.status === 'reading').length} reading`,
        made ? `${made} added here` : '',
        pagesHere ? `${pagesHere} ${pagesHere === 1 ? 'sitting' : 'sittings'} logged` : '',
        quoteLinks.length ? `${quoteLinks.length} ${quoteLinks.length === 1 ? 'quote' : 'quotes'}` : '',
      ].filter(Boolean).join(' · ')

  const setChange = (id: string) => (patch: (c: Changes) => Changes) =>
    setChanges(prev => ({ ...prev, [id]: patch(prev[id] ?? empty()) }))

  function added(b: Book) {
    addOutcomeLink({ eventId: event.id, eventTitle: event.title, eventDate: event.date, kind: 'book', recordId: b.id, role: 'made' })
    setMadeHere(prev => new Set(prev).add(b.id))
  }

  /** A book already on the shelf, started from here: remember what it was so
   *  Undo can put it back, and link it. */
  function started(b: Book) {
    setChange(b.id)(c => ({ ...c, before: c.before ?? { status: b.status, startedOn: b.startedOn, finishedOn: b.finishedOn } }))
    if (!linkedIds.has(b.id)) addOutcomeLink({ eventId: event.id, eventTitle: event.title, eventDate: event.date, kind: 'book', recordId: b.id, role: 'touched' })
  }

  function undoMade(b: Book) {
    // Taking the book away takes its quotes with it (the server cascades them),
    // so their links go too — the meeting must not list a quote that is gone.
    for (const q of quotesAll.filter(q => q.bookId === b.id)) removeOutcomeLink(event.id, 'quote', q.id)
    deleteBook(b.id)
    removeOutcomeLink(event.id, 'book', b.id)
    setMadeHere(prev => { const n = new Set(prev); n.delete(b.id); return n })
    setChanges(prev => { const n = { ...prev }; delete n[b.id]; return n })
  }

  return (
    <OutcomeBox id="books" icon={<BookOpen size={ICON.lg} />} title="Books" summary={summary} open={open} onToggle={onToggle} tint={TINT}>
      {loading ? (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Fetching your library…</p>
      ) : missing ? (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
          The Library is not set up on this account yet (its database migration has not run).
        </p>
      ) : (
        <>
          {rows.length > 0 && <p style={EYEBROW}>You are reading</p>}
          {rows.map(b => (
            <BookRow key={b.id} book={b} event={event}
              linkedHere={linkedIds.has(b.id)} madeHere={madeHere.has(b.id)}
              changes={changes[b.id] ?? empty()} onChanges={setChange(b.id)} onUndoMade={() => undoMade(b)} />
          ))}
          {rows.length === 0 && (
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
              Nothing is being read right now. Put the book from this meeting on the shelf below.
            </p>
          )}
          <Finder event={event} onAdded={added} onStarted={started} />
        </>
      )}
    </OutcomeBox>
  )
}

export function BooksBox(props: { event: OutcomeEvent; open: boolean; onToggle: () => void }) {
  // Two switches, either one turns it off, and an off Library is never loaded.
  if (libraryIsOff()) return null
  return <BooksInner {...props} />
}
