import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card } from '@/components/ui'
import { ICON } from '@/lib/type'
import { ArrowRight } from 'lucide-react'
import { Eyebrow } from './fields'
import { makeCloze } from './cloze'
import { useLibraryStore } from './libraryStore'
import { niceDay } from './planStats'
import { todayISO } from './readingStats'
import { buildQueue, GRADES, previews, SESSION_CAP } from './srs'
import type { Grade, Quote } from './types'

const LABEL: Record<Grade, string> = { again: 'Forgot', hard: 'Hard', good: 'Good', easy: 'Easy' }
const HINT: Record<Grade, string> = { again: 'Did not remember it', hard: 'Remembered with effort', good: 'Remembered it', easy: 'Knew it at once' }

/** A blank takes up roughly the room of the word it hides, so the sentence keeps its shape. */
function Blank({ word }: { word: string }) {
  return <span role="img" aria-label="hidden word" style={{ display: 'inline-block', minWidth: `${Math.max(3, word.length)}ch`, borderBottom: '2px solid var(--sb-ink-3)', margin: '0 1px', lineHeight: 1 }}>&nbsp;</span>
}

/**
 * Your quotes, asked back to you.
 *
 * A card is the quote with a few of its words hidden; you try to fill them in,
 * look, and say how it went. The next time it comes is the scheduler's (`srs`),
 * and each answer button says how long it would wait — so the choice is
 * between real things, not between labels.
 *
 * **A sitting is frozen when it starts**, not recomputed under you: answering a
 * card changes what is due, and a queue that rearranged itself mid-card would
 * show the same quote twice or skip one. A forgotten card is asked once more at
 * the end of the same sitting (and not again) — the scheduler already has it
 * coming back tomorrow.
 */
export function ReviewView({ onOpenBook }: { onOpenBook: (bookId: string) => void }) {
  const quotes = useLibraryStore(s => s.quotes)
  const books = useLibraryStore(s => s.books)
  const notes = useLibraryStore(s => s.notes)
  const reviews = useLibraryStore(s => s.reviews)
  const missing = useLibraryStore(s => s.reviewsMissing)
  const gradeQuote = useLibraryStore(s => s.gradeQuote)
  const today = todayISO()

  const q = useMemo(() => buildQueue(quotes, reviews, today), [quotes, reviews, today])
  const [session, setSession] = useState<string[] | null>(null)
  const [pos, setPos] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [tally, setTally] = useState<Record<Grade, number>>({ again: 0, hard: 0, good: 0, easy: 0 })
  const requeued = useRef(new Set<string>())
  const shown = useRef(new Map<string, number>())

  const total = session?.length ?? 0
  const cur: Quote | undefined = session ? quotes.find(x => x.id === session[pos]) : undefined
  const review = cur ? reviews.find(r => r.quoteId === cur.id) ?? null : null

  function start() {
    requeued.current = new Set(); shown.current = new Map()
    setTally({ again: 0, hard: 0, good: 0, easy: 0 }); setPos(0); setRevealed(false)
    setSession(q.session.map(x => x.id))
  }

  function answer(g: Grade) {
    if (!cur || !session) return
    gradeQuote(cur.id, g, today)
    setTally(t => ({ ...t, [g]: t[g] + 1 }))
    // Asked once more before the sitting ends, never twice.
    if (g === 'again' && !requeued.current.has(cur.id)) { requeued.current.add(cur.id); setSession(s => (s ? [...s, cur.id] : s)) }
    setPos(p => p + 1); setRevealed(false)
  }

  // A card whose quote was deleted (here or on another device) mid-sitting is skipped, not shown blank.
  useEffect(() => { if (session && pos < session.length && !cur) setPos(p => p + 1) }, [session, pos, cur])

  useEffect(() => {
    if (!session || !cur) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setRevealed(true) }
      else if (revealed && /^[1-4]$/.test(e.key)) { e.preventDefault(); answer(GRADES[Number(e.key) - 1]) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // `answer` closes over the card on screen; re-binding per card is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, cur, revealed, pos])

  const pieces = useMemo(() => {
    if (!cur?.body) return []
    const n = shown.current.get(cur.id) ?? 0
    shown.current.set(cur.id, n + 1)
    return makeCloze(cur.body, `${cur.id}:${review?.reps ?? 0}:${n}`)
    // A new draw per card shown, not per render: the blanks must not change when you reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, pos])

  if (missing) {
    return <Card style={{ padding: '20px 22px', maxWidth: 560 }}>Reviewing needs migration <code>20260034_library_quote_reviews.sql</code>.</Card>
  }

  // ── idle: what is waiting, and how to start ───────────────────────────────
  if (!session) {
    const withWords = quotes.filter(x => x.body && x.body.trim()).length
    return (
      <Card style={{ padding: '24px 26px', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Eyebrow>Review</Eyebrow>
        {withWords === 0 ? (
          <p style={{ margin: 0, color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>Save a quote with words in it and it can come back to you here, a little further apart each time you remember it.</p>
        ) : q.waiting === 0 ? (
          <>
            <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em' }}>Nothing to review today</div>
            <p style={{ margin: 0, color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
              {q.nextDue ? `The next one is due ${niceDay(q.nextDue)}.` : 'Every quote has had its turn for today.'}
            </p>
          </>
        ) : (
          <>
            <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em' }}>
              {q.waiting} quote{q.waiting === 1 ? '' : 's'} to review
            </div>
            <p style={{ margin: 0, color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
              {[q.due.length ? `${q.due.length} due` : '', q.fresh.length ? `${q.fresh.length} new` : ''].filter(Boolean).join(' · ')}
              {q.waiting > SESSION_CAP ? ` — ${SESSION_CAP} at a time.` : '.'} Some words are hidden: fill them in, look, and say how it went.
            </p>
            <div><Button variant="accent" onClick={start}>Start <ArrowRight size={ICON.sm} /></Button></div>
          </>
        )}
      </Card>
    )
  }

  // ── a sitting is over ─────────────────────────────────────────────────────
  if (pos >= total) {
    const n = tally.again + tally.hard + tally.good + tally.easy
    return (
      <Card style={{ padding: '24px 26px', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Eyebrow>Review</Eyebrow>
        <div role="status" style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em' }}>
          {n === 0 ? 'Nothing was answered' : `Reviewed ${n} card${n === 1 ? '' : 's'}`}
        </div>
        <p style={{ margin: 0, color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
          {n > 0 && `${tally.good + tally.easy} remembered · ${tally.hard} hard · ${tally.again} forgotten. `}
          {q.waiting > 0 ? `${q.waiting} more ${q.waiting === 1 ? 'is' : 'are'} waiting.` : q.nextDue ? `Next review ${niceDay(q.nextDue)}.` : ''}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {q.waiting > 0 && <Button variant="accent" onClick={start}>Review {Math.min(q.waiting, SESSION_CAP)} more</Button>}
          <Button variant="secondary" onClick={() => setSession(null)}>Done</Button>
        </div>
      </Card>
    )
  }

  if (!cur) return null
  const book = books.find(b => b.id === cur.bookId)
  const myNotes = notes.filter(n => n.quoteId === cur.id).slice(0, 2)
  const pv = previews(review)

  return (
    <Card style={{ padding: '22px 26px', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Eyebrow>Review</Eyebrow>
        <div role="progressbar" aria-label="Sitting progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={pos}
          style={{ flex: 1, height: 6, marginTop: -8, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-hairline)', overflow: 'hidden' }}>
          <div style={{ width: `${(pos / total) * 100}%`, height: '100%', background: 'var(--sb-accent)' }} />
        </div>
        <span style={{ marginTop: -8, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{pos + 1} of {total}</span>
      </div>

      {book && <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}><strong style={{ color: 'var(--sb-ink-2)' }}>{book.title}</strong>{book.authors[0] ? ` · ${book.authors[0]}` : ''}{cur.page ? ` · p. ${cur.page}` : ''}</div>}

      <blockquote dir="auto" aria-label={revealed ? 'The quote' : 'The quote, with some words hidden'} style={{
        margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', lineHeight: 1.6, letterSpacing: '-0.01em',
        color: 'var(--sb-ink-1)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
      }}>
        {pieces.map((p, i) => !p.blank ? <span key={i}>{p.text}</span>
          : revealed ? <mark key={i} style={{ background: 'var(--sb-accent-tint)', color: 'var(--sb-ink-1)', borderRadius: 4, padding: '0 3px' }}>{p.text}</mark>
          : <Blank key={i} word={p.text} />)}
      </blockquote>

      {!revealed ? (
        <div><Button variant="accent" onClick={() => setRevealed(true)}>Show the words <kbd style={{ fontSize: 11, opacity: 0.7, marginLeft: 4 }}>space</kbd></Button></div>
      ) : (
        <>
          {myNotes.length > 0 && (
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
              {myNotes.map(n => <div key={n.id}>“{n.body.length > 160 ? `${n.body.slice(0, 160)}…` : n.body}”</div>)}
            </div>
          )}
          <div role="group" aria-label="How did it go?" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            {GRADES.map((g, i) => (
              <Button key={g} variant={g === 'good' ? 'accent' : 'secondary'} onClick={() => answer(g)} title={`${HINT[g]} (${i + 1})`}
                aria-label={`${LABEL[g]} — ${HINT[g]}; see it again in ${pv[g]}`} style={{ flexDirection: 'column', height: 'auto', padding: '8px 6px', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{LABEL[g]}</span>
                <span style={{ fontSize: 'var(--sb-t-meta)', opacity: 0.8 }}>{pv[g]}</span>
              </Button>
            ))}
          </div>
          {book && <div><Button size="sm" variant="ghost" onClick={() => onOpenBook(book.id)}>Open the book</Button></div>}
        </>
      )}
    </Card>
  )
}
