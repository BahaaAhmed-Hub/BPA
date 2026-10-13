// ─── Who the assistant is, to this person ────────────────────────────────────
// The assistant has a face and a name the person chooses (Settings → AI). The
// name is a **shared pref** — it rides in `users.schedule_rules.shared_prefs`
// like the AI key does — so the iPad, the Telegram bot and Siri all answer to
// the same one.
//
// **It is separate from `professor-ai-config` on purpose.** That key holds the
// API credentials, and a rename must never be able to trip the key-sync rules
// (a push carries only the keys whose value changed).
//
// The name ends up inside prompts and inside a spoken-name matcher, so it is
// **cleaned on the way in**: letters, digits, spaces and a few name punctuation
// marks, 24 characters at most. A name with a newline and an instruction in it
// is not a name.
import { useEffect, useState } from 'react'
import { pushSharedPrefs } from '@/lib/prefSync'

export interface Persona {
  /** What the person calls it. Empty until they say. */
  name: string
  /** Listen for the name while the app is open (opt-in; foreground only). */
  listen: boolean
  /** Read answers aloud when the question was spoken. */
  speak: boolean
  /** The first-use "what would you like to call me?" has been answered or waved away; never asked twice. */
  asked: boolean
}

const KEY = 'assistant-persona'
export const PERSONA_EVENT = 'professor:personaChanged'
export const NAME_MAX = 24
const DEFAULTS: Persona = { name: '', listen: false, speak: true, asked: false }

/** Letters (any script), digits, space, hyphen, apostrophe, full stop — nothing else survives. */
export function cleanName(raw: string): string {
  const t = (raw ?? '').normalize('NFKC').replace(/[^\p{L}\p{N}\s'’.-]/gu, '').replace(/\s+/g, ' ').trim()
  return t.slice(0, NAME_MAX).trim()
}

export function loadPersona(): Persona {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<Persona>
    return { name: cleanName(typeof p.name === 'string' ? p.name : ''), listen: p.listen === true, speak: p.speak !== false, asked: p.asked === true }
  } catch { return DEFAULTS }
}

export function savePersona(next: Persona): void {
  const clean: Persona = { name: cleanName(next.name), listen: !!next.listen, speak: next.speak !== false, asked: !!next.asked || !!cleanName(next.name) }
  try { localStorage.setItem(KEY, JSON.stringify(clean)) } catch { /* private window */ }
  window.dispatchEvent(new Event(PERSONA_EVENT))
  // The bots read this out of Postgres, and the ordinary push is a five-minute timer.
  void pushSharedPrefs()
}

/** Re-renders when the person renames it here, in another tab, or another device's value arrives. */
export function usePersona(): Persona {
  const [p, setP] = useState(loadPersona)
  useEffect(() => {
    const on = () => setP(loadPersona())
    window.addEventListener(PERSONA_EVENT, on)
    window.addEventListener('storage', on)
    return () => { window.removeEventListener(PERSONA_EVENT, on); window.removeEventListener('storage', on) }
  }, [])
  return p
}

/** What to call it on screen when it has no name yet. */
export const UNNAMED = 'Your assistant'
export const labelOf = (p: Pick<Persona, 'name'>): string => p.name || UNNAMED
