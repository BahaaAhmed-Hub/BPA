// ─── Gmail, as a mail provider ───────────────────────────────────────────────
//
//  The only file in the smart view that knows what Gmail is. Everything it
//  does is translation: Gmail's `internalDate` string into milliseconds, its
//  `payload.headers` into the ordinary RFC 5322 list, its MIME tree into a
//  body. A second provider is a second file this size, and nothing else moves.

import {
  listThreadIds, getThread, header, extractBody,
  type GmailMessage, type MailAccount,
} from '@/lib/gmail'
import {
  parseAddressList, parseDisplayName,
  type MailProvider, type MailboxRef, type NeutralMessage, type NeutralThread,
} from '@/lib/mailProvider'

function toNeutral(m: GmailMessage): NeutralMessage {
  const h = m.payload.headers
  const from = header(h, 'From')
  return {
    id: m.id,
    sentAt: Number(m.internalDate),
    from: parseAddressList(from)[0] ?? '',
    fromName: parseDisplayName(from),
    to: parseAddressList(header(h, 'To')),
    cc: parseAddressList(header(h, 'Cc')),
    subject: header(h, 'Subject'),
    snippet: m.snippet ?? '',
    body: extractBody(m),
    headers: h,
  }
}

/** The account a mailbox ref stands for. `MailAccount` is what `gmail.ts`
 *  authenticates with; the engine never sees it. */
function asAccount(box: MailboxRef): MailAccount {
  return { email: box.email, isPrimary: box.isPrimary ?? false }
}

export const gmailProvider: MailProvider = {
  id: 'gmail',

  async listThreadsSince(box, sinceMs, limit) {
    // Gmail's `after:` is in whole seconds. A second of overlap is deliberate:
    // a message landing in the same second as the watermark must not fall
    // between two runs.
    const after = Math.floor(Math.max(0, sinceMs - 1000) / 1000)
    const q = `after:${after} -in:chats -in:spam -in:trash`
    const { ids } = await listThreadIds(limit, undefined, asAccount(box), q)
    return ids
  },

  async getThread(box, threadId): Promise<NeutralThread> {
    const t = await getThread(threadId, asAccount(box))
    return {
      id: t.id,
      // Sorted here, once, so nothing downstream has to wonder about order.
      messages: (t.messages ?? []).map(toNeutral).sort((a, b) => a.sentAt - b.sentAt),
    }
  },
}
