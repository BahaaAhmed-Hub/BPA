// ─── Do the browser and the nightly run agree? ───────────────────────────────
//
//  The smart mail view's rules exist twice: in `src/lib/mailSmart.ts`, which
//  the app runs, and in `supabase/functions/_shared/mailRules.ts`, which the
//  nightly edge function runs. Deno cannot import the app's bundle, so the
//  duplication is unavoidable — but a rule that drifts on one side and not the
//  other is a thread that is in one section at 3am and another at 9am, with
//  nothing on screen to say which is right.
//
//  So both are loaded and given the same fixtures, and any disagreement fails.
//
//    node scripts/mail-rules-agree.mjs

import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mailrules-'))
const entry = join(dir, 'entry.ts')

writeFileSync(entry, `
export * as app  from '${process.cwd()}/src/lib/mailSmart'
export * as edge from '${process.cwd()}/supabase/functions/_shared/mailRules.ts'
export * as prov  from '${process.cwd()}/src/lib/mailProvider'
export * as kinds from '${process.cwd()}/src/lib/mailKinds'
`)

// esbuild is not a dependency of this project, so it is run rather than
// imported — the script stays something you can run on a clean checkout.
const out = join(dir, 'bundle.mjs')
execFileSync('npx', ['--yes', 'esbuild', entry,
  '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`,
  `--alias:@=${join(process.cwd(), 'src')}`, '--log-level=error',
  `--define:import.meta.env=${JSON.stringify({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' })}`,
], { stdio: 'inherit' })

// `businessAccounts` reads localStorage; the app side needs one to exist.
const store = { 'mail-business-accounts': JSON.stringify(['me@acme-corp.com']) }
globalThis.localStorage = {
  getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v },
  removeItem: k => { delete store[k] }, clear: () => {},
}
globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} }

const { app, edge, prov, kinds } = await import(out)

const DAY = 864e5
const NOW = new Date('2026-06-15T12:00:00Z').getTime()
const ME = 'me@acme-corp.com'
const me = new Set([ME])

let seq = 0
const msg = ({ from, to = ME, cc = '', at, body = 'hello', subject = 'A subject', headers = [] }) => {
  const id = 'm' + (++seq)
  return {
    id, sentAt: at,
    from: prov.parseAddressList(from)[0] ?? '',
    fromName: prov.parseDisplayName(from),
    to: prov.parseAddressList(to), cc: prov.parseAddressList(cc),
    subject, snippet: body, body,
    headers: [
      { name: 'From', value: from }, { name: 'To', value: to },
      { name: 'Cc', value: cc }, { name: 'Subject', value: subject },
      ...headers,
    ],
  }
}

// Every shape either side is meant to have an opinion about.
const CASES = [
  ['never answered, addressed to me', [msg({ from: 'Nadia <n@client.com>', at: NOW - 2 * DAY, body: 'Bahaa, confirm please' })]],
  ['only copied in',                  [msg({ from: 'O <o@acme-corp.com>', to: 'team@acme-corp.com', cc: ME, at: NOW - 2 * DAY })]],
  ['I answered, quiet 2 days',        [msg({ from: 'H <h@client.com>', at: NOW - 4 * DAY }), msg({ from: ME, to: 'h@client.com', at: NOW - 2 * DAY })]],
  ['I answered, quiet 8 days',        [msg({ from: 'H <h@client.com>', at: NOW - 20 * DAY }), msg({ from: ME, to: 'h@client.com', at: NOW - 8 * DAY })]],
  ['they wrote back after me',        [msg({ from: 'H <h@client.com>', at: NOW - 5 * DAY }), msg({ from: ME, to: 'h@client.com', at: NOW - 4 * DAY }), msg({ from: 'H <h@client.com>', at: NOW - 3 * DAY })]],
  ['arrived an hour ago',             [msg({ from: 'N <n@client.com>', at: NOW - 3600e3 })]],
  ['named in the body, only cc',      [msg({ from: 'N <n@client.com>', to: 'team@acme-corp.com', cc: ME, at: NOW - 2 * DAY, body: 'Can Bahaa sign this off?' })]],
  ['thread of only my own messages',  [msg({ from: ME, to: 'x@client.com', at: NOW - 2 * DAY })]],
  ['a newsletter',                    [msg({ from: 'Deals <news@shop.com>', at: NOW - DAY, body: 'unsubscribe', headers: [{ name: 'List-Unsubscribe', value: '<https://shop.com/u>' }] })]],
  ['an automated notification',       [msg({ from: 'no-reply@build.io', at: NOW - DAY, body: 'Your build failed' })]],
  ['a calendar invitation',           [msg({ from: 'N <n@client.com>', at: NOW - DAY, headers: [{ name: 'Content-Type', value: 'text/calendar; method=REQUEST' }] })]],
  ['a meeting invitation',            [msg({ from: 'N <n@client.com>', subject: 'Invitation: Kickoff', at: NOW - DAY, headers: [{ name: 'Content-Type', value: 'text/calendar; method=REQUEST' }] })]],
  ['a cancelled event',               [msg({ from: 'N <n@client.com>', subject: 'Cancelled: Kickoff', at: NOW - DAY, headers: [{ name: 'Content-Type', value: 'text/calendar; method=CANCEL' }] })]],
  ['a sign-in notification',          [msg({ from: 'Google <no-reply@accounts.google.com>', subject: 'Security alert: new sign-in', at: NOW - DAY })]],
  ['a cloud status notice',           [msg({ from: 'alerts@statuspage.io', subject: 'Scheduled maintenance on Sunday', at: NOW - DAY })]],
  ['somebody accepting your invite',  [msg({ from: 'O <o@client.com>', subject: 'Accepted: Kickoff', at: NOW - DAY, headers: [{ name: 'Content-Type', value: 'text/calendar; method=REPLY' }] })]],
  ['free-mail sender',                [msg({ from: 'Mum <mum@gmail.com>', at: NOW - 2 * DAY, body: 'dinner?' })]],
]

const FIELDS = ['replyState', 'addressedTo', 'namedInBody', 'bottleneck', 'awaitingCustomer', 'section', 'kind']
let bad = 0

console.log('fixture                              field              app          nightly')
console.log('─'.repeat(78))

for (const [name, messages] of CASES) {
  const thread = { id: 't' + name.length, messages }
  const a = app.readThread(thread, ME, me, 'Bahaa', NOW)
  const e = edge.readThread(thread, me, 'Bahaa', NOW)

  if (!a || !e) { console.log(`${name.padEnd(36)} — one side returned nothing`); bad++; continue }

  const appKind = kinds.kindOf({ newest: messages.filter(m => m.from !== ME).pop() ?? messages[messages.length - 1],
                                 subject: a.subject, fromEmail: a.fromEmail })
  const appSection = app.sectionFor(a, false, appKind)
  const newest = messages.filter(m => m.from !== ME).pop() ?? messages[messages.length - 1]
  // Kept/discarded, both sides, for a mailbox marked as work.
  const appKeep  = app.isBusinessThread(a, newest, true, appKind)
  const edgeKeep = edge.keepThread(newest, e.kind)

  for (const f of FIELDS) {
    const av = f === 'section' ? appSection : f === 'kind' ? appKind : a[f]
    const ev = e[f]
    const same = String(av) === String(ev)
    if (!same) { bad++; console.log(`${name.padEnd(36)} ${f.padEnd(18)} ${String(av).padEnd(12)} ${String(ev)}   ✗`) }
  }
  if (appKeep !== edgeKeep) {
    bad++
    console.log(`${name.padEnd(36)} ${'kept'.padEnd(18)} ${String(appKeep).padEnd(12)} ${String(edgeKeep)}   ✗`)
  }
  // The section of a thread nobody keeps is not a fact about anything, so the
  // line says which it is rather than printing a section for a discarded row.
  const where = appKeep ? appSection : 'discarded'
  console.log(`${name.padEnd(36)} ${'(all fields)'.padEnd(18)} ${where.padEnd(12)} ${edgeKeep ? e.section : 'discarded'}   ${appSection === e.section && appKeep === edgeKeep ? 'ok' : ''}`)
}

console.log('─'.repeat(78))
if (bad) {
  console.error(`\n${bad} disagreement(s) between the browser and the nightly run.`)
  process.exit(1)
}
console.log(`\n✅ the two implementations agree on all ${CASES.length} fixtures`)
