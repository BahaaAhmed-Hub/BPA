/**
 * link-preview — Supabase Edge Function
 *
 * Reads the `og:` tags off a page so a pasted link can be drawn as a card.
 *
 *   POST /functions/v1/link-preview
 *   { "urls": ["https://example.com/a", ...] }        → { previews: [...] }
 *
 * A browser cannot do this itself. The same-origin policy is strictest about
 * exactly this — reading another site's bytes — so a link that is not a
 * YouTube or Drive id (which the client derives with no request at all) needs
 * a server or it gets a favicon and its host. That is the only reason this
 * exists.
 *
 * **It is a URL fetcher, so it is an SSRF hole unless it is nailed shut**, and
 * it runs beside a service-role database. Five guards, in order:
 *
 *  1. **It is not open.** A valid signed-in user, or nothing happens. An
 *     unauthenticated fetch proxy is a gift to whoever finds the address.
 *  2. **http(s) only**, so `file:`, `gopher:` and friends are not a route.
 *  3. **No private ground.** Loopback, link-local, the three RFC1918 blocks,
 *     CGNAT, `.local`/`.internal`, and `169.254.169.254` — the cloud metadata
 *     address, which is the one that turns a preview card into credentials.
 *     Checked on the literal host, and on the resolved A records where the
 *     runtime allows a lookup.
 *  4. **Redirects are walked by hand** (`redirect: 'manual'`, 3 hops).
 *     Following them automatically hands the guard's answer to whoever
 *     controls the first hop: a public URL that 302s to 169.254.169.254 would
 *     sail through a check made only on what was typed.
 *  5. **Bounded**: 6s, 256KB, `text/html` only, and the read stops at
 *     `</head>` because nothing below it is a meta tag.
 *
 * Nothing is written to the database and nothing is logged but a count.
 *
 * Auto-injected: SUPABASE_URL, SUPABASE_ANON_KEY
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { headers: { ...CORS, 'Content-Type': 'application/json' }, status })

const MAX_URLS  = 8
const MAX_BYTES = 256 * 1024
const TIMEOUT   = 6000
const MAX_HOPS  = 3
const UA = 'Mozilla/5.0 (compatible; ProfessorLinkPreview/1.0; +link card for the person who pasted it)'

/* ── the guard ─────────────────────────────────────────────────────────── */

const BAD_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localdomain)$/i

/** Is this a literal IP we must never reach? */
function privateIp(host: string): boolean {
  // IPv6, including ::1 and the v4-mapped forms.
  if (host.includes(':')) {
    const h = host.replace(/^\[|\]$/g, '').toLowerCase()
    if (h === '::1' || h === '::' ) return true
    if (/^f[cd]/.test(h)) return true          // unique-local fc00::/7
    if (/^fe[89ab]/.test(h)) return true       // link-local fe80::/10
    // A v4-mapped address must be judged as the v4 address it carries — and
    // `new URL()` has already rewritten the dotted quad into hex by the time
    // we see it (`[::ffff:127.0.0.1]` arrives as `[::ffff:7f00:1]`), so a
    // dotted-quad match here never fires. Measured, not assumed: the
    // addresses suite walked straight through to loopback on the first run.
    const dotted = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (dotted) return privateIp(dotted[1])
    const hex = h.match(/^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16)
      return privateIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'))
    }
    return false
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if ([a, b, Number(m[3]), Number(m[4])].some(n => n > 255)) return true
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||                // link-local, metadata lives here
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||      // CGNAT
    a >= 224                                   // multicast and reserved
  )
}

/** `null` when the URL is safe to fetch, otherwise why not. */
async function refuse(u: URL): Promise<string | null> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'not a web address'
  const host = u.hostname.toLowerCase()
  if (!host || BAD_HOST.test(host)) return 'private host'
  if (privateIp(host)) return 'private address'
  // Where the runtime permits a lookup, the name must not resolve inward
  // either — a public hostname with an A record of 127.0.0.1 is the classic.
  try {
    const ips = await Deno.resolveDns(host, 'A')
    if (ips.some(privateIp)) return 'resolves to a private address'
  } catch { /* no permission or no A record: the literal checks stand */ }
  return null
}

/* ── reading the head ──────────────────────────────────────────────────── */

function meta(head: string, names: string[]): string | undefined {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`, 'i')
    const tag = head.match(re)?.[0]
    const val = tag?.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]
    if (val?.trim()) return decode(val.trim())
  }
  return undefined
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, ' ')
    .trim()
}

const cut = (s: string | undefined, n: number) =>
  s && s.length > n ? s.slice(0, n - 1) + '…' : s

/** Follows up to MAX_HOPS redirects, guarding every single hop. */
async function walk(start: URL, signal: AbortSignal): Promise<Response | null> {
  let u = start
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (await refuse(u)) return null
    const res = await fetch(u.toString(), {
      redirect: 'manual', signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      await res.body?.cancel()
      if (!loc) return null
      try { u = new URL(loc, u) } catch { return null }
      continue
    }
    return res
  }
  return null
}

async function preview(raw: string) {
  let u: URL
  try { u = new URL(raw) } catch { return { url: raw } }
  if (await refuse(u)) return { url: raw }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const res = await walk(u, ctl.signal)
    if (!res || !res.ok) { await res?.body?.cancel(); return { url: raw } }

    const type = res.headers.get('content-type') || ''
    if (!/text\/html|application\/xhtml/i.test(type)) {
      await res.body?.cancel()
      return { url: raw }
    }

    // Read to </head> or the cap, whichever comes first.
    let head = ''
    const reader = res.body?.getReader()
    const dec = new TextDecoder('utf-8', { fatal: false })
    let got = 0
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      got += value.byteLength
      head += dec.decode(value, { stream: true })
      if (got >= MAX_BYTES || /<\/head>/i.test(head)) { await reader.cancel(); break }
    }

    const base = res.url ? new URL(res.url) : u
    const abs = (v?: string) => {
      if (!v) return undefined
      try { return new URL(v, base).toString() } catch { return undefined }
    }

    const title =
      meta(head, ['og:title', 'twitter:title']) ||
      decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') || undefined

    const iconHref = head.match(
      /<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/i)?.[0]
      ?.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]

    return {
      url:   raw,
      title: cut(title, 120),
      desc:  cut(meta(head, ['og:description', 'twitter:description', 'description']), 90),
      thumb: abs(meta(head, ['og:image:secure_url', 'og:image', 'twitter:image'])),
      icon:  abs(iconHref) || `${base.origin}/favicon.ico`,
    }
  } catch {
    return { url: raw }
  } finally {
    clearTimeout(timer)
  }
}

/* ── the door ──────────────────────────────────────────────────────────── */

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  // 1 · Not an open proxy. A caller we cannot name gets nothing.
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'Sign in first' }, 401)
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  })
  const { data: who, error: whoErr } = await sb.auth.getUser()
  if (whoErr || !who?.user) return json({ error: 'Sign in first' }, 401)

  let urls: unknown
  try { urls = (await req.json())?.urls } catch { return json({ error: 'Bad body' }, 400) }
  if (!Array.isArray(urls)) return json({ error: '`urls` must be a list' }, 400)

  const list = urls.filter((u): u is string => typeof u === 'string' && u.length < 2048)
                   .slice(0, MAX_URLS)
  const previews = await Promise.all(list.map(preview))
  console.log(`link-preview: ${previews.length} asked, ${previews.filter(p => 'title' in p).length} read`)
  return json({ previews })
})
