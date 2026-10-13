import { useMemo, useState } from 'react'
import { Card, Segmented } from '@/components/ui'
import { Eyebrow } from './fields'
import { useLibraryStore } from './libraryStore'
import { niceDay, planSentence, planStatus, STATE_INK, STATE_LABEL } from './planStats'
import { fmtMinutes, todayISO } from './readingStats'
import { addDays, byDay, dayRange, finishedIn, periodTotals, streaks, total, weekBuckets, weekStart, type Minutes } from './trackerStats'
import type { ReadingSession } from './types'

type Kind = 'all' | 'read' | 'listen'
type Span = 'week' | 'weeks'

const KINDS: { value: Kind; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'read', label: 'Reading' }, { value: 'listen', label: 'Listening' }]
const SPANS: { value: Span; label: string }[] = [{ value: 'week', label: 'This week' }, { value: 'weeks', label: '12 weeks' }]

const shown = (m: Minutes, k: Kind) => (k === 'read' ? m.read : k === 'listen' ? m.listen : total(m))

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 26, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--sb-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{sub}</div>}
    </Card>
  )
}

/** One column per day (or per week): reading in the accent, listening beside it,
 *  and the figure printed on the bar — a bar you must hover to read cannot be
 *  compared with the one beside it. */
function Bars({ cols, kind }: { cols: { key: string; label: string; sub?: string; m: Minutes; now?: boolean }[]; kind: Kind }) {
  const max = Math.max(1, ...cols.map(c => shown(c.m, kind)))
  return (
    <div role="list" aria-label="Time by day" style={{ display: 'flex', gap: cols.length > 7 ? 6 : 10, alignItems: 'flex-end', height: 190 }}>
      {cols.map(c => {
        const v = shown(c.m, kind)
        const pctRead = v ? (kind === 'listen' ? 0 : (c.m.read / v) * 100) : 0
        const label = `${c.sub ?? c.label}: ${v ? [kind !== 'listen' && c.m.read ? `${fmtMinutes(c.m.read)} reading` : '', kind !== 'read' && c.m.listen ? `${fmtMinutes(c.m.listen)} listening` : ''].filter(Boolean).join(', ') : 'nothing'}`
        return (
          <div key={c.key} role="listitem" aria-label={label} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', fontVariantNumeric: 'tabular-nums', minHeight: 16, whiteSpace: 'nowrap' }}>{v ? fmtMinutes(v) : ''}</div>
            <div aria-hidden style={{ width: '100%', maxWidth: 56, height: `${(v / max) * 120}px`, minHeight: v ? 4 : 2, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderRadius: 'var(--sb-r-chip)', overflow: 'hidden', background: v ? 'transparent' : 'var(--sb-hairline)' }}>
              {v > 0 && kind !== 'read' && <div style={{ flex: `0 0 ${100 - pctRead}%`, background: 'var(--sb-info)' }} />}
              {v > 0 && kind !== 'listen' && <div style={{ flex: `0 0 ${pctRead}%`, background: 'var(--sb-accent)' }} />}
            </div>
            <div style={{ fontSize: 'var(--sb-t-meta)', fontWeight: c.now ? 700 : 500, color: c.now ? 'var(--sb-ink-1)' : 'var(--sb-ink-3)' }}>{c.label}</div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Everything you have read and listened to, across the shelf: a streak, this
 * week against last, a bar for each day or week, and the latest sittings.
 *
 * Every figure comes from `trackerStats` over the same session log the book
 * panels write, so a number here and the same number on a book cannot disagree.
 */
export function TrackerView({ onOpenBook }: { onOpenBook: (id: string) => void }) {
  const sessions = useLibraryStore(s => s.sessions)
  const books = useLibraryStore(s => s.books)
  const missing = useLibraryStore(s => s.sessionsMissing)
  const plans = useLibraryStore(s => s.plans)
  const [kind, setKind] = useState<Kind>('all')
  const [span, setSpan] = useState<Span>('week')
  const today = todayISO()

  const t = useMemo(() => {
    const ws = weekStart(today), lastWs = addDays(ws, -7)
    const days = byDay(sessions)
    const week = periodTotals(sessions, ws, addDays(ws, 6))
    const prev = periodTotals(sessions, lastWs, addDays(lastWs, 6))
    return {
      streak: streaks(sessions, today), week, prev,
      cols: dayRange(ws, 7).map(d => ({ key: d, label: new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' }), sub: new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }), m: days.get(d) ?? { read: 0, listen: 0 }, now: d === today })),
      weeks: weekBuckets(sessions, today, 12).map(b => ({ key: b.start, label: b.label, sub: `Week of ${b.label}`, m: b, now: b.start === ws })),
    }
  }, [sessions, today])

  const byId = new Map(books.map(b => [b.id, b]))
  const recent: ReadingSession[] = sessions.filter(s => kind === 'all' || s.kind === kind).slice(0, 12)
  const delta = total(t.week) - total(t.prev)
  // A finished book's plan is history, not a thing to act on: only the live ones are listed.
  const plannedBooks = plans.flatMap(plan => {
    const book = byId.get(plan.bookId)
    if (!book) return []
    const st = planStatus(book, sessions, plan, today)
    return st.state === 'done' ? [] : [{ book, plan, st }]
  })

  if (missing) {
    return <Card style={{ padding: '20px 22px', maxWidth: 560, marginTop: 12 }}>The tracker needs migration <code>20260030_library_sessions.sql</code>. Once it has run, reload.</Card>
  }
  if (sessions.length === 0) {
    return (
      <Card style={{ padding: '26px 24px', maxWidth: 520, marginTop: 12 }}>
        <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>Nothing logged yet</div>
        <p style={{ margin: 0, color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>Open a book and start the timer when you sit down with it, or log a session after. Your week, your streak and your pace gather here.</p>
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 12, maxWidth: 900 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <Tile label="Streak" value={`${t.streak.current} day${t.streak.current === 1 ? '' : 's'}`}
          sub={t.streak.today ? `Done today · longest ${t.streak.longest}` : t.streak.current ? `Not yet today · longest ${t.streak.longest}` : `Longest ${t.streak.longest}`} />
        <Tile label="This week" value={fmtMinutes(total(t.week))}
          sub={delta === 0 ? 'The same as last week' : `${fmtMinutes(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} than last week`} />
        <Tile label="Pages this week" value={String(t.week.pages)} sub={t.week.sessions ? `${t.week.sessions} session${t.week.sessions === 1 ? '' : 's'}` : 'No sessions yet'} />
        <Tile label={`Finished in ${today.slice(0, 4)}`} value={String(finishedIn(books, Number(today.slice(0, 4))))} sub="books" />
      </div>

      <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Segmented value={span} onChange={setSpan} options={SPANS} />
          <Segmented value={kind} onChange={setKind} options={KINDS} />
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            <span><span aria-hidden style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: 'var(--sb-accent)', marginRight: 5 }} />Reading</span>
            <span><span aria-hidden style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: 'var(--sb-info)', marginRight: 5 }} />Listening</span>
          </span>
        </div>
        <Bars cols={span === 'week' ? t.cols : t.weeks} kind={kind} />
      </Card>

      {plannedBooks.length > 0 && (
        <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Eyebrow>Plans</Eyebrow>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {plannedBooks.map(({ book, plan, st }) => (
              <li key={plan.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', padding: '8px 0', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)', fontSize: 'var(--sb-t-body-s)' }}>
                <button type="button" onClick={() => onOpenBook(book.id)} style={{ all: 'unset', cursor: 'pointer', flex: '1 1 160px', minWidth: 0, fontWeight: 600, color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.title}</button>
                <span style={{ fontWeight: 600, color: STATE_INK[st.state] }}>{STATE_LABEL[st.state]}{plan.finishBy && st.state !== 'done' ? ` · by ${niceDay(plan.finishBy)}` : ''}</span>
                <span style={{ flex: '1 1 100%', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-meta)' }}>{planSentence(st)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Eyebrow>Latest sessions</Eyebrow>
        {recent.length === 0 ? <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>None of that kind yet.</div> : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {recent.map(s => {
              const b = byId.get(s.bookId)
              return (
                <li key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 0', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>
                  <span style={{ width: 92, flexShrink: 0, color: 'var(--sb-ink-3)' }}>{new Date(s.on + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  {b ? <button type="button" onClick={() => onOpenBook(b.id)} style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0, fontWeight: 600, color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</button> : <span style={{ flex: 1 }}>A deleted book</span>}
                  <span style={{ flexShrink: 0 }}>{fmtMinutes(s.minutes)}{s.kind === 'listen' ? ' listening' : ''}{s.pages ? ` · ${s.pages} p.` : ''}</span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
