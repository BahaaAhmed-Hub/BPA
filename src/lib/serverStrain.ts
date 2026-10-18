// ─── Is the server struggling? ───────────────────────────────────────────────
//
// A database that is timing out is asked again, at full speed, by every poll,
// focus and Realtime nudge — which is how a slow minute becomes a slow half
// hour. This watches the answers coming back and says how long to leave it alone.
//
// **A round of failures is one failure.** A pull is 23 reads; if the server is
// down all 23 fail together, and counting each would send the wait straight to
// the ceiling. A failure counts only when the previous wait has run out, so the
// wait doubles once per attempt — 15s, 30s, 60s … five minutes — and any answer
// that is not a server fault puts it back to zero.
//
// Only the reads and auth calls that go to the database count. An edge function
// failing is Google or the function's own doing, not the database's, and a 402
// or 403 is a refusal, not strain.

const BASE_MS = 15_000
const MAX_MS  = 5 * 60_000

let failures = 0
let since = 0

export function backoffLeft(): number {
  if (!failures) return 0
  const wait = Math.min(MAX_MS, BASE_MS * 2 ** (failures - 1))
  return Math.max(0, since + wait - Date.now())
}

function note(fault: boolean): void {
  if (!fault) { failures = 0; return }
  if (failures === 0 || backoffLeft() === 0) { failures++; since = Date.now() }
}

const counts = (url: string) => url.includes('/rest/v1/') || url.includes('/auth/v1/')

/** `fetch` for the Supabase client: the same call, with its answer noted. */
export const strainAwareFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    const res = await fetch(input, init)
    if (counts(url)) note(res.status >= 500 || res.status === 408 || res.status === 429)
    return res
  } catch (e) {
    // A request the page itself cancelled is not the server's doing.
    if (counts(url) && !(e instanceof DOMException && e.name === 'AbortError')) note(true)
    throw e
  }
}
