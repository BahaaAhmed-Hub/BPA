// ─── Which of your companies is this mail about ──────────────────────────────
//
//  A merged inbox is a list of correspondence with several different businesses
//  at once, and until now the only thing on a row that said which was the
//  mailbox chip — which answers "where did it land", not "whose business is
//  this". Those differ often enough to matter: a colleague at one of your
//  companies writing to your personal address is that company's mail, and a
//  client writing to a company mailbox is that company's mail too.
//
//  So the order is deliberate, and it is the *counterparty first*:
//
//    1. **Somebody at one of your companies.** The sender's domain, then the
//       other addresses on the message. This is the strong signal — a person on
//       your own organisation's domain is that organisation, whatever mailbox
//       the message reached.
//    2. **The mailbox's own company.** A client writing in from a domain you
//       have never heard of is still, plainly, about the business whose inbox
//       they wrote to.
//
//  Nothing is guessed past that: a personal address writing to a personal
//  mailbox has no company, and the row says nothing rather than inventing one.
//  A label that is wrong some of the time is worse than no label, because you
//  cannot tell which times.

import { loadDynamicCompanies } from '@/types'
import { loadAccounts } from '@/lib/multiAccount'

export interface MailCompany {
  id: string
  name: string
  color: string
}

/** Everything resolved once per build, because a row does this per message and
 *  a merged inbox is a hundred of them. Dropped when the companies or the
 *  connected accounts change. */
interface Index {
  /** domain → company */
  byDomain: Map<string, MailCompany>
  /** mailbox address → company */
  byMailbox: Map<string, MailCompany>
  all: MailCompany[]
}

let index: Index | null = null

function build(): Index {
  const companies = loadDynamicCompanies().filter(c => !c.hidden)
  const accounts = loadAccounts()
  const byDomain = new Map<string, MailCompany>()
  const byMailbox = new Map<string, MailCompany>()
  const all: MailCompany[] = []

  for (const c of companies) {
    const co: MailCompany = { id: c.id, name: c.name, color: c.color }
    all.push(co)

    const domain = c.emailDomain?.trim().toLowerCase().replace(/^@/, '')
    // First writer wins: two companies claiming one domain is a mistake in
    // Settings, and picking the later one silently would hide it.
    if (domain && !byDomain.has(domain)) byDomain.set(domain, co)

    if (c.accountId) {
      // `primary` is the account you signed in with, which is not in
      // `professor-connected-accounts` at all — Settings offers it under that
      // id and every consumer reads it the same way.
      const address = c.accountId === 'primary'
        ? null
        : accounts.find(a => a.id === c.accountId)?.email?.toLowerCase()
      if (address) byMailbox.set(address, co)
      else if (c.accountId === 'primary') byMailbox.set('primary', co)
    }
  }
  return { byDomain, byMailbox, all }
}

function idx(): Index {
  if (!index) index = build()
  return index
}

/** The companies a chip could name, for a picker or a group order. */
export function mailCompanies(): MailCompany[] {
  return idx().all
}

export function forgetMailCompanies(): void { index = null }

if (typeof window !== 'undefined') {
  window.addEventListener('professor:companiesUpdated', forgetMailCompanies)
  window.addEventListener('professor:accountsUpdated', forgetMailCompanies)
  window.addEventListener('storage', e => {
    if (e.key === 'professor-companies' || e.key === 'professor-connected-accounts') forgetMailCompanies()
  })
}

const DOMAIN = /@([a-z0-9.-]+\.[a-z]{2,})/gi

function domainsIn(...lists: (string | undefined)[]): string[] {
  const out: string[] = []
  for (const list of lists) {
    if (!list) continue
    for (const m of list.matchAll(DOMAIN)) out.push(m[1].toLowerCase())
  }
  return out
}

export interface MailLike {
  fromEmail?: string
  /** Comma-separated, as the header has it. */
  to?: string
  cc?: string
  /** The mailbox it arrived in. */
  accountEmail?: string
  isPrimary?: boolean
}

/**
 * The company a message belongs to, or null where nothing says.
 *
 * The sender is asked first and the other addresses second, so a message *from*
 * a client *to* your colleague still reads as your colleague's company rather
 * than as nothing at all.
 */
export function companyOfMail(m: MailLike): MailCompany | null {
  const { byDomain, byMailbox } = idx()

  const from = domainsIn(m.fromEmail)
  for (const d of from) {
    const hit = byDomain.get(d)
    if (hit) return hit
  }

  const others = domainsIn(m.to, m.cc)
  for (const d of others) {
    const hit = byDomain.get(d)
    if (hit) return hit
  }

  // Nobody on the message is one of yours, so it is whoever's inbox it reached.
  const box = m.accountEmail?.toLowerCase()
  if (box) {
    const linked = byMailbox.get(box)
    if (linked) return linked
    // A mailbox on a company's own domain counts as that company even when
    // nobody has linked the account explicitly.
    const byOwnDomain = byDomain.get(box.split('@')[1] ?? '')
    if (byOwnDomain) return byOwnDomain
  }
  if (m.isPrimary) {
    const primary = byMailbox.get('primary')
    if (primary) return primary
  }
  return null
}

/** What a group of company-less mail is called. One string, in one place, so
 *  the header and the empty state cannot disagree. */
export const NO_COMPANY = 'No company'
