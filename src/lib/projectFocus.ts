import { useEffect, useState } from 'react'

// ─── Looking at one project, across every screen ────────────────────────────
//
// The second lens, beside the company one in `companyFocus.ts`, with the same
// four rules: **dimmed, never hidden**; each module names its own row (this file
// never decides what belongs to a project — the project store's links and the
// task's own `projectId` do); a row that is not demonstrably the project's is
// out of focus; and the way out is always drawn (the rail shows a chip while it
// is on). The two lenses AND: with a company and a project both on, a row has to
// be in both. They share one fade — `OUT_OF_FOCUS` — so it cannot drift.

const KEY = 'professor-project-focus'
export const PROJECT_FOCUS_EVENT = 'professor:projectFocusChanged'

export function focusedProject(): string | null {
  try { return localStorage.getItem(KEY) || null } catch { return null }
}

/** Set the lens, or clear it with `null`. The same value is a no-op. */
export function setFocusedProject(id: string | null): void {
  if (focusedProject() === id) return
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch { /* private window */ }
  window.dispatchEvent(new Event(PROJECT_FOCUS_EVENT))
}

export function useProjectFocus(): [string | null, (id: string | null) => void] {
  const [lens, setLens] = useState<string | null>(() => focusedProject())
  useEffect(() => {
    const read = () => setLens(focusedProject())
    window.addEventListener(PROJECT_FOCUS_EVENT, read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener(PROJECT_FOCUS_EVENT, read)
      window.removeEventListener('storage', read)
    }
  }, [])
  return [lens, setFocusedProject]
}
