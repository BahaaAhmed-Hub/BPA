// ─── Taking somebody to an account ───────────────────────────────────────────
//
//  A debt goal is derived from an account, and until now it named it and
//  stopped there — so "which account is this about?" was a question the screen
//  posed and could not answer. Two accounts with similar names, or one since
//  renamed, and the only way through was guessing.
//
//  The click happens on Goals, where Balances is not mounted, so an event
//  alone is shouted into an empty room. The id is parked here as well and
//  claimed on mount, whichever order the two happen in.

export const OPEN_ACCOUNT = 'finance:openAccount'

let pending: string | null = null

/** Switch to Balances and pick this account out of the list. */
export function openAccount(accountId: string): void {
  pending = accountId
  window.dispatchEvent(new CustomEvent(OPEN_ACCOUNT, { detail: { accountId } }))
}

/** Read once, by whoever mounts first. A second reader gets null rather than
 *  re-selecting an account the user has since clicked away from. */
export function takePendingAccount(): string | null {
  const id = pending
  pending = null
  return id
}

/** The account id off an `OPEN_ACCOUNT` event, or null if it is malformed. */
export function accountIdOf(e: Event): string | null {
  const d = (e as CustomEvent).detail
  return d && typeof d.accountId === 'string' ? d.accountId : null
}
