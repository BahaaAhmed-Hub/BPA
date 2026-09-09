// ─── What the mail says, and the answer to it ────────────────────────────────
// The Today card used to show the first 140 characters of a message, which is
// a greeting and half a sentence. This asks the Professor what the message is
// and — where it wants an answer — writes one, so the card carries a summary
// and a draft rather than a preview.
//
// Two rules hold this together:
// - **A brief is cached against the message, not the thread.** A new message in
//   a thread is a new thing to answer; the same message read twice is not.
// - **It is never on the render path.** Rows draw the moment mail arrives; the
//   briefs land after, one setState per batch. A failed or unconfigured AI
//   leaves the card exactly as it was, minus the summaries.

import { briefInbox, ProfessorError, type InboxBrief, type InboxMessage, type MailAction } from '@/lib/professor'
import type { DbUser, DbCompany } from '@/types/database'

export type { MailAction, InboxBrief }

const KEY = 'today-mail-briefs'
/** A brief older than this is thrown away — the day it was written for is gone. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000
/** One call is one card. More than this and the prompt stops fitting. */
const BATCH = 8

interface Cached extends InboxBrief {
  /** The message the brief was written for. A newer one re-drafts. */
  messageId: string
  at: number
  /** Who it answers and what about — so a draft can be named somewhere the
   *  mail itself is not loaded, like the notification bell. */
  fromName?: string
  subject?: string
}

type Store = Record<string, Cached>

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    const all = raw ? JSON.parse(raw) as Store : {}
    const cut = Date.now() - TTL_MS
    // Expiry happens on read, so a browser left open for a week does not keep
    // handing back last Tuesday's draft.
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v?.at > cut))
  } catch { return {} }
}

function save(s: Store): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* quota */ }
}

/** Forget one, so it is written again from scratch. */
export function forgetBrief(threadId: string): void {
  const s = load()
  delete s[threadId]
  save(s)
}

export interface BriefInput {
  /** The Gmail thread id — what the card keys its rows by. */
  id: string
  /** The message the brief is about; a newer one invalidates the old brief. */
  messageId: string
  fromName: string
  fromEmail: string
  subject: string
  receivedAt: string
  addressedToMe: boolean
  body: string
}

export interface BriefResult {
  briefs: Record<string, InboxBrief>
  /** Why nothing was written, when nothing was — shown quietly, not as an error. */
  unavailable: string | null
}

/**
 * Briefs for a set of rows: the cached ones immediately, the rest in one call.
 * `onPartial` fires once with what the cache already had, so the summaries that
 * are known appear without waiting for the model.
 */
export async function briefsFor(
  rows: BriefInput[],
  ctx: { user: DbUser; companies: DbCompany[]; me: string },
  onPartial?: (briefs: Record<string, InboxBrief>) => void,
): Promise<BriefResult> {
  const store = load()
  const have: Record<string, InboxBrief> = {}
  const missing: BriefInput[] = []

  for (const r of rows) {
    const c = store[r.id]
    if (c && c.messageId === r.messageId) have[r.id] = { id: c.id, summary: c.summary, action: c.action, draft: c.draft }
    else missing.push(r)
  }

  if (Object.keys(have).length) onPartial?.(have)
  if (missing.length === 0) return { briefs: have, unavailable: null }

  const messages: InboxMessage[] = missing.slice(0, BATCH).map(r => ({
    id: r.id,
    fromName: r.fromName,
    fromEmail: r.fromEmail,
    subject: r.subject,
    receivedAt: r.receivedAt,
    addressedToMe: r.addressedToMe,
    body: r.body,
  }))

  try {
    const written = await briefInbox({ user: ctx.user, companies: ctx.companies, me: ctx.me, messages })
    const next = load()
    for (const b of written) {
      const row = missing.find(r => r.id === b.id)
      if (!row) continue
      next[b.id] = { ...b, messageId: row.messageId, at: Date.now(), fromName: row.fromName, subject: row.subject }
      have[b.id] = b
    }
    save(next)
    return { briefs: have, unavailable: null }
  } catch (err) {
    // Not having a key is the ordinary case on a fresh browser, and it is not
    // an error the card should shout about — it just has no summaries.
    const why = err instanceof ProfessorError && err.code === 'config_error'
      ? 'Summaries and drafts need an AI key — Settings → AI.'
      : `Summaries could not be written: ${err instanceof Error ? err.message : 'unknown'}`
    return { briefs: have, unavailable: why }
  }
}

export interface PendingDraft {
  threadId: string
  messageId: string
  fromName: string
  subject: string
  draft: string
  /** When it was written. */
  at: number
}

/** Every reply that is written and has not been sent. Sending forgets the
 *  brief, so what is left here is exactly what is waiting on a click. */
export function pendingDrafts(): PendingDraft[] {
  return Object.entries(load())
    .filter(([, c]) => c?.draft?.trim())
    .map(([threadId, c]) => ({
      threadId, messageId: c.messageId, draft: c.draft,
      fromName: c.fromName ?? '', subject: c.subject ?? '', at: c.at,
    }))
    .sort((a, b) => b.at - a.at)
}

/** The draft already written for this message, if the cache has one — what the
 *  Mail module opens with, so a reply drafted by the automation is there. */
export function cachedDraft(threadId: string, messageId: string): string | null {
  const c = load()[threadId]
  return c && c.messageId === messageId && c.draft.trim() ? c.draft : null
}

/** Overwrite one brief's draft — what the review popup saves when it is edited. */
export function rememberDraft(threadId: string, draft: string): void {
  const s = load()
  if (s[threadId]) { s[threadId] = { ...s[threadId], draft, at: Date.now() }; save(s) }
}
