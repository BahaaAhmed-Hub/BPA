#!/usr/bin/env node
/**
 * link-preview-is-not-a-proxy — the guard, measured on the real file
 *
 * `link-preview` fetches a URL somebody hands it, from inside the project's
 * own network, beside a service-role database. That is the shape of every
 * SSRF write-up there has ever been, so the guard is the feature and this is
 * the test of it.
 *
 * The functions are **lifted out of `supabase/functions/link-preview/index.ts`
 * by regex and de-typed with `tsc`** rather than restated here — there is no
 * Deno on this machine to run the function, and a restated copy is a second
 * implementation that passes while the shipped one does not.
 *
 *   node scripts/link-preview-is-not-a-proxy.mjs [addresses|dns|redirect|control]
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODE = process.argv[2] ?? 'addresses'
let code = 0
const ok = (n, c, x = '') => {
  console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`)
  if (!c) code = 1
}

const SRC = 'supabase/functions/link-preview/index.ts'
const src = readFileSync(SRC, 'utf8')

ok('the function file is present', src.length > 1000, `${src.length} bytes`)

/* ── lift the real code out ────────────────────────────────────────────── */

function lift(name) {
  // from `const NAME` / `function NAME` to the next top-level declaration
  const re = new RegExp(
    `^(?:const ${name}\\b|(?:async )?function ${name}\\b)[\\s\\S]*?(?=\\n(?:const |let |async function |function |serve\\(|/\\*|//))`,
    'm')
  const m = src.match(re)
  if (!m) throw new Error(`could not lift ${name} out of ${SRC}`)
  return m[0]
}

const lifted = ['BAD_HOST', 'MAX_HOPS', 'UA', 'privateIp', 'refuse', 'walk']
  .map(lift).join('\n\n')

ok('every guard lifted from the shipped file', lifted.includes('privateIp') && lifted.includes('refuse'))

const dir = mkdtempSync(join(tmpdir(), 'lp-'))
const ts  = join(dir, 'g.ts')
// `declare` emits nothing, so at runtime `Deno` is still whatever the test
// put on globalThis — which is how the dns mode controls the lookup.
writeFileSync(ts, 'declare const Deno: { resolveDns(h: string, t: string): Promise<string[]> }\n'
  + lifted + '\nexport { privateIp, refuse, walk, MAX_HOPS }\n')
try {
  execFileSync('npx', ['tsc', ts, '--target', 'es2022', '--module', 'esnext',
    '--moduleResolution', 'bundler', '--skipLibCheck', '--outDir', dir],
    { stdio: 'pipe' })
} catch (e) {
  console.error('tsc refused the lifted guard:\n' + String(e.stdout ?? e))
  process.exit(1)
}
const mod = await import('file://' + join(dir, 'g.js'))

/* ── the addresses ─────────────────────────────────────────────────────── */

if (MODE === 'addresses' || MODE === 'control') {
  // `control` runs the same table against a naive guard, to prove the table
  // is capable of failing. A list every implementation passes measures nothing.
  const naive = async u => (u.protocol === 'http:' || u.protocol === 'https:')
    ? null : 'not a web address'
  const refuse = MODE === 'control' ? naive : mod.refuse

  const MUST_REFUSE = [
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['loopback by name',           'http://localhost:8000/'],
    ['loopback by number',         'http://127.0.0.1/'],
    ['127.x, not just .0.1',       'http://127.99.4.3/'],
    ['IPv6 loopback',              'http://[::1]/'],
    ['IPv6 unique-local',          'http://[fd00::1]/'],
    ['IPv6 link-local',            'http://[fe80::1]/'],
    ['v4-mapped loopback',         'http://[::ffff:127.0.0.1]/'],
    ['RFC1918 — 10/8',             'http://10.0.0.5/'],
    ['RFC1918 — 172.16/12',        'http://172.20.11.1/'],
    ['RFC1918 — 192.168/16',       'http://192.168.1.1/'],
    ['CGNAT 100.64/10',            'http://100.80.0.1/'],
    ['0.0.0.0',                    'http://0.0.0.0/'],
    ['multicast',                  'http://239.1.2.3/'],
    ['a .internal name',           'http://vault.internal/'],
    ['a .local name',              'http://printer.local/'],
    ['file://',                    'file:///etc/passwd'],
    ['gopher://',                  'gopher://10.0.0.1/'],
  ]
  const MUST_ALLOW = [
    ['an ordinary page',   'https://example.com/a/b?c=d'],
    ['a public IP',        'http://93.184.216.34/'],
    ['172.15 is public',   'http://172.15.0.1/'],
    ['172.32 is public',   'http://172.32.0.1/'],
    ['192.167 is public',  'http://192.167.1.1/'],
  ]

  let refused = 0
  for (const [name, url] of MUST_REFUSE) {
    const why = await refuse(new URL(url))
    if (why) refused++
    ok(`refuses ${name}`, !!why, why ? `— ${why}` : '*** REACHED ***')
  }
  for (const [name, url] of MUST_ALLOW) {
    const why = await refuse(new URL(url))
    ok(`allows ${name}`, why === null, why ?? '')
  }
  console.log(`\n  ${refused} of ${MUST_REFUSE.length} private addresses refused`)
}

/* ── a name that resolves inward ───────────────────────────────────────── */

if (MODE === 'dns') {
  // The classic: a perfectly public hostname whose A record is 127.0.0.1.
  globalThis.Deno = { resolveDns: async () => ['127.0.0.1'] }
  ok('a public name resolving to loopback is refused',
    !!(await mod.refuse(new URL('https://evil.example.com/'))))

  globalThis.Deno = { resolveDns: async () => ['93.184.216.34'] }
  ok('a public name resolving outward is allowed',
    (await mod.refuse(new URL('https://example.com/'))) === null)

  // No permission to look up is not a reason to refuse everything — the
  // literal checks still stand, and the runtime may not allow resolveDns.
  globalThis.Deno = { resolveDns: async () => { throw new Error('no permission') } }
  ok('a failed lookup leaves the literal guards in force',
    (await mod.refuse(new URL('https://example.com/'))) === null &&
    !!(await mod.refuse(new URL('http://10.0.0.1/'))))
  delete globalThis.Deno
}

/* ── the redirect walk ─────────────────────────────────────────────────── */

if (MODE === 'redirect') {
  const seen = []
  const reply = (status, loc) => ({
    status, ok: status < 300, url: '',
    headers: { get: k => (k.toLowerCase() === 'location' ? loc : null) },
    body: { cancel: async () => {} },
  })

  // A public URL that bounces to the metadata address. Guarding only what was
  // typed lets this straight through.
  globalThis.fetch = async (u) => {
    seen.push(u)
    if (u.startsWith('https://nice.example.com')) return reply(302, 'http://169.254.169.254/')
    return reply(200)
  }
  const got = await mod.walk(new URL('https://nice.example.com/x'), new AbortController().signal)
  ok('a redirect to the metadata address is refused', got === null)
  ok('and the inward hop was never fetched',
    !seen.some(u => u.includes('169.254.169.254')), seen.join(' → '))

  // A redirect chain that never ends must stop, not spin.
  seen.length = 0
  globalThis.fetch = async (u) => { seen.push(u); return reply(302, 'https://a.example.com/' + seen.length) }
  const loop = await mod.walk(new URL('https://a.example.com/0'), new AbortController().signal)
  ok('an endless redirect stops', loop === null)
  ok(`and stops at ${mod.MAX_HOPS} hops`, seen.length <= mod.MAX_HOPS + 1, `${seen.length} fetches`)

  // An ordinary page still comes back.
  seen.length = 0
  globalThis.fetch = async (u) => { seen.push(u); return reply(200) }
  const fine = await mod.walk(new URL('https://example.com/'), new AbortController().signal)
  ok('an ordinary page is fetched', fine?.status === 200)
}

console.log(code ? '\nFAILED' : '\nall good')
process.exit(code)
