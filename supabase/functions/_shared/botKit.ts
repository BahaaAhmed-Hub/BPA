// ─── What the Telegram bot and Siri share with the in-app assistant ──────────
//
//  Two halves, both pure TypeScript with the database handed in (so Node can
//  run them against a fake that is able to refuse — there is no Deno here):
//
//   1. THE GATE. `gateCall` stands between the model's request and the tool.
//      An outward, destructive or money act is not run: it is parked in
//      `assistant_pending_actions` and the person approves it with a Telegram
//      button or a spoken "yes". The model's own `confirm: true` is ignored —
//      the click is the confirmation. If the act cannot be parked (the table
//      is missing, the database is down) it is NOT done: the gate fails
//      closed, never open.
//
//   2. THE TOOLS the bots did not have: the app guide, "what needs me" mail,
//      habit create/edit/delete and the Library. They act as the person on
//      the person's own rows (every query is `user_id = <the resolved user>`),
//      and obey the same switches the app does (plan and the person's own).

import { approvalFor, type Approval } from './assistantGate.ts'
import { APP_GUIDE, findGuide } from './appGuide.ts'

// deno-lint-ignore no-explicit-any
export type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any }

export type Channel = 'telegram' | 'siri'
export interface GateCtx { userId: string; channel: Channel; chatId?: string }
export interface Parked { id: string; approval: Approval; tool: string }

/** How long a parked act stays approvable. Mirrors the column default. */
export const PENDING_MINUTES = 10

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// ─── the gate ────────────────────────────────────────────────────────────────

/** What the person is shown and asked: the title and the call's real arguments. */
export function approvalText(a: Approval): string {
  return [a.title, ...a.lines.map(l => `• ${l.label}: ${l.value}`)].join('\n')
}

/** One sentence for a voice: the title and the arguments that matter, nothing read as markup. */
export function approvalSpoken(a: Approval): string {
  const parts = a.lines.slice(0, 4).map(l => `${l.label} ${l.value}`)
  return `${a.title}${parts.length ? ': ' + parts.join(', ') : ''}`
}

/** Returns the id of the parked act, or null when it could not be parked (fail closed). */
export async function parkAction(db: Db, ctx: GateCtx, tool: string, input: Record<string, unknown>, summary: string): Promise<string | null> {
  try {
    // Siri has no buttons: "yes" means the latest thing it asked, so only one can be open.
    if (ctx.channel === 'siri') {
      await db.from('assistant_pending_actions').delete().eq('user_id', ctx.userId).eq('channel', 'siri')
    }
    const { data, error } = await db.from('assistant_pending_actions').insert({
      user_id: ctx.userId, channel: ctx.channel, chat_id: ctx.chatId ?? null, tool, input, summary: clip(summary, 1500),
      expires_at: new Date(Date.now() + PENDING_MINUTES * 60_000).toISOString(),
    }).select('id').single()
    if (error || !data?.id) { console.error('could not park an act for approval:', error); return null }
    return data.id as string
  } catch (e) {
    console.error('could not park an act for approval:', e)
    return null
  }
}

export interface PendingRow { id: string; tool: string; input: Record<string, unknown>; summary: string }

/**
 * Takes a parked act out for good (approve or decline both come through here), so it can run once
 * and only once — two taps, a retried webhook or a repeated "yes" find nothing the second time.
 * It must belong to this person, this channel (and this chat on Telegram) and not have expired.
 */
export async function takeAction(db: Db, id: string, ctx: GateCtx): Promise<PendingRow | null> {
  try {
    let q = db.from('assistant_pending_actions').delete()
      .eq('id', id).eq('user_id', ctx.userId).eq('channel', ctx.channel)
      .gt('expires_at', new Date().toISOString())
    if (ctx.channel === 'telegram') q = q.eq('chat_id', ctx.chatId ?? '')
    const { data, error } = await q.select('id, tool, input, summary')
    if (error) { console.error('could not take a parked act:', error); return null }
    const row = (data ?? [])[0] as PendingRow | undefined
    return row ?? null
  } catch (e) {
    console.error('could not take a parked act:', e)
    return null
  }
}

/** Siri: the act it last asked about, if one is still open. */
export async function latestPendingId(db: Db, userId: string): Promise<string | null> {
  try {
    const { data } = await db.from('assistant_pending_actions').select('id')
      .eq('user_id', userId).eq('channel', 'siri').gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).limit(1)
    return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null
  } catch { return null }
}

/**
 * Is a whole utterance a plain yes or a plain no? Deliberately strict: "yes send it to Ahmed instead"
 * is a new request, not an approval of the old one, so anything longer than a few words is neither.
 */
export function parseYesNo(text: string): 'yes' | 'no' | null {
  const t = text.toLowerCase().replace(/['’]/g, '').replace(/[.!?,؟،"“”]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t || t.split(' ').length > 4) return null
  if (/^(yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|approve|approved|go ahead|do it|send it|please do|yes please|نعم|ايوه|أيوه|ايوة|أيوة|تمام|موافق|أكد|اكد|نفذ)$/.test(t)) return 'yes'
  if (/^(no|nope|nah|cancel|stop|dont|do not|never mind|nevermind|not now|decline|لا|لأ|الغي|ألغي|الغاء|إلغاء|بلاش|ما تبعتش)$/.test(t)) return 'no'
  return null
}

/**
 * The tool wrapper both bots call before running anything. `null` means "not gated, run it".
 * Otherwise the act has been parked (and recorded in `parked` so the bot can show the buttons /
 * speak the question) and the string is what the MODEL is told in place of a result.
 */
export async function gateCall(db: Db, ctx: GateCtx, name: string, input: Record<string, unknown>, parked: Parked[]): Promise<string | null> {
  const approval = approvalFor(name, input)
  if (!approval) return null
  // Siri can hold ONE open question ("yes" means the latest thing it asked), and calls in one turn run
  // side by side, so the slot is reserved here, before the first await.
  if (ctx.channel === 'siri' && parked.length > 0) {
    return 'NOT DONE. By voice only one thing can be approved at a time and another is already waiting. Tell the user this one was not done and to ask for it again after answering the first.'
  }
  const entry: Parked = { id: '', approval, tool: name }
  parked.push(entry)
  const id = await parkAction(db, ctx, name, input, approvalText(approval))
  if (!id) {
    parked.splice(parked.indexOf(entry), 1)
    return 'NOT DONE. I could not ask the user for approval just now, so nothing was done. Tell them it was not done and to try again in a moment. Do not try another way.'
  }
  entry.id = id
  return 'WAITING FOR THE USER\'S APPROVAL. Nothing has been done yet. The user is being shown exactly what you asked for and will approve or decline it. '
    + 'Do NOT say it is done or sent. Reply with at most one short sentence saying you have asked for their OK; do not repeat the details.'
}

// ─── shared helpers ──────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

function pickByName<T extends { id: string }>(rows: T[], q: string, nameOf: (r: T) => string, what: string): { row: T } | { say: string } {
  const want = norm(q)
  if (!want) return { say: `Which ${what}? Say its name.` }
  const exact = rows.filter(r => norm(nameOf(r)) === want)
  if (exact.length === 1) return { row: exact[0] }
  const part = exact.length ? exact : rows.filter(r => norm(nameOf(r)).includes(want))
  if (part.length === 1) return { row: part[0] }
  if (!part.length) return { say: `No ${what} matches "${q}".` }
  return { say: `Several ${what}s match "${q}": ${part.slice(0, 6).map(nameOf).join('; ')}. Which one?` }
}

// ─── mail: what needs me ─────────────────────────────────────────────────────

interface MailRow {
  account_email: string; thread_id: string; subject: string | null; from_name: string | null; from_email: string | null
  last_at: string; section: string; need: string | null; muted: boolean | null; archived_at: string | null; handled_at: string | null
}
const WINDOW_DAYS = 30   // the smart view's own window (mailSmart.WINDOW_DAYS)

/** The smart view's visibility and grouping, on the rows it stored. Pure, and agreed with the app's by a test. */
export function mailNeedsFrom(rows: MailRow[], now = Date.now()) {
  const from = now - WINDOW_DAYS * 864e5
  const vis = rows.filter(r => {
    const last = new Date(r.last_at).getTime()
    if (last < from || r.muted) return false
    if (r.archived_at && new Date(r.archived_at).getTime() >= last) return false
    return true
  }).sort((a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime())
  const groupOf = (r: MailRow) => (r.handled_at && new Date(r.handled_at).getTime() >= new Date(r.last_at).getTime() ? 'fyi' : r.section)
  const line = (r: MailRow) => ({
    from: r.from_name || r.from_email || '', subject: r.subject || '(no subject)', thread_id: r.thread_id,
    mailbox: r.account_email, wants: r.need || '', at: r.last_at,
  })
  return { action: vis.filter(r => groupOf(r) === 'action').map(line), attention: vis.filter(r => groupOf(r) === 'attention').map(line) }
}

// ─── the Library ─────────────────────────────────────────────────────────────

/** Both switches, as the app has them: the plan (server) and the person's own (a synced preference). */
export async function libraryAvailable(db: Db, userId: string): Promise<boolean> {
  try {
    const { data: has } = await db.rpc('has_module', { uid: userId, mod: 'library' })
    if (has === false) return false
    const { data } = await db.from('users').select('schedule_rules').eq('id', userId).maybeSingle()
    const raw = (data as { schedule_rules?: { shared_prefs?: Record<string, string> } } | null)?.schedule_rules?.shared_prefs?.['library-settings']
    if (typeof raw === 'string') return (JSON.parse(raw) as { enabled?: boolean }).enabled !== false
    return true
  } catch { return false }
}

interface BookRow {
  id: string; title: string; authors: string[] | null; status: string; pages: number | null; rating: number
  started_on: string | null; finished_on: string | null; shelf_order: number
}
const bookLine = (b: BookRow) => `${b.title}${b.authors?.length ? ' — ' + b.authors.join(', ') : ''} [${b.status}${b.rating ? `, ${b.rating}/5` : ''}]`
const STATUSES = ['want', 'reading', 'finished', 'paused', 'abandoned']

// ─── tool definitions ────────────────────────────────────────────────────────

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required })

export const KIT_TOOLS = [
  { name: 'app_guide', description: 'How the app works and where things are. Call with a topic (overview, today, calendar, mail, tasks, habits, finance, shopping, library, assistant, settings, search) to answer "how do I…" or "where is…". Answer only from what it returns; if it does not say, say you do not know.',
    input_schema: obj({ topic: { type: 'string' } }) },
  { name: 'mail_needs', description: 'The mail that needs the user: what they owe an answer (action) and what they should know (attention) — the same list the Mail page and Today show. Use this, not get_emails, for "what mail needs me / what is important".',
    input_schema: obj({}) },
  { name: 'create_habit', description: 'Create a habit. Yes/no is "boolean"; counted is "quantity" with a goal and a unit (8 glasses).',
    input_schema: obj({ name: { type: 'string' }, frequency: { type: 'string', enum: ['daily', 'weekdays', 'weekly'] }, type: { type: 'string', enum: ['boolean', 'quantity'] }, goal: { type: 'number' }, unit: { type: 'string' }, emoji: { type: 'string' } }, ['name']) },
  { name: 'update_habit', description: 'Change a habit: rename it, its frequency, goal or unit, or pause it (active:false) or bring it back (active:true). Name it by its name.',
    input_schema: obj({ habit: { type: 'string' }, name: { type: 'string' }, frequency: { type: 'string', enum: ['daily', 'weekdays', 'weekly'] }, goal: { type: 'number' }, unit: { type: 'string' }, active: { type: 'boolean' } }, ['habit']) },
  { name: 'delete_habit', description: 'Delete a habit and its whole history. This cannot be undone and needs the user\'s approval. Prefer update_habit with active:false to pause it.',
    input_schema: obj({ habit: { type: 'string' } }, ['habit']) },
  { name: 'library_overview', description: 'The user\'s Library: how many books by status, what they are reading now, and the latest additions.', input_schema: obj({}) },
  { name: 'library_find_books', description: 'Find books on the shelf by title, author or status.',
    input_schema: obj({ query: { type: 'string' }, status: { type: 'string', enum: STATUSES } }) },
  { name: 'library_add_book', description: 'Put a book on the shelf by hand (title and author as the user said them). No cover or details are fetched from here — say so if asked; the app can fetch them.',
    input_schema: obj({ title: { type: 'string' }, author: { type: 'string' }, status: { type: 'string', enum: STATUSES }, pages: { type: 'number' } }, ['title']) },
  { name: 'library_update_book', description: 'Change a book on the shelf: its status, rating (0-5), review or page count. Name the book by its title.',
    input_schema: obj({ book: { type: 'string' }, status: { type: 'string', enum: STATUSES }, rating: { type: 'number' }, review: { type: 'string' }, pages: { type: 'number' } }, ['book']) },
  { name: 'library_log_reading', description: 'Log a reading or listening sitting: minutes, and the page reached for reading. Starts a want-to-read book. Never marks a book finished by itself.',
    input_schema: obj({ book: { type: 'string' }, minutes: { type: 'number' }, to_page: { type: 'number' }, kind: { type: 'string', enum: ['read', 'listen'] }, date: { type: 'string', description: 'YYYY-MM-DD, default today' } }, ['book', 'minutes']) },
  { name: 'library_add_quote', description: 'Save a quote from a book, with its page if the user said one.',
    input_schema: obj({ book: { type: 'string' }, text: { type: 'string' }, page: { type: 'number' } }, ['book', 'text']) },
  { name: 'library_delete_book', description: 'Remove a book from the shelf with its quotes, notes and reading log. This cannot be undone and needs the user\'s approval.',
    input_schema: obj({ book: { type: 'string' } }, ['book']) },
]
export const KIT_NAMES = new Set(KIT_TOOLS.map(t => t.name))

/** What the bots' prompts say about the new abilities and the approval. */
export const KIT_RULES = `
APP KNOWLEDGE AND APPROVAL:
- For "how do I…", "where is…", "what can you do" about the app, call app_guide and answer ONLY from it. If it does not say, say you do not know — never invent a screen or a feature.
- "What mail needs me / what is important" → mail_needs (the same list the Mail page shows), not get_emails.
- Sending a reply, adding a ledger entry, and any delete are NOT done on your say-so. When you call them the user is asked to approve; the tool result will say WAITING FOR THE USER'S APPROVAL. Then do not say it is done or sent — say you have asked for their OK, in one short sentence. If a tool says NOT DONE or the user declined, say so and do not retry or find another way.
- You can manage habits (create_habit, update_habit, delete_habit) and the Library (library_*). Name books and habits by their names, never by id.`

// ─── tool execution ──────────────────────────────────────────────────────────

/** Runs a kit tool and returns text for the model, or `null` when the name is not a kit tool. */
export async function runKitTool(db: Db, userId: string, name: string, a: Record<string, unknown>, today: string): Promise<string | null> {
  if (!KIT_NAMES.has(name)) return null
  try {
    if (name === 'app_guide') return appGuide(String(a.topic ?? ''))
    if (name === 'mail_needs') return await mailNeeds(db, userId)
    if (name.endsWith('_habit')) return await habitTool(db, userId, name, a)
    if (!(await libraryAvailable(db, userId))) return 'The Library is switched off on this account (by plan or in Settings → Library), so I cannot use it.'
    return await libraryTool(db, userId, name, a, today)
  } catch (e) {
    console.error(`${name} failed:`, e)
    return `Something went wrong with ${name.replace(/_/g, ' ')}. Nothing was changed that I can confirm.`
  }
}

function appGuide(topic: string): string {
  if (!topic.trim()) {
    return 'Topics: ' + Object.entries(APP_GUIDE).map(([id, e]) => `${id} (${e.title})`).join('; ')
      + '. Call app_guide again with one topic. (The "assistant" lines describe the in-app assistant; here you can do a smaller set.)'
  }
  const hit = findGuide(topic)
  if (!hit) return `The guide has no entry for "${topic}". Do not guess — say you do not know, or ask what they are trying to do.`
  const e = hit.entry
  return `${e.title}\nWhere: ${e.where}\n${e.summary}\nYou can: ${e.can.join('; ')}`
}

async function mailNeeds(db: Db, userId: string): Promise<string> {
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString()
  const { data, error } = await db.from('mail_smart_threads')
    .select('account_email, thread_id, subject, from_name, from_email, last_at, section, need, muted, archived_at, handled_at')
    .eq('user_id', userId).gte('last_at', since).order('last_at', { ascending: false }).limit(500)
  if (error) return 'I could not read the mail judgement just now (open the Mail page once so it can be built). Do not guess from raw mail.'
  const n = mailNeedsFrom((data ?? []) as MailRow[])
  const show = (xs: ReturnType<typeof mailNeedsFrom>['action']) => xs.slice(0, 10).map(x => `- ${x.from}: ${x.subject}${x.wants ? ` (${x.wants})` : ''} [thread ${x.thread_id}]`).join('\n') || '- none'
  return `Needs an answer or decision (${n.action.length}):\n${show(n.action)}\n\nGood to know, nothing to answer (${n.attention.length}):\n${show(n.attention)}`
}

async function habitTool(db: Db, userId: string, name: string, a: Record<string, unknown>): Promise<string> {
  if (name === 'create_habit') {
    const nm = String(a.name ?? '').trim()
    if (!nm) return 'A name is needed.'
    const { data: have } = await db.from('habits').select('id, name').eq('user_id', userId).eq('is_active', true)
    if (((have ?? []) as { name: string }[]).some(h => norm(h.name) === norm(nm))) return `You already have a habit called "${nm}".`
    const type = a.type === 'quantity' ? 'quantity' : 'boolean'
    const goal = Number(a.goal)
    if (type === 'quantity' && !(goal > 0)) return 'A counted habit needs a goal above zero (for example 8) and a unit (glasses).'
    const frequency = a.frequency === 'weekdays' || a.frequency === 'weekly' ? a.frequency : 'daily'
    const row = {
      id: crypto.randomUUID(), user_id: userId, name: nm, frequency, current_streak: 0, longest_streak: 0, is_active: true, type,
      emoji: typeof a.emoji === 'string' && a.emoji.trim() ? a.emoji.trim() : '✅', color: '#F5D14E',
      ...(type === 'quantity' ? { goal, unit: typeof a.unit === 'string' ? a.unit.trim() : null } : {}),
    }
    const { error } = await db.from('habits').insert(row)
    if (error) return `Could not create the habit: ${error.message}`
    return `Habit "${nm}" created (${frequency}${type === 'quantity' ? `, ${goal} ${String(a.unit ?? '')}`.trimEnd() : ''}).`
  }
  const { data } = await db.from('habits').select('id, name, is_active').eq('user_id', userId)
  const rows = (data ?? []) as { id: string; name: string; is_active: boolean }[]
  const pick = pickByName(rows, String(a.habit ?? ''), r => r.name, 'habit')
  if ('say' in pick) return pick.say
  const h = pick.row
  if (name === 'delete_habit') {
    const { error } = await db.from('habits').delete().eq('id', h.id).eq('user_id', userId)
    return error ? `Could not delete the habit: ${error.message}` : `Habit "${h.name}" deleted, with its history.`
  }
  const patch: Record<string, unknown> = {}
  if (typeof a.name === 'string' && a.name.trim()) patch.name = a.name.trim()
  if (a.frequency === 'daily' || a.frequency === 'weekdays' || a.frequency === 'weekly') patch.frequency = a.frequency
  if (a.goal !== undefined) { const g = Number(a.goal); if (!(g > 0)) return 'The goal must be above zero.'; patch.goal = g }
  if (typeof a.unit === 'string') patch.unit = a.unit.trim() || null
  if (typeof a.active === 'boolean') patch.is_active = a.active
  if (!Object.keys(patch).length) return 'Nothing to change.'
  const { error } = await db.from('habits').update(patch).eq('id', h.id).eq('user_id', userId)
  return error ? `Could not change the habit: ${error.message}` : `Habit "${h.name}" updated.`
}

async function libraryTool(db: Db, userId: string, name: string, a: Record<string, unknown>, today: string): Promise<string> {
  const { data, error } = await db.from('library_books')
    .select('id, title, authors, status, pages, rating, started_on, finished_on, shelf_order').eq('user_id', userId).limit(3000)
  if (error) return error.code === '42P01' ? 'The Library has not been set up on this project yet (migration 20260025).' : `Could not read the shelf: ${error.message}`
  const books = (data ?? []) as BookRow[]

  if (name === 'library_overview') {
    const by = (s: string) => books.filter(b => b.status === s)
    const reading = by('reading').map(bookLine).join('; ') || 'nothing'
    return `${books.length} books: ${STATUSES.map(s => `${by(s).length} ${s}`).join(', ')}.\nReading now: ${reading}.`
  }
  if (name === 'library_find_books') {
    const q = norm(String(a.query ?? ''))
    const hits = books.filter(b => (!a.status || b.status === a.status) && (!q || norm(`${b.title} ${(b.authors ?? []).join(' ')}`).includes(q)))
    return hits.length ? `${hits.length} found:\n` + hits.slice(0, 15).map(b => `- ${bookLine(b)}`).join('\n') : 'No book on the shelf matches.'
  }
  if (name === 'library_add_book') {
    const title = String(a.title ?? '').trim()
    if (!title) return 'A title is needed.'
    const author = String(a.author ?? '').trim()
    const dup = books.find(b => norm(b.title) === norm(title) && (!author || !b.authors?.length || norm(b.authors[0]) === norm(author)))
    if (dup) return `"${dup.title}" is already on the shelf (${dup.status}); nothing added.`
    const status = STATUSES.includes(String(a.status)) ? String(a.status) : 'want'
    const pages = Number(a.pages)
    const row = {
      id: crypto.randomUUID(), user_id: userId, title, authors: author ? [author] : [], source: 'manual', status, format: 'print', rating: 0,
      shelf_order: books.reduce((m, b) => Math.max(m, b.shelf_order), -1) + 1,
      ...(pages > 0 ? { pages: Math.floor(pages) } : {}),
      ...(status === 'reading' ? { started_on: today } : {}),
      ...(status === 'finished' ? { finished_on: today } : {}),
    }
    const { error: e } = await db.from('library_books').insert(row)
    return e ? `Could not add the book: ${e.message}` : `Added "${title}"${author ? ' by ' + author : ''} as ${status}. (No cover or details were fetched.)`
  }

  const pick = pickByName(books, String(a.book ?? ''), b => b.title, 'book')
  if ('say' in pick) return pick.say
  const b = pick.row

  if (name === 'library_delete_book') {
    const { error: e } = await db.from('library_books').delete().eq('id', b.id).eq('user_id', userId)
    return e ? `Could not remove the book: ${e.message}` : `Removed "${b.title}" from the shelf, with its quotes, notes and reading log.`
  }
  if (name === 'library_update_book') {
    const patch: Record<string, unknown> = {}
    if (a.status !== undefined) {
      if (!STATUSES.includes(String(a.status))) return `Status must be one of ${STATUSES.join(', ')}.`
      patch.status = a.status
      // The app's rule: starting stamps the day once; coming off finished clears the finish date.
      if (a.status === 'reading' && !b.started_on) patch.started_on = today
      if (a.status === 'finished') { if (!b.finished_on) patch.finished_on = today; if (!b.started_on) patch.started_on = today }
      if (a.status !== 'finished' && b.finished_on) patch.finished_on = null
    }
    if (a.rating !== undefined) { const r = Number(a.rating); if (!Number.isInteger(r) || r < 0 || r > 5) return 'A rating is a whole number from 0 to 5.'; patch.rating = r }
    if (typeof a.review === 'string') patch.review = a.review.trim() || null
    if (a.pages !== undefined) { const p = Number(a.pages); if (!(p > 0)) return 'Pages must be above zero.'; patch.pages = Math.floor(p) }
    if (!Object.keys(patch).length) return 'Nothing to change.'
    patch.updated_at = new Date().toISOString()
    const { error: e } = await db.from('library_books').update(patch).eq('id', b.id).eq('user_id', userId)
    return e ? `Could not change the book: ${e.message}` : `Updated "${b.title}".`
  }
  if (name === 'library_add_quote') {
    const text = String(a.text ?? '').trim()
    if (!text) return 'The quote needs words.'
    const page = Number(a.page)
    const { error: e } = await db.from('library_quotes').insert({
      id: crypto.randomUUID(), user_id: userId, book_id: b.id, kind: 'text', body: text, ...(page > 0 ? { page: Math.floor(page) } : {}),
    })
    return e ? `Could not save the quote: ${e.message}` : `Saved the quote from "${b.title}"${page > 0 ? ` (page ${Math.floor(page)})` : ''}.`
  }
  if (name === 'library_log_reading') {
    const minutes = Math.round(Number(a.minutes))
    if (!(minutes >= 1 && minutes <= 1440)) return 'Minutes must be between 1 and 1440.'
    const on = a.date === undefined ? today : String(a.date)
    if (!isDay(on)) return 'The date must look like 2026-10-14.'
    if (on > today) return 'That day has not happened yet.'
    const kind = a.kind === 'listen' ? 'listen' : 'read'
    const toPage = a.to_page === undefined ? null : Math.floor(Number(a.to_page))
    if (toPage !== null && (!(toPage >= 0) || (b.pages && toPage > b.pages))) return `The page must be between 0 and ${b.pages ?? 'the last page'}.`
    const { data: prior } = await db.from('library_sessions').select('to_page').eq('user_id', userId).eq('book_id', b.id)
    const furthest = ((prior ?? []) as { to_page: number | null }[]).reduce((m, s) => Math.max(m, s.to_page ?? 0), 0)
    // New ground only: re-reading or jumping back is time spent, not progress.
    const pages = kind === 'read' && toPage !== null ? Math.max(0, toPage - furthest) : null
    const { error: e } = await db.from('library_sessions').insert({
      id: crypto.randomUUID(), user_id: userId, book_id: b.id, kind, on_date: on, minutes,
      pages, to_page: kind === 'read' ? toPage : null,
    })
    if (e) return `Could not log it: ${e.message}`
    if (b.status === 'want') await db.from('library_books').update({ status: 'reading', started_on: b.started_on ?? on, updated_at: new Date().toISOString() }).eq('id', b.id).eq('user_id', userId)
    const reached = Math.max(furthest, toPage ?? 0)
    return `Logged ${minutes} min ${kind === 'listen' ? 'listening' : 'reading'} "${b.title}" on ${on}.`
      + (b.pages && reached ? ` Progress: page ${reached} of ${b.pages} (${Math.round((reached / b.pages) * 100)}%).` : reached ? ` Furthest page: ${reached}.` : '')
      + (b.pages && reached >= b.pages ? ' That is the last page — say if you want it marked finished.' : '')
  }
  return `Unknown Library tool ${name}.`
}
