// ─── One pass of the smart view ──────────────────────────────────────────────
//
//  This runs when the Mail tab is opened and once a day. Done naively it would
//  be the most expensive thing in the app — thirty days of mail re-read and
//  every thread re-analysed, several times an hour, for an answer that has not
//  changed since breakfast. The whole design here is about not doing that.
//
//  Three levels of avoidance, cheapest first:
//
//  1. **The watermark.** Each mailbox remembers how far it has been read, so
//     Gmail is asked for `after:<watermark>` rather than for thirty days.
//     Reopening the tab with no new mail lists zero threads.
//  2. **The message id.** A thread whose newest message is the one already
//     stored is finished: it is not fetched and not analysed. Its stored row is
//     the answer.
//  3. **The model, last.** Only threads that survived (1) and (2) — genuinely
//     new or genuinely changed — are sent, in batches, and only for the three
//     things headers cannot answer.
//
//  A pass that finds nothing new does no fetching, no analysis and no writing.

import type { MailAccount } from '@/lib/gmail'
import { gmailProvider } from '@/lib/gmailProvider'
import type { MailProvider, NeutralMessage } from '@/lib/mailProvider'
import {
  readThread, isBusinessThread, sectionFor, orderThreads,
  windowStart, meSet, firstNameOf, type ThreadFacts, type SmartSection, type ReplyState,
} from '@/lib/mailSmart'
import { isBusinessAccount } from '@/lib/businessAccounts'
import {
  loadSmartThreads, saveSmartThreads, loadSyncMarks, saveSyncMark,
  pruneSmartThreads, type SmartRow,
} from '@/lib/mailSmartDb'

/** Where a pass keeps what it learned.
 *
 *  It is a parameter rather than a direct import so the expensive-path logic —
 *  what gets refetched, what gets re-analysed — can be tested without a
 *  database in the room. The default is the real one, so no caller has to care. */
export interface SmartStore {
  load(accounts: string[], since: Date): Promise<SmartRow[] | null>
  save(rows: Omit<SmartRow, 'analyzed_at'>[]): Promise<void>
  marks(accounts: string[]): Promise<Record<string, number>>
  setMark(accountEmail: string, syncedTo: number): Promise<void>
  prune(before: Date): Promise<void>
}

export const serverStore: SmartStore = {
  load: loadSmartThreads,
  save: saveSmartThreads,
  marks: loadSyncMarks,
  setMark: saveSyncMark,
  prune: pruneSmartThreads,
}
import { triageMail, ProfessorError, type TriageInput } from '@/lib/professor'
import type { DbUser, DbCompany } from '@/types/database'

/** A thread as the view draws it: the facts, plus whatever the model added. */
export interface SmartThread {
  accountEmail: string
  threadId: string
  lastMessageId: string
  subject: string
  fromName: string
  fromEmail: string
  lastAt: number
  section: SmartSection
  replyState: ReplyState
  need: string
  draft: string
  direct: boolean
  addressedTo: boolean
  bottleneck: boolean
  awaitingCustomer: boolean
  handled: boolean
}

export interface PassResult {
  threads: SmartThread[]
  /** What the pass actually did, so the view can say so rather than spin. */
  fetched: number
  analysed: number
  /** Named mailboxes that could not be opened; the rest still arrived. */
  failed: { email: string; reason: string }[]
  /** Set when a model is configured but the call did not go through. The rows
   *  are still real — they just have no sentence on them. */
  aiError?: string
}

/** One call is one prompt; more than this and it stops fitting. */
const BATCH = 6
/** A ceiling on a single pass, so a first run over a busy year cannot turn into
 *  hundreds of thread fetches in one go. What is left is picked up next time,
 *  because the watermark only advances over what was actually read. */
const MAX_PER_PASS = 40

function rowToThread(r: SmartRow): SmartThread {
  return {
    accountEmail: r.account_email, threadId: r.thread_id, lastMessageId: r.last_message_id,
    subject: r.subject ?? '(no subject)', fromName: r.from_name ?? '', fromEmail: r.from_email ?? '',
    lastAt: new Date(r.last_at).getTime(),
    section: r.section, replyState: r.reply_state,
    need: r.need ?? '', draft: r.draft ?? '', direct: r.direct,
    addressedTo: r.addressed_to, bottleneck: r.bottleneck,
    awaitingCustomer: r.awaiting_customer, handled: !!r.handled_at,
  }
}

function factsToRow(f: ThreadFacts, t: { direct: boolean; need: string; draft: string }): Omit<SmartRow, 'analyzed_at'> {
  return {
    account_email: f.accountEmail, thread_id: f.threadId, last_message_id: f.lastMessageId,
    last_at: new Date(f.lastAt).toISOString(),
    subject: f.subject, from_name: f.fromName, from_email: f.fromEmail,
    section: sectionFor(f, t.direct), reply_state: f.replyState,
    need: t.need || null, draft: t.draft || null, direct: t.direct,
    addressed_to: f.addressedTo, named_in_body: f.namedInBody,
    // The model can promote a thread the headers read as a copy — a deliverable
    // assigned to you in a recap is yours, whatever the To line says.
    bottleneck: f.bottleneck || (t.direct && f.staleInbound),
    awaiting_customer: f.awaitingCustomer,
    handled_at: null,
  }
}

export async function runSmartPass(opts: {
  accounts: MailAccount[]
  user: DbUser
  companies: DbCompany[]
  /** Ignore the watermark and re-read the whole window. The Refresh button. */
  full?: boolean
  now?: number
  store?: SmartStore
  /** Which mail system these mailboxes are on. Gmail unless told otherwise —
   *  the engine itself has no opinion. */
  provider?: MailProvider
}): Promise<PassResult> {
  const store = opts.store ?? serverStore
  const provider = opts.provider ?? gmailProvider
  const now = opts.now ?? Date.now()
  const from = windowStart(now)
  const emails = opts.accounts.map(a => a.email)
  const me = meSet(emails)
  const myFirstName = firstNameOf(opts.user.full_name ?? undefined, emails[0] ?? '')

  // What is already known. `null` means the store could not be asked — the pass
  // then behaves like a first run rather than pretending there is nothing.
  const cachedRows = await store.load(emails, new Date(from))
  const cached = new Map<string, SmartRow>()
  for (const r of cachedRows ?? []) cached.set(`${r.account_email}|${r.thread_id}`, r)

  const marks = opts.full ? {} : await store.marks(emails)
  const failed: PassResult['failed'] = []
  let fetched = 0

  // ── Each mailbox, in parallel. One that will not open names itself and the
  //    rest still arrive — the same contract the normal view already has.
  const perAccount = await Promise.all(opts.accounts.map(async account => {
    const since = Math.max(marks[account.email] ?? 0, from)
    try {
      const box = { email: account.email, isPrimary: account.isPrimary }
      const ids = await provider.listThreadsSince(box, since, MAX_PER_PASS)
      const business = isBusinessAccount(account.email)
      const out: { facts: ThreadFacts; newest: NeutralMessage }[] = []
      for (const id of ids) {
        const key = `${account.email}|${id}`
        const known = cached.get(key)
        const full = await provider.getThread(box, id)
        fetched++
        const facts = readThread(full, account.email, me, myFirstName, now)
        if (!facts) continue
        // Level 2: the newest message is the one already read — keep the stored
        // reading, including whatever the model said about it.
        if (known && known.last_message_id === facts.lastMessageId) continue
        const newest = full.messages[full.messages.length - 1]
        if (!isBusinessThread(facts, newest, business)) continue
        out.push({ facts, newest })
      }
      return { account, out, reachedEnd: ids.length < MAX_PER_PASS }
    } catch (e) {
      failed.push({ email: account.email, reason: e instanceof Error ? e.message : 'could not be read' })
      return { account, out: [], reachedEnd: false }
    }
  }))

  // ── Level 3: the model, for what is left and nothing else.
  const changed = perAccount.flatMap(p => p.out)
  let aiError: string | undefined
  const readings = new Map<string, { direct: boolean; need: string; draft: string }>()
  for (const { facts } of changed) readings.set(facts.threadId, { direct: false, need: '', draft: '' })

  if (changed.length > 0) {
    const inputs: TriageInput[] = changed.map(({ facts, newest }) => ({
      id: facts.threadId,
      subject: facts.subject, fromName: facts.fromName, fromEmail: facts.fromEmail,
      receivedAt: new Date(facts.lastAt).toISOString(),
      addressedToMe: facts.addressedTo,
      replyState: facts.replyState,
      body: newest.body,
    }))
    for (let i = 0; i < inputs.length; i += BATCH) {
      const slice = inputs.slice(i, i + BATCH)
      try {
        const got = await triageMail({
          user: opts.user, companies: opts.companies, me: emails[0] ?? '', threads: slice,
        })
        for (const r of got) readings.set(r.id, { direct: r.direct, need: r.need, draft: r.draft })
      } catch (e) {
        // No key, no quota, a parse failure: the rows are still real and still
        // sorted by everything the headers said. Only the sentences are missing,
        // and the view says so once rather than down every row.
        aiError = e instanceof ProfessorError ? e.message
          : e instanceof Error ? e.message : 'the model could not be reached'
        break
      }
    }
  }

  // ── Store, and move each watermark to the newest thing that mailbox actually
  //    returned. A mailbox that failed keeps its old mark and is simply read
  //    again next time.
  const rows = changed.map(({ facts }) =>
    factsToRow(facts, readings.get(facts.threadId) ?? { direct: false, need: '', draft: '' }))
  await store.save(rows)
  await Promise.all(perAccount.map(p => {
    if (!p.reachedEnd && p.out.length === 0 && failed.some(f => f.email === p.account.email)) return
    const newest = p.out.reduce((m, x) => Math.max(m, x.facts.lastAt), marks[p.account.email] ?? from)
    return store.setMark(p.account.email, Math.max(newest, marks[p.account.email] ?? 0))
  }))
  void store.prune(new Date(from))

  // ── What the view draws: everything stored, with this pass's rows over it.
  const merged = new Map<string, SmartThread>()
  for (const r of cachedRows ?? []) merged.set(`${r.account_email}|${r.thread_id}`, rowToThread(r))
  for (const r of rows) merged.set(`${r.account_email}|${r.thread_id}`,
    rowToThread({ ...r, analyzed_at: new Date().toISOString() } as SmartRow))

  const threads = [...merged.values()]
    .filter(t => t.lastAt >= from)
    .sort((a, b) => orderThreads(
      { bottleneck: a.bottleneck, lastAt: a.lastAt } as ThreadFacts,
      { bottleneck: b.bottleneck, lastAt: b.lastAt } as ThreadFacts))

  return { threads, fetched, analysed: changed.length, failed, aiError }
}
