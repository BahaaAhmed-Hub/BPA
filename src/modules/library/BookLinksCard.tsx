import { ExternalLink, ShoppingCart } from 'lucide-react'
import { Card, Pill } from '@/components/ui'
import { ICON } from '@/lib/type'
import { COUNTRY_CODES, countryName, defaultCountry, linksFor, type BookLink } from './bookLinks'
import { Eyebrow } from './fields'
import { inputStyle } from './fieldStyle'
import { loadLibrarySettings, saveLibrarySettings } from './libraryPrefs'
import { useLibraryStore } from './libraryStore'
import { useEffect, useState } from 'react'
import { findReadable, type ReadResult } from './readSources'
import type { Book } from './types'

const readCache = new Map<string, ReadResult>()

/** Only the places that were asked and have this book. Checking, nowhere, and could-not-ask are three different sentences. */
function ReadGroup({ read }: { read: ReadResult | null }) {
  const note = { fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' } as const
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-live="polite">
      <div style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-2)' }}>Read or borrow, free and legal</div>
      {read === null && <div style={note}>Checking where you can read it…</div>}
      {read && read.found.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {read.found.map(l => (
            <a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer" title={`${l.how} on ${l.label}`}
              className="sb-btn" data-variant="secondary" data-size="sm" style={{ textDecoration: 'none' }}>
              {l.label} · {l.how} <ExternalLink size={ICON.sm} aria-hidden />
            </a>
          ))}
        </div>
      )}
      {read && read.found.length === 0 && (
        <div style={note}>{read.failed.length
          ? `Could not check ${read.failed.join(' and ')}, so nothing is shown yet.`
          : 'Not available to read or borrow for free on Open Library, the Internet Archive, Project Gutenberg or Google Books.'}</div>
      )}
      {read && read.found.length > 0 && read.failed.length > 0 && <div style={note}>Could not check {read.failed.join(' and ')}.</div>}
    </div>
  )
}

function LinkGroup({ title, links }: { title: string; links: BookLink[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-2)' }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {links.map(l => (
          <a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer" title={l.note}
            className="sb-btn" data-variant="secondary" data-size="sm" style={{ textDecoration: 'none' }}>
            {l.label} <ExternalLink size={ICON.sm} aria-hidden />
          </a>
        ))}
      </div>
    </div>
  )
}

/**
 * Where to read it for free, and where to buy it in your country.
 *
 * **"To buy" is a flag, not a status**: a book can be a want-to-read because a
 * friend lent it, or because the library has it. The server refuses the flag
 * until 20260028 has run, and the store says so rather than showing a pill that
 * will not stay.
 */
export function BookLinksCard({ book }: { book: Book }) {
  const update = useLibraryStore(s => s.updateBook)
  const [country, setCountry] = useState(() => loadLibrarySettings().country ?? defaultCountry())
  const { buy } = linksFor(book, country)
  const [read, setRead] = useState<ReadResult | null>(null)
  const isbn = book.isbn
  useEffect(() => {
    const key = `${book.title}|${book.authors[0] ?? ''}|${isbn ?? ''}`
    const cached = readCache.get(key)
    if (cached) { setRead(cached); return }
    setRead(null)
    const ac = new AbortController()
    void findReadable({ title: book.title, authors: book.authors, isbn }, ac.signal).then(r => {
      if (ac.signal.aborted) return
      // A result with a source that could not be asked is not remembered: it is asked again next time.
      if (!r.failed.length) readCache.set(key, r)
      setRead(r)
    })
    return () => ac.abort()
  }, [book.title, book.authors, isbn])
  const codes = COUNTRY_CODES.includes(country) ? COUNTRY_CODES : [...COUNTRY_CODES, country].sort()

  return (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Eyebrow>Get it</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Pill on={!!book.toBuy} onClick={() => update(book.id, { toBuy: !book.toBuy })} aria-pressed={!!book.toBuy}
          title="Keep it on your buy-later list">
          <ShoppingCart size={ICON.sm} /> {book.toBuy ? 'On your buy list' : 'Buy later'}
        </Pill>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
          Shop in
          <select value={country} aria-label="Country for buy links" style={{ ...inputStyle, width: 'auto', maxWidth: 170 }}
            onChange={e => { setCountry(e.target.value); saveLibrarySettings({ ...loadLibrarySettings(), country: e.target.value }) }}>
            {codes.map(c => <option key={c} value={c}>{countryName(c)}</option>)}
          </select>
        </label>
      </div>
      <ReadGroup read={read} />
      <LinkGroup title={`Buy in ${countryName(country)}`} links={buy} />
      <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
        Reading links are shown only where the book was found, and open the book itself. Buy buttons open each shop’s own search; prices and stock are not checked here.
      </p>
    </Card>
  )
}
