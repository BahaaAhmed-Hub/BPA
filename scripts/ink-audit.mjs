// ─── Contrast audit ──────────────────────────────────────────────────────────
//
//   npm run dev -- --port 5199        (in one shell)
//   node scripts/ink-audit.mjs 5199   (in another)
//
// Walks nine screens in each of the four themes and measures every piece of
// text against the background it is *actually* drawn on, rather than against
// the token somebody meant. Prints one row per distinct failing colour pair,
// and nothing at all when the app is clean.
//
// Three things it has to get right, each of which gave a wrong answer before
// it did:
//
// - **`color-mix()` does not come back as `rgb()`.** Chrome computes it to
//   `color(srgb 0.9 0.8 0.75)` — the same channels, 0..1 rather than 0..255.
//   Read as 0..255, every tint in the app audits as near-black.
// - **The ground is a stack.** An element's own background is often
//   translucent or absent, so the ink lands on an ancestor's; the stack is
//   walked to the first opaque layer and composited back down.
// - **Some text has no measurable ground.** Over a gradient the ratio depends
//   on where the glyph falls, so that is left out rather than guessed at, and
//   `aria-hidden` decoration is exempt under WCAG and skipped.
//
import { chromium } from 'playwright-core'

const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const ME = 'eng.bahaa.a@gmail.com'
const jwt = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: 'u1', email: ME, aud: 'authenticated', role: 'authenticated', exp: now + 3600, iat: now })}.sig`
const session = {
  access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r1', provider_token: 'tok',
  user: { id: 'u1', email: ME, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' }, user_metadata: { full_name: 'Bahaa Ahmed' }, created_at: '2025-01-01T00:00:00.000Z' },
}

const D = new Date(); const at = (h, m = 0) => { const d = new Date(D); d.setHours(h, m, 0, 0); return d.toISOString() }
const events = [{
  id: 'e1', summary: 'OWI Actions Review', start: { dateTime: at(13) }, end: { dateTime: at(14) },
  status: 'confirmed', calendarId: 'primary', calendarColor: '#7F77DD',
  organizer: { email: ME },
  attendees: [
    { email: ME, self: true, responseStatus: 'accepted' },
    { email: 'bahaa.ahmed@teradix.com', responseStatus: 'accepted' },
    { email: 'mohamed.zein@teradix.com', responseStatus: 'needsAction' },
    { email: 'khaled.aziz@teradix.com', responseStatus: 'declined' },
  ],
}]
const cals = [{ id: 'primary', summary: 'Work', backgroundColor: '#7F77DD', primary: true, accessRole: 'owner', accountEmail: ME }]

const T = {}
for (let i = 1; i <= 4; i++) {
  T['m' + i] = { from: `Person ${i} <p${i}@teradix.com>`, to: ME, subj: `Message number ${i}`, body: `Body of message ${i}.` }
}
const msg = id => ({
  id, threadId: id, labelIds: ['INBOX', 'UNREAD'], internalDate: String(Date.now() - 3600000),
  snippet: T[id].body,
  payload: { mimeType: 'text/plain', headers: [
    { name: 'From', value: T[id].from }, { name: 'To', value: T[id].to },
    { name: 'Subject', value: T[id].subj }, { name: 'Message-ID', value: `<${id}@x>` },
  ], body: { size: 9, data: Buffer.from(T[id].body).toString('base64url') } },
})

// ─── The measurement, run inside the page ────────────────────────────────────
const AUDIT = () => {
  // Chrome computes color-mix() to `color(srgb 0.9 0.8 0.7)` — 0..1, not
  // 0..255. Read as 0..255 every mix audits as near-black.
  const px = c => {
    const srgb = /^color\(srgb\s+([^)]+)\)$/i.exec(c.trim())
    if (srgb) {
      const p = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number)
      return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p[3] === undefined ? 1 : p[3] }
    }
    const m = /rgba?\(([^)]+)\)/.exec(c)
    if (!m) return null
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }
  }
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  })

  /** The colour actually behind this element: its own background composited
   *  over its ancestors', down to the first opaque one. */
  const groundOf = el => {
    const stack = []
    let painted = false     // a gradient or image in the stack: not measurable here
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') { painted = true; break }
      const bg = px(cs.backgroundColor)
      if (!bg || bg.a === 0) continue
      stack.push(bg)
      if (bg.a === 1) break
    }
    if (painted) return null
    if (stack.length === 0) return { r: 255, g: 255, b: 255, a: 1 }
    let out = stack[stack.length - 1]
    for (let i = stack.length - 2; i >= 0; i--) out = over(stack[i], out)
    return out
  }

  const out = []
  for (const el of document.querySelectorAll('*')) {
    // Only elements that draw text of their own.
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    const svg = el.tagName === 'svg'
    if (!own && !svg) continue
    const r = el.getBoundingClientRect()
    if (r.width < 3 || r.height < 3) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.display === 'none') continue
    // Decoration is exempt by WCAG, and `aria-hidden` is how a component says
    // so — the same mark that keeps a screen reader from announcing it.
    if (el.closest('[aria-hidden="true"]')) continue

    const fgRaw = px(svg ? (cs.stroke !== 'none' ? cs.stroke : cs.color) : cs.color)
    if (!fgRaw) continue
    const ground = groundOf(el)
    // Text over a gradient or an image: the ratio depends on where on the
    // gradient it falls, which a single colour cannot say. Left out rather
    // than guessed at — a guess here is what produces phantom findings.
    if (!ground) continue
    const fg = fgRaw.a < 1 ? over(fgRaw, ground) : fgRaw
    const cr = ratio(fg, ground)

    const size = parseFloat(cs.fontSize)
    const weight = parseInt(cs.fontWeight, 10) || 400
    // WCAG "large text": 18.66px bold, or 24px.
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const need = svg ? 3 : large ? 3 : 4.5
    if (cr >= need) continue

    const txt = svg ? `<svg ${el.getAttribute('class') || ''}>`
      : [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 34)
    out.push({
      text: txt,
      ratio: Math.round(cr * 100) / 100,
      need,
      fg: `rgb(${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)})`,
      bg: `rgb(${Math.round(ground.r)},${Math.round(ground.g)},${Math.round(ground.b)})`,
      size: Math.round(size * 10) / 10,
      where: (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName),
    })
  }
  // Same failure repeated down a list is one finding.
  const seen = new Map()
  for (const f of out) {
    const k = `${f.fg}|${f.bg}|${f.size}`
    const p = seen.get(k)
    if (p) { p.n += 1; if (f.text.length > p.text.length) p.text = f.text }
    else seen.set(k, { ...f, n: 1 })
  }
  return [...seen.values()].sort((a, b) => a.ratio - b.ratio)
}

const THEMES = ['sunlit-bento', 'warm-minimal', 'glass-depth', 'evergreen']
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })

for (const theme of THEMES) {
  const page = await (await br.newContext({ viewport: { width: 1500, height: 1050 }, timezoneId: 'Africa/Cairo', locale: 'en-GB' })).newPage()
  await page.route('**://placeholder.supabase.co/**', r => {
    const u = r.request().url()
    if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user })
    if (u.includes('/auth/v1/token')) return r.fulfill({ json: session })
    return r.fulfill({ json: [] })
  })
  await page.route('**://*.googleapis.com/**', r => {
    const u = r.request().url()
    if (/\/calendars\/[^/]+\/events/.test(u)) return r.fulfill({ json: { items: events } })
    if (/calendarList/.test(u)) return r.fulfill({ json: { items: cals } })
    if (u.includes('/labels')) return r.fulfill({ json: { labels: [] } })
    if (u.includes('/threads?')) return r.fulfill({ json: { threads: Object.keys(T).map(id => ({ id })) } })
    const id = u.match(/threads\/([^?]+)/)?.[1]
    if (id && T[id]) return r.fulfill({ json: { id, messages: [msg(id)] } })
    return r.fulfill({ json: { items: [], threads: [] } })
  })
  await page.addInitScript(([s, cs, th]) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('google_provider_token', 'tok')
    localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
    localStorage.setItem('cal-intel-cals-cache', JSON.stringify(cs))
    localStorage.setItem('cal-view', 'week')
    localStorage.setItem('professor-ui', JSON.stringify({ state: { themeId: th }, version: 0 }))
  }, [session, cals, theme])

  await page.goto(`http://localhost:${process.argv[2]}/BPA/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3400)
  await page.getByText('Skip for now').first().click().catch(() => {})
  await page.waitForTimeout(700)

  const found = []
  const visit = async (label, go) => {
    try { await go() } catch { return }
    await page.waitForTimeout(1500)
    for (const f of await page.evaluate(AUDIT)) found.push({ ...f, screen: label })
  }

  await visit('Today', async () => { await page.locator('header nav button', { hasText: /^Today$/ }).first().click() })
  await visit('Calendar + event panel', async () => {
    await page.locator('header nav button', { hasText: /^Calendar$/ }).first().click()
    await page.waitForTimeout(1600)
    await page.locator('.event-card').first().click()
  })
  await visit('Mail', async () => { await page.locator('header nav button', { hasText: /^Mail$/ }).first().click() })
  await visit('Tasks', async () => { await page.locator('header nav button', { hasText: /^Tasks$/ }).first().click() })
  await visit('Habits', async () => { await page.locator('header nav button', { hasText: /^Habits$/ }).first().click() })
  await visit('Finance', async () => { await page.locator('header nav button', { hasText: /^Finance$/ }).first().click() })
  await visit('Dashboard', async () => { await page.locator('header nav button', { hasText: /^Dashboard$/ }).first().click() })
  // Settings is behind the avatar menu, and carries every colour picker there
  // is — the company swatches, the habit colours, the category palette.
  await visit('Settings', async () => {
    await page.evaluate(() => {
      const w = window
      const s = Object.keys(localStorage).find(k => k.includes('professor-ui'))
      if (s) { const v = JSON.parse(localStorage.getItem(s)); v.state.activeModule = 'settings'; localStorage.setItem(s, JSON.stringify(v)) }
      w.location.reload()
    })
    await page.waitForTimeout(3200)
  })
  for (const sec of ['Appearance', 'Accounts & companies', 'Habits']) {
    await visit(`Settings · ${sec}`, async () => {
      await page.getByRole('button', { name: sec, exact: true }).first().click({ timeout: 4000 })
    })
  }

  // One row per distinct colour pair across the whole theme.
  const uniq = new Map()
  for (const f of found) {
    const k = `${f.fg}|${f.bg}|${f.size}`
    if (!uniq.has(k)) uniq.set(k, f)
  }
  const rows = [...uniq.values()].sort((a, b) => a.ratio - b.ratio)
  console.log(`\n━━ ${theme} — ${rows.length} failing pair${rows.length === 1 ? '' : 's'}`)
  for (const f of rows.slice(0, 14)) {
    console.log(`   ${String(f.ratio).padStart(5)} (need ${f.need})  ${f.fg.padEnd(18)} on ${f.bg.padEnd(18)} ${String(f.size).padStart(5)}px  ${f.screen} · ${JSON.stringify(f.text)}`)
  }
  await page.context().close()
}
await br.close()
