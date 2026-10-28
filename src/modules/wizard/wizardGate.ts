import { pushSharedPrefs } from '@/lib/prefSync'

/**
 * Who sees the setup guide: a **new signup**, once.
 *
 * It used to open for anyone whose browser had no `bpa-wizard-done` and no
 * companies or habits — which is also an existing person on a second device
 * before their data had arrived, and a person who had cleared their storage.
 * Absence of local data is not evidence of a new account. The account's own
 * age is: Supabase stamps `created_at` once, on the first sign-in, and nothing
 * a browser does can move it.
 *
 * Finishing or skipping is recorded twice on purpose. `bpa-wizard-done` is this
 * browser's memory; `professor-wizard-done` is a shared pref, so a second device
 * pulls it and never opens the guide the first one already closed.
 */
export const WIZARD_DONE_KEY   = 'bpa-wizard-done'
export const WIZARD_SHARED_KEY = 'professor-wizard-done'

/** How long an account counts as new. Long enough to come back to it the next day, short enough that nobody established is ever asked. */
export const NEW_SIGNUP_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000
/** A clock that is a minute behind the server's must not make a brand-new account look like it is from the future. */
const SKEW_MS = 60_000

export function wizardDone(): boolean {
  try { return !!localStorage.getItem(WIZARD_DONE_KEY) || !!localStorage.getItem(WIZARD_SHARED_KEY) } catch { return false }
}

/** Done on this browser **and on the account**. */
export function markWizardDone(): void {
  try {
    localStorage.setItem(WIZARD_DONE_KEY, '1')
    localStorage.setItem(WIZARD_SHARED_KEY, '1')
  } catch { /* quota */ }
  void pushSharedPrefs()
}

/** Done on this browser only — for an established account on a new device, where there is nothing to tell the server. */
export function suppressWizardHere(): void {
  try { localStorage.setItem(WIZARD_DONE_KEY, '1') } catch { /* quota */ }
}

/** No `created_at` is not new: a persisted user from before this field existed is exactly the person who must not be asked. */
export function isNewSignup(createdAt: string | undefined, now = Date.now()): boolean {
  if (!createdAt) return false
  const t = Date.parse(createdAt)
  if (!Number.isFinite(t)) return false
  const age = now - t
  return age >= -SKEW_MS && age <= NEW_SIGNUP_DAYS * DAY_MS
}

export interface GateInput { createdAt?: string; hasCompanies: boolean; hasHabits: boolean }

export type GateAnswer = 'open' | 'done' | 'established'

/** `open` — show it. `done` — this account already closed it. `established` — not a new signup, so quietly never. */
export function gateAnswer(i: GateInput, now = Date.now()): GateAnswer {
  if (wizardDone()) return 'done'
  if (!isNewSignup(i.createdAt, now)) return 'established'
  // A new account that already has data came through an import or a second
  // device finishing the work: the guide would be asking for what is there.
  if (i.hasCompanies || i.hasHabits) return 'established'
  return 'open'
}
