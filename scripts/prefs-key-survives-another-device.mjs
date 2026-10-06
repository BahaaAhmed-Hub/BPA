// node scripts/prefs-key-survives-another-device.mjs
//
// "I pasted the new Anthropic key into Settings → AI and Telegram still 401s."
// Two faults, measured here against the real prefSync module.
//
// 1. `pushSharedPrefs` wrote `shared_prefs: bag` — every shared key as THIS
//    browser holds it, replacing the lot. A second device that had never
//    touched the key still asserted its stale copy, on boot and every 5 min.
// 2. Settings → AI wrote localStorage only, so the key reached Postgres on the
//    5-minute tick at the earliest — the bot answered with the old one.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const TMP = '/tmp/prefsync-check'
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true })

// Lift the module out and de-type it, stubbing only its one import.
const src = readFileSync('src/lib/prefSync.ts', 'utf8')
  .replace("import { supabase } from '@/lib/supabase'", 'import { supabase } from "./supabase.js"')
writeFileSync(`${TMP}/prefSync.ts`, src)
writeFileSync(`${TMP}/supabase.ts`, `export const supabase: any = (globalThis as any).__sb\n`)
execFileSync('npx', ['tsc', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler',
  '--skipLibCheck', '--outDir', TMP, `${TMP}/prefSync.ts`, `${TMP}/supabase.ts`], { stdio: 'pipe' })

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

// A device is a localStorage; the server is one jsonb bag they share.
let server = { shared_prefs: {} }
function device(seed = {}) {
  const store = { ...seed }
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: k => { delete store[k] },
    _store: store,
  }
}
globalThis.__sb = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { schedule_rules: server } }) }) }),
    update: payload => ({ eq: async () => { server = payload.schedule_rules; return { error: null } } }),
  }),
  auth: {
    getUser:    async () => ({ data: { user: { id: 'u1' } } }),
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
  },
}
const KEY = 'professor-ai-config'
const OLDK = JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-REVOKED' })
const NEWK = JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-FRESH' })
const mod = await import(`${TMP}/prefSync.js?v=${Date.now()}`)
const keyOnServer = () => {
  const raw = server.shared_prefs?.[KEY]
  try { return JSON.parse(raw).anthropicKey } catch { return raw ?? null }
}

// ── Both devices start in step on the revoked key, as they really would be.
server = { shared_prefs: { [KEY]: OLDK, 'professor-accent': '"amber"' } }
const phone  = device({ [KEY]: OLDK, 'professor-accent': '"amber"' })
const laptop = device({ [KEY]: OLDK, 'professor-accent': '"amber"' })

globalThis.localStorage = phone
await mod.pullSharedPrefs(); await mod.pushSharedPrefs()
globalThis.localStorage = laptop
await mod.pullSharedPrefs(); await mod.pushSharedPrefs()
ok('both devices start on the revoked key', keyOnServer() === 'sk-ant-REVOKED', String(keyOnServer()))

// ── You paste the new key on the phone. (Settings pushes at once — asserted
//    separately below; here we just push.)
globalThis.localStorage = phone
phone.setItem(KEY, NEWK)
await mod.pushSharedPrefs()
ok('pasting it on the phone reaches the server', keyOnServer() === 'sk-ant-FRESH', String(keyOnServer()))

// ── The laptop, still holding the revoked key, boots and ticks. THIS is the bug.
globalThis.localStorage = laptop
await mod.pullSharedPrefs()
await mod.pushSharedPrefs()
ok('the other device does NOT put the revoked key back',
   keyOnServer() === 'sk-ant-FRESH', `server now holds ${keyOnServer()}`)
await mod.pushSharedPrefs()
ok('…nor on its next five-minute tick', keyOnServer() === 'sk-ant-FRESH', String(keyOnServer()))
ok('and the laptop took the new key for itself',
   JSON.parse(laptop.getItem(KEY)).anthropicKey === 'sk-ant-FRESH',
   JSON.parse(laptop.getItem(KEY)).anthropicKey)

// ── A real edit on the laptop must still travel: this must not freeze prefs.
laptop.setItem('professor-accent', '"violet"')
await mod.pushSharedPrefs()
ok('a change made on the laptop still travels',
   server.shared_prefs['professor-accent'] === '"violet"', server.shared_prefs['professor-accent'])

// ── A fresh device with nothing on the server still uploads what it has.
server = { shared_prefs: {} }
const fresh = device({ [KEY]: NEWK })
globalThis.localStorage = fresh
await mod.pullSharedPrefs(); await mod.pushSharedPrefs()
ok('a fresh account still gets its prefs uploaded', keyOnServer() === 'sk-ant-FRESH', String(keyOnServer()))

// ── THE UPGRADE CASE, and the one that actually bit. Before this fix no device
//    had a `seen` record at all, so the laptop's FIRST boot on the new code has
//    an empty one — and "no record" was read as "an unexplained local value,
//    keep it and push it". So the very first boot after the deploy still wrote
//    the revoked key back, which is exactly "I have a valid key in Settings and
//    it still does not work". The earlier cases missed it by syncing both
//    devices on the new code before the edit, which seeds `seen`.
server = { shared_prefs: { [KEY]: NEWK } }           // phone already set the good key
const cold = device({ [KEY]: OLDK })                 // laptop: stale local, NO seen record
globalThis.localStorage = cold
await mod.pullSharedPrefs()
await mod.pushSharedPrefs()
ok('a device syncing for the FIRST time does not push its stale copy',
   keyOnServer() === 'sk-ant-FRESH', `server now holds ${keyOnServer()}`)
ok('…and takes the good key for itself',
   JSON.parse(cold.getItem(KEY)).anthropicKey === 'sk-ant-FRESH',
   JSON.parse(cold.getItem(KEY)).anthropicKey)

// ── A refused write must not be remembered as synced, or the change is lost.
server = { shared_prefs: { [KEY]: OLDK } }
const d2 = device({ [KEY]: OLDK })
globalThis.localStorage = d2
await mod.pullSharedPrefs()
d2.setItem(KEY, NEWK)
globalThis.__sb.from = () => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { schedule_rules: server } }) }) }),
  update: () => ({ eq: async () => ({ error: { message: 'offline' } }) }),
})
await mod.pushSharedPrefs()
globalThis.__sb.from = () => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { schedule_rules: server } }) }) }),
  update: payload => ({ eq: async () => { server = payload.schedule_rules; return { error: null } } }),
})
await mod.pushSharedPrefs()
ok('a refused push is retried rather than forgotten', keyOnServer() === 'sk-ant-FRESH', String(keyOnServer()))

// ── Settings → AI must push the moment you save it.
const settings = readFileSync('src/modules/settings/Settings.tsx', 'utf8')
const save = settings.slice(settings.indexOf('function saveAIConfig'), settings.indexOf('function saveSettings'))
ok('saving the AI key pushes immediately', /pushSharedPrefs\(\)/.test(save), save.replace(/\s+/g, ' ').slice(0, 80))

console.log(fails ? `\n${fails} failing` : '\nall good')
process.exit(fails ? 1 : 0)
