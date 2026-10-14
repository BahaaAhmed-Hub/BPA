// ─── Acting on mail — the same act, whichever screen you are on ──────────────
//
//  Archive and RSVP used to be written three times. The Mail page archived the
//  **thread** in Gmail and undid itself when Gmail refused; Today archived one
//  **message** (so the thread stayed in the inbox if anything else in it was)
//  and swallowed a refusal — the row left the card and the mail never left
//  Gmail; the assistant did the message version too. And none of the last two
//  told the smart view, so a thread you had dealt with in one place was still
//  waiting on you in another.
//
//  Both here are **server first**: Gmail or Google Calendar must say yes before
//  anything else changes, a refusal comes back as words, and only then are the
//  smart view's marks written so every screen agrees.

import { modifyThread, type MailAccount } from '@/lib/gmail'
import { markThread } from '@/lib/mailSmartDb'
import { respondToInvite, rememberAnswer, type Invite, type Rsvp, type RsvpResult } from '@/lib/invitations'

export type ActResult = { ok: true } | { ok: false; why: string }

/** Take a whole thread out of the inbox in Gmail itself, then record it. */
export async function archiveThread(account: MailAccount, threadId: string): Promise<ActResult> {
  try {
    await modifyThread(threadId, { remove: ['INBOX'] }, account)
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : 'Gmail would not archive it' }
  }
  void markThread(account.email, threadId, { archived_at: new Date().toISOString() })
  return { ok: true }
}

/**
 * Answer an invitation on the calendar the event lives on (the organiser is
 * told — `sendUpdates=all`), then mark the thread dealt with and read. Nothing
 * is marked unless Google recorded the answer.
 */
export async function answerInvitation(
  invite: Invite, account: MailAccount, threadId: string, answer: Rsvp,
): Promise<RsvpResult> {
  const res = await respondToInvite(invite, account, answer)
  if (!res.ok) return res
  rememberAnswer(invite.uid, answer)
  void markThread(account.email, threadId, { handled_at: new Date().toISOString() })
  // Read, so it also leaves anything that lists unread mail. The answer stands whether or not this lands.
  void modifyThread(threadId, { remove: ['UNREAD'] }, account).catch(() => { /* the answer still stands */ })
  return res
}
