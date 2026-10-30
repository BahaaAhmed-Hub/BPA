#!/usr/bin/env node
/**
 * integration-hub — Settings → Integrations: the platform in the middle, apps round it
 *
 *   node scripts/integration-hub.mjs [none|connected|reduced]
 *
 * none       nothing is connected: every mark is grey and no beam is drawn
 * connected  a token and a linked Telegram chat are served: those three are in
 *            colour with a beam each, and the four that do not exist yet stay grey
 * reduced    prefers-reduced-motion: the beams are drawn and do not move
 * Measured in the page: computed `filter`, the beam's own dash offset sampled
 * twice, and the logo's centre against the hub's. INK_THEME picks the theme.
 */
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'connected'
const THEME = process.env.INK_THEME ?? 'glass-depth'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 }, reducedMotion: MODE === 'reduced' ? 'reduce' : 'no-preference' })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (MODE !== 'none' && u.pathname.endsWith('/user_tokens')) return j([{ id: 't1', label: 'Siri Shortcuts', created_at: new Date().toISOString(), last_used_at: null, revoked: false }])
  if (MODE !== 'none' && u.pathname.endsWith('/telegram_links')) return j([{ chat_id: '42', linked_at: new Date().toISOString() }])
  return j([])
})
await ctx.route('**://www.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))
await ctx.addInitScript(([s, t]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s)); sessionStorage.setItem('finance-unlocked', '1')
  localStorage.setItem('bpa-wizard-done', '1'); localStorage.setItem('professor-wizard-done', '1')
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'settings', themeId: t }, version: 0 }))
} catch {} }, [session, THEME])
const p = await ctx.newPage(); const traffic = watchTraffic(p)
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6000)
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

await p.getByText('Integrations', { exact: true }).last().click().catch(() => {})
await p.locator('[data-integration-hub]').waitFor({ timeout: 6000 }).catch(() => {})
ok('the hub is on the page', await p.locator('[data-integration-hub]').count() === 1)
await p.waitForTimeout(500)
const read = () => p.evaluate(() => {
  const hub = document.querySelector('[data-integration-hub]'); if (!hub) return null
  const hr = hub.getBoundingClientRect()
  const nodes = [...hub.querySelectorAll('[data-hub-node]')].map(li => {
    const ring = li.querySelector('span'); const c = getComputedStyle(ring)
    return { id: li.dataset.hubNode, state: li.dataset.state, label: li.getAttribute('aria-label'), filter: c.filter, opacity: c.opacity }
  })
  const beams = [...hub.querySelectorAll('.hub-beam')].map(e => ({ off: getComputedStyle(e).strokeDashoffset, anim: getComputedStyle(e).animationName, dur: getComputedStyle(e).animationDuration }))
  const logo = hub.querySelector('[data-hub-centre]')
  const lr = logo?.getBoundingClientRect()
  return { nodes, beams, hubC: [hr.left + hr.width / 2, hr.top + hr.height / 2], logoC: lr && [lr.left + lr.width / 2, lr.top + lr.height / 2], w: hr.width, h: hr.height }
})
const a = await read()
ok('seven apps are drawn', a?.nodes.length === 7, `${a?.nodes.map(n => n.id).join(',')}`)
ok('the platform logo is centred in the hub', !!a?.logoC && Math.abs(a.logoC[0] - a.hubC[0]) < 1.5 && Math.abs(a.logoC[1] - a.hubC[1]) < 1.5, JSON.stringify(a?.logoC) + ' vs ' + JSON.stringify(a?.hubC?.map(Math.round)))
const live = ['telegram', 'siri', 'mcp']
for (const n of a?.nodes ?? []) {
  const shouldBeOn = MODE !== 'none' && live.includes(n.id)
  ok(`${n.id}: ${shouldBeOn ? 'in colour' : 'grey'} (${n.state})`, shouldBeOn ? (n.state === 'on' && n.filter === 'none') : (n.state !== 'on' && /grayscale\(1\)/.test(n.filter)), n.filter)
}
ok('every node says its state to a screen reader', a?.nodes.every(n => /, (connected|not connected|not available yet)$/.test(n.label)))
ok('the four not-yet apps are dimmer than the live ones', a?.nodes.filter(n => n.state === 'soon').every(n => Number(n.opacity) < 0.7))
ok(`${MODE === 'none' ? 'no' : '3'} beams`, a?.beams.length === (MODE === 'none' ? 0 : 3), `${a?.beams.length}`)
if (MODE === 'connected') {
  ok('the beam animates over 3s', a.beams.every(x => x.anim === 'hub-beam' && x.dur === '3s'), JSON.stringify(a.beams[0]))
  await p.waitForTimeout(700); const c = await read()
  ok('and the dash is actually moving', c.beams.some((x, i) => x.off !== a.beams[i].off), `${a.beams[0].off} -> ${c.beams[0].off}`)
}
if (MODE === 'reduced') {
  await p.waitForTimeout(700); const c = await read()
  ok('reduced motion: beams drawn and still', c.beams.length === 3 && c.beams.every((x, i) => x.anim === 'none' && x.off === a.beams[i].off), JSON.stringify(c.beams[0]))
}
await p.locator('[data-integration-hub]').screenshot({ path: process.env.SHOT ?? `/tmp/hub-${MODE}.png` }).catch(() => {})
await b.close(); console.log(fails ? `\n${fails} failing` : '\nall passing'); process.exit(fails ? 1 : 0)
