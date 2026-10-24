import { useEffect, useRef, useState } from 'react'
import { BookMarked, Plus, Trash2, UserRound } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { ICON } from '@/lib/type'
import { bookFromCandidate } from './applyCandidate'
import type { BookCandidate } from './bookLookup'
import { inputStyle } from './fieldStyle'
import { newReleases, releasesOf, seriesQuery, snapshotKeys, workKey } from './followCheck'
import { useLibraryStore } from './libraryStore'
import { ResultCard } from './ResultCard'
import { checkedAgo } from './priceWatch'
import type { Follow, FollowNews } from './types'

type Check = { s: 'busy' } | { s: 'failed' } | { s: 'ok'; found: BookCandidate[]; at: number }
/** Asked again after this long, not on every visit: following is a once-a-day
 *  glance, and the catalogue is someone else's server. Module scope, so it
 *  survives switching tabs inside the Library. */
const FRESH_MS = 30 * 60_000
const cache = new Map<string, { found: BookCandidate[]; at: number; query: string }>()
const CONCURRENT = 4

/** A release the scheduled check found, drawn as the same card a live result gets. */
const fromNews = (n: FollowNews): BookCandidate => ({
  title: n.title, authors: n.authors, isbn: n.isbn, publishedYear: n.publishedYear, coverUrl: n.coverUrl, source: 'openlibrary', sourceKey: n.workKey,
})

/**
 * Authors and series you follow, and what is new from each.
 *
 * Two things look: this view, when it is open, and a scheduled function once a
 * day while the app is closed (`library-follow-check`), whose findings wait in
 * `library_follow_news`. They answer the same question with the same rules, so
 * the card shows the union — what the live check found and what was found
 * overnight — and the overnight rows alone while the live one is still reading
 * or has failed. Failure is per follow: one author's lookup failing says so on
 * that card and the others still answer.
 */
export function FollowingView({ onOpenBook }: { onOpenBook: (id: string) => void }) {
  const follows = useLibraryStore(s => s.follows)
  const missing = useLibraryStore(s => s.followsMissing)
  const books = useLibraryStore(s => s.books)
  const addBook = useLibraryStore(s => s.addBook)
  const addFollow = useLibraryStore(s => s.addFollow)
  const markSeen = useLibraryStore(s => s.markSeen)
  const unfollow = useLibraryStore(s => s.unfollow)
  const news = useLibraryStore(s => s.news)
  const readNews = useLibraryStore(s => s.readNews)
  const [checks, setChecks] = useState<Record<string, Check>>({})
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [by, setBy] = useState('')
  const [formNote, setFormNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const ctl = useRef<AbortController | null>(null)

  const ids = follows.map(f => `${f.id}|${f.query}`).join(',')
  useEffect(() => {
    const ac = new AbortController(); ctl.current = ac
    const todo = useLibraryStore.getState().follows
    let next = 0
    const run = async () => {
      while (next < todo.length && !ac.signal.aborted) {
        const f = todo[next++]
        const hit = cache.get(f.id)
        if (hit && hit.query === f.query && Date.now() - hit.at < FRESH_MS) { setChecks(c => ({ ...c, [f.id]: { s: 'ok', found: hit.found, at: hit.at } })); continue }
        setChecks(c => ({ ...c, [f.id]: { s: 'busy' } }))
        try {
          const found = await releasesOf(f.query, 40, ac.signal)
          if (ac.signal.aborted) return
          cache.set(f.id, { found, at: Date.now(), query: f.query })
          setChecks(c => ({ ...c, [f.id]: { s: 'ok', found, at: Date.now() } }))
        } catch { if (!ac.signal.aborted) setChecks(c => ({ ...c, [f.id]: { s: 'failed' } })) }
      }
    }
    for (let i = 0; i < Math.min(CONCURRENT, todo.length); i++) void run()
    return () => ac.abort()
    // The follows' identities and queries are the whole input; their seen-sets
    // change on "mark seen" and must not re-ask the catalogue.
  }, [ids])

  // Looking at this page is reading the overnight finds: let the bell go of them once they have had a moment on screen.
  const unread = news.filter(n => !n.readAt).map(n => n.id).join(',')
  useEffect(() => {
    if (!unread) return
    const t = setTimeout(() => readNews(unread.split(',')), 1500)
    return () => clearTimeout(t)
  }, [unread, readNews])

  const authors = follows.filter(f => f.kind === 'author' && f.authorKey)

  async function followSeries() {
    const authorKey = authors.find(a => a.id === by)?.authorKey
    const query = seriesQuery(name, authorKey)
    if (!query) { setFormNote('Give the series a name.'); return }
    if (follows.some(f => f.query === query)) { setFormNote('You already follow that.'); return }
    setSaving(true); setFormNote(null)
    try {
      const keys = await snapshotKeys(query)
      addFollow({ kind: 'series', name: name.trim(), query, authorKey, seenKeys: keys })
      setName(''); setBy(''); setFormOpen(false)
    } catch {
      setFormNote('Could not read that series from Open Library just now, so nothing was followed. Try again in a moment.')
    } finally { setSaving(false) }
  }

  if (missing) {
    return <Card style={{ padding: '20px 22px', maxWidth: 560, marginTop: 12 }}>Following needs migration <code>20260029_library_follows.sql</code>. Once it has run, reload.</Card>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12, maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
          What’s new from the authors and series you follow — checked when you open this page, and once a day while the app is closed.
        </div>
        <Button variant="secondary" size="sm" onClick={() => setFormOpen(o => !o)} aria-expanded={formOpen}><Plus size={ICON.sm} /> Follow a series</Button>
      </div>

      {formOpen && (
        <Card style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={name} onChange={e => { setName(e.target.value); setFormNote(null) }} aria-label="Series name" placeholder="The series’ name, e.g. The Expanse"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void followSeries() } }} style={{ ...inputStyle, flex: '1 1 220px' }} />
            {authors.length > 0 && (
              <select value={by} onChange={e => setBy(e.target.value)} aria-label="Only by an author you follow" style={{ ...inputStyle, flex: '0 1 220px', width: 'auto' }}>
                <option value="">By anyone</option>
                {authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <Button variant="accent" disabled={saving || name.trim().length < 2} onClick={() => void followSeries()}>{saving ? 'Reading…' : 'Follow'}</Button>
          </div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
            Series are matched by name in Open Library’s catalogue, which has no reliable series field — so look over what turns up. Narrowing it to an author you follow keeps it honest.
          </div>
          {formNote && <div role="alert" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{formNote}</div>}
        </Card>
      )}

      {follows.length === 0 ? (
        <Card style={{ padding: '26px 24px', maxWidth: 520 }}>
          <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>Nobody followed yet</div>
          <p style={{ margin: 0, color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
            Find an author under Discover → Authors and tap Follow — new books from them will turn up here. Or follow a series above.
          </p>
        </Card>
      ) : follows.map((f: Follow) => {
        const c = checks[f.id]
        const live = c?.s === 'ok' ? newReleases(f, c.found, books) : []
        // The overnight finds that the live check has not (yet) said: still new, not seen, not on the shelf.
        const liveKeys = new Set(live.map(workKey))
        const overnight = newReleases(f, news.filter(n => n.followId === f.id).map(fromNews), books).filter(b => !liveKeys.has(workKey(b)))
        const fresh = [...live, ...overnight]
        const settled = c?.s === 'ok' || c?.s === 'failed'
        return (
          <Card key={f.id} style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {f.kind === 'author' ? <UserRound size={ICON.md} color="var(--sb-ink-3)" aria-hidden /> : <BookMarked size={ICON.md} color="var(--sb-ink-3)" aria-hidden />}
              <div style={{ fontWeight: 600, color: 'var(--sb-ink-1)' }}>{f.name}</div>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{f.kind === 'author' ? 'Author' : 'Series'}</span>
              {fresh.length > 0 && (
                <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-accent-tint)', color: 'var(--sb-accent-deep)' }}>
                  {fresh.length} new
                </span>
              )}
              <span style={{ flex: 1 }} />
              {fresh.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => markSeen(f.id, [...(c?.s === 'ok' ? c.found.map(workKey) : []), ...fresh.map(workKey)])}>Mark all seen</Button>
              )}
              <Button size="sm" variant="ghost" iconOnly title={`Unfollow ${f.name}`} aria-label={`Unfollow ${f.name}`} onClick={() => unfollow(f.id)}><Trash2 size={ICON.sm} /></Button>
            </div>
            {(!c || c.s === 'busy') && fresh.length === 0 && <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Checking…</div>}
            {c?.s === 'failed' && <div role="alert" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>Could not check {f.name} just now — Open Library did not answer.</div>}
            {c?.s === 'ok' && fresh.length === 0 && <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Nothing new since you followed.</div>}
            {settled && f.lastCheckedAt && (
              <div style={{ fontSize: 'var(--sb-t-meta)', color: f.lastCheckOk === false ? 'var(--sb-accent-deep)' : 'var(--sb-ink-3)' }}>
                {f.lastCheckOk === false ? `The overnight check could not reach Open Library (${checkedAgo(f.lastCheckedAt)}).` : `Also checked overnight, ${checkedAgo(f.lastCheckedAt)}.`}
              </div>
            )}
            {fresh.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                {fresh.map((b, i) => (
                  <ResultCard key={`${workKey(b)}-${i}`} c={b} onOpen={onOpenBook}
                    onAdd={() => addBook(bookFromCandidate(b))} onBuy={() => addBook({ ...bookFromCandidate(b), toBuy: true })} />
                ))}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
