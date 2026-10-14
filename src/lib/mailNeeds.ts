// ─── What needs you — one answer, for every screen ───────────────────────────
//
//  The Mail page's smart view, Today's mail card and the assistant used to
//  decide "what is important" three different ways (the first from stored
//  analysis, the second from its own sender rules and an unread query, the
//  third from nothing at all — a raw Gmail search the model had to judge). One
//  thread could be an action on one screen, a newsletter on the second and a
//  line in a list on the third.
//
//  This is the one place that answers it. It reads what the smart view stored
//  (so the nightly pass, the Mail tab and every mark made on any screen agree),
//  applies the smart view's own visibility rules, and groups with the smart
//  view's own sentence: **handled goes to FYI, whatever the section.**
//
//  It never invents a judgement. A thread the store has not seen yet is simply
//  not here — callers that must show *something* for it keep a live fallback of
//  their own, and say which they used.

import { loadSmartThreads } from '@/lib/mailSmartDb'
import { rowToThread, visibleThreads, type SmartThread } from '@/lib/mailSmartSync'
import { windowStart, type SmartSection } from '@/lib/mailSmart'
import type { MailAction } from '@/lib/mailBriefs'

export const keyOf = (t: { accountEmail: string; threadId: string }) => `${t.accountEmail}|${t.threadId}`

/** Which section a thread is shown under. Handled is always FYI: that is where "done" goes. */
export const groupOf = (t: SmartThread): SmartSection => (t.handled ? 'fyi' : t.section)

export interface Needs {
  /** You owe somebody an answer, a decision or a reply. */
  action: SmartThread[]
  /** You should know — nothing to answer. */
  attention: SmartThread[]
  /** Every thread the smart view would show, in its order, with its group via `groupOf`. */
  all: SmartThread[]
  /** The visible threads by `keyOf`, for a screen that has its own list and asks "what does the smart view say about this one?". */
  byKey: Map<string, SmartThread>
  /** Every thread the store holds, visible or not. In here but not in `byKey` means you archived, muted or hid it:
   *  a decision, which is a different thing from "the smart view has never seen this". */
  stored: Set<string>
}

/**
 * The smart view's visible threads for these mailboxes, grouped. `null` means
 * "could not ask" (not signed in, or the table is not there), never "nothing":
 * an empty answer would read as an empty inbox.
 */
export async function readNeeds(accountEmails: string[], now = Date.now()): Promise<Needs | null> {
  const from = windowStart(now)
  const rows = await loadSmartThreads(accountEmails, new Date(from))
  if (!rows) return null
  const all = visibleThreads(rows.map(rowToThread), from)
  return {
    action: all.filter(t => groupOf(t) === 'action'),
    attention: all.filter(t => groupOf(t) === 'attention'),
    all,
    byKey: new Map(all.map(t => [keyOf(t), t])),
    stored: new Set(rows.map(r => `${r.account_email}|${r.thread_id}`)),
  }
}

/**
 * What a row on Today is asking of you — the word on its chip.
 *
 * The model's reading (`briefed`: reply / schedule / decide / read) says *what kind* of ask a message is; it must
 * not say *whether* it is one, because the Mail page already decided that and the two cannot disagree. So where
 * the smart view has judged the thread (`section`): anything it files outside **action** is "to read", and
 * anything it calls an action is never "to read" (it is "to answer" unless the model can be more specific).
 * A thread it has not read yet (`section` undefined) keeps the model's word, and an invitation is "to book" —
 * answering it is the whole of what it wants.
 */
export function askFor(section: SmartSection | undefined, invited: boolean, briefed: MailAction | undefined): MailAction {
  if (invited) return 'schedule'
  const a = briefed ?? 'read'
  if (section === undefined) return a
  if (section !== 'action') return 'read'
  return a === 'read' ? 'reply' : a
}
