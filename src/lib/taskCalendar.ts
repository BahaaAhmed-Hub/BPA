// ─── Which calendar a task belongs on ────────────────────────────────────────
// A task carrying a company should land on that company's calendar. Deciding
// this in one place matters because there are several ways to schedule a task
// and they were not agreeing: the Tasks page read only task.calendarId and put
// everything else on the default calendar, so a Teradix task went to the
// personal one.
//
// A company's calendar and a company's account are separate facts. "Teradix
// Synced" is a group calendar sitting on the ordinary Google account, so a
// company can name a calendar without naming an account, and the calendar must
// still be honoured.

import { loadDynamicCompanies } from '@/types'
import { loadAccounts } from '@/lib/multiAccount'

export interface CalendarTarget {
  calendarId: string
  /** Set only when the company is bound to a connected account other than the
   *  primary one; that account's token has to be used to write to it. */
  accountId?: string
  accountEmail?: string
  /** Why this calendar — for a message that explains itself. */
  source: 'task' | 'company' | 'default'
  companyName?: string
}

/** In order: what the task itself says, then what its company says, then the
 *  default calendar. */
export function resolveTaskCalendar(
  task: { calendarId?: string; companyId?: string; company?: string },
): CalendarTarget {
  const companies = loadDynamicCompanies()
  // `company` has held an id and a name over the life of the app, so match either.
  const tag = task.company?.toLowerCase()
  const co = companies.find(c =>
    (task.companyId && c.id === task.companyId) ||
    (tag && (c.id.toLowerCase() === tag || c.name.toLowerCase() === tag)))

  const account = co?.accountId ? loadAccounts().find(a => a.id === co.accountId) : undefined
  const onOtherAccount = account && !account.isPrimary

  if (task.calendarId) {
    return {
      calendarId: task.calendarId,
      ...(onOtherAccount ? { accountId: account.id, accountEmail: account.email } : {}),
      source: 'task',
      companyName: co?.name,
    }
  }

  if (co?.calendarId) {
    return {
      calendarId: co.calendarId,
      ...(onOtherAccount ? { accountId: account.id, accountEmail: account.email } : {}),
      source: 'company',
      companyName: co.name,
    }
  }

  // A company with an account but no calendar of its own still writes to that
  // account — to its default calendar there, not to the personal one.
  return {
    calendarId: 'primary',
    ...(onOtherAccount ? { accountId: account.id, accountEmail: account.email } : {}),
    source: onOtherAccount ? 'company' : 'default',
    companyName: onOtherAccount ? co?.name : undefined,
  }
}
