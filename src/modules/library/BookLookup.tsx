import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { ICON } from '@/lib/type'
import { lookupBooks, type BookCandidate } from './bookLookup'
import { inputStyle } from './fieldStyle'

const SOURCE_NAME = { openlibrary: 'Open Library', google: 'Google Books', manual: '' } as const

/**
 * Search by what you remember — title, author, ISBN — and pick the one you
 * mean. Debounced, and a stale answer never overwrites a newer one: an
 * `AbortController` per keystroke would be tidier, but the merge of two sources
 * makes "which request is current" a counter's job.
 */
export function BookLookup({ initialQuery = '', autoFocus, onPick, hint }: {
  initialQuery?: string
  autoFocus?: boolean
  onPick: (c: BookCandidate) => void
  hint?: string
}) {
  const [q, setQ] = useState(initialQuery)
  const [results, setResults] = useState<BookCandidate[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [state, setState] = useState<'idle' | 'busy' | 'done'>(initialQuery.trim().length >= 2 ? 'busy' : 'idle')
  const run = useRef(0)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) return
    const mine = ++run.current
    const t = window.setTimeout(async () => {
      const r = await lookupBooks(term)
      if (mine !== run.current) return
      setResults(r.candidates); setFailed(r.failed); setState('done')
    }, 450)
    return () => clearTimeout(t)
  }, [q])

  // State that follows the keystroke is set here, in the handler, rather than
  // in the effect: the effect only schedules the request.
  function change(v: string) {
    setQ(v)
    if (v.trim().length < 2) { run.current++; setResults([]); setFailed([]); setState('idle') }
    else setState('busy')
  }

  const allFailed = state === 'done' && failed.length === 2

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ position: 'relative' }}>
        <Search size={ICON.md} color="var(--sb-ink-4)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
        <input autoFocus={autoFocus} value={q} onChange={e => change(e.target.value)} aria-label="Search for a book"
          placeholder={hint ?? 'Title, author or ISBN'}
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
          style={{ ...inputStyle, paddingLeft: 32 }} />
      </div>

      <div aria-live="polite" style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', minHeight: 16 }}>
        {state === 'busy' && 'Searching…'}
        {state === 'done' && allFailed && 'Neither Open Library nor Google Books could be reached — add it by hand below.'}
        {state === 'done' && !allFailed && results.length === 0 && 'Nothing found — check the spelling, or add it by hand below.'}
        {/* One source down is not "no results": say which, the other still answered. */}
        {state === 'done' && !allFailed && failed.length === 1 && results.length > 0 && `${failed[0]} could not be reached; showing the other.`}
      </div>

      {results.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
          {results.map((c, i) => (
            <li key={`${c.source}-${c.sourceKey ?? i}`}>
              <button type="button" onClick={() => onPick(c)} style={{
                display: 'flex', gap: 10, alignItems: 'center', width: '100%', textAlign: 'left', cursor: 'pointer',
                padding: 6, minHeight: 56, borderRadius: 'var(--sb-r-sm)', border: 'var(--sb-border-width) solid var(--sb-hairline)',
                background: 'var(--sb-card)', color: 'var(--sb-ink-1)', fontFamily: 'inherit',
              }}>
                <span style={{ width: 36, height: 54, flexShrink: 0, borderRadius: 3, overflow: 'hidden', background: 'var(--sb-field)', display: 'block' }}>
                  {c.coverUrl && <img src={c.coverUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 'var(--sb-t-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                  <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[c.authors.join(', '), c.publishedYear, SOURCE_NAME[c.source]].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
