// Typing a key fires one push per keystroke, and they are not serialised.
//
// `saveAIConfig` writes localStorage and calls `pushSharedPrefs()` on **every
// change event** — so a key typed by hand is ~100 overlapping pushes, each of
// which reads the server bag, merges and writes it back, then records what it
// pushed in `professor-prefs-seen`. Two things can then finish out of order:
//   · the UPDATEs — an early, partial key can land *after* the full one, so
//     the server ends up holding half a key;
//   · `saveSeen({ ...seen, ...mine })` — `seen` is the snapshot read before
//     the await, so a late-finishing early call writes back a map that has
//     forgotten every entry recorded while it was in flight.
// The pull on the next boot is what turns that into the report: with
// `seen[key] === localStorage[key]` it concludes this device has not touched
// the key since its last sync and **adopts the server's copy**.
//
// Run against the real module, with the server's completion order controlled.
//
// Control (`control`): the same fixture with the serialisation lifted back
// out, which is the code as it shipped — the server ends with one character.
//
//   node scripts/ai-key-survives-typing.mjs [typed|pasted|control]
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODE = process.argv[2] ?? 'typed'
const KEY = 'professor-ai-config'
const OLD = JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-OLD-REVOKED', groqKey: '' })
const NEW_KEY = 'sk-ant-api03-' + 'N'.repeat(80)
const NEW = JSON.stringify({ provider: 'anthropic', anthropicKey: NEW_KEY, groqKey: '' })

// ─── a localStorage, and a server that can finish out of order ──────────────
const store = new Map([[KEY, OLD]])
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: k => void store.delete(k),
  key: i => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

let bag = { [KEY]: OLD }
const landed = []
// `settle` decides when each UPDATE actually lands. 'reverse' is the
// interleaving under test: the requests are issued in order and complete
// backwards, which is what an HTTP/2 connection with a hundred in flight can
// genuinely do.
const pending = []
const supabase = {
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: { schedule_rules: { shared_prefs: { ...bag } } } }) }),
    }),
    update: patch => ({
      eq: () => {
        const p = new Promise(res => {
          pending.push(() => {
            bag = { ...(patch.schedule_rules.shared_prefs ?? {}) }
            landed.push(bag[KEY])
            res({ error: null })
          })
        })
        return Object.assign(p, { select: () => p.then(r => ({ ...r, data: [{ id: 'u1' }] })) })
      },
    }),
  }),
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
}

// ─── the real module, with its supabase and auth swapped for the stubs ──────
const dir = mkdtempSync(join(tmpdir(), 'prefsync-'))
let src = readFileSync('src/lib/prefSync.ts', 'utf8')
src = src.replace(/^import .*$/gm, '')
  .replace(/async function userId\(\)[\s\S]*?\n}/, "async function userId() { return 'u1' }")
if (MODE === 'control') {
  // The shipped code: every caller ran its own push, concurrently.
  src = src.replace(/export async function pushSharedPrefs\(\)[\s\S]*?\n}\n/,
    'export async function pushSharedPrefs() { return sendSharedPrefs() }\n')
}
src = `const supabase = globalThis.__sb\n` + src
writeFileSync(join(dir, 'prefSync.ts'), src)
execFileSync('npx', ['tsc', join(dir, 'prefSync.ts'), '--target', 'es2022', '--module', 'esnext',
  '--moduleResolution', 'bundler', '--skipLibCheck', '--outDir', dir], { stdio: 'pipe' })
globalThis.__sb = supabase
const mod = await import(pathToFileURL(join(dir, 'prefSync.js')).href)

let code = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) code = 1 }

// This device has synced before and is holding the old key, in step with the
// server — which is where a person who is about to replace a revoked key is.
globalThis.localStorage.setItem('professor-prefs-seen', JSON.stringify({ [KEY]: OLD }))

// ─── type (or paste) the new key, exactly as the field does ─────────────────
const pushes = []
const type = async () => {
  if (MODE === 'pasted') {
    store.set(KEY, NEW)
    pushes.push(mod.pushSharedPrefs())
    return
  }
  // One change event per character, each writing localStorage then pushing —
  // which is what `saveAIConfig` does today.
  for (let i = 1; i <= NEW_KEY.length; i++) {
    store.set(KEY, JSON.stringify({ provider: 'anthropic', anthropicKey: NEW_KEY.slice(0, i), groqKey: '' }))
    pushes.push(mod.pushSharedPrefs())
    await new Promise(r => setImmediate(r))
  }
}
await type()
// Every UPDATE lands, and each batch lands **backwards** — nothing failed,
// this is purely about order. Drained in a loop because a serialised push
// issues its request only once the one before it has finished, so new work
// appears as the queue empties; unserialised, the whole hundred are waiting
// in the first batch and the reversal is what poisons the server.
for (let round = 0; round < 400; round++) {
  await new Promise(r => setTimeout(r, 5))
  if (!pending.length) break
  const batch = pending.splice(0, pending.length).reverse()
  for (const run of batch) run()
}
await Promise.all(pushes)
await new Promise(r => setTimeout(r, 20))

const localNow = JSON.parse(store.get(KEY)).anthropicKey
const serverNow = JSON.parse(bag[KEY]).anthropicKey
const seenNow = JSON.parse(store.get('professor-prefs-seen'))[KEY]

ok('the browser holds the key that was typed', localNow === NEW_KEY, localNow.slice(0, 22) + '…')
if (MODE === 'control') {
  // The whole point of the control: unserialised, an early keystroke's write
  // lands last and the server keeps a stump of the key.
  ok('unserialised, the server does NOT hold the key', serverNow !== NEW_KEY,
     `server=${serverNow.length} chars against ${NEW_KEY.length} typed`)
  ok('and what it holds is a fragment', serverNow.length < 20, JSON.stringify(serverNow))
  process.exit(code)
}
ok('the server holds it too', serverNow === NEW_KEY,
   `server=${serverNow.length} chars, typed=${NEW_KEY.length}`)
ok('and `seen` records what the server really has',
   seenNow === undefined || JSON.parse(seenNow).anthropicKey === serverNow,
   `seen=${seenNow ? JSON.parse(seenNow).anthropicKey.length : 'none'} chars`)

// ─── the next boot, which is where the report comes from ────────────────────
await mod.pullSharedPrefs()
const afterReload = JSON.parse(store.get(KEY)).anthropicKey
ok('after a refresh the key is still the one that was typed',
   afterReload === NEW_KEY,
   afterReload === NEW_KEY ? '' : `got ${afterReload.length} chars: ${afterReload.slice(0, 26)}…`)

process.exit(code)
