// A company's logo: set in Settings, drawn in the rail, written to the row.
//
// Four things a wrong implementation would do, each asserted against:
//   - draw a preview and store nothing (the control is the whole point: the
//     claim is about `professor-companies` and the `companies` upsert body,
//     never about a pixel on screen)
//   - store the file as handed in — a 1200px photograph in a row read on
//     every load
//   - lose it on a project that has not run `20260025`, because the upsert
//     is refused for a column nobody has — and, worse, take the name and the
//     account with it, which is the failure `COMPANY_OPTIONAL` exists for
//   - leave the rail drawing initials until a reload, which is what
//     `saveCompanies` firing no event actually did
//
//   node scripts/company-logo-sticks.mjs [set|shrinks|remove|no-column|dense]
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

import { watchTraffic, settled } from './settled.mjs'
const MODE = process.argv[2] ?? 'set'
const U = user.id

const COMPANIES = [
  { id: 'co-teradix', name: 'Teradix Ltd',     color: '#3B82F6', users: [], calendarId: 'teradix-cal' },
  { id: 'co-dx',      name: 'DX Technologies', color: '#0C8140', users: [], accountId: 'acc-dx' },
]

// Every row the server accepted, and every upsert it refused.
const stored = []
const refused = []
// `logo_url` is deliberately absent on this stub unless the mode says
// otherwise: a fake server that accepts whatever it is handed cannot tell a
// well-formed write from one naming a column nobody has — the
// `accounts-come-back.mjs` rule.
const HAS_LOGO_COLUMN = MODE !== 'no-column'
const COLUMNS = ['id', 'user_id', 'name', 'color_tag', 'calendar_id', 'is_active',
                 'email_domain', 'account_id', 'users_data', 'hidden',
                 ...(HAS_LOGO_COLUMN ? ['logo_url'] : [])]

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } })

await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url()); const m = q.method()
  const j = (x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
  let body = {}
  try { body = JSON.parse(q.postData() ?? '{}') } catch { /* not json */ }

  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})

  if (u.pathname.endsWith('/companies')) {
    if (m === 'GET') return j(stored.length ? stored : [])
    if (m === 'POST' || m === 'PATCH') {
      const rows = Array.isArray(body) ? body : [body]
      for (const row of rows) {
        const unknown = Object.keys(row).find(k => !COLUMNS.includes(k))
        if (unknown) {
          refused.push({ unknown, keys: Object.keys(row) })
          // PostgREST's own shape for a column that does not exist.
          return j({ code: 'PGRST204', message: `Could not find the '${unknown}' column of 'companies' in the schema cache` }, 400)
        }
      }
      for (const row of rows) {
        const i = stored.findIndex(x => x.id === row.id)
        if (i >= 0) stored[i] = { ...stored[i], ...row }
        else stored.push(row)
      }
      return j(rows)
    }
    if (m === 'DELETE') return j([])
  }
  if (u.pathname.endsWith('/tasks') || u.pathname.endsWith('/habits')) return j([])
  return j([])
})
await ctx.route('**://www.googleapis.com/**', r => {
  const u = new URL(r.request().url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname.includes('/users/me/calendarList')) return j({ items: [
    { id: 'primary', summary: user.email, primary: true, accessRole: 'owner', backgroundColor: '#9B9180', selected: true },
  ] })
  if (u.pathname.includes('/events')) return j({ items: [] })
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))

// An init script runs before **every** navigation, so seeding the companies
// unconditionally wiped the logo on the very reload the `no-column` case
// exists to measure — and the case then failed for the fixture's reason
// rather than the code's. Seed only what is not there.
await ctx.addInitScript(([s, cos]) => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'settings', themeId: 'sunlit-bento' }, version: 0 }))
  if (!localStorage.getItem('professor-companies')) localStorage.setItem('professor-companies', JSON.stringify(cos))
  localStorage.setItem('google_provider_token', 'stub-token')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
} catch { /* quota */ } }, [session, COMPANIES])

const p = await ctx.newPage()

// Installed before the first navigation, or the counter misses the boot.

const traffic = watchTraffic(p)
p.on('dialog', d => d.accept())
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6000)

let code = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  [${MODE}] ${n}${x ? '  ' + x : ''}`); if (!c) code = 1 }
const text = () => p.evaluate(() => document.body.innerText)

/** A real PNG, made in the page, so what the picker is handed is a file a
 *  browser would hand it. `big` is 900x300 — a wordmark, the shape that
 *  proves nothing is cropped to a square — and `dense` is noise **at 128px**,
 *  which is the densest thing the stored box can hold. At 1400px it proved
 *  nothing: the downscale averages noise away and a 1400px mess arrives as a
 *  1KB flat grey, so the rung under test was never reached. */
async function pngFile(kind) {
  return p.evaluate(async k => {
    const [w, h] = k === 'dense' ? [128, 128] : k === 'big' ? [900, 300] : [64, 64]
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const g = c.getContext('2d')
    if (k === 'dense') {
      // Random noise: incompressible, so PNG and WebP both stay over the cap.
      const d = g.createImageData(w, h)
      for (let i = 0; i < d.data.length; i++) d.data[i] = (Math.random() * 256) | 0
      g.putImageData(d, 0, 0)
    } else {
      g.fillStyle = '#C62828'; g.fillRect(0, 0, w, h)
      g.fillStyle = '#FFFFFF'; g.font = `bold ${Math.round(h * 0.5)}px sans-serif`
      g.fillText('T', w * 0.4, h * 0.7)
      // A marker at each far end. "Nothing was cropped" is a claim about the
      // mark's own extremes, and it has to be asserted on something that is
      // *there* — counting empty space only worked while a contained image
      // left transparent bars, which an image with its own ground no longer
      // does.
      g.fillStyle = '#00E5FF'
      g.fillRect(0, h * 0.4, Math.max(2, w * 0.03), h * 0.2)
      g.fillRect(w - Math.max(2, w * 0.03), h * 0.4, Math.max(2, w * 0.03), h * 0.2)
    }
    const blob = await new Promise(res => c.toBlob(res, 'image/png'))
    const buf = new Uint8Array(await blob.arrayBuffer())
    return { name: `${k}.png`, mimeType: 'image/png', buffer: Array.from(buf) }
  }, kind)
}

const setFile = async (coId, kind) => {
  const f = await pngFile(kind)
  await p.locator(`[data-logo-pick="${coId}"]`).locator('xpath=ancestor::div[1]').locator('input[type=file]')
    .setInputFiles({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.buffer) })
  await p.waitForTimeout(1800)
}

const logoOf = id => p.evaluate(i => {
  const cos = JSON.parse(localStorage.getItem('professor-companies') || '[]')
  return cos.find(c => c.id === i)?.logoUrl ?? null
}, id)

// Settings → Accounts & companies. `.last()`, because the rail's own nav comes
// first in the DOM and `Habits` is in both lists — the mistake the ink audit
// made and had to undo.
ok('Settings is open', /Accounts & companies/.test(await text()))
await p.getByText('Accounts & companies', { exact: true }).last().click()
await p.waitForTimeout(1200)
ok('the companies section is open', /Teradix Ltd/.test(await text()))
ok('every company card offers a logo', await p.locator('[data-logo-pick]').count() === 2,
   `${await p.locator('[data-logo-pick]').count()} pickers`)
ok('with no caption under the mark, and nothing to remove where there is no logo', !/\bLogo\b/.test(await text()) && await p.locator('[data-logo-remove]').count() === 0)

if (MODE === 'dense') {
  // The second rung, which is the whole reason there is no size refusal.
  // Pure RGB noise at 128px is 75,574 bytes as PNG — over the cap — and
  // 19,659 as WebP at 0.9. So a photographic mark has to come back as WebP,
  // under the cap, with nothing asked of the person.
  await setFile('co-teradix', 'dense')
  const got = await logoOf('co-teradix')
  ok('a dense image is still accepted', typeof got === 'string', String(got).slice(0, 24))
  ok('and it fell through to WebP', String(got).startsWith('data:image/webp'), String(got).slice(0, 20))
  ok('under the cap', (got?.length ?? 1e9) <= 48_000, `${Math.round((got?.length ?? 0) / 1024)}KB`)
  ok('nothing was refused', !/could not|not an image|cannot shrink/i.test(await text()))
  ok('and the row carries it', typeof stored.find(r => r.id === 'co-teradix')?.logo_url === 'string')
  await b.close(); process.exit(code)
}

await setFile('co-teradix', 'big')

const logo = await logoOf('co-teradix')
ok('the logo reached the store', typeof logo === 'string' && logo.startsWith('data:image/'),
   String(logo).slice(0, 24))
ok('as pixels, never markup', !/svg|script/i.test(String(logo).slice(0, 40)))

if (MODE === 'shrinks') {
  const px = await p.evaluate(src => new Promise(res => {
    const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.src = src
  }), logo)
  ok('a 900x300 wordmark is stored at 128 square', px[0] === 128 && px[1] === 128, JSON.stringify(px))
  ok('and under the cap', logo.length <= 48_000, `${Math.round(logo.length / 1024)}KB`)
  // **Nothing cropped, and the corners are the mark's own ground.** A logo
  // with a background of its own has that background extended to the corners
  // rather than left transparent, so the circle it is drawn in is full — the
  // thing the rail got wrong. Both ends of the mark have to survive that.
  const fit = await p.evaluate(src => new Promise(res => {
    const i = new Image()
    i.onload = () => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0)
      const row = g.getImageData(0, 64, 128, 1).data
      const cyan = []
      for (let x = 0; x < 128; x++) {
        if (row[x * 4] < 120 && row[x * 4 + 1] > 170 && row[x * 4 + 2] > 200) cyan.push(x)
      }
      const corner = Array.from(g.getImageData(1, 1, 1, 1).data)
      res({ first: cyan[0] ?? -1, last: cyan[cyan.length - 1] ?? -1, corner })
    }
    i.src = src
  }), logo)
  ok('both ends of the mark survive — nothing was cropped',
     fit.first >= 0 && fit.last >= 0 && fit.first < 10 && fit.last > 118, JSON.stringify(fit))
  ok('and the corners carry its own ground, so a circle is full',
     fit.corner[3] > 250 && Math.abs(fit.corner[0] - 198) < 16 && fit.corner[1] < 70,
     JSON.stringify(fit.corner))
  await b.close(); process.exit(code)
}

if (MODE === 'no-column') {
  // The project has not run 20260025. The upsert naming `logo_url` is refused,
  // and the retry must drop **only that column** — the account, the domain and
  // the people have to survive, which is the whole of `COMPANY_OPTIONAL`.
  ok('the write naming logo_url was refused once', refused.some(r => r.unknown === 'logo_url'),
     JSON.stringify(refused.map(r => r.unknown)))
  const row = stored.find(r => r.id === 'co-teradix') ?? {}
  ok('the row still landed', !!row.id, JSON.stringify(Object.keys(row)))
  ok('with its name', row.name === 'Teradix Ltd', String(row.name))
  ok('its colour', row.color_tag === '#3B82F6', String(row.color_tag))
  ok('its calendar', row.calendar_id === 'teradix-cal', String(row.calendar_id))
  ok('its people', Array.isArray(row.users_data), JSON.stringify(row.users_data))
  ok('and no logo_url, since the column is not there', !('logo_url' in row))
  // The other half of the same rule: a blank the server could not hold must
  // never beat what this browser knows — and **Settings' own hydration** used
  // to be a second, hand-written merge that carried only users and hidden, so
  // opening this very screen wrote that blank over the account, the domain,
  // the calendar and the logo.
  const kept = await p.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('professor-companies') || '[]')
      .find(x => x.id === 'co-teradix') ?? {}
    return { logo: typeof c.logoUrl === 'string', cal: c.calendarId, name: c.name }
  })
  ok('the browser still holds the logo after the refused write', kept.logo, JSON.stringify(kept))
  ok('and the calendar link with it', kept.cal === 'teradix-cal', String(kept.cal))
  // And the browser keeps the logo, so the choice is not lost — a blank from
  // a server that cannot hold it never beats a value here.
  await p.reload({ waitUntil: 'domcontentloaded' })
  await settled(p, traffic, 6000)
  ok('the logo survives a reload on this device', typeof (await logoOf('co-teradix')) === 'string')
  await b.close(); process.exit(code)
}

if (MODE === 'remove') {
  const geo = await p.evaluate(() => {
    const x = document.querySelector('[data-logo-remove="co-teradix"]').getBoundingClientRect()
    const m = document.querySelector('[data-logo-pick="co-teradix"]').getBoundingClientRect()
    return { xr: x.right - m.right, xt: m.top - x.top, w: x.width, h: x.height, inCorner: x.left + x.width / 2 > m.left + m.width * 0.6 && x.top + x.height / 2 < m.top + m.height * 0.4 }
  })
  ok('the remove control is a small ✕ on the mark\'s top-right corner', geo.inCorner && geo.w >= 16 && geo.w <= 24, JSON.stringify(geo))
  ok('and there is no "Remove" word', !/\bRemove\b/.test(await text()))
  await p.locator('[data-logo-remove="co-teradix"]').click()
  await p.waitForTimeout(1500)
  ok('Remove takes it off the company', await logoOf('co-teradix') === null)
  ok('and clears the column rather than leaving the old one',
     stored.find(r => r.id === 'co-teradix')?.logo_url === null,
     JSON.stringify(stored.find(r => r.id === 'co-teradix')?.logo_url))
  ok('the card goes back to offering one: the picker is there, the ✕ is gone', await p.locator('[data-logo-pick="co-teradix"]').count() === 1 && await p.locator('[data-logo-remove="co-teradix"]').count() === 0)
  await b.close(); process.exit(code)
}

// ─── set: the row, and the rail ─────────────────────────────────────────────
const row = stored.find(r => r.id === 'co-teradix') ?? {}
ok('it was written to the row', typeof row.logo_url === 'string' && row.logo_url === logo,
   `${String(row.logo_url).slice(0, 20)}…`)
ok('the other company was not given one', !stored.find(r => r.id === 'co-dx')?.logo_url)

// **The rail draws it without a reload.** `saveCompanies` fired no event, so
// everything reading `professor-companies` — the rail, the calendar's company
// resolution, mailCompany's cache — learnt nothing until the page came back.
const railImg = async () => p.evaluate(() => {
  const t = document.querySelector('[data-company-tile="co-teradix"]')
  const img = t?.querySelector('img')
  if (!img) return null
  const r = img.getBoundingClientRect()
  return { src: img.getAttribute('src')?.slice(0, 22), w: Math.round(r.width), h: Math.round(r.height) }
})
const live = await railImg()
ok('the rail tile draws the logo, with no reload', !!live && live.src.startsWith('data:image/'),
   JSON.stringify(live))
ok('and it has a real box', (live?.w ?? 0) > 20 && (live?.h ?? 0) > 20, JSON.stringify(live))
// Two initials, which for "DX Technologies" is DT — the first letter of each
// of the first two words, which is what every company chip in the app has
// always shortened to.
const dx = await p.evaluate(() => {
  const t = document.querySelector('[data-company-tile="co-dx"]')
  return { img: !!t?.querySelector('img'), text: (t?.innerText || '').trim() }
})
ok('the company with no logo still draws its initials',
   !dx.img && dx.text === 'DT', JSON.stringify(dx))

await p.reload({ waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6000)
ok('it is still there after a reload', typeof (await logoOf('co-teradix')) === 'string')
ok('and the rail still draws it', !!(await railImg()))

await b.close()
process.exit(code)
