// node scripts/library-covers-fill.mjs [widths…]     (needs a dev server on 5199)
// "Why is there room for another book at the end of every shelf?" The Covers view packs its rows
// from the width the case has — but with a gap constant (14) the boards do not use (they draw 6),
// so in a band of window widths it fits one cover fewer than the row has room for. Measured at
// every width: for each full row, the free room at its right end must be smaller than one more
// cover (a row that could take another book is a row packed wrong).
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const U = user.id
const books = Array.from({ length: 60 }, (_, i) => ({
  id: `b${String(i).padStart(3, '0')}`, user_id: U, title: `Book ${i + 1}`, authors: [`Author ${i + 1}`], status: 'want',
  created_at: `2025-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`, shelf_order: i,
}))
const widths = process.argv.slice(2).map(Number).filter(Boolean)
const WIDTHS = widths.length ? widths : [1100, 1180, 1260, 1340, 1420, 1500, 1580, 1660, 1740, 1820]
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
for (const W of WIDTHS) {
  const ctx = await b.newContext({ viewport: { width: W, height: 900 } })
  await ctx.route('**://placeholder.supabase.co/**', r => {
    const u = new URL(r.request().url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x), headers: { 'access-control-allow-origin': '*' } })
    if (u.pathname === '/auth/v1/user') return j(user)
    if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
    if (u.pathname.startsWith('/auth/v1')) return j({})
    if (u.pathname.endsWith('/rpc/my_modules')) return j([{ module_id: 'library', label: 'Library', enabled: true }])
    if (u.pathname.endsWith('/library_books')) return j(books)
    return j([])
  })
  await ctx.route('https://covers.openlibrary.org/**', r => r.abort())
  await ctx.addInitScript(s => { try {
    localStorage.setItem('bpa-wizard-done', '1')
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
  } catch {} }, session)
  const p = await ctx.newPage(); const traffic = watchTraffic(p)
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6500)
  await p.getByRole('tab', { name: 'Covers' }).click(); await p.waitForTimeout(600)
  const m = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.lib-case .lib-row')]
    const out = rows.map(r => {
      const kids = [...r.children].filter(c => c.classList.contains('lib-cover'))
      if (!kids.length) return null
      const rr = r.getBoundingClientRect(), first = kids[0].getBoundingClientRect(), last = kids[kids.length - 1].getBoundingClientRect()
      return { n: kids.length, free: rr.right - 20 - last.right, cover: first.width, gap: kids.length > 1 ? kids[1].getBoundingClientRect().left - first.right : 0 }
    }).filter(Boolean)
    return out
  })
  const full = m.slice(0, -1)             // the last row is allowed to be short
  const tooRoomy = full.filter(r => r.free >= r.cover + r.gap)
  ok(`${W}px: ${m.length} rows of ${m[0]?.n} — no full row has room for another cover`, full.length > 0 && tooRoomy.length === 0, `free ${full[0]?.free.toFixed(0)}px vs a cover + gap of ${(full[0]?.cover + full[0]?.gap).toFixed(0)}px`)
  await ctx.close()
}
await b.close(); process.exit(fails ? 1 : 0)
