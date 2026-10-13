#!/usr/bin/env node
/**
 * mark-and-the-stats — the Be mark, the mail switch, and the habits order
 *
 *   node scripts/mark-and-the-stats.mjs [mark|mail|habits|control]
 *
 * Three separate claims, each measured where it is made:
 *
 * - **mark** — it is 76px (1.5x the 51 it was), it owns the **top-left**
 *   corner with nothing drawn to its left, and it is *aligned*: every item in
 *   the row shares one centre line and the mark sits inside the row's own
 *   bounds. A size assertion alone passes with the mark hanging out of the row
 *   or sitting at the wrong end of it, which is why each of those is its own
 *   claim.
 * - **mail** — no Mail/Smart switch, and the four views are now **inside the
 *   bar** with the LAST 30 DAYS statement gone. The absence is also true of a
 *   blank page, so the pills' presence *in that element* is asserted beside
 *   it, along with the bar still being one line.
 * - **habits** — the stats card is *above* the controls, and the duplicate
 *   sentence that used to sit over it is gone. Measured as the rects' own y
 *   order, not as source order.
 */

import { chromium } from 'playwright-core'
import { user, session } from './session.mjs'

import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'mark'
const BASE = 'http://localhost:5199/BPA/'

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  // Two real habits: with none at all there is no stats card to be above
  // anything, and the measurement would be about an empty page.
  if (u.pathname === '/rest/v1/habits') return j([
    { id: 'h1', user_id: user.id, name: 'Water', emoji: '💧', frequency: 'daily',
      goal: 8, unit: 'glasses', created_at: new Date().toISOString() },
    { id: 'h2', user_id: user.id, name: 'Walk', emoji: '🚶', frequency: 'daily',
      created_at: new Date().toISOString() },
  ])
  return j([])
})
await ctx.route('**://www.googleapis.com/**', r =>
  r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  sessionStorage.setItem('finance-unlocked', '1')
} catch {} }, session)

const p = await ctx.newPage()

// Installed before the first navigation, or the counter misses the boot.

const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 140)))

let fails = 0
const ok = (n, c, x = '') => {
  console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

async function go(mod) {
  if (!p.url().startsWith(BASE)) await p.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p.evaluate(m => { try {
    const ui = JSON.parse(localStorage.getItem('professor-ui') || '{}')
    localStorage.setItem('professor-ui', JSON.stringify({
      ...ui, state: { ...(ui.state || {}), activeModule: m, themeId: 'sunlit-bento' }, version: 0 }))
  } catch {} }, mod)
  await p.goto(BASE, { waitUntil: 'domcontentloaded' })
  await settled(p, traffic, 5600)
}

/* ── the mark ──────────────────────────────────────────────────────────────── */
// It owns the window's top-left corner, **over the nav rail**: centred on the
// rail's own pill, inside the rail's column, on the same centre line as the
// controls across the window. Each is its own claim — a size alone passes with
// the mark floating off the rail, which is what was reported.
if (MODE === 'mark' || MODE === 'control') {
  await go('morning')
  if (MODE === 'control') {
    // The arrangement as it was, restored on the very same element: moved into
    // the content column's row, 76px, at that row's 18px padding.
    await p.evaluate(() => {
      const row  = document.querySelector('[data-you]')
      const mark = document.querySelector('[data-be-mark]')
      if (!row || !mark) return
      row.prepend(mark)
      row.style.height = '84px'
      mark.style.marginRight = 'auto'
      const art = mark.firstElementChild
      if (art) { art.style.width = '76px'; art.style.height = '76px' }
    })
    await p.waitForTimeout(200)
  }
  const m = await p.evaluate(() => {
    const row  = document.querySelector('[data-you]')
    const mark = document.querySelector('[data-be-mark]')
    const pill = document.querySelector('[data-side-rail] > div > div')
    const rail = document.querySelector('[data-side-rail]')
    if (!row || !mark || !pill || !rail) return null
    const art = mark.firstElementChild.getBoundingClientRect()
    const pr  = pill.getBoundingClientRect()
    const rr  = rail.getBoundingClientRect()
    const yr  = row.getBoundingClientRect()
    const mid = r => +(r.left + r.width / 2).toFixed(1)
    const ctrls = [...row.children].filter(el => el !== mark && el.getBoundingClientRect().width > 0)
      .map(el => { const r = el.getBoundingClientRect(); return +(r.top + r.height / 2).toFixed(1) })
    return {
      w: Math.round(art.width), h: Math.round(art.height),
      inRow: row.contains(mark),
      xOff: +(mid(art) - mid(pr)).toFixed(1),
      pillW: Math.round(pr.width),
      aboveRail: art.bottom <= rr.top + 0.5 || art.bottom <= pr.top,
      markMid: +(art.top + art.height / 2).toFixed(1),
      ctrlMids: ctrls, rowMid: +(yr.top + yr.height / 2).toFixed(1),
      top: Math.round(art.top), left: Math.round(art.left),
    }
  })
  if (!m) { ok('the mark and the rail are on screen', false) }
  else {
    console.log('   ' + JSON.stringify(m))
    ok('the mark is drawn, square', m.w > 0 && m.w === m.h, `${m.w}x${m.h}`)
    ok('it is not in the content column\'s row', !m.inRow)
    ok('it is centred over the rail’s pill', Math.abs(m.xOff) <= 1, `${m.xOff}px off`)
    ok('and no wider than the pill', m.w <= m.pillW, `${m.w} in ${m.pillW}`)
    ok('and above the rail, not over it', m.aboveRail)
    ok('on the window’s top-left, not mid-page', m.left < 80 && m.top < 40, `${m.left},${m.top}`)
    ok('sharing a centre line with the controls',
      m.ctrlMids.length > 0 && Math.max(...m.ctrlMids.map(c => Math.abs(c - m.markMid))) <= 1,
      `mark ${m.markMid} vs ${m.ctrlMids.join(',')}`)
  }
}

/* ── mail ──────────────────────────────────────────────────────────────────── */
if (MODE === 'mail') {
  await go('inbox')
  const seg = await p.evaluate(() =>
    [...document.querySelectorAll('[role="radiogroup"], .sb-segmented')]
      .map(e => e.innerText.replace(/\s+/g, ' ').trim()))
  console.log('   segmented controls on the page:', JSON.stringify(seg))
  ok('no Mail / Smart switch anywhere', !seg.some(t => /^Mail Smart$|^Smart Mail$/.test(t)))

  const bar = await p.evaluate(() => {
    const el = document.querySelector('[data-mail-bar]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const rails = [...document.querySelectorAll('.mail-filter-rail')]
    return {
      text: el.innerText.replace(/\s+/g, ' ').trim(),
      h: Math.round(r.height),
      pageText: document.body.innerText.replace(/\s+/g, ' '),
      rails: rails.length,
      railsInBar: rails.filter(x => el.contains(x)).length,
      // Does the rail actually have its own box to scroll in?
      railFlexes: rails.filter(x => el.contains(x))
        .map(x => Math.round(x.getBoundingClientRect().width)),
    }
  })
  if (!bar) { ok('the mail bar is on screen', false) }
  else {
    console.log('   ' + JSON.stringify({ ...bar, pageText: bar.pageText.slice(0, 50) }))
    // The positive claim first: an absence is also true of a blank page.
    ok('the bar is on screen', bar.h > 0, `${bar.h}px tall`)
    ok('the four views are inside it',
      ['Requires your action', 'Worth knowing', 'On your radar', 'Internal FYI']
        .every(t => bar.text.includes(t)), bar.text.slice(0, 90))
    ok('and All with them', /\bAll\b/.test(bar.text))
    ok('there is exactly one filter rail, and it is in the bar',
      bar.rails === 1 && bar.railsInBar === 1, `${bar.rails} rails, ${bar.railsInBar} in the bar`)
    ok('it has a box of its own to scroll in', (bar.railFlexes[0] ?? 0) > 200,
      `${bar.railFlexes[0]}px`)
    // Now the absence.
    ok('the LAST 30 DAYS statement is gone from the bar', !/30 days/i.test(bar.text), bar.text.slice(0, 60))
    ok('and from the page', !/Last 30 days/i.test(bar.pageText))
    ok('nor does it still say who is waiting',
      !/waiting on you/i.test(bar.text) && !/Not read yet/i.test(bar.text))
    ok('the bar still carries its own two controls',
      /Check now/.test(bar.text) && /Re-read all/.test(bar.text))
    // One line: pills are 27px, so a wrapped bar is over 60.
    ok('and it is one line', bar.h <= 52, `${bar.h}px`)
  }
}

/* ── habits ────────────────────────────────────────────────────────────────── */
if (MODE === 'habits') {
  await go('habits')
  const h = await p.evaluate(() => {
    const bar = document.querySelector('[data-habits-bar]')
    if (!bar) return null
    const br = bar.getBoundingClientRect()
    // The stats card is the one holding the ring and "of the day done".
    // **Not "of the day done"** — that wording only appears once something is
    // logged, so on a fresh day the selector found nothing and the case failed
    // for the wrong reason. "Active habits" is in the card in every state.
    const card = [...document.querySelectorAll('main div')].find(el =>
      /Active habits/i.test(el.innerText || '') && el.getBoundingClientRect().height < 160
      && el !== bar && !el.contains(bar))
    const cr = card?.getBoundingClientRect()
    return {
      barTop: Math.round(br.top), barText: bar.innerText.replace(/\s+/g, ' ').trim(),
      cardTop: cr ? Math.round(cr.top) : null,
      cardText: card ? card.innerText.replace(/\s+/g, ' ').trim().slice(0, 70) : null,
    }
  })
  if (!h) { ok('the habits bar is on screen', false) }
  else {
    console.log('   ' + JSON.stringify(h))
    ok('the stats card is on screen', h.cardTop !== null)
    ok('and it is ABOVE the controls', h.cardTop !== null && h.cardTop < h.barTop,
      `card ${h.cardTop} vs bar ${h.barTop}`)
    ok('the bar no longer repeats the title', !/HABITS TRACKER/i.test(h.barText), h.barText)
    ok('nor the stats sentence', !/of today done/i.test(h.barText) && !/finished/i.test(h.barText))
    ok('but it still holds how you are looking, and New habit',
      /Table/.test(h.barText) && /New habit/.test(h.barText), h.barText)
  }
}

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
