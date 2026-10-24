// The assistant's conversation as the page sees it — pure, so it can be measured
// without a browser. The rows come from `assistant_messages` (see 20260042/43);
// everything here turns them into what the panel draws and decides what this
// device should do about them. No network, no React.
import type { Row } from '../../supabase/functions/_shared/assistantChat.ts'

/** An answer nobody has touched for this long belongs to an invocation that died. */
export const STALE_ANSWER_MS = 100_000
/** A tool claim older than this was made by a device that has gone. */
export const CLAIM_MS = 120_000
/** A finished tool with nothing after it is "about to continue" only this long. */
export const FINISHED_TOOL_GRACE_MS = 60_000
/** Adopt the newest conversation on another device only if it is this fresh. */
export const ADOPT_WITHIN_MS = 24 * 3_600_000

export interface ChatRow extends Row {
  conversation_id: string
  client_id?: string | null
  files?: { name: string; kind: 'image' | 'pdf' | 'text' }[] | null
  created_at?: string
  updated_at?: string
  claimed_by?: string | null
  claimed_at?: string | null
  /** what the request that wrote this answer used, as the provider reported it (20260044); read with `usageFromRow` */
  usage?: unknown
}

export interface Bubble {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'error'
  content: string
  files?: { name: string; kind: 'image' | 'pdf' | 'text' }[]
  tool?: string
  state?: 'running' | 'done' | 'failed'
}

const age = (iso: string | undefined, now: number) => (iso ? now - Date.parse(iso) : 0)

export const isStaleStreaming = (r: ChatRow, now: number) =>
  r.status === 'streaming' && age(r.updated_at, now) > STALE_ANSWER_MS

/** Keeps rows in conversation order and replaces by id — a Realtime event, a poll
 *  and the first read can all arrive in any order and say the same thing twice. */
export function mergeRows(prev: ChatRow[], incoming: ChatRow[]): ChatRow[] {
  const by = new Map(prev.map(r => [r.id, r]))
  for (const r of incoming) {
    const old = by.get(r.id)
    // A late, older copy of a row must not undo a newer one.
    if (!old || !old.updated_at || !r.updated_at || r.updated_at >= old.updated_at) by.set(r.id, r)
  }
  return [...by.values()].sort((a, b) => a.id - b.id)
}

export function rowsToBubbles(rows: ChatRow[], now: number): Bubble[] {
  const out: Bubble[] = []
  for (const r of rows) {
    if (r.role === 'user') {
      out.push({ id: r.client_id ?? `row-${r.id}`, role: 'user', content: r.content, ...(r.files?.length ? { files: r.files } : {}) })
    } else if (r.role === 'tool') {
      out.push({ id: `tool-${r.tool_use_id ?? r.id}`, role: 'tool', content: r.tool ?? '', tool: r.tool ?? '', state: r.tool_state ?? 'done' })
    } else if (r.role === 'error' || r.status === 'error') {
      out.push({ id: `row-${r.id}`, role: 'error', content: r.content })
    } else if (isStaleStreaming(r, now)) {
      out.push({ id: `row-${r.id}`, role: 'error', content: (r.content ? r.content + '\n\n' : '') + 'This answer was interrupted before it finished. Ask again.' })
    } else if (r.status === 'streaming' && !r.content) {
      continue // the thinking dot stands in for it
    } else if (r.status === 'complete' && !r.content.trim()) {
      continue // a step that only asked for tools: no words, but its tokens are counted on this row
    } else {
      out.push({ id: `row-${r.id}`, role: 'assistant', content: r.content })
    }
  }
  return out
}

/** Something is on its way: an answer being written, a tool waiting to run, or a
 *  tool that has just come back and the next step is about to start. */
export function busyOf(rows: ChatRow[], now: number): boolean {
  if (rows.some(r => r.status === 'streaming' && !isStaleStreaming(r, now))) return true
  if (rows.some(r => r.role === 'tool' && r.tool_state === 'running')) return true
  const last = rows[rows.length - 1]
  return !!last && last.role === 'tool' && age(last.updated_at, now) < FINISHED_TOOL_GRACE_MS
}

/** Tool calls this device may take: running, and not claimed — or claimed so long ago the claimant is gone, or claimed
 *  by this very device (a page reloaded while an approval card was up: the claimant is the page that no longer exists;
 *  the caller skips anything this page is itself running). */
export function claimable(rows: ChatRow[], now: number, device?: string): ChatRow[] {
  return rows.filter(r =>
    r.role === 'tool' && r.tool_state === 'running' && !!r.tool_use_id &&
    (!r.claimed_at || age(r.claimed_at, now) > CLAIM_MS || (!!device && r.claimed_by === device)))
}

/** The trailing run of tool rows when every one has come back and nothing has
 *  started after them: the browser that ran the last one may have died before it
 *  asked for the next step. A signature, so it is asked for once. */
export function awaitingContinue(rows: ChatRow[]): string | null {
  const tail: ChatRow[] = []
  for (let i = rows.length - 1; i >= 0 && rows[i].role === 'tool'; i--) tail.unshift(rows[i])
  if (!tail.length) return null
  if (rows.some(r => r.status === 'streaming')) return null
  if (!tail.every(r => r.tool_state === 'done' || r.tool_state === 'failed')) return null
  return tail.map(r => r.id).join(',')
}

// ── The URL carries the conversation ─────────────────────────────────────────

export const CHAT_PARAM = 'c'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function chatIdFromUrl(href: string): string | null {
  try {
    const v = new URL(href).searchParams.get(CHAT_PARAM)
    return v && UUID.test(v) ? v : null
  } catch { return null }
}

/** The same address with `?c=<id>` set or removed; the path, other parameters and hash are untouched. */
export function urlWithChat(href: string, id: string | null): string {
  const u = new URL(href)
  if (id) u.searchParams.set(CHAT_PARAM, id)
  else u.searchParams.delete(CHAT_PARAM)
  return u.pathname + u.search + u.hash
}

// ── A half-typed message survives a reload ───────────────────────────────────

export const DRAFT_KEY = 'assistant-draft'
export const loadDraft = (): string => { try { return localStorage.getItem(DRAFT_KEY) ?? '' } catch { return '' } }
export function saveDraft(text: string) {
  try { if (text) localStorage.setItem(DRAFT_KEY, text); else localStorage.removeItem(DRAFT_KEY) } catch { /* private window */ }
}

/** Which device took a tool call. Kept so a reloaded page recognises its own stale claim. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('assistant-device')
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('assistant-device', id) }
    return id
  } catch { return 'ephemeral-' + Math.random().toString(36).slice(2) }
}
