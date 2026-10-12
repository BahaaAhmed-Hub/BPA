import { useEffect, useState } from 'react'
import { Check, Play, Square, Trash2 } from 'lucide-react'
import { Button, Card, Segmented } from '@/components/ui'
import { ICON } from '@/lib/type'
import { Eyebrow, Field } from './fields'
import { inputStyle } from './fieldStyle'
import { useLibraryStore } from './libraryStore'
import { fmtMinutes, pagesCovered, progressOf, todayISO } from './readingStats'
import { discardTimer, elapsedMinutes, startTimer, stopTimer, useTimer } from './readingTimer'
import type { Book, SessionKind } from './types'

const KINDS: { value: SessionKind; label: string }[] = [{ value: 'read', label: 'Reading' }, { value: 'listen', label: 'Listening' }]

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`
}

/**
 * How far you are, and a place to say you read today.
 *
 * Two ways to log: a **stopwatch** (Start, Stop — the form then opens with the
 * time filled in, to correct) or **by hand** for a sitting that was not timed.
 * Either ends in the same form, because the number worth keeping is the one the
 * person agrees with, not the one the clock produced.
 *
 * Progress is the furthest page any session reached (`progressOf`) — derived, so
 * deleting a mistaken session puts it back. Reaching the last page offers
 * *Mark finished* and does not do it: finishing a book is the reader's call, and
 * a page count in a catalogue is often not the book in their hands.
 */
export function ReadingLogCard({ book, disabled }: { book: Book; disabled?: boolean }) {
  const all = useLibraryStore(s => s.sessions)
  const addSession = useLibraryStore(s => s.addSession)
  const deleteSession = useLibraryStore(s => s.deleteSession)
  const updateBook = useLibraryStore(s => s.updateBook)
  const books = useLibraryStore(s => s.books)
  const timer = useTimer()
  const mine = all.filter(s => s.bookId === book.id)
  const prog = progressOf(book, mine)

  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<SessionKind>('read')
  const [minutes, setMinutes] = useState('')
  const [on, setOn] = useState(todayISO)
  const [toPage, setToPage] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const mineRunning = timer?.bookId === book.id ? timer : null
  const elsewhere = timer && timer.bookId !== book.id ? books.find(b => b.id === timer.bookId) : undefined
  // One tick a second, only while this card's timer is the one running.
  useEffect(() => {
    if (!mineRunning) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [mineRunning])

  function openForm(init?: { kind: SessionKind; minutes: number; on: string }) {
    setKind(init?.kind ?? 'read'); setMinutes(init ? String(init.minutes) : ''); setOn(init?.on ?? todayISO())
    setToPage(''); setErr(null); setOpen(true)
  }
  function stop() {
    const r = stopTimer()
    if (r) openForm({ kind: r.kind, minutes: r.minutes, on: todayISO(new Date(r.startedAt)) })
  }

  function save() {
    const m = parseInt(minutes, 10)
    if (!Number.isFinite(m) || m < 1 || m > 1440) { setErr('How many minutes? Between 1 and 1440.'); return }
    if (on > todayISO()) { setErr('That day has not happened yet.'); return }
    let to: number | undefined
    if (kind === 'read' && toPage.trim()) {
      to = parseInt(toPage, 10)
      if (!Number.isFinite(to) || to < 0) { setErr('Which page did you reach?'); return }
      if (book.pages && to > book.pages) { setErr(`This book has ${book.pages} pages — fix the page count above if that is wrong.`); return }
    }
    addSession({ bookId: book.id, kind, on, minutes: m, ...(to !== undefined ? { toPage: to, pages: pagesCovered(prog.page, to) } : {}) })
    setOpen(false)
  }

  const atEnd = !!book.pages && prog.page !== null && prog.page >= book.pages && book.status !== 'finished'
  const recent = mine.slice(0, 5)

  return (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Eyebrow>Progress</Eyebrow>

      {prog.page !== null || prog.sessions > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {prog.pct !== null && (
            <div role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prog.pct}
              style={{ height: 8, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-hairline)', overflow: 'hidden' }}>
              <div style={{ width: `${prog.pct}%`, height: '100%', background: 'var(--sb-accent)' }} />
            </div>
          )}
          <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>
            {prog.page !== null ? `Page ${prog.page}${book.pages ? ` of ${book.pages}` : ''}${prog.pct !== null ? ` · ${prog.pct}%` : ''}` : 'No page recorded yet'}
          </div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            {[prog.readMinutes ? `${fmtMinutes(prog.readMinutes)} reading` : '', prog.listenMinutes ? `${fmtMinutes(prog.listenMinutes)} listening` : '', `${prog.sessions} session${prog.sessions === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>No sessions yet. Start the timer when you sit down with it, or log one after.</div>
      )}

      {atEnd && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>
          You have reached the last page.
          <Button size="sm" variant="secondary" onClick={() => updateBook(book.id, { status: 'finished', finishedOn: todayISO() })}><Check size={ICON.sm} /> Mark finished</Button>
        </div>
      )}

      {disabled ? (
        <div role="status" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-accent-deep)' }}>
          Logging needs migration <code>20260030_library_sessions.sql</code>.
        </div>
      ) : mineRunning ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span aria-live="off" aria-label="Time so far" style={{ fontFamily: 'var(--sb-font-num)', fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--sb-ink-1)' }}>
            {clock(Math.max(now, mineRunning.startedAt) - mineRunning.startedAt)}
          </span>
          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{mineRunning.kind === 'listen' ? 'listening' : 'reading'} · {fmtMinutes(elapsedMinutes(mineRunning, Math.max(now, mineRunning.startedAt)))}</span>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" onClick={stop}><Square size={ICON.sm} /> Stop</Button>
          <Button size="sm" variant="ghost" onClick={discardTimer}>Discard</Button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="accent" disabled={!!elsewhere} onClick={() => startTimer(book.id, book.format === 'audio' ? 'listen' : 'read')}><Play size={ICON.sm} /> Start timer</Button>
          <Button size="sm" variant="secondary" onClick={() => (open ? setOpen(false) : openForm())} aria-expanded={open}>Log a session</Button>
        </div>
      )}
      {elsewhere && !disabled && !mineRunning && (
        <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>The timer is running for “{elsewhere.title}” — stop it there first.</div>
      )}

      {open && !disabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
          <Segmented value={kind} onChange={setKind} options={KINDS} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Field label="Minutes"><input value={minutes} inputMode="numeric" aria-label="Minutes" onChange={e => { setMinutes(e.target.value); setErr(null) }} style={inputStyle} /></Field>
            <Field label="Day"><input type="date" value={on} max={todayISO()} aria-label="Day" onChange={e => { setOn(e.target.value); setErr(null) }} style={inputStyle} /></Field>
            {kind === 'read' && (
              <Field label="Now on page"><input value={toPage} inputMode="numeric" aria-label="Now on page" placeholder={prog.page !== null ? String(prog.page) : ''} onChange={e => { setToPage(e.target.value); setErr(null) }} style={inputStyle} /></Field>
            )}
          </div>
          {err && <div role="alert" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" variant="accent" onClick={save}>Save session</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {recent.map(s => (
            <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                {new Date(s.on + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · {fmtMinutes(s.minutes)}{s.kind === 'listen' ? ' listening' : ''}
                {s.toPage !== undefined ? ` · to p. ${s.toPage}${s.pages ? ` (+${s.pages})` : ''}` : ''}
              </span>
              <Button size="sm" variant="ghost" iconOnly title="Delete this session" aria-label={`Delete the session on ${s.on}`} onClick={() => deleteSession(s.id)}><Trash2 size={ICON.sm} /></Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
