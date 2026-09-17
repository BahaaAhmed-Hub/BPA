// ─── Which mailboxes are work ────────────────────────────────────────────────
//
//  The smart view's whole first filter is "is this business mail" — and no
//  header answers that. A personal Gmail and a company address look identical
//  to a parser; the only thing that knows is the person whose addresses they
//  are. So it is asked once, in Settings, and kept.
//
//  It is keyed by **address**, not by account id, for one reason: the account
//  you signed in with is not in `professor-connected-accounts` at all — that
//  key holds the *additional* ones — so an id-keyed flag could not mark your
//  main work mailbox, which is the one that matters most. An address is the one
//  identifier every mailbox here has.
//
//  A shared prefSync key: the answer is about your accounts, not about this
//  browser, so it belongs on every device you open the app on.

import { normaliseEmail } from '@/modules/calendar/NewEventPanel'

const KEY = 'mail-business-accounts'
export const BUSINESS_EVENT = 'professor:businessAccountsChanged'

/** The addresses marked as business, lower-cased. */
export function loadBusinessAccounts(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(list)) return new Set()
    return new Set(list.filter(x => typeof x === 'string').map(x => normaliseEmail(x)))
  } catch { return new Set() }
}

function save(s: Set<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...s])) } catch { /* quota */ }
  window.dispatchEvent(new Event(BUSINESS_EVENT))
}

export function isBusinessAccount(email: string | undefined): boolean {
  return loadBusinessAccounts().has(normaliseEmail(email))
}

export function setBusinessAccount(email: string, business: boolean): void {
  const s = loadBusinessAccounts()
  const a = normaliseEmail(email)
  if (!a) return
  if (business) s.add(a); else s.delete(a)
  save(s)
}

/** The domains your business mailboxes live on — what makes a *sender*
 *  internal, and what "from: your own business domains" means in the search.
 *  A free-mail domain is never one of these: everybody's personal Gmail would
 *  otherwise make every Gmail user a colleague. */
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'mail.com', 'yandex.com', 'zoho.com',
])

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL.has(domain.toLowerCase().replace(/^@/, ''))
}

export function businessDomains(): string[] {
  const out = new Set<string>()
  for (const a of loadBusinessAccounts()) {
    const d = a.split('@')[1]
    if (d && !isFreeMailDomain(d)) out.add(d)
  }
  return [...out]
}

/** Whether an address belongs to one of your own business domains. */
export function isInternalSender(email: string | undefined): boolean {
  const d = normaliseEmail(email).split('@')[1]
  return !!d && businessDomains().includes(d)
}
