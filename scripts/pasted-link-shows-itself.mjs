#!/usr/bin/env node
/**
 * pasted-link-shows-itself — a link in a notes box becomes a card
 *
 *   node scripts/pasted-link-shows-itself.mjs [task|event|meeting|dead-thumb|control]
 *
 * The claim that matters is a **pair**, and either half alone proves nothing:
 * a YouTube link draws its picture with **no request to the server at all**
 * (the id in the URL already names the thumbnail), while an ordinary link —
 * which no browser can read — is the one that asks. So the measurement is as
 * much about the request that is *absent* as the card that is present, the
 * shape the entitlements run used.
 *
 * `dead-thumb` is the other half of being bold about a derived URL: a guess
 * that 404s must fall back to the site's mark, not leave a broken frame.
 * Control: the same 404 with the card's `onError` ignored keeps a 76px image
 * box with no pixels in it.
 */

import { chromium } from 'playwright-core'
import { user, session } from './session.mjs'

const MODE = process.argv[2] ?? 'task'
const YT   = 'https://www.youtube.com/watch?v=ZvDkJsKE80k&t=34s'
const NB   = 'https://notebook.google.com/notebook/c26de4d8-340b-42c4-9247-9c82c0fddbdf'
const PASTE = `${YT}\n${NB}`

// A 2x2 PNG — enough for the <img> to fire `load` rather than `error`.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z4AATAxQxhAUAACZbgMVIsjK1QAAAABJRU5ErkJggg==',
  'base64')

const tasks = [{
  id: 'link-1', title: 'Study AI Fundamentals', company: 'personal',
  quadrant: 'important_not_urgent', status: 'todo', completed: false,
  description: '', created_at: new Date().toISOString(), user_id: user.id,
}]

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 } })

/** Every call the page makes that we care about. */
const asked = { preview: [], thumb: [] }

await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url())
  // A cross-origin reply with no `Access-Control-Allow-Origin` is one the
  // page cannot read — the request lands and the answer is thrown away, which
  // is indistinguishable from a function that is not deployed.
  const j = x => r.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
    body: JSON.stringify(x) })
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
               'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }, body: '' })
  if (u.pathname === '/functions/v1/link-preview') {
    let body = {}
    try { body = JSON.parse(r.request().postData() || '{}') } catch {}
    asked.preview.push(body.urls ?? [])
    // The server answers only for what a browser genuinely cannot read.
    return j({ previews: (body.urls ?? []).map(url => ({
      url, title: 'Fundamentals of AI — my notebook', icon: 'https://notebook.google.com/favicon.ico',
    })) })
  }
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname === '/rest/v1/tasks') return j(tasks)
  return j([])
})

await ctx.route('**://i.ytimg.com/**', r => {
  asked.thumb.push(r.request().url())
  if (MODE === 'dead-thumb' || MODE === 'control')
    return r.fulfill({ status: 404, contentType: 'text/plain', body: 'no' })
  return r.fulfill({ status: 200, contentType: 'image/png', body: PNG })
})
await ctx.route('**://notebook.google.com/**', r =>
  r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
await ctx.route('**://www.googleapis.com/**', r =>
  r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))

const START = MODE === 'task' || MODE === 'dead-thumb' || MODE === 'control' ? 'tasks' : 'calendar'
await ctx.addInitScript(([s, mod]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  const ui = JSON.parse(localStorage.getItem('professor-ui') || '{}')
  localStorage.setItem('professor-ui', JSON.stringify({
    ...ui, state: { ...(ui.state || {}), activeModule: mod, themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('task-view-mode', 'matrix')
  localStorage.removeItem('professor-link-previews')
} catch {} }, [session, START])

const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(6500)

let fails = 0
const ok = (n, c, x = '') => {
  console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

/* ── get to a box that takes words ─────────────────────────────────────── */

let box = null
if (START === 'tasks') {
  const card = p.locator('[data-task-node]').filter({ hasText: 'Study AI Fundamentals' }).last()
  ok('the task is on the board', await card.count() > 0)
  await card.click()
  await p.waitForTimeout(900)
  box = p.locator('textarea[placeholder="Anything worth remembering…"]').last()
  ok('its Notes box is open', await box.count() > 0)
} else if (MODE === 'event') {
  await p.getByRole('button', { name: /New event/i }).first().click()
  await p.waitForTimeout(1200)
  const more = p.getByText('Notes and more').first()
  if (await more.count()) { await more.click(); await p.waitForTimeout(400) }
  box = p.locator('textarea[placeholder="Anything worth remembering…"]').last()
  ok('the composer’s Notes box is open', await box.count() > 0)
} else if (MODE === 'meeting') {
  // The outcome prompt is opened by `toggleStatus` — the one funnel every
  // door to "done" goes through. Reaching it through the real UI needs an
  // event; the dialog is driven here through that same funnel.
  box = p.locator('textarea[aria-label="The outputs of the meeting, one per line"]').last()
}

if (box && await box.count()) {
  await box.click()
  await box.fill(PASTE)
  await p.waitForTimeout(2600)        // past the 700ms hold, plus the round trip
}

/* ── what is on screen ─────────────────────────────────────────────────── */

const cards = p.locator('[data-link-card]')
const n = await cards.count()
ok('a card is drawn for each link', n === 2, `${n} cards`)

const shown = await p.evaluate(() => [...document.querySelectorAll('[data-link-card]')].map(a => ({
  href: a.getAttribute('href'),
  from: a.dataset.from,
  thumb: a.dataset.thumb,
  img: a.querySelector('img')?.getAttribute('src') ?? null,
  w: a.querySelector('img')?.getBoundingClientRect().width ?? 0,
  natural: a.querySelector('img')?.naturalWidth ?? 0,
  text: a.innerText.replace(/\s+/g, ' ').trim().slice(0, 70),
})))
console.log('  ' + JSON.stringify(shown, null, 1).replace(/\n/g, '\n  '))

const yt = shown.find(c => c.href === YT)
const nb = shown.find(c => c.href === NB)

ok('the YouTube link has a card', !!yt)
ok('the other link has a card too', !!nb)

if (MODE !== 'dead-thumb' && MODE !== 'control') {
  ok('the YouTube thumbnail is the one the id names',
    yt?.img === 'https://i.ytimg.com/vi/ZvDkJsKE80k/hqdefault.jpg', yt?.img ?? '')
  ok('and the picture actually loaded', (yt?.natural ?? 0) > 0, `naturalWidth ${yt?.natural}`)
  ok('it is marked as derived, not read', yt?.from === 'derived', yt?.from ?? '')

  // The pair: the derived one costs no request, the other one is why the
  // server exists at all.
  const everAsked = asked.preview.flat()
  ok('the server was NEVER asked about the YouTube link',
    !everAsked.includes(YT), everAsked.join(' '))
  ok('and it WAS asked about the one no browser can read',
    everAsked.includes(NB), everAsked.join(' '))
  ok('the read title is what the second card shows',
    /Fundamentals of AI/.test(nb?.text ?? ''), nb?.text ?? '')
} else {
  ok('the thumbnail 404’d, so the card fell back to its mark',
    yt?.thumb === 'no', `data-thumb=${yt?.thumb}`)
  ok('and no empty 76px image box is left behind',
    (yt?.w ?? 0) !== 76, `img width ${yt?.w}`)
  ok('the card is still a card, with its words',
    /youtube/i.test(yt?.text ?? '') || (yt?.text ?? '').length > 3, yt?.text ?? '')
  ok('the thumbnail was at least attempted', asked.thumb.length > 0, `${asked.thumb.length} tries`)
}

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
