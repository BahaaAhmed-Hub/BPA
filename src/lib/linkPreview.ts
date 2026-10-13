/**
 * linkPreview.ts — a pasted link should show what it *is*
 *
 * A URL typed into a notes box, or into a meeting's outputs, is a row of
 * characters you have to read to recognise. This turns one into a card with a
 * picture and a name.
 *
 * Two answers, and which one is in force is visible on the card:
 *
 * - **Derived** — a pure function of the URL, no request and nothing to trust.
 *   A YouTube thumbnail is `i.ytimg.com/vi/<id>/hqdefault.jpg`, which the id in
 *   the link already names, so the picture is there the instant you stop
 *   typing. There is no CORS question to lose, because an `<img>` renders a
 *   cross-origin image without needing permission to *read* it — and if the
 *   guess is wrong the image's own `onerror` falls the card back rather than
 *   leaving a broken frame. That is the whole reason the derived set is
 *   expressed as a URL rather than as a lookup.
 * - **Read** — the `link-preview` edge function fetches the page and returns
 *   its `og:` tags. A browser cannot do this: the one thing the same-origin
 *   policy is strictest about is reading another site's bytes, and no amount
 *   of care in this file changes that. Anything with no derivation needs a
 *   server, or it gets a favicon and its host.
 *
 * **Nothing is invented.** No title is guessed from a path, no description is
 * written for a page nobody has read, and a link that answers neither way is
 * drawn as its host and its own last path segment — which is still a better
 * row than 94 characters of query string, and is true.
 */

import { supabase } from './supabase'

export type PreviewFrom = 'derived' | 'read' | 'bare'

export interface LinkPreview {
  url:    string
  host:   string
  /** The last readable thing in the path — never a guess at a title. */
  tail:   string
  title?: string
  desc?:  string
  /** A picture to draw big. Derived ones may 404; the card handles that. */
  thumb?: string
  /** The site's own mark, for the rows with no picture. */
  icon?:  string
  kind?:  string
  from:   PreviewFrom
}

/* ── finding them ──────────────────────────────────────────────────────── */

// Trailing punctuation is almost always the sentence's, not the URL's.
const TRAIL = /[.,;:!?)\]}'"»]+$/

/** Every http(s) URL in a block of text, in order, deduped. */
export function findLinks(text: string, cap = 6): string[] {
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    let raw = m[0].replace(TRAIL, '')
    // A closing bracket is only punctuation when nothing opened it.
    if (raw.endsWith(')') && !raw.includes('(')) raw = raw.slice(0, -1)
    if (!raw || seen.has(raw)) continue
    try { new URL(raw) } catch { continue }
    seen.add(raw)
    out.push(raw)
    if (out.length >= cap) break
  }
  return out
}

/* ── derivation: what the URL already tells us ─────────────────────────── */

const YT_ID = /^[\w-]{11}$/

/** The YouTube video id, from every shape of YouTube link there is. */
function youTubeId(u: URL): string | null {
  const h = u.hostname.replace(/^www\.|^m\./, '')
  if (h === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0]
    return YT_ID.test(id) ? id : null
  }
  if (h !== 'youtube.com' && h !== 'youtube-nocookie.com') return null
  const v = u.searchParams.get('v')
  if (v && YT_ID.test(v)) return v
  const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/)
  return m ? m[1] : null
}

function driveId(u: URL): string | null {
  if (!/(^|\.)(drive|docs)\.google\.com$/.test(u.hostname)) return null
  const m = u.pathname.match(/\/d\/([\w-]{10,})/)
  return m ? m[1] : (u.searchParams.get('id') || null)
}

/** The last path segment, made readable. Never dressed up as a title. */
function tailOf(u: URL): string {
  const segs = u.pathname.split('/').filter(Boolean)
  const last = segs[segs.length - 1] ?? ''
  const pretty = decodeURIComponent(last)
    .replace(/\.(html?|php|aspx?|pdf)$/i, '')
    .replace(/[-_+]+/g, ' ')
    .trim()
  return pretty.length > 2 && pretty.length < 80 ? pretty : (segs.join(' / ') || u.hostname)
}

/**
 * What the URL says on its own. The thumbnail here is a *claim the image
 * itself settles*: it loads, or the card falls back.
 */
export function derive(url: string): LinkPreview | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null

  const host = u.hostname.replace(/^www\./, '')
  const base: LinkPreview = { url, host, tail: tailOf(u), from: 'bare' }

  const yt = youTubeId(u)
  if (yt) return { ...base, kind: 'video', from: 'derived', tail: 'YouTube',
    thumb: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` }

  const gd = driveId(u)
  if (gd) return { ...base, kind: 'file', from: 'derived', tail: 'Google Drive',
    thumb: `https://drive.google.com/thumbnail?id=${gd}&sz=w480` }

  return base
}

/* ── the cache ─────────────────────────────────────────────────────────── */

const KEY  = 'professor-link-previews'
const TTL  = 14 * 24 * 60 * 60 * 1000
const CAP  = 300

type Cached = { at: number; p: LinkPreview }

function readCache(): Record<string, Cached> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

function writeCache(bag: Record<string, Cached>) {
  const keys = Object.keys(bag)
  if (keys.length > CAP) {
    keys.sort((a, b) => (bag[a]?.at ?? 0) - (bag[b]?.at ?? 0))
    for (const k of keys.slice(0, keys.length - CAP)) delete bag[k]
  }
  try { localStorage.setItem(KEY, JSON.stringify(bag)) } catch { /* full is not fatal */ }
}

/** What is known right now, with no request of any kind. */
export function cachedPreview(url: string): LinkPreview | null {
  const hit = readCache()[url]
  if (hit && Date.now() - hit.at < TTL) return hit.p
  return derive(url)
}

/* ── reading the ones that cannot be derived ───────────────────────────── */

let asking: Promise<void> | null = null

/**
 * Fills in the links a URL cannot answer for itself, through the edge
 * function. A failure is **not** written to the cache: the derived answer
 * stands, and the next open asks again. A function that is not deployed is
 * exactly that case, so nothing here is required for the derived cards.
 */
export async function readPreviews(urls: string[]): Promise<Record<string, LinkPreview>> {
  const bag  = readCache()
  const now  = Date.now()
  const want = urls.filter(u => {
    const hit = bag[u]
    if (hit && now - hit.at < TTL && hit.p.from === 'read') return false
    return derive(u)?.from !== 'derived'   // a derived card needs no server
  })
  if (!want.length) return {}

  // One flight at a time: three textareas on screen must not each ask.
  while (asking) await asking
  let release: () => void = () => {}
  asking = new Promise<void>(r => { release = r })
  try {
    const { data, error } = await supabase.functions.invoke('link-preview', {
      body: { urls: want.slice(0, 8) },
    })
    if (error || !data || !Array.isArray((data as { previews?: unknown }).previews)) return {}

    const out: Record<string, LinkPreview> = {}
    const fresh = readCache()
    for (const row of (data as { previews: Partial<LinkPreview>[] }).previews) {
      if (!row?.url) continue
      const d = derive(row.url)
      if (!d) continue
      // The server fills in; it never overwrites what the URL already proved.
      const merged: LinkPreview = {
        ...d,
        title: row.title || undefined,
        desc:  row.desc  || undefined,
        thumb: d.thumb || row.thumb || undefined,
        icon:  row.icon  || undefined,
        from:  (row.title || row.thumb || row.icon) ? 'read' : d.from,
      }
      out[row.url] = merged
      fresh[row.url] = { at: now, p: merged }
    }
    writeCache(fresh)
    return out
  } catch {
    return {}
  } finally {
    release()
    asking = null
  }
}

export function forgetPreviews() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
