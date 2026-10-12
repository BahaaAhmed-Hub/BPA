import { useEffect, useState } from 'react'

// ─── Looking at one company, across every screen ────────────────────────────
//
// The company rail under the nav picks a lens. With one chosen, everything on
// the screen that is **not** that company's goes quiet and what is stays as it
// was — the calendar first, and tasks and mail the same way, because "whose is
// this?" is one question whatever module is open.
//
// Four rules hold this together, and each is a mistake this project has made
// somewhere else already:
//
// - **Dimmed, never hidden.** Removing the rest would make a filtered screen
//   indistinguishable from an empty one — *a reload is not an empty ledger*,
//   pointed at a lens instead of a load. You can still see the shape of the
//   week behind the company you are reading, which is most of why you looked.
// - **One answer to one question.** Each module already knows how to name the
//   company of its own row — `companyForCalendar`, `task.companyId`,
//   `companyOfMail` — so this file never re-derives any of that. It takes the
//   id those produce and answers only *is it in focus*. A second resolver here
//   would be a second answer about the same row.
// - **Not knowing is not the same as not matching.** A row whose company is
//   `undefined` — mail from a stranger, a task nobody filed — is **dimmed**
//   under a lens, because it is certainly not the company you asked for. But
//   that is a different fact from a row this app could not resolve, and the
//   two are deliberately the same here: with a lens on, the question is
//   "show me this company", and anything that is not demonstrably it is not it.
// - **The way out is always drawn.** The lens survives a reload (it is per
//   browser, like every other view preference here), which is only safe
//   because the rail that set it is on every screen with the chosen tile
//   ringed. A filter you cannot see is one you will report as missing data.

const KEY = 'professor-company-focus'
/** Fired on this tab when the lens changes; `storage` covers the others. */
export const FOCUS_EVENT = 'professor:companyFocusChanged'

/** The company being looked at, or null for all of them. */
export function focusedCompany(): string | null {
  try { return localStorage.getItem(KEY) || null } catch { return null }
}

/** Set the lens, or clear it with `null`. Writing the same value is a no-op,
 *  so a rail that re-renders cannot fire an event storm. */
export function setFocusedCompany(id: string | null): void {
  if (focusedCompany() === id) return
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch { /* private window */ }
  window.dispatchEvent(new Event(FOCUS_EVENT))
}

/** The class an out-of-focus thing wears. One rule in `index.css` owns what
 *  that looks like, so the fade cannot drift between modules. */
export const OUT_OF_FOCUS = 'sb-out-of-focus'

/** `focusClassFor(lens, companyId)` — '' while in focus, the class when not.
 *
 *  Pure, and exported on its own so it can be tested without a browser: the
 *  interesting cases are all about absence (no lens, no company) and those are
 *  exactly the ones a rendering test is worst at pinning down.
 */
export function focusClassFor(lens: string | null, companyId: string | null | undefined): string {
  if (!lens) return ''            // no lens: everything is in focus
  return companyId === lens ? '' : OUT_OF_FOCUS
}

/** The lens, live. Re-reads on this tab's own event and on `storage`, so a
 *  second tab (or a second device, once prefs sync) moves with it. */
export function useCompanyFocus(): [string | null, (id: string | null) => void] {
  const [lens, setLens] = useState<string | null>(() => focusedCompany())
  useEffect(() => {
    const read = () => setLens(focusedCompany())
    window.addEventListener(FOCUS_EVENT, read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener(FOCUS_EVENT, read)
      window.removeEventListener('storage', read)
    }
  }, [])
  return [lens, setFocusedCompany]
}

/** The one call a row makes: `focusClass(task.companyId)`. */
export function useFocusClass(): (companyId: string | null | undefined) => string {
  const [lens] = useCompanyFocus()
  return (companyId) => focusClassFor(lens, companyId)
}
