// ─── What the last read of the mail found ────────────────────────────────────
//
// The bell is worked out synchronously from what the device holds, and mail
// lives behind a network call. So whoever reads the mail leaves a note of what
// was in it, and the bell reads the note. Two things follow from that:
//
// - **It is a snapshot, not a claim about now.** `readAt` says when it was
//   taken, and a note older than `STALE_DAYS` is ignored rather than shown —
//   "Hasan has been waiting" is worth saying about mail read this morning and
//   not about mail read last week from a laptop that has been shut since.
// - **Anything acted on is forgotten immediately.** Sending, archiving or
//   marking read drops the row here too, so the bell does not go on asking for
//   a reply that has been sent.

const KEY = 'professor-mail-waiting'
const STALE_DAYS = 3
/** More than this and the note is a mail client, not a note. */
const KEEP = 40

export interface WaitingMail {
  /** The Gmail thread id — what the Today card and the brief cache key on. */
  id: string
  messageId: string
  fromName: string
  fromEmail: string
  subject: string
  /** ISO. */
  receivedAt: string
  /** Which mailbox it arrived in. */
  mailbox: string
  /** Addressed to you, and not a campaign — what the app calls NEEDS YOU. */
  needsYou: boolean
}

interface Note { readAt: string; rows: WaitingMail[] }

export function loadWaiting(): Note | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const note = JSON.parse(raw) as Note
    if (!note?.readAt || !Array.isArray(note.rows)) return null
    if (Date.now() - new Date(note.readAt).getTime() > STALE_DAYS * 86400_000) return null
    return note
  } catch { return null }
}

/** Replace the note. The caller has just read every mailbox, so what it did
 *  not find is not there any more — merging would keep answered mail alive. */
export function rememberWaiting(rows: WaitingMail[]): void {
  const note: Note = {
    readAt: new Date().toISOString(),
    rows: [...rows]
      .sort((a, b) => Number(b.needsYou) - Number(a.needsYou) || b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, KEEP),
  }
  try { localStorage.setItem(KEY, JSON.stringify(note)) } catch { /* quota */ }
}

/** One thread is dealt with — sent, archived, read. */
export function forgetWaiting(id: string): void {
  const note = loadWaiting()
  if (!note) return
  const rows = note.rows.filter(r => r.id !== id)
  if (rows.length === note.rows.length) return
  try { localStorage.setItem(KEY, JSON.stringify({ ...note, rows })) } catch { /* quota */ }
}

/** Whether the mail has ever been read on this device — the difference between
 *  "nothing is waiting" and "nothing has looked". */
export function mailEverRead(): boolean {
  try { return localStorage.getItem(KEY) != null } catch { return false }
}
