// ─── Company visibility ──────────────────────────────────────────────────────
// Hiding a company in Settings is one decision, so it has to mean the same
// thing everywhere: its tasks, its calendars, its mail and anything counted
// from them all go quiet together. Every surface asks this module rather than
// re-deriving the rule.

import { loadDynamicCompanies, type DynamicCompany } from '@/types'
import { loadAccounts } from '@/lib/multiAccount'

export function hiddenCompanies(): DynamicCompany[] {
  return loadDynamicCompanies().filter(c => c.hidden === true)
}

/** The addresses of connected accounts belonging to hidden companies. */
export function hiddenAccountEmails(): Set<string> {
  const accounts = loadAccounts()
  return new Set(
    hiddenCompanies()
      .filter(c => c.accountId)
      .map(c => accounts.find(a => a.id === c.accountId)?.email?.toLowerCase())
      .filter((e): e is string => !!e),
  )
}

/** The calendar ids explicitly tied to a hidden company. */
export function hiddenCalendarIds(): Set<string> {
  return new Set(
    hiddenCompanies()
      .map(c => c.calendarId)
      .filter((id): id is string => !!id),
  )
}

/** The mail domains of hidden companies, lower-cased and without a leading @. */
export function hiddenMailDomains(): string[] {
  return hiddenCompanies()
    .map(c => c.emailDomain?.trim().toLowerCase().replace(/^@/, ''))
    .filter((d): d is string => !!d)
}

/** A calendar is hidden when its company is, whether tied by account or by id. */
export function isCalendarHiddenByCompany(calendarId?: string, accountEmail?: string): boolean {
  if (calendarId && hiddenCalendarIds().has(calendarId)) return true
  if (accountEmail && hiddenAccountEmails().has(accountEmail.toLowerCase())) return true
  return false
}

/** Mail is hidden when it came from, or was sent to, a hidden company — matched
 *  on the company's own domain, or on the account it landed in. */
export function isMailHiddenByCompany(mail: { from?: string; to?: string; accountEmail?: string }): boolean {
  if (mail.accountEmail && hiddenAccountEmails().has(mail.accountEmail.toLowerCase())) return true
  const domains = hiddenMailDomains()
  if (domains.length === 0) return false
  const haystack = `${mail.from ?? ''} ${mail.to ?? ''}`.toLowerCase()
  return domains.some(d => haystack.includes(`@${d}`))
}
