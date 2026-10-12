// ─── Is the Library on, for this person? ─────────────────────────────────────
// Two independent answers, and either one turning it off turns it off:
//   · the server's — `my_modules()`, what the plan and admin overrides say;
//   · the person's — Settings → Library, a switch they own.
// The second is a preference and travels with them (`library-settings` is a
// prefSync shared key); which view they last used is a property of the device
// in their hand and does not.
import { useEffect, useState } from 'react'
import { moduleIsOff } from '@/lib/entitlements'

const SETTINGS_KEY = 'library-settings'
const VIEW_KEY = 'library-view'
export const LIBRARY_PREFS_EVENT = 'professor:libraryPrefsChanged'

export interface LibrarySettings { enabled: boolean }
export type LibraryView = 'shelf' | 'covers' | 'lists'

export function loadLibrarySettings(): LibrarySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    // Absent means on: a person who has never opened Settings has not said no.
    if (!raw) return { enabled: true }
    const p = JSON.parse(raw) as Partial<LibrarySettings>
    return { enabled: p.enabled !== false }
  } catch { return { enabled: true } }
}

export function saveLibrarySettings(s: LibrarySettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* private window */ }
  window.dispatchEvent(new Event(LIBRARY_PREFS_EVENT))
}

export function loadLibraryView(): LibraryView {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'covers' || v === 'lists' ? v : 'shelf'
  } catch { return 'shelf' }
}
export function saveLibraryView(v: LibraryView): void {
  try { localStorage.setItem(VIEW_KEY, v) } catch { /* private window */ }
}

/** Off for either reason. Synchronous, for the nav and the loaders. */
export function libraryIsOff(): boolean {
  return moduleIsOff('library') || !loadLibrarySettings().enabled
}

/** Re-render when the person flips the switch, or another tab does. */
export function useLibraryOff(): boolean {
  const [, bump] = useState(0)
  useEffect(() => {
    const on = () => bump(n => n + 1)
    window.addEventListener(LIBRARY_PREFS_EVENT, on)
    window.addEventListener('storage', on)
    window.addEventListener('professor:modulesChanged', on)
    return () => {
      window.removeEventListener(LIBRARY_PREFS_EVENT, on)
      window.removeEventListener('storage', on)
      window.removeEventListener('professor:modulesChanged', on)
    }
  }, [])
  return libraryIsOff()
}
