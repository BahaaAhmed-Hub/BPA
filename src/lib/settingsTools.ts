// ─── The settings the assistant may change ───────────────────────────────────
//
// A closed list, on purpose. "Change a setting" is the widest thing to hand a model, and almost all of
// Settings is something it must never touch: the AI key and every token (credentials), billing and the plan,
// connected accounts, data and privacy, automation rules that act without asking. Those are simply not in
// the list, and asking for one is answered with where in Settings the person can do it themselves.
//
// What is in it is small, reversible, and changed through the *same* function the Settings screen calls, so
// the screen, the other devices and the bots all hear about it the way they would if it had been clicked:
//   - the assistant's name and whether it reads answers aloud   (`savePersona`)
//   - whether the Library is shown, and the quote of the day    (`saveLibrarySettings`, pushed at once)
//
// The theme is not here. It is held in three places (the UI store, `professor-settings` and its database
// row) and the Settings screen is what keeps them agreeing; changing one from outside would be reverted by
// the next load of the others. It is said to the user rather than half-done.

import type Anthropic from '@anthropic-ai/sdk'
import { loadPersona, savePersona, cleanName } from '@/lib/assistantPersona'
import { loadLibrarySettings, saveLibrarySettings } from '@/modules/library/libraryPrefs'
import { pushSharedPrefs } from '@/lib/prefSync'

type Setting = 'assistant_name' | 'assistant_reads_answers_aloud' | 'library_shown' | 'library_quote_of_the_day'
const SETTINGS: Setting[] = ['assistant_name', 'assistant_reads_answers_aloud', 'library_shown', 'library_quote_of_the_day']

export const SETTINGS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_settings',
    description: 'The settings the assistant is allowed to read and change, with their current values: the assistant\'s name, whether it reads answers aloud, whether the Library is shown, and whether Today shows a quote of the day.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'change_setting',
    description: 'Change one setting from the list in get_settings. Anything else — the AI key or any token, billing, connected accounts, data and privacy, automation, notifications, the theme — is NOT something you can change: tell the user which Settings section it is in (app_guide "settings") and let them do it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        setting: { type: 'string', enum: SETTINGS },
        value: { description: 'A name (text) for assistant_name; true or false for the others', anyOf: [{ type: 'string' }, { type: 'boolean' }] },
      },
      required: ['setting', 'value'],
    },
  },
]

export const SETTINGS_TOOL_NAMES = new Set(SETTINGS_TOOLS.map(t => t.name))

const current = () => {
  const p = loadPersona(), l = loadLibrarySettings()
  return {
    assistant_name: p.name || '(not named yet)',
    assistant_reads_answers_aloud: p.speak,
    library_shown: l.enabled,
    library_quote_of_the_day: l.dailyQuote !== false,
  }
}

export async function executeSettingsTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  if (name === 'get_settings') return { settings: current(), cannot_change: 'Everything else — see app_guide "settings" for where it is.' }

  const setting = input.setting as Setting
  if (!SETTINGS.includes(setting)) {
    return { changed: false, error: `"${String(input.setting)}" is not a setting you can change. Tell the user where it is in Settings (app_guide "settings"). The ones you can change: ${SETTINGS.join(', ')}.` }
  }
  const v = input.value
  if (setting === 'assistant_name') {
    if (typeof v !== 'string') return { changed: false, error: 'The name must be text.' }
    const clean = cleanName(v)
    if (!clean) return { changed: false, error: 'That is not a usable name (letters, numbers, spaces, hyphens and apostrophes; up to 24 characters).' }
    savePersona({ ...loadPersona(), name: clean })
    return { changed: true, settings: current() }
  }
  if (typeof v !== 'boolean') return { changed: false, error: `${setting} is on or off: give true or false.` }
  if (setting === 'assistant_reads_answers_aloud') {
    savePersona({ ...loadPersona(), speak: v })
  } else if (setting === 'library_shown') {
    saveLibrarySettings({ ...loadLibrarySettings(), enabled: v })
    void pushSharedPrefs()
  } else {
    const next = { ...loadLibrarySettings() }
    if (v) delete next.dailyQuote; else next.dailyQuote = false
    saveLibrarySettings(next)
    void pushSharedPrefs()
  }
  return { changed: true, settings: current() }
}
