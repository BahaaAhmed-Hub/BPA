/**
 * LinkPreviews — the cards under a box you have pasted links into
 *
 * One row per link: a picture where the URL or the page gives one, the page's
 * name where it has one, and its host underneath. The whole row opens the
 * link.
 *
 * Three rules it exists to keep:
 *
 * - **A picture that does not load is not a broken frame.** Every derived
 *   thumbnail is a guess the image settles for itself, so `onError` swaps the
 *   row to its mark rather than leaving a grey rectangle — which is why the
 *   derivation can be bold about YouTube and Drive without a request first.
 * - **A link with no answer still gets a row.** Host plus the tail of its own
 *   path, which is true and readable, rather than nothing or an invented
 *   title. The card says where it got what it has.
 * - **Words are held, pictures are not.** The derived half is a pure function
 *   of the text, so it appears as you type; only the half that needs the
 *   server waits 700ms — the pause the calendar composer already holds words
 *   for.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { cachedPreview, findLinks, readPreviews, type LinkPreview } from '../lib/linkPreview'

/** Everything known about the links in a block of text, kept current. */
export function useLinkPreviews(text: string): LinkPreview[] {
  const urls = useMemo(() => findLinks(text), [text])
  const key  = urls.join('\n')
  const [read, setRead] = useState<Record<string, LinkPreview>>({})
  const alive = useRef(true)

  // Set on *mount*, not only cleared on unmount. StrictMode mounts, unmounts
  // and mounts again, so a ref that is only ever cleared stays false for the
  // life of the component and every answer that arrives is dropped on the
  // floor — measured exactly that way: the request went out, the server
  // replied, and the card never changed.
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  useEffect(() => {
    if (!urls.length) return
    const t = setTimeout(() => {
      void readPreviews(urls).then(got => {
        if (alive.current && Object.keys(got).length) setRead(r => ({ ...r, ...got }))
      })
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return useMemo(
    () => urls.map(u => read[u] ?? cachedPreview(u)).filter(Boolean) as LinkPreview[],
    [key, read], // eslint-disable-line react-hooks/exhaustive-deps
  )
}

const THUMB_W = 76
const THUMB_H = 52

function Mark({ p }: { p: LinkPreview }) {
  const [dead, setDead] = useState(false)
  const letter = (p.host.replace(/^www\./, '')[0] || '?').toUpperCase()
  if (p.icon && !dead) {
    return <img src={p.icon} alt="" width={18} height={18} onError={() => setDead(true)}
      style={{ width: 18, height: 18, objectFit: 'contain', borderRadius: 3 }} />
  }
  return (
    <span aria-hidden style={{
      width: 18, height: 18, borderRadius: 5, display: 'grid', placeItems: 'center',
      background: 'var(--sb-accent-tint)', color: 'var(--sb-accent-deep)',
      fontSize: 10, fontWeight: 700, lineHeight: 1,
    }}>{letter}</span>
  )
}

function Card({ p }: { p: LinkPreview }) {
  const [noThumb, setNoThumb] = useState(false)
  const showThumb = !!p.thumb && !noThumb

  return (
    <a
      href={p.url} target="_blank" rel="noreferrer noopener"
      data-link-card data-from={p.from} data-thumb={showThumb ? 'yes' : 'no'}
      title={p.title ? `${p.title} — ${p.url}` : p.url}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
        padding: 7, borderRadius: 'var(--sb-r-nav)',
        background: 'var(--sb-card)',
        border: 'var(--sb-border-width) solid var(--sb-border)',
        minWidth: 0, overflow: 'hidden',
      }}
    >
      {showThumb ? (
        <img
          src={p.thumb} alt="" loading="lazy" referrerPolicy="no-referrer"
          onError={() => setNoThumb(true)}
          style={{
            width: THUMB_W, height: THUMB_H, flexShrink: 0, objectFit: 'cover',
            borderRadius: 'var(--sb-r-sm)', background: 'var(--sb-field)', display: 'block',
          }} />
      ) : (
        <span style={{
          width: 34, height: 34, flexShrink: 0, borderRadius: 'var(--sb-r-sm)',
          background: 'var(--sb-field)', display: 'grid', placeItems: 'center',
        }}><Mark p={p} /></span>
      )}

      <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{
          fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)',
          lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{p.title || p.tail}</span>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)',
          lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {showThumb && <Mark p={p} />}
          {p.host}
          {p.desc ? ` · ${p.desc}` : ''}
        </span>
      </span>

      <ExternalLink size={13} strokeWidth={1.8} color="var(--sb-ink-4)" style={{ flexShrink: 0 }} />
    </a>
  )
}

/** The row of cards for whatever is written in `text`. Draws nothing for none. */
export default function LinkPreviews({ text, max = 4 }: { text: string; max?: number }) {
  const previews = useLinkPreviews(text)
  if (!previews.length) return null
  return (
    <div data-link-previews style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {previews.slice(0, max).map(p => <Card key={p.url} p={p} />)}
    </div>
  )
}
