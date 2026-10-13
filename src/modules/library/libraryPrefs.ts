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

export interface LibrarySettings {
  enabled: boolean
  /** ISO 3166 region the buy links point at. Absent = read it from the browser. */
  country?: string
  /** Today's quote of the day. Absent = on: an unopened Settings has not said no. */
  dailyQuote?: boolean
}
export type LibraryView = 'shelf' | 'covers' | 'lists' | 'quotes' | 'discover' | 'tracker'

export function loadLibrarySettings(): LibrarySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    // Absent means on: a person who has never opened Settings has not said no.
    if (!raw) return { enabled: true }
    const p = JSON.parse(raw) as Partial<LibrarySettings>
    return {
      enabled: p.enabled !== false,
      ...(typeof p.country === 'string' && /^[A-Z]{2}$/.test(p.country) ? { country: p.country } : {}),
      ...(p.dailyQuote === false ? { dailyQuote: false } : {}),
    }
  } catch { return { enabled: true } }
}

export function saveLibrarySettings(s: LibrarySettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* private window */ }
  window.dispatchEvent(new Event(LIBRARY_PREFS_EVENT))
}

export function loadLibraryView(): LibraryView {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'covers' || v === 'lists' || v === 'quotes' || v === 'discover' || v === 'tracker' ? v : 'shelf'
  } catch { return 'shelf' }
}
export function saveLibraryView(v: LibraryView): void {
  try { localStorage.setItem(VIEW_KEY, v) } catch { /* private window */ }
}

/** Is the quote of the day wanted on Today? Off when the Library is, or when the person said no to this alone. */
export function dailyQuoteWanted(): boolean {
  return !libraryIsOff() && loadLibrarySettings().dailyQuote !== false
}

// ─── Opening a book from another module ──────────────────────────────────────
// The selection is state inside the Library, which may not even be mounted yet (modules mount on first
// visit). So a request is parked here and taken by whoever is listening — now, or on mount.
export const OPEN_BOOK_EVENT = 'professor:libraryOpenBook'
let pendingOpen: string | null = null
export function requestOpenBook(bookId: string): void {
  pendingOpen = bookId
  window.dispatchEvent(new Event(OPEN_BOOK_EVENT))
}
export function takePendingOpen(): string | null {
  const id = pendingOpen
  pendingOpen = null
  return id
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
