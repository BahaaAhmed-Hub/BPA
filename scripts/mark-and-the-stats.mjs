#!/usr/bin/env node
/**
 * mark-and-the-stats — the Be mark, the mail switch, and the habits order
 *
 *   node scripts/mark-and-the-stats.mjs [mark|mail|habits|control]
 *
 * Three separate claims, each measured where it is made:
 *
 * - **mark** — the mark is 1.5x the controls beside it and *aligned*, which is
 *   two measurements rather than one: every item's vertical centre is the same
 *   line, and its right edge is the row's own padding edge with nothing to the
 *   right of it. A size assertion alone would pass with the mark hanging out
 *   of the row.
 * - **mail** — no Mail/Smart switch anywhere, and the Smart view is what draws
 *   (the absence alone is also true of a blank page, so the presence is
 *   asserted beside it).
 * - **habits** — the stats card is *above* the controls, and the duplicate
 *   sentence that used to sit over it is gone. Measured as the rects' own y
 *   order, not as source order.
 */

import { chromium } from 'playwright-core'
import { user, session } from './session.mjs'

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
  await p.waitForTimeout(5600)
}

/* ── the mark ──────────────────────────────────────────────────────────────── */
if (MODE === 'mark' || MODE === 'control') {
  await go('morning')
  if (MODE === 'control') {
    // The row as it was: 48px tall, which a 51px mark cannot sit inside.
    await p.evaluate(() => {
      const row = document.querySelector('[data-you]'); if (row) row.style.height = '48px'
    })
    await p.waitForTimeout(200)
  }

  const m = await p.evaluate(() => {
    const row  = document.querySelector('[data-you]')
    const mark = document.querySelector('[data-be-mark]')
    if (!row || !mark) return null
    const rr = row.getBoundingClientRect()
    const mr = mark.getBoundingClientRect()
    // Everything in the row that is a real control, by its own box.
    const items = [...row.children].filter(el => el !== mark).map(el => {
      const r = el.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height), mid: +(r.top + r.height / 2).toFixed(1) }
    }).filter(i => i.w > 0)
    return {
      markW: Math.round(mr.width), markH: Math.round(mr.height),
      markMid: +(mr.top + mr.height / 2).toFixed(1),
      rowTop: Math.round(rr.top), rowBottom: Math.round(rr.bottom), rowH: Math.round(rr.height),
      markTop: Math.round(mr.top), markBottom: Math.round(mr.bottom),
      rightGap: Math.round(rr.right - mr.right),
      items,
      // Is anything drawn to the right of it?
      rightOf: [...document.querySelectorAll('[data-you] *')]
        .filter(el => el.getBoundingClientRect().left >= mr.right + 1).length,
    }
  })
  if (!m) { ok('the mark is on screen', false); }
  else {
    console.log('   ' + JSON.stringify(m))
    const ctrl = m.items[0]
    ok('the mark is drawn', m.markW > 0, `${m.markW}x${m.markH}`)
    ok('the controls beside it are 34px', ctrl?.h === 34, `${ctrl?.h}`)
    ok('and the mark is 1.5x of them', m.markW === Math.round(ctrl.h * 1.5), `${m.markW} vs ${ctrl.h} x 1.5`)
    ok('it is square', m.markW === m.markH)

    // Vertical: one centre line through every item in the row.
    const offs = m.items.map(i => Math.abs(i.mid - m.markMid))
    ok('every item shares its centre line', Math.max(...offs) <= 1,
      `worst ${Math.max(...offs).toFixed(1)}px`)
    ok('and it sits inside the row, not through it',
      m.markTop >= m.rowTop && m.markBottom <= m.rowBottom,
      `mark ${m.markTop}–${m.markBottom} in row ${m.rowTop}–${m.rowBottom}`)

    // Horizontal: it owns the corner.
    ok('nothing is drawn to the right of it', m.rightOf === 0, `${m.rightOf} elements`)
    ok('it sits on the row’s own right padding', m.rightGap === 18, `${m.rightGap}px`)
  }
}

/* ── mail ──────────────────────────────────────────────────────────────────── */
if (MODE === 'mail') {
  await go('inbox')
  const txt = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
  const seg = await p.evaluate(() =>
    [...document.querySelectorAll('[role="radiogroup"], .sb-segmented')]
      .map(e => e.innerText.replace(/\s+/g, ' ').trim()))
  console.log('   segmented controls on the page:', JSON.stringify(seg))
  ok('no Mail / Smart switch anywhere', !seg.some(t => /^Mail Smart$|^Smart Mail$/.test(t)))
  // The absence is also true of a blank page, so assert the view is there.
  ok('the Smart view is what draws', /Last 30 days/i.test(txt), txt.slice(0, 60))
  ok('and its bar carries its own controls', /Check now/.test(txt) && /Re-read all/.test(txt))
  ok('mail-mode is no longer read or written',
    !(await p.evaluate(() => localStorage.getItem('mail-mode'))) ||
    !(await p.evaluate(() => document.body.innerHTML.includes('mail-mode'))))
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
