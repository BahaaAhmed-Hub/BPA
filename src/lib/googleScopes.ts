// ─── What a Google token is actually allowed to do ───────────────────────────
//
//  The badges under a connected account were drawn from a hard-coded list —
//  the same three strings written out at three call sites in `App.tsx`:
//
//      scopes: ['calendar', 'calendar.events', 'gmail.readonly']
//
//  which never contained `drive`. So the Drive badge read "not granted" on
//  every account, for ever, whatever you had consented to. Tapping **Grant**
//  sent you round the whole OAuth loop — with `drive.file` and `drive.readonly`
//  correctly in the request — and on the way back wrote those same three
//  strings again. Nothing was broken about the grant; the badge was a
//  hard-coded claim that no round trip could ever change.
//
//  A badge is a claim about a token, so it asks the token. Google's tokeninfo
//  endpoint answers with the scopes actually on it, and that is the only thing
//  entitled to decide what these badges say.

/** email → what its token last said, and when it said it. */
const KEY = 'professor-google-scopes'
/** A grant does not change on its own, but a re-consent does, so this is short
 *  enough to notice one and long enough not to ask on every render. */
const TTL = 6 * 60 * 60 * 1000

type Cache = Record<string, { scopes: string[]; at: number }>

function read(): Cache {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Cache } catch { return {} }
}
function write(c: Cache): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* private mode */ }
}

/**
 *  What we last measured, or `null` where we have never measured it.
 *
 *  `null` is not `[]`. An empty list is a token that can do nothing; null is a
 *  question nobody has asked yet, and the two lead to opposite things on
 *  screen — "not granted, here is how to grant it" against "we have not
 *  checked". Drawing the second as the first is what put an unusable button in
 *  front of a scope that was already there.
 */
export function cachedScopes(email: string): string[] | null {
  const hit = read()[email.toLowerCase()]
  return hit ? hit.scopes : null
}

/** True when the cached answer is old enough to be worth asking again. */
export function scopesAreStale(email: string): boolean {
  const hit = read()[email.toLowerCase()]
  return !hit || Date.now() - hit.at > TTL
}

/**
 *  Ask Google what this token carries.
 *
 *  Returns `null` when we could not ask — a dead network, a token Google has
 *  already expired — never a guess. The caller keeps whatever it had rather
 *  than reporting a grant that has gone or a loss that has not happened.
 */
/** One question per token in flight. StrictMode runs every effect twice, and
 *  two accounts' rows can ask about the same token at once. */
const asking = new Map<string, Promise<string[] | null>>()

export async function readScopes(email: string, token: string): Promise<string[] | null> {
  if (!token) return null
  const inFlight = asking.get(token)
  if (inFlight) return inFlight
  const p = ask(email, token).finally(() => asking.delete(token))
  asking.set(token, p)
  return p
}

async function ask(email: string, token: string): Promise<string[] | null> {
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token))
    if (!r.ok) return null
    const body = await r.json() as { scope?: string }
    if (typeof body.scope !== 'string') return null
    // Google answers with full URLs; everything here matches on the last part,
    // and keeping both means neither a `includes('drive')` nor an exact compare
    // can be caught out by which form it was written in.
    const scopes = body.scope.split(/\s+/).filter(Boolean)
    const c = read()
    c[email.toLowerCase()] = { scopes, at: Date.now() }
    write(c)
    return scopes
  } catch {
    return null
  }
}

/** After a re-consent, the cached answer is about the old grant. */
export function forgetScopes(email?: string): void {
  if (!email) { try { localStorage.removeItem(KEY) } catch { /* private mode */ } return }
  const c = read()
  delete c[email.toLowerCase()]
  write(c)
}

/** Does this list cover a capability? `part` is the tail Google names it by —
 *  `calendar`, `gmail`, `drive`. */
export function grants(scopes: string[] | null, part: string): boolean | null {
  if (scopes === null) return null
  return scopes.some(s => s.includes(part))
}
