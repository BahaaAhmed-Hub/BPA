import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ScanBarcode, Search } from 'lucide-react'
import { Button, Segmented } from '@/components/ui'
import { ICON } from '@/lib/type'
import { booksByAuthor, lookupBooks, searchAuthors, shelfMatch, type AuthorHit, type BookCandidate } from './bookLookup'
import { bookFromCandidate } from './applyCandidate'
import { FollowingView } from './FollowingView'
import { authorQuery, snapshotKeys } from './followCheck'
import { ResultCard } from './ResultCard'
import { inputStyle } from './fieldStyle'
import { ScanIsbnDialog } from './ScanIsbnDialog'
import { useLibraryStore } from './libraryStore'

type Mode = 'books' | 'authors' | 'following'


/**
 * Find a book you do not have yet — by title, or by an author and everything
 * they wrote — and put it on the shelf as *want to read*.
 *
 * Two modes because they are two questions. **Books** is the same Open Library +
 * Google Books search the Add dialog uses. **Authors** asks Open Library for the
 * author *as a person* (it has keys; a book only has a name string), then lists
 * their works — so “their other books” is exactly their books, not whoever shares
 * the name.
 *
 * A result that is already on the shelf says so and opens it rather than adding
 * a second copy.
 */
export function DiscoverView({ onOpenBook, onAddByHand }: { onOpenBook: (id: string) => void; onAddByHand: (isbn: string) => void }) {
  const books = useLibraryStore(s => s.books)
  const addBook = useLibraryStore(s => s.addBook)
  const [mode, setMode] = useState<Mode>('books')
  const [term, setTerm] = useState('')
  const [author, setAuthor] = useState<AuthorHit | null>(null)
  const [found, setFound] = useState<BookCandidate[]>([])
  const [authors, setAuthors] = useState<AuthorHit[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [scanning, setScanning] = useState(false)
  const follows = useLibraryStore(s => s.follows)
  const addFollow = useLibraryStore(s => s.addFollow)
  const [followBusy, setFollowBusy] = useState(false)
  const [followNote, setFollowNote] = useState<string | null>(null)
  const run = useRef(0)

  const q = term.trim()
  // What is being asked for: an author's works, or a search in the current mode.
  const wants = author ? `works:${author.key}` : mode !== 'following' && q.length >= 2 ? `${mode}:${q}` : ''

  useEffect(() => {
    if (!wants) return
    const mine = ++run.current
    const ctl = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        if (author) {
          const r = await booksByAuthor(author.key, ctl.signal)
          if (mine === run.current) { setFound(r); setFailed([]); setState('done') }
        } else if (mode === 'books') {
          const r = await lookupBooks(q, ctl.signal, 24)
          if (mine === run.current) { setFound(r.candidates); setFailed(r.failed); setState('done') }
        } else {
          const r = await searchAuthors(q, ctl.signal)
          if (mine === run.current) { setAuthors(r); setFailed([]); setState('done') }
        }
      } catch {
        if (mine === run.current) { setFound([]); setAuthors([]); setFailed(['Open Library']); setState('done') }
      }
    }, author ? 0 : 450)
    return () => { clearTimeout(t); ctl.abort() }
    // `wants` is the whole of what the request depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wants])

  // State that follows a keystroke is set in the handler, not the effect: the
  // effect only schedules the request.
  function change(v: string) {
    setTerm(v); setAuthor(null)
    if (v.trim().length < 2) { run.current++; setFound([]); setAuthors([]); setFailed([]); setState('idle') } else setState('busy')
  }
  function switchMode(m: Mode) {
    setMode(m); setAuthor(null); setFound([]); setAuthors([]); setFailed([])
    setState(q.length >= 2 ? 'busy' : 'idle')
  }
  function openAuthor(a: AuthorHit) { setAuthor(a); setFound([]); setFailed([]); setState('busy') }
  function back() { setAuthor(null); setFound([]); setState(q.length >= 2 ? 'busy' : 'idle') }

  const add = (c: BookCandidate, toBuy?: boolean) => addBook({ ...bookFromCandidate(c), ...(toBuy ? { toBuy: true } : {}) })

  const showBooks = mode === 'books' || !!author
  const allDown = state === 'done' && failed.length >= (author || mode === 'authors' ? 1 : 2)

  const modes = <Segmented value={mode} onChange={switchMode} options={[{ value: 'books', label: 'Books' }, { value: 'authors', label: 'Authors' }, { value: 'following', label: 'Following' }]} />
  const followed = author ? follows.find(f => f.authorKey === author.key) : undefined

  // Follow = snapshot first. A snapshot that failed would be an empty set, and an
  // empty set makes every book they ever wrote "new" — so nothing is followed
  // until it has been read.
  async function followAuthor(a: AuthorHit) {
    const query = authorQuery(a.key)
    if (!query) return
    setFollowBusy(true); setFollowNote(null)
    try {
      addFollow({ kind: 'author', name: a.name, query, authorKey: a.key, seenKeys: await snapshotKeys(query) })
    } catch { setFollowNote('Could not read their books just now, so nothing was followed. Try again in a moment.') }
    finally { setFollowBusy(false) }
  }

  if (mode === 'following') {
    return (
      <div style={{ paddingTop: 12 }}>
        {modes}
        <FollowingView onOpenBook={onOpenBook} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {modes}
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 440 }}>
          <Search size={ICON.md} color="var(--sb-ink-4)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={term} onChange={e => change(e.target.value)} aria-label="Search online"
            placeholder={mode === 'books' ? 'A title, an author or an ISBN' : 'An author’s name'} style={{ ...inputStyle, paddingLeft: 32 }} />
        </div>
        <Button variant="secondary" onClick={() => setScanning(true)} title="Scan a book’s barcode"><ScanBarcode size={ICON.md} /> Scan ISBN</Button>
      </div>

      {author && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button variant="ghost" size="sm" onClick={back}><ArrowLeft size={ICON.sm} /> Authors</Button>
          <h2 style={{ margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>{author.name}</h2>
          {author.workCount ? <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>{author.workCount} works</span> : null}
          <span style={{ flex: 1 }} />
          {followed ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-positive)' }}><Check size={ICON.sm} /> Following</span>
          ) : (
            <Button size="sm" variant="accent" disabled={followBusy} onClick={() => void followAuthor(author)} aria-label={`Follow ${author.name}`}>{followBusy ? 'Reading…' : 'Follow'}</Button>
          )}
        </div>
      )}
      {author && followNote && (
        <div role="alert" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{followNote}</div>
      )}

      <div aria-live="polite" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', minHeight: 18 }}>
        {state === 'idle' && 'Search the world’s catalogues — Open Library and Google Books — for a book you want to read.'}
        {state === 'busy' && 'Searching…'}
        {state === 'done' && allDown && 'Could not reach the book catalogues just now. Check your connection and try again.'}
        {state === 'done' && !allDown && failed.length === 1 && `${failed[0]} could not be reached; showing the other.`}
        {state === 'done' && !allDown && showBooks && found.length === 0 && 'Nothing found — check the spelling.'}
        {state === 'done' && !allDown && !showBooks && authors.length === 0 && 'No author by that name.'}
      </div>

      {showBooks ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          {found.map((c, i) => {
            const mine = shelfMatch(books, c)
            return <ResultCard key={`${c.source}-${c.sourceKey ?? i}`} c={c} onShelfId={mine?.id} onAdd={() => add(c)} onBuy={() => add(c, true)} onOpen={onOpenBook} />
          })}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 560 }}>
          {authors.map(a => (
            <li key={a.key}>
              <button type="button" onClick={() => openAuthor(a)} style={{
                width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: '10px 14px', minHeight: 52,
                borderRadius: 'var(--sb-r-nav)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', color: 'var(--sb-ink-1)',
              }}>
                <span style={{ display: 'block', fontWeight: 600 }}>{a.name}</span>
                <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
                  {[a.topWork && `Best known for “${a.topWork}”`, a.workCount && `${a.workCount} works`, a.born && `born ${a.born}`].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {scanning && <ScanIsbnDialog onClose={() => setScanning(false)} onOpenBook={onOpenBook} onAddByHand={onAddByHand} />}
    </div>
  )
}
