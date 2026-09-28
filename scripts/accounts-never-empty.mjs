// node scripts/accounts-never-empty.mjs
//
// The mirror in `users.schedule_rules.connected_accounts` must never be
// emptied by a caller that happened to read `professor-connected-accounts`
// a moment after sign-out cleared it. `saveAccountsToDB` is lifted out of the
// real file and run against a stub client, so there is no second copy to drift.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const SRC = readFileSync(new URL('../src/lib/dbSync.ts', import.meta.url), 'utf8')
let fails = 0
const ok = (n, c, x='') => { console.log(`${c?'PASS':'*** FAIL ***'}  ${n}${x?'  '+x:''}`); if (!c) fails++ }

const i = SRC.search(/export async function saveAccountsToDB\(/)
const j = SRC.indexOf('\n}', i)
const body = SRC.slice(i, j + 2).replace(/^export /, '')
const js = s => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText

function stub(existingCount) {
  const saved = []
  const prev = { connected_accounts: Array.from({ length: existingCount }, (_, k) => ({ email: `a${k}@x` })),
                 timezone: 'Africa/Cairo' }
  const q = {
    select: () => q, eq: () => q,
    maybeSingle: () => Promise.resolve({ data: { schedule_rules: prev } }),
    update(payload) { saved.push(payload); return { eq: () => Promise.resolve({ error: null }) } },
  }
  return { sb: { from: () => q }, saved }
}
const make = deps => new Function(...Object.keys(deps), js(`${body}\nreturn saveAccountsToDB`))(...Object.values(deps))
const acct = e => ({ id: 'i-'+e, email: e, name: e, scopes: [], connectedAt: 'x', isPrimary: false })

{
  const { sb, saved } = stub(3)
  await make({ supabase: sb, getSession: async () => ({ user: { id: 'u1' } }) })([])
  ok('an empty list never overwrites three saved accounts', saved.length === 0)
}
{
  const { sb, saved } = stub(0)
  await make({ supabase: sb, getSession: async () => ({ user: { id: 'u1' } }) })([])
  ok('…but an empty list over an empty mirror is allowed through', saved.length === 1)
}
{
  const { sb, saved } = stub(3)
  await make({ supabase: sb, getSession: async () => ({ user: { id: 'u1' } }) })([acct('one@x'), acct('two@x')])
  ok('a real list is written', saved.length === 1 && saved[0].schedule_rules.connected_accounts.length === 2)
  ok('and the rest of schedule_rules survives', saved[0].schedule_rules.timezone === 'Africa/Cairo')
  ok('no token ever reaches the mirror',
     !JSON.stringify(saved[0]).includes('providerToken') && !JSON.stringify(saved[0]).includes('supabaseRefreshToken'))
}
{
  const { sb, saved } = stub(1)
  await make({ supabase: sb, getSession: async () => ({ user: { id: 'u1' } }) })([acct('one@x')])
  ok('shrinking to one is still a real write, not a wipe', saved.length === 1)
}
console.log(fails ? `\n${fails} failing` : '\nall green')
process.exit(fails ? 1 : 0)
