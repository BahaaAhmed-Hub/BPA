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
import { PDF as LIB_PDF } from './pdf-fixture.mjs'
const LIB_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
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
// What a stranger sees: a page, two calls, and three half hours tomorrow.
const BOOKING_PAGE = {
  handle: 'bahaa', name: 'Bahaa', blurb: 'Half an hour, whenever suits.',
  timezone: 'Africa/Cairo',
  plans: [
    { slug: 'intro', title: 'Intro call', blurb: 'A first conversation.', duration_minutes: 30, location_mode: 'meet', requires_approval: false },
    { slug: 'demo', title: 'Teradix demo', blurb: null, duration_minutes: 45, location_mode: 'place', requires_approval: true },
  ],
}
const BOOKING_SLOTS = (() => {
  const d = new Date(Date.now() + 86400000)
  const date = d.toISOString().slice(0, 10)
  return {
    slots: [9, 10, 11].map(h => `${date}T${String(h).padStart(2, '0')}:00:00.000Z`),
    from: new Date().toISOString().slice(0, 10),
    to: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    timezone: 'Africa/Cairo', duration: 30, title: 'Intro call',
    blurb: 'A first conversation.', location_mode: 'meet', requires_approval: false,
  }
})()

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
    // The reader's text layer is transparent by design: pdf.js lays the page's
    // words over the canvas so they can be selected and read aloud, and what is
    // SEEN is the PDF's own picture of them underneath — the document's ink, not
    // the app's. It cannot be aria-hidden (that would take the words from a
    // screen reader), so it is named here instead.
    if (el.closest('.lib-textlayer')) continue

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

// Shopping has a screen, a board and a stores page, all of which draw text on
// tints and on fills — so it is audited like anything else. It is behind a
// switch and reads four tables, which is why it gets rows of its own here.
const SU = 'u1'
const SHOPPING = {
  shopping_groups: [
    { id: 'sg1', user_id: SU, name: 'Weekly groceries', color: '#F5D14E', icon: '\u{1F966}', scheduled_date: '2026-09-19', recurrence: 'weekly', recurrence_rule: null, next_run_at: null, status: 'active', sort_order: 0, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
    { id: 'sg2', user_id: SU, name: 'Pharmacy run', color: '#F5D14E', icon: '\u{1F48A}', scheduled_date: null, recurrence: 'none', recurrence_rule: null, next_run_at: null, status: 'active', sort_order: 1, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
  ],
  shopping_stores: [
    { id: 'ss1', user_id: SU, name: 'Carrefour', url: 'https://carrefouregypt.com', country: 'EG', categories: ['Groceries'], last_scraped_at: null, last_scrape_ok: null, sort_order: 0, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
    { id: 'ss2', user_id: SU, name: 'El Ezaby', url: 'https://elezabypharmacy.com', country: 'EG', categories: ['Pharmacy'], last_scraped_at: null, last_scrape_ok: false, sort_order: 1, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
  ],
  shopping_items: [
    { id: 'si1', user_id: SU, group_id: 'sg1', name: 'Olive oil', category: 'Groceries', quantity: 1, unit: 'L', priority: 2, status: 'wanted', target_price_max: 450, currency: 'EGP', budget_envelope_id: null, calendar_event_id: null, task_id: null, notes: null, purchased_at: null, final_price: null, store_used_id: null, store_ids: ['ss1'], sort_order: 0, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
    { id: 'si2', user_id: SU, group_id: 'sg2', name: 'Vitamin D', category: 'Pharmacy', quantity: 1, unit: null, priority: 1, status: 'wanted', target_price_max: null, currency: 'EGP', budget_envelope_id: null, calendar_event_id: null, task_id: null, notes: null, purchased_at: null, final_price: null, store_used_id: null, store_ids: [], sort_order: 0, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
    { id: 'si3', user_id: SU, group_id: null, name: 'Light bulbs', category: 'Home & Kitchen', quantity: 4, unit: null, priority: 0, status: 'purchased', target_price_max: null, currency: 'EGP', budget_envelope_id: null, calendar_event_id: null, task_id: null, notes: 'warm white', purchased_at: '2026-09-10T09:00:00Z', final_price: 320, store_used_id: 'ss1', store_ids: [], sort_order: 0, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
  ],
  shopping_price_snapshots: [
    { id: 'sp1', item_id: 'si1', store_id: 'ss1', price: 410, currency: 'EGP', product_url: null, available: true, scraped_at: '2026-09-17T09:00:00Z' },
  ],
}

// ─── The admin panel's tables ────────────────────────────────────────────────
// Its own screens, because a module added without an audit is how Shopping
// shipped ten failing pairs. `users` is deliberately NOT served wholesale —
// the app reads that table for the profile too, and answering both with this
// fixture would change every other screen in the run.
const AME = 'u1'
const A_MODULES = [
  { id: 'morning', label: 'Today', core: true, sort_order: 10 },
  { id: 'calendar', label: 'Calendar', core: false, sort_order: 20 },
  { id: 'inbox', label: 'Mail', core: false, sort_order: 30 },
  { id: 'tasks', label: 'Tasks', core: false, sort_order: 40 },
  { id: 'habits', label: 'Habits', core: false, sort_order: 50 },
  { id: 'finance', label: 'Finance', core: false, sort_order: 60 },
  { id: 'dashboard', label: 'Dashboard', core: true, sort_order: 70 },
]
const A_USERS = [
  { id: AME, email: ME, full_name: 'Bahaa Ahmed', created_at: '2026-01-05T00:00:00Z' },
  { id: 'u2', email: 'omar@teradix.com', full_name: 'Omar Said', created_at: '2026-03-11T00:00:00Z' },
  { id: 'u3', email: 'lina@dx.com', full_name: null, created_at: '2026-06-02T00:00:00Z' },
]
const ADMIN_T = {
  admins: [{ user_id: AME }],
  modules: A_MODULES,
  subscriptions: [
    { user_id: AME, plan: 'pro', status: 'active' },
    { user_id: 'u2', plan: 'free', status: 'active' },
    { user_id: 'u3', plan: 'pro', status: 'canceled' },
  ],
  plan_modules: [
    ...['morning', 'dashboard', 'calendar', 'tasks', 'habits'].map(m => ({ plan: 'free', module_id: m })),
    ...A_MODULES.map(m => ({ plan: 'pro', module_id: m.id })),
  ],
  user_modules: [
    { user_id: 'u2', module_id: 'finance', enabled: true, note: 'beta tester', set_at: '2026-09-01T10:00:00Z', set_by: AME },
    { user_id: 'u3', module_id: 'inbox', enabled: false, note: 'abuse — mail sending', set_at: '2026-09-18T08:00:00Z', set_by: AME },
  ],
}

// The Library: books across every status, with and without a cover, one of them
// carrying a long title — a spine's label is drawn on a colour nobody chose
// from the theme, so each of those colours has to be measured.
const LIB_BOOK = (i, title, authors, status, extra = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`, user_id: SU, title, subtitle: null, authors, isbn: null, publisher: null,
  published_year: null, pages: 180 + i * 60, language: null, description: 'A book about ideas worth keeping.', cover_url: null,
  source: 'manual', source_key: null, status, format: 'print', rating: i % 6, review: null, spine_color: null, file_path: null,
  shelf_order: i, started_on: null, finished_on: null, added_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...extra,
})
const LIBRARY = {
  library_books: [
    LIB_BOOK(0, 'Atomic Habits', ['James Clear'], 'reading', { to_buy: true, file_path: 'u1/00000000-0000-4000-8000-000000000000/book.pdf', pages: 3 }),
    LIB_BOOK(1, 'Deep Work', ['Cal Newport'], 'finished'),
    LIB_BOOK(2, 'The Almanack of Naval Ravikant', ['Eric Jorgenson'], 'want'),
    LIB_BOOK(3, 'Sapiens', ['Yuval Noah Harari'], 'paused'),
    LIB_BOOK(4, 'Meditations', ['Marcus Aurelius'], 'finished'),
    LIB_BOOK(5, 'Man\u2019s Search for Meaning', ['Viktor Frankl'], 'want'),
    LIB_BOOK(6, 'Antifragile', ['Nassim Taleb'], 'reading'),
    LIB_BOOK(7, 'Dune', ['Frank Herbert'], 'abandoned'),
  ],
  library_lists: [
    { id: 'l1', user_id: SU, name: 'Philosophy', kind: 'category', description: null, thumb_url: null, color: 'var(--sb-cat-5)', sort_order: 0, created_at: '2026-09-01T00:00:00Z' },
    { id: 'l2', user_id: SU, name: 'Summer reading', kind: 'list', description: 'Easy ones for the beach.', thumb_url: null, color: null, sort_order: 1, created_at: '2026-09-01T00:00:00Z' },
  ],
  // Quotes, a note on one, a page note and a bookmark, so the panel's second half
  // is measured with something in it rather than as an empty form.
  library_quotes: [
    { id: 'q1', user_id: SU, book_id: '00000000-0000-4000-8000-000000000000', kind: 'text', body: 'We are what we repeatedly do.', image_path: null, page: 12, line: 4, color: 'var(--sb-cat-3)', created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' },
    { id: 'q2', user_id: SU, book_id: '00000000-0000-4000-8000-000000000000', kind: 'text', body: 'Habits are the compound interest of self-improvement.', image_path: null, page: null, line: null, color: null, explanation: JSON.stringify({ meaning: 'Small gains repeat, and what repeats grows.', apply: ['Pick one tiny habit and do it daily', 'Track it for a week'] }), created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' },
    { id: 'q3', user_id: SU, book_id: '00000000-0000-4000-8000-000000000000', kind: 'image', body: null, image_path: 'u1/00000000-0000-4000-8000-000000000000/quotes/x.png', page: 40, line: null, color: null, created_at: '2026-09-03T00:00:00Z', updated_at: '2026-09-03T00:00:00Z' },
  ],
  // One quote already in review and overdue (so "1 due · 1 new"), one never asked.
  library_quote_reviews: [
    { quote_id: 'q2', user_id: SU, due_on: '2026-09-30', interval_days: 3, ease: 2.5, reps: 2, lapses: 0, first_on: '2026-09-20', last_on: '2026-09-27' },
  ],
  // A quote made from a photo with no words typed yet: its own row, its own ink.
  library_notes: [
    { id: 'n1', user_id: SU, scope: 'quote', book_id: null, quote_id: 'q1', list_id: null, page: null, line: null, body: 'Aristotle, really.', created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' },
    { id: 'n2', user_id: SU, scope: 'page', book_id: '00000000-0000-4000-8000-000000000000', quote_id: null, list_id: null, page: 30, line: null, body: 'Revisit this chapter.', created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' },
  ],
  library_bookmarks: [
    { id: 'b1', user_id: SU, kind: 'quote', book_id: '00000000-0000-4000-8000-000000000000', quote_id: 'q1', page: null, line: null, label: null, created_at: '2026-09-02T00:00:00Z' },
  ],
  library_follows: [
    { id: 'f1', user_id: SU, kind: 'author', name: 'Cal Newport', query: 'author_key:OL123A', author_key: 'OL123A', seen_keys: ['/works/OL1W'], created_at: '2026-09-01T00:00:00Z' },
    { id: 'f2', user_id: SU, kind: 'series', name: 'The Expanse', query: 'title:"The Expanse"', author_key: null, seen_keys: ['/works/OL1W', '/works/OL2W'], created_at: '2026-09-02T00:00:00Z' },
  ],
  // Sessions on the first book (3 pages long in the fixture's PDF, 300 in the row), so the
  // progress bar, the totals and the recent list are on screen when the panel is.
  library_sessions: [
    { id: 's1', user_id: SU, book_id: '00000000-0000-4000-8000-000000000000', kind: 'read', on_date: '2026-10-10', minutes: 40, pages: 60, to_page: 60, created_at: '2026-10-10T20:00:00Z' },
    { id: 's2', user_id: SU, book_id: '00000000-0000-4000-8000-000000000000', kind: 'listen', on_date: '2026-10-11', minutes: 25, pages: null, to_page: null, created_at: '2026-10-11T08:00:00Z' },
  ],
  // Plans: one live (a state in the accent-deep ink) and one past its date (the negative ink), so
  // both state colours are measured on the panel and in the Tracker's list. The first also carries a (stale)
  // calendar block, so the 4d line and its Update button are on screen.
  library_plans: [
    { id: 'pl1', user_id: SU, book_id: '00000000-0000-4000-8000-000000000000', finish_by: '2026-10-20', minutes: 30, per: 'day', created_at: '2026-10-09T00:00:00Z', block_at: '20:00', block_event_id: 'ev-fixture', block_sig: 'stale' },
    { id: 'pl2', user_id: SU, book_id: '00000000-0000-4000-8000-000000000001', finish_by: '2026-10-01', minutes: null, per: 'day', created_at: '2026-09-20T00:00:00Z' },
  ],
  // Goals for the current year: a whole-library one that is behind (the accent-deep state ink), a
  // challenge on a list, and a time goal — so the card's three shapes and its add form are measured.
  library_goals: [
    { id: 'gl1', user_id: SU, year: new Date().getFullYear(), kind: 'books', target: 24, list_id: null, created_at: '2026-01-02T00:00:00Z' },
    { id: 'gl2', user_id: SU, year: new Date().getFullYear(), kind: 'books', target: 5, list_id: 'l2', created_at: '2026-01-03T00:00:00Z' },
    { id: 'gl3', user_id: SU, year: new Date().getFullYear(), kind: 'minutes', target: 6000, list_id: null, created_at: '2026-01-04T00:00:00Z' },
  ],
  library_list_books: [0, 1, 2].map(i => ({ list_id: 'l2', book_id: `00000000-0000-4000-8000-00000000000${i}`, user_id: SU, sort_order: 0, added_at: '2026-09-01T00:00:00Z' })),
}

const THEMES = process.env.INK_THEME ? [process.env.INK_THEME]
  : ['sunlit-bento', 'warm-minimal', 'glass-depth', 'evergreen']
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })

for (const theme of THEMES) {
  const page = await (await br.newContext({ viewport: { width: 1500, height: 1050 }, timezoneId: 'Africa/Cairo', locale: 'en-GB' })).newPage()
  await page.route('**://placeholder.supabase.co/**', r => {
    const u = r.request().url()
    if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user })
    if (u.includes('/auth/v1/token')) return r.fulfill({ json: session })
    // The stranger's booking page talks only to this function, so it is the
    // whole of what has to be stood up to measure that page's ink.
    if (u.includes('/functions/v1/book-me')) {
      const action = new URL(u).searchParams.get('action')
      if (action === 'profile') return r.fulfill({ json: BOOKING_PAGE })
      if (action === 'slots') return r.fulfill({ json: BOOKING_SLOTS })
      return r.fulfill({ json: {} })
    }
    // The reader downloads the book's file through Storage.
    if (u.includes('/storage/v1/object/library/')) return u.endsWith('.png') ? r.fulfill({ status: 200, contentType: 'image/png', body: LIB_PNG }) : r.fulfill({ status: 200, contentType: 'application/pdf', body: LIB_PDF })
    const t = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
    const GET = r.request().method() === 'GET'
    if (t && SHOPPING[t] && GET) return r.fulfill({ json: SHOPPING[t] })
    if (t && LIBRARY[t] && GET) return r.fulfill({ json: LIBRARY[t] })
    if (t === 'rpc' || u.includes('/rpc/has_module')) {
      const b = (() => { try { return r.request().postDataJSON() } catch { return {} } })()
      const m = A_MODULES.find(x => x.id === b.mod)
      if (!m) return r.fulfill({ json: false })
      if (m.core) return r.fulfill({ json: true })
      const o = ADMIN_T.user_modules.find(x => x.user_id === b.uid && x.module_id === b.mod)
      if (o) return r.fulfill({ json: o.enabled })
      const sub = ADMIN_T.subscriptions.find(x => x.user_id === b.uid)
      const plan = sub && ['active', 'trialing'].includes(sub.status) ? sub.plan : 'free'
      return r.fulfill({ json: ADMIN_T.plan_modules.some(x => x.plan === plan && x.module_id === b.mod) })
    }
    // Only the admin panel's own shape of the users query — the profile read
    // asks for different columns and must keep getting nothing.
    if (t === 'users' && GET && u.includes('created_at')) return r.fulfill({ json: A_USERS })
    if (t && t !== 'users' && ADMIN_T[t] && GET) return r.fulfill({ json: ADMIN_T[t] })
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
  // Discover: the two catalogues (a later route wins over the blanket
  // googleapis one above) — one book on the shelf already, one not, and an author.
  // Claude, for the shelf-photo dialog only: it answers a spine-reading request with a row of each kind
  // (clear, small print, unsure, already on the shelf, a new category) and everything else with nothing.
  await page.route('https://api.anthropic.com/**', async r => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
    const spine = /read book spines/.test(r.request().postData() ?? '')
    const text = spine ? JSON.stringify({ unreadable: 2, books: [
      { title: 'Meditations', author: 'Marcus Aurelius', sureness: 'high', category: 'Philosophy' },
      { title: 'The Odyssey', author: null, sureness: 'medium', category: 'Epic Poetry' },
      { title: 'Blurry Title', author: null, sureness: 'low', category: null },
      { title: 'Atomic Habits', author: 'James Clear', sureness: 'high', category: 'Self-help' },
    ] }) : '{}'
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }) })
  })
  await page.route('https://www.googleapis.com/books/**', r => r.fulfill({ json: { items: [
    { id: 'g9', volumeInfo: { title: 'Digital Minimalism', authors: ['Cal Newport'], publishedDate: '2019-02-05' } }] }, headers: { 'access-control-allow-origin': '*' } }))
  await page.route('https://openlibrary.org/**', r => {
    const cors = { 'access-control-allow-origin': '*' }
    if (r.request().url().includes('/search/authors.json')) return r.fulfill({ headers: cors, json: { docs: [{ key: 'OL123A', name: 'Cal Newport', top_work: 'Deep Work', work_count: 12, birth_date: '1982' }] } })
    return r.fulfill({ headers: cors, json: { docs: [
      { key: '/works/OL1W', title: 'Atomic Habits', author_name: ['James Clear'], first_publish_year: 2018 },
      { key: '/works/OL2W', title: 'Deep Work', author_name: ['Cal Newport'], first_publish_year: 2016 }] } })
  })
  await page.addInitScript(([s, cs, th]) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('google_provider_token', 'tok')
    localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
    localStorage.setItem('cal-intel-cals-cache', JSON.stringify(cs))
    localStorage.setItem('cal-view', 'week')
    localStorage.setItem('professor-ui', JSON.stringify({ state: { themeId: th }, version: 0 }))
    // The Shopping screen is behind a switch, and so is its tab in Finance.
    localStorage.setItem('shopping-settings', JSON.stringify({
      enabled: true, viewMode: 'byWeek', priceWatchFrequency: 'off',
      markCalendarDoneOnPurchase: false, markTaskDoneOnPurchase: false,
    }))
    localStorage.setItem('shopping-layout', 'list')
  }, [session, cals, theme])

  await page.goto(`http://localhost:${process.argv[2]}/BPA/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3400)
  await page.getByText('Skip for now').first().click().catch(() => {})
  await page.waitForTimeout(700)

  const found = []
  const seen = []
  // `floor` is the number of elements below which a screen is called blind. 40
  // suits the app's own screens, every one of which is dense; a deliberately
  // lean page — the stranger's booking page is 32 elements and all of them
  // real — says its own floor rather than being reported as never opened.
  const visit = async (label, go, floor = 40) => {
    let opened = true
    try { await go() } catch (e) { opened = false; seen.push({ label, pairs: 0, why: String(e).split('\n')[0].slice(0, 70) }) }
    if (!opened) return
    await page.waitForTimeout(1500)
    const rows = await page.evaluate(AUDIT)
    // `AUDIT` returns only the FAILING pairs, so it cannot say whether a screen
    // was measured at all. Count the text it actually looked at as well: a
    // screen that never opened reports 0 failures over 0 nodes, which reads
    // identically to a clean one and is how a whole module can slip the gate.
    const measured = await page.evaluate(() => document.querySelectorAll('body *').length)
    seen.push({ label, pairs: rows.length, nodes: measured, floor })
    for (const f of rows) found.push({ ...f, screen: label })
  }

  await visit('Today', async () => { await page.locator('header nav button', { hasText: /^Today$/ }).first().click() })
  await visit('Calendar + event panel', async () => {
    await page.locator('header nav button', { hasText: /^Calendar$/ }).first().click()
    await page.waitForTimeout(1600)
    await page.locator('.event-card').first().click()
  })
  // Booking: the owner's panel, and the same week with the open-hours bands on
  // it. The public page is a different document entirely — it renders above
  // the sign-in gate, with no session — so it is audited by its own file
  // rather than from in here.
  await visit('Calendar · booking panel', async () => {
    await page.locator('header nav button', { hasText: /^Calendar$/ }).first().click()
    await page.waitForTimeout(1400)
    await page.getByRole('button', { name: /^Booking$/ }).click()
    await page.waitForTimeout(900)
  })
  await visit('Calendar · marking open hours', async () => {
    const mark = page.getByRole('button', { name: /Mark hours on the week/i })
    if (await mark.count()) { await mark.click(); await page.waitForTimeout(800) }
  })
  await visit('Mail', async () => { await page.locator('header nav button', { hasText: /^Mail$/ }).first().click() })
  await visit('Tasks', async () => { await page.locator('header nav button', { hasText: /^Tasks$/ }).first().click() })
  await visit('Habits', async () => { await page.locator('header nav button', { hasText: /^Habits$/ }).first().click() })
  await visit('Finance', async () => { await page.locator('header nav button', { hasText: /^Finance$/ }).first().click() })
  // Shopping: the list with an item open (every field of the editor), the board
  // (cards on a column ground), and the stores page with one opened.
  const shoppingTab = async () => {
    await page.locator('header nav button', { hasText: /^Finance$/ }).first().click()
    await page.waitForTimeout(1200)
    await page.locator('button', { hasText: /^Shopping$/ }).first().click()
    await page.waitForTimeout(1400)
  }
  await visit('Shopping · list + item editor', async () => {
    await shoppingTab()
    await page.evaluate(() => {
      const n = [...document.querySelectorAll('span')].find(x => x.textContent.trim() === 'Olive oil')
      n?.closest('div[style*="cursor: pointer"]')?.click()
    })
  })
  await visit('Shopping · board', async () => {
    await page.locator('button', { hasText: /^Board$/ }).first().click()
  })
  await visit('Shopping · stores', async () => {
    await page.locator('button', { hasText: /^Stores$/ }).first().click()
    await page.waitForTimeout(900)
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('div')].find(x => x.textContent.trim() === 'Carrefour')
      d?.parentElement?.click()
    })
  })

  // Library: spines on a shelf, covers face-out, lists, a book open beside the
  // shelf, and the add dialog with a lookup typed into it.
  const libraryTab = async () => {
    await page.locator('header nav button', { hasText: /^Library$/ }).first().click()
    await page.waitForTimeout(1200)
  }
  await visit('Library · shelf', libraryTab)
  await visit('Library · covers', async () => {
    await libraryTab()
    await page.getByRole('tab', { name: 'Covers' }).click()
  })
  await visit('Library · lists', async () => {
    await libraryTab()
    await page.getByRole('tab', { name: 'Lists' }).click()
  })
  // The quote board: a wall of cards, one poster, and the explain view with a
  // stored explanation on q2 (the AI label and the "try this" list).
  for (const [label, mode] of [['cards', 'Cards'], ['poster', 'Poster'], ['explain', 'Explain']]) {
    await visit(`Library · quote board · ${label}`, async () => {
      await libraryTab()
      await page.getByRole('tab', { name: 'Quotes' }).click()
      await page.waitForTimeout(500)
      await page.getByRole('tab', { name: mode }).click()
      await page.waitForTimeout(500)
    })
  }
  // Reviewing quotes: the idle screen (counts, the start button), a card with its words hidden, and the same
  // card revealed with the four answers and the intervals they promise.
  await visit('Library · quote review · waiting', async () => {
    await libraryTab()
    await page.getByRole('tab', { name: 'Quotes' }).click()
    await page.waitForTimeout(500)
    await page.getByRole('tab', { name: /^Review/ }).click()
    await page.waitForTimeout(600)
  })
  await visit('Library · quote review · a card', async () => {
    await page.getByRole('button', { name: /^Start/ }).click()
    await page.waitForTimeout(500)
  })
  await visit('Library · quote review · answered', async () => {
    await page.keyboard.press('Space')
    await page.waitForTimeout(500)
  })
  await page.getByRole('tab', { name: 'Cards' }).click()
  await page.waitForTimeout(300)
  // The export dialog over the board: format switch, options, the monospace
  // preview on --sb-field, and the disabled Copy beside the live Download.
  await visit('Library · export', async () => {
    await libraryTab()
    await page.getByRole('tab', { name: 'Quotes' }).click()
    await page.waitForTimeout(400)
    await page.getByRole('tab', { name: 'Cards' }).click()
    await page.getByRole('button', { name: /Export/ }).click()
    await page.waitForTimeout(400)
    await page.getByRole('tab', { name: 'Obsidian' }).click()
    await page.waitForTimeout(300)
  })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await visit('Library · discover', async () => {
    await libraryTab()
    await page.getByRole('tab', { name: 'Discover' }).click()
    await page.getByRole('tab', { name: 'Books' }).click()
    await page.getByLabel('Search online').fill('newport')
    await page.waitForTimeout(1500)
  })
  await visit('Library · discover authors', async () => {
    await libraryTab()
    await page.getByRole('tab', { name: 'Discover' }).click()
    await page.getByRole('tab', { name: 'Authors' }).click()
    await page.getByLabel('Search online').fill('newport')
    await page.waitForTimeout(1500)
  })
  // The scanner dialog. Headless Chromium has no camera, so what is measured is
  // the "camera unavailable" notice, a typed ISBN's result card, and the form.
  await visit('Library · scan an ISBN', async () => {
    await libraryTab()
    await page.getByRole('tab', { name: 'Discover' }).click()
    await page.getByRole('button', { name: /Scan ISBN/ }).click()
    await page.getByLabel('Or type the ISBN').fill('9781612680194')
    await page.getByRole('button', { name: 'Look up' }).click()
    await page.waitForTimeout(1500)
  })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  // Following: a followed author with a new release (the stub's search returns two
  // books, one of them unseen) and a series, so the badge, the cards and the form
  // are all on screen.
  await visit('Library · following', async () => {
    await libraryTab()
    await page.getByRole('tab', { name: 'Discover' }).click()
    await page.getByRole('tab', { name: 'Following' }).click()
    await page.getByRole('button', { name: /Follow a series/ }).click()
    await page.waitForTimeout(1800)
  })
  await visit('Library · tracker', async () => {
    await libraryTab()
    await page.getByRole('tab', { name: 'Tracker' }).click()
    await page.waitForTimeout(800)
  })
  await visit('Library · a book open', async () => {
    await libraryTab()
    await page.getByRole('tab', { name: 'Shelf' }).click()
    await page.getByRole('button', { name: /Atomic Habits by/ }).click()
    await page.waitForTimeout(900)
  })
  await visit('Library · add a book', async () => {
    await libraryTab()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Add book/ }).first().click()
    await page.waitForTimeout(300)
  })
  // The reader: toolbar, a page drawn from a real PDF, and its bookmarks menu
  // open over it with a page bookmark and a quote in it.
  await page.keyboard.press('Escape')   // the add dialog above is still open
  await page.waitForTimeout(300)
  await visit('Library · the reader', async () => {
    await libraryTab()
    await page.getByRole('button', { name: /Atomic Habits by/ }).click()
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: /Open and read/ }).click()
    await page.waitForTimeout(2200)
    await page.getByRole('button', { name: 'Bookmarks and quotes' }).click()
    await page.waitForTimeout(300)
  })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  // A photographed page: the dialog with no AI key saved (the warning ink on the
  // overlay), over the panel that carries a photo-only quote.
  await visit('Library · quote from a photo', async () => {
    await page.getByLabel('Choose a photo of a page').setInputFiles({ name: 'page.png', mimeType: 'image/png', buffer: LIB_PNG })
    await page.waitForTimeout(1500)
  })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  // The dialog is a scrim over the whole page; the next screen's nav click
  // would land on it.
  await page.keyboard.press('Escape')

  // A photographed shelf: every row kind — clear, small print, unsure, a book already on the shelf, an
  // existing category and a new one — plus the toolbar and the "makes N new categories" line.
  await visit('Library · books from a shelf photo', async () => {
    await page.evaluate(() => localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-audit' })))
    await page.getByLabel('Choose a photo of a shelf').setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: LIB_PNG })
    await page.waitForTimeout(2500)
  })
  await page.keyboard.press('Escape')
  await page.evaluate(() => localStorage.removeItem('professor-ai-config'))
  await page.waitForTimeout(300)

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
    // Settings is the heaviest module in the app and 3.2s is not always enough
    // for its rail; without this the section clicks below aimed at nothing.
    await page.getByRole('button', { name: 'Appearance', exact: true })
      .last().waitFor({ timeout: 10000 })
  })
  for (const sec of ['Appearance', 'Accounts & companies', 'Habits']) {
    await visit(`Settings · ${sec}`, async () => {
      // `.last()`, never `.first()`: the header nav comes first in the DOM and
      // carries some of the same words — `Habits` is in both, so `.first()`
      // clicked the top nav and navigated out of Settings entirely. That
      // screen was measuring the Habits module under a Settings label.
      await page.getByRole('button', { name: sec, exact: true }).last().click({ timeout: 6000 })
      await page.waitForTimeout(400)
    })
  }

  // The admin panel — four faces, all of them new text on new grounds.
  // Through the avatar menu, the way a person reaches it. Writing the module
  // into localStorage and reloading does NOT work for a module outside the nav
  // — the app came back up on Today, so these four screens were auditing the
  // morning page under an Admin label. Clicking is also the only version that
  // proves the menu row exists at all.
  const goAdmin = async () => {
    await page.locator('header button', { hasText: /^(BA|A)$/ }).last().click({ timeout: 4000 })
    await page.waitForTimeout(400)
    await page.locator('button[role="menuitem"]', { hasText: 'Admin' }).first().click({ timeout: 4000 })
    await page.waitForTimeout(1400)
    const onIt = await page.evaluate(() => /Plans & modules/.test(document.body.innerText))
    if (!onIt) throw new Error('the Admin panel did not open')
  }
  await visit('Admin · users', goAdmin)
  await visit('Admin · one account open', async () => {
    await page.locator('button', { hasText: 'omar@teradix.com' }).first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(1200)
  })
  await visit('Admin · plans', async () => {
    await page.locator('button', { hasText: /^Plans$/ }).first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(700)
  })
  await visit('Admin · audit', async () => {
    await page.locator('button', { hasText: /^Audit/ }).first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(700)
  })

  // ── The page a stranger sees ───────────────────────────────────────────────
  // Its own document: `?book=` renders above the sign-in gate, so this is a
  // navigation rather than a click. It is measured last, because it leaves the
  // app behind — there is nothing to click afterwards.
  await visit('Booking · the public page', async () => {
    await page.goto(`http://localhost:${process.argv[2]}/BPA/?book=bahaa`, { waitUntil: 'domcontentloaded' })
    // Wait for what the page is *for*, not for a guess at how long it takes:
    // the first measurement landed on an empty document and said so.
    await page.getByRole('button', { name: /Intro call/ }).first().waitFor({ timeout: 15000 })
    await page.waitForTimeout(500)
  }, 20)
  await visit('Booking · picking a time', async () => {
    await page.getByRole('button', { name: /Intro call/ }).first().click({ timeout: 5000 })
    await page.waitForTimeout(1400)
    const t = page.locator('button[aria-pressed]').filter({ hasText: /:/ }).first()
    if (await t.count()) { await t.click(); await page.waitForTimeout(700) }
  })


  // One row per distinct colour pair across the whole theme.
  const uniq = new Map()
  for (const f of found) {
    const k = `${f.fg}|${f.bg}|${f.size}`
    if (!uniq.has(k)) uniq.set(k, f)
  }
  const rows = [...uniq.values()].sort((a, b) => a.ratio - b.ratio)
  const blind = seen.filter(v => v.why || (v.nodes ?? 0) < (v.floor ?? 40))
  console.log(`\n━━ ${theme} — ${rows.length} failing pair${rows.length === 1 ? '' : 's'} over ${seen.length} screens`)
  if (blind.length) {
    console.log(`   ⚠ ${blind.length} screen(s) measured nothing — a clean result over nothing is not a clean result:`)
    for (const v of blind) console.log(`     ${v.label}${v.why ? ` — ${v.why}` : ` — opened but only ${v.nodes ?? 0} elements on it`}`)
  }
  for (const f of rows.slice(0, 14)) {
    console.log(`   ${String(f.ratio).padStart(5)} (need ${f.need})  ${f.fg.padEnd(18)} on ${f.bg.padEnd(18)} ${String(f.size).padStart(5)}px  ${f.screen} · ${JSON.stringify(f.text)}`)
  }
  await page.context().close()
}
await br.close()
