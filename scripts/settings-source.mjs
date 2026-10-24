// The whole Settings feature's source as one string.
//
// Several harnesses assert on what Settings.tsx *says* (a provider union, a
// helper's body, a prefs key). When that file was split into model.ts, ui.tsx,
// nav and sections/*, those assertions did not become false — the text just
// moved. Reading the feature rather than one file keeps each of them about the
// behaviour and not about the file layout. Order is stable (shell first, then
// the rest by path), so slice-between-two-markers assertions still work.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'src/modules/settings'
function* walk(d) {
  for (const n of readdirSync(d).sort()) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.tsx?$/.test(n)) yield p
  }
}
export function settingsSource() {
  const shell = join(DIR, 'Settings.tsx')
  const rest = [...walk(DIR)].filter(p => p !== shell && !p.endsWith('SettingsModule.tsx'))
  return [shell, ...rest].map(p => readFileSync(p, 'utf8')).join('\n')
}
