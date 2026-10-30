#!/usr/bin/env node
/**
 * settings-snapshot — a fingerprint of every Settings section
 *
 *   node scripts/settings-snapshot.mjs 5199 --save=/tmp/before.json
 *   node scripts/settings-snapshot.mjs 5199 --compare=/tmp/before.json
 *   INK_THEME=glass-depth …                      (a different theme, for the control)
 *
 * The Settings split (docs/ui-unification.md, P2.2) must change no behaviour,
 * and "it still builds" does not say that. This opens each of the 15 sections
 * through the real nav, waits for the markup to stop changing, and hashes the
 * <main> content with the volatile parts normalised (clock times, React ids).
 * `--compare` fails on any section whose hash moved, or that did not open.
 *
 * A section counts as opened only if its title is showing AND it has real
 * content (>=300 chars of markup) — an empty screen hashes identically before
 * and after, which is a vacuous pass.
 * Controls (see the P2.2 notes): two runs on the same code agree, and a run in
 * another theme disagrees on every section.
 */
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'
import { settingsSource } from './settings-source.mjs'

const argv = process.argv.slice(2)
const port = argv.find(a => /^\d+$/.test(a)) ?? '5199'
const save = argv.find(a => a.startsWith('--save='))?.slice(7)
const compare = argv.find(a => a.startsWith('--compare='))?.slice(10)
const theme = process.env.INK_THEME ?? 'sunlit-bento'

// The section titles are the nav's own words; read them from the source so a
// renamed section is a loud failure here rather than a silently skipped one.
const sources = settingsSource()
const block = /const SECTION_META[^=]*=\s*\[([\s\S]*?)\n\]/.exec(sources)?.[1] ?? ''
const TITLES = [...block.matchAll(/title:\s*'([^']+)'/g)].map(m => m[1])
if (TITLES.length !== 15) { console.error(`expected 15 sections in SECTION_META, found ${TITLES.length}`); process.exit(2) }

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1500, height: 1050 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const req = r.request(), u = req.url()
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
  if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
  if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
  return r.fulfill({ json: [], headers: CORS })
})
await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
const page = await ctx.newPage()
page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
await page.addInitScript(([s, th]) => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'settings', themeId: th }, version: 0 }))
}, [session, theme])
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000, { want: 'text=Profile' })
await page.getByText('Skip for now').first().click({ timeout: 800 }).catch(() => {})

const normalise = html => html
  .replace(/:r[0-9a-z]+:/g, ':rX:')                 // React useId
  .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, 'HH:MM')   // clock times
  .replace(/build local · [^<]*/g, 'build local')
  .replace(/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, 'D Mon')
  .replace(/(blob:|data:)[^"')]+/g, '$1…')

const result = {}
for (const title of TITLES) {
  let html = '', opened = false
  try {
    // `.last()`: the app's own top nav can carry the same word (see ink-audit).
    // By visible text, not accessible name: a nav entry can carry a count badge
    // ("Integrations4") or an icon with its own label (the AI entry).
    const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await page.locator('main button').filter({ hasText: new RegExp(`^${esc}\\d*$`) }).last().click({ timeout: 6000 })
    // stable markup, not a number
    let prev = '', same = 0
    for (let i = 0; i < 60 && same < 3; i++) {
      html = await page.evaluate(() => document.querySelector('main')?.innerHTML ?? '')
      same = html === prev ? same + 1 : 0
      prev = html
      await page.waitForTimeout(120)
    }
    opened = html.length >= 300
  } catch { /* reported below */ }
  result[title] = { opened, len: html.length, hash: createHash('sha1').update(normalise(html)).digest('hex').slice(0, 12) }
}
await br.close()

let failed = 0
const prior = compare ? JSON.parse(readFileSync(compare, 'utf8')) : null
for (const t of TITLES) {
  const r = result[t]
  let verdict = r.opened ? '' : '✗ NOT OPENED'
  if (!r.opened) failed++
  if (prior && r.opened) {
    if (!prior[t]) { verdict = '✗ not in the saved snapshot'; failed++ }
    else if (prior[t].hash !== r.hash) { verdict = `✗ CHANGED (${prior[t].hash} → ${r.hash}, ${prior[t].len} → ${r.len} chars)`; failed++ }
    else verdict = '✓ identical'
  }
  console.log(`${t.padEnd(22)} ${String(r.len).padStart(6)} chars  ${r.hash}  ${verdict}`)
}
if (save) { writeFileSync(save, JSON.stringify(result, null, 1)); console.log(`saved ${save}`) }
console.log(failed ? `\n${failed} section(s) differ or did not open` : prior ? '\nall 15 sections identical' : '\nsnapshot taken')
process.exit(failed ? 1 : 0)
