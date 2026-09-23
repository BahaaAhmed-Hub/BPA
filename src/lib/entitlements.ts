// ─── What this account may see ───────────────────────────────────────────────
// `my_modules()` (20260021) resolves core → the user's own override → the plan
// → no, on the server, and hands back the whole answer in one round trip. This
// file is the browser's copy of that answer and nothing more: it decides what
// is *drawn* and what is *loaded*, never what is permitted. The bundle is
// public and editable, so a gate here is a courtesy to the user, not a
// boundary — the boundary is RLS.
//
// Three rules hold it together:
//
//  1. **Off means never loaded, not loaded-and-hidden.** A store that fetches
//     into an RLS denial replaces itself with nothing, and an empty Finance
//     screen reads as "my ledger is gone" rather than "this is not on your
//     plan". That is the same failure as *a reload is not an empty ledger*,
//     one layer down, and it is why `hydrate()` waits for this answer before
//     it pulls anything.
//
//  2. **A failed read is not evidence that a module went away.** The last
//     answer for this user stands — the rule `googleScopes.ts` already
//     follows. With nothing cached at all, everything is on: locking somebody
//     out of their own app over a dropped request is far worse than drawing a
//     tab whose data the server will decline anyway.
//
//  3. **The cache is keyed by user id**, so another account's answer can never
//     be read as this one's. `clearUserData`'s key list is maintained by hand
//     and has drifted before; this does not depend on being on it.
//
// An id the registry has never heard of — `settings`, `review`, `behavioral`,
// `planning` — is NOT off. Only a module that exists and resolved to false is,
// or the first thing this would hide is the way into Settings.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Modules = Record<string, boolean>

const KEY = 'professor-modules'
export const MODULES_CHANGED = 'professor:modulesChanged'

type Cached = { uid: string; at: number; modules: Modules; labels?: Record<string,string> }

let current: Cached | null = null

function read(): Cached | null {
  if (current) return current
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cached
    if (!parsed?.uid || !parsed.modules) return null
    current = parsed
    return parsed
  } catch { return null }
}

function write(uid: string, modules: Modules, labels?: Record<string,string>) {
  current = { uid, at: Date.now(), modules, labels }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* private window */ }
  window.dispatchEvent(new Event(MODULES_CHANGED))
}

/** The answer already on this device for this user, or null. Synchronous, so
 *  a warm boot draws the right nav on its first frame rather than flickering. */
export function cachedModules(uid: string): Modules | null {
  const c = read()
  return c && c.uid === uid ? c.modules : null
}

/** The resolved set, whoever it is for. Used by the synchronous gate below. */
export function currentModules(): Modules | null {
  return read()?.modules ?? null
}

/** Ask the server. Returns null when it could not be asked — which is not the
 *  same as an empty answer, and must not be read as one. */
export async function fetchModules(uid: string): Promise<Modules | null> {
  try {
    const { data, error } = await supabase.rpc('my_modules')
    if (error || !Array.isArray(data)) return cachedModules(uid)
    const modules: Modules = {}
    const labels: Record<string, string> = {}
    for (const row of data as { module_id: string; label?: string; enabled: boolean }[]) {
      if (!row?.module_id) continue
      modules[row.module_id] = !!row.enabled
      if (row.label) labels[row.module_id] = row.label
    }
    // An empty registry means the migration has not run here. That is a
    // question nobody answered, not a user with no modules.
    if (Object.keys(modules).length === 0) return cachedModules(uid)
    write(uid, modules, labels)
    return modules
  } catch { return cachedModules(uid) }
}

/** The gate. True only for a module the registry knows and resolved to false —
 *  an unregistered id is never off, or Settings would be the first casualty. */
export function moduleIsOff(id: string): boolean {
  const m = currentModules()
  if (!m) return false
  return m[id] === false
}

/** Sign-out. The next sign-in, even as the same person, asks again. */
export function forgetEntitlements() {
  current = null
  try { localStorage.removeItem(KEY) } catch { /* private window */ }
  window.dispatchEvent(new Event(MODULES_CHANGED))
}

/** Re-render when the answer changes — a background refresh, another device's
 *  edit, or a sign-out. Returns the set so a caller can read it directly. */
export function useModules(): Modules | null {
  const [, bump] = useState(0)
  useEffect(() => {
    const onChange = () => bump(n => n + 1)
    window.addEventListener(MODULES_CHANGED, onChange)
    // Another tab's write lands as `storage`, the same way prefs do.
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) { current = null; onChange() } }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(MODULES_CHANGED, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return currentModules()
}

/** The module's own name, for a sentence a person reads. Falls back to the id
 *  rather than inventing one — an id on screen is a bug report, a made-up
 *  label is a wrong answer. */
export function labelOf(id: string): string {
  const c = read()
  return c?.labels?.[id] ?? id
}
