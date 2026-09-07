import { loadAccounts } from '@/lib/multiAccount'
import type { MailAccount } from '@/lib/gmail'

// ─── Whose mail is on screen ─────────────────────────────────────────────────
//
// The module read one mailbox — the account you signed in with — and there was
// no way to say which. With two or three connected accounts that is most of
// your mail missing, and no way to tell where a message you *can* see came
// from, or which address a reply would leave from.
//
// The account you signed in with is not in `professor-connected-accounts` —
// that key holds the *additional* ones — so it is added here, as everywhere
// else that needs the whole set.

const VIEW_KEY = 'mail-account-view'

/** Every mailbox this browser can open, the signed-in one first. */
export function mailAccounts(primaryEmail: string | undefined): MailAccount[] {
  const extra = loadAccounts()
    .filter(a => !a.isPrimary && a.email !== primaryEmail)
    .map(a => ({ email: a.email, name: a.name, isPrimary: false }))
  return primaryEmail
    ? [{ email: primaryEmail, isPrimary: true }, ...extra]
    : extra
}

/** `'all'`, or one account's address. */
export type MailView = 'all' | string

export function loadMailView(): MailView {
  try { return localStorage.getItem(VIEW_KEY) || 'all' } catch { return 'all' }
}

export function saveMailView(view: MailView): void {
  try { localStorage.setItem(VIEW_KEY, view) } catch { /* quota */ }
}

/** The mailboxes a view covers. An address no longer connected falls back to
 *  everything, rather than to an empty screen with no explanation. */
export function accountsFor(view: MailView, all: MailAccount[]): MailAccount[] {
  if (view === 'all') return all
  const one = all.find(a => a.email === view)
  return one ? [one] : all
}

/** Enough of an address to tell two accounts apart in a chip. */
export function shortAddress(email: string): string {
  const [user, domain] = email.split('@')
  return domain ? `${user}@${domain.split('.')[0]}` : email
}
