import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Plus, Search, ShoppingCart } from 'lucide-react'
import { Button, Card, Segmented } from '@/components/ui'
import { ICON } from '@/lib/type'
import { booksByAuthor, lookupBooks, searchAuthors, shelfMatch, type AuthorHit, type BookCandidate } from './bookLookup'
import { CoverArt } from './CoverArt'
import { inputStyle } from './fieldStyle'
import { useLibraryStore } from './libraryStore'

type Mode = 'books' | 'authors'
const SOURCE_NAME = { openlibrary: 'Open Library', google: 'Google Books', manual: '' } as const

/** A search result drawn as a book would be, so the cover is the same object. */
function ResultCard({ c, onShelfId, onAdd, onBuy, onOpen }: { c: BookCandidate; onShelfId?: string; onAdd: () => void; onBuy: () => void; onOpen: (id: string) => void }) {
  return (
    <Card style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <CoverArt book={{ id: c.sourceKey ?? c.title, title: c.title, authors: c.authors, coverUrl: c.coverUrl }} />
      <div style={{ minWidth: 0 }}>
        <div title={c.title} style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', lineHeight: 1.3,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.title}</div>
        <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[c.authors[0], c.publishedYear].filter(Boolean).join(' · ') || SOURCE_NAME[c.source]}
        </div>
      </div>
      {onShelfId ? (
        <Button size="sm" variant="secondary" onClick={() => onOpen(onShelfId)} aria-label={`On your shelf: ${c.title}`} title="Open it on your shelf">
          <Check size={ICON.sm} color="var(--sb-positive)" /> On your shelf
        </Button>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" variant="accent" onClick={onAdd} aria-label={`Want to read: ${c.title}`} style={{ flex: 1, minWidth: 0 }}>
            <Plus size={ICON.sm} /> Want to read
          </Button>
          <Button size="sm" variant="secondary" iconOnly onClick={onBuy} aria-label={`Buy later: ${c.title}`} title="Put it on your buy-later list">
            <ShoppingCart size={ICON.sm} />
          </Button>
        </div>
      )}
    </Card>
  )
}

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
export function DiscoverView({ onOpenBook }: { onOpenBook: (id: string) => void }) {
  const books = useLibraryStore(s => s.books)
  const addBook = useLibraryStore(s => s.addBook)
  const [mode, setMode] = useState<Mode>('books')
  const [term, setTerm] = useState('')
  const [author, setAuthor] = useState<AuthorHit | null>(null)
  const [found, setFound] = useState<BookCandidate[]>([])
  const [authors, setAuthors] = useState<AuthorHit[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const run = useRef(0)

  const q = term.trim()
  // What is being asked for: an author's works, or a search in the current mode.
  const wants = author ? `works:${author.key}` : q.length >= 2 ? `${mode}:${q}` : ''

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

  const add = (c: BookCandidate, toBuy?: boolean) => addBook({
    title: c.title, subtitle: c.subtitle, authors: c.authors, isbn: c.isbn, publisher: c.publisher, publishedYear: c.publishedYear,
    pages: c.pages, language: c.language, description: c.description, coverUrl: c.coverUrl, source: c.source, sourceKey: c.sourceKey, status: 'want',
    ...(toBuy ? { toBuy: true } : {}),
  })

  const showBooks = mode === 'books' || !!author
  const allDown = state === 'done' && failed.length >= (author || mode === 'authors' ? 1 : 2)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Segmented value={mode} onChange={switchMode} options={[{ value: 'books', label: 'Books' }, { value: 'authors', label: 'Authors' }]} />
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 440 }}>
          <Search size={ICON.md} color="var(--sb-ink-4)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={term} onChange={e => change(e.target.value)} aria-label="Search online"
            placeholder={mode === 'books' ? 'A title, an author or an ISBN' : 'An author’s name'} style={{ ...inputStyle, paddingLeft: 32 }} />
        </div>
      </div>

      {author && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button variant="ghost" size="sm" onClick={back}><ArrowLeft size={ICON.sm} /> Authors</Button>
          <h2 style={{ margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>{author.name}</h2>
          {author.workCount ? <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>{author.workCount} works</span> : null}
        </div>
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
    </div>
  )
}
