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

// The outcome window files money and habits, and the audit serves neither for
// any other screen — so the rest of the audit is unchanged by this. It is turned
// on inside that one visit (`outcomeFixture`), because the stores load at boot
// and a screen that has no account to file against is a screen that never
// draws a draft.
let outcomeFixture = false

// Projects: a card in every state it has — overdue and late, personal and
// work, idea / paused / done — and the tasks that give two of them progress.
// Served only inside the Projects visits (`projectsFixture`) and torn out again
// after, because the task store keeps what it was given when the server is
// later empty, and the screens after this one should not inherit a project.
let projectsFixture = false
const PROJECTS = (() => {
  const now = new Date().toISOString()
  const day = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA')
  const P = (id, name, o) => ({ id, user_id: session.user.id, name, kind: 'work', color: '#2F63A8', status: 'active',
    company_id: null, start_date: null, target_date: null, notes: null, archived: false, created_at: now, updated_at: now, ...o })
  const T = (n, title, o) => ({ id: `11111111-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, user_id: session.user.id,
    company_id: null, title, description: null, quadrant: 'schedule', effort_minutes: null, due_date: null, status: 'todo',
    delegated_to: null, done_looks_like: null, created_at: now, completed_at: null, planned_time: null, owner_id: null,
    company_tag: null, completed: false, task_type: null, priority: null, board_status: null, calendar_id: null,
    gcal_event_id: null, parent_task_id: null, captured_via: null, urgent: false, checklist: [], attachments: [], links: [],
    project_id: null, milestone_id: null, ...o })
  const a = 'aaaaaaaa-0000-4000-8000-0000000001', id = n => a + String(n).padStart(2, '0')
  return {
    projects: [
      P(id(1), 'Launch the new website', { start_date: day(-40), target_date: day(-6), color: '#2F63A8' }),
      P(id(2), 'Kitchen renovation', { kind: 'personal', status: 'paused', color: '#1D8A6A', target_date: day(40), budget_amount: 1000, budget_currency: 'EGP' }),   // under what its entry cost: the over state
      P(id(3), 'Learn calligraphy', { kind: 'personal', status: 'idea', color: '#B03A73' }),
      P(id(4), 'Annual report', { status: 'done', color: '#C2622B', target_date: day(-30) }),
      // Named for the audit's own mail ("Message number 1"…), so Mail offers it.
      P(id(5), 'Message number', { status: 'idea', color: '#7B84E8' }),
    ],
    project_milestones: [
      { id: 'bbbbbbbb-0000-4000-8000-000000000101', project_id: id(1), user_id: session.user.id, title: 'Beta goes live', due_date: day(9), done: false, sort_order: 1 },
      { id: 'bbbbbbbb-0000-4000-8000-000000000102', project_id: id(1), user_id: session.user.id, title: 'Design review', due_date: day(-4), done: true, sort_order: 0 },
      { id: 'bbbbbbbb-0000-4000-8000-000000000103', project_id: id(1), user_id: session.user.id, title: 'Content freeze', due_date: day(0), done: false, sort_order: 2 },
      { id: 'bbbbbbbb-0000-4000-8000-000000000104', project_id: id(1), user_id: session.user.id, title: 'Public launch', due_date: day(30), done: false, sort_order: 3 },
      { id: 'bbbbbbbb-0000-4000-8000-000000000105', project_id: id(1), user_id: session.user.id, title: 'Press kit', due_date: null, done: false, sort_order: 4 },
    ],
    tasks: [
      T(1, 'Design signed off', { project_id: id(1), completed: true, status: 'done', completed_at: now }),
      T(2, 'Write the copy', { project_id: id(1), due_date: day(-2) }),
      T(3, 'Ship it', { project_id: id(1), due_date: day(5) }),
      T(4, 'Pick the tiles', { project_id: id(2) }),
      // A task whose time block is on the calendar — the "Task block" row.
      T(5, 'Prepare the review', { project_id: id(1), gcal_event_id: 'evt-block', due_date: day(0), planned_time: '11:00', effort_minutes: 45 }),
    ],
    // The audit's own calendar event (e1) linked to the project, and two more that
    // are only known by their snapshot — upcoming and earlier.
    // Habits the personal project serves, with a week of logs: five days ticked, and
    // a part-day of a measured one.
    habits: [
      { id: 'hh000001', user_id: session.user.id, name: 'Write 30 min', emoji: '✍️', color: '#7F77DD', frequency: 'daily', is_active: true, created_at: now, type: 'boolean' },
      { id: 'hh000002', user_id: session.user.id, name: 'Water', emoji: '💧', color: '#60A5FA', frequency: 'daily', is_active: true, created_at: now, type: 'quantity', goal: 8, unit: 'glasses' },
    ],
    habit_logs: [
      ...[0, 1, 2, 3, 4].map(n => ({ habit_id: 'hh000001', user_id: session.user.id, date: day(-n), completed: true })),
      { habit_id: 'hh000002', user_id: session.user.id, date: day(0), completed: false, quantity: 5 },
    ],
    project_links: [
      // The personal project's money (snapshots: Finance is not served here, so an entry
      // of this year reads as gone — which draws that state too), habits and books.
      { id: 'cccccccc-0000-4000-8000-000000000301', project_id: id(2), user_id: session.user.id, kind: 'entry', ref_id: 'tx-a', meta: { payee: 'Tile shop', amount: 1200, currency: 'EGP', date: day(-3), paidAt: day(-3), type: 'expense' }, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000302', project_id: id(2), user_id: session.user.id, kind: 'entry', ref_id: 'tx-b', meta: { payee: 'Cabinet deposit', amount: 500, currency: 'EGP', date: day(-1), type: 'expense' }, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000303', project_id: id(2), user_id: session.user.id, kind: 'entry', ref_id: 'tx-c', meta: { payee: 'Refund', amount: 100, currency: 'EGP', date: day(-2), paidAt: day(-2), type: 'income' }, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000304', project_id: id(2), user_id: session.user.id, kind: 'entry', ref_id: 'tx-d', meta: { payee: 'Dubai fittings', amount: 100, currency: 'AED', date: day(-4), paidAt: day(-4), type: 'expense' }, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000305', project_id: id(2), user_id: session.user.id, kind: 'entry', ref_id: 'tx-old', meta: { payee: 'Old boiler', amount: 300, currency: 'EGP', date: '2023-03-01', paidAt: '2023-03-01', type: 'expense' }, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000311', project_id: id(2), user_id: session.user.id, kind: 'habit', ref_id: 'hh000001', meta: null, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000312', project_id: id(2), user_id: session.user.id, kind: 'habit', ref_id: 'hh000002', meta: null, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000313', project_id: id(2), user_id: session.user.id, kind: 'habit', ref_id: 'hh-gone', meta: null, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000321', project_id: id(2), user_id: session.user.id, kind: 'book', ref_id: '00000000-0000-4000-8000-000000000000', meta: null, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000322', project_id: id(2), user_id: session.user.id, kind: 'book', ref_id: '00000000-0000-4000-8000-000000000001', meta: null, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000323', project_id: id(2), user_id: session.user.id, kind: 'book', ref_id: 'b-gone', meta: null, created_at: now },
      // Two of the audit's own threads: one filed, drawn on its row and listed under Mail.
      { id: 'cccccccc-0000-4000-8000-000000000201', project_id: id(1), user_id: session.user.id, kind: 'thread', ref_id: `${ME}|m3`,
        meta: { subject: 'Message number 3', fromName: 'Person 3', fromEmail: 'p3@teradix.com', at: Date.now() - 3600000, accountEmail: ME }, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000202', project_id: id(1), user_id: session.user.id, kind: 'thread', ref_id: `${ME}|gone`,
        meta: null, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000101', project_id: id(1), user_id: session.user.id, kind: 'event', ref_id: 'e1',
        meta: { title: 'OWI Actions Review', start: new Date(new Date().setHours(13, 0, 0, 0)).toISOString(), end: new Date(new Date().setHours(14, 0, 0, 0)).toISOString(), allDay: false, calendarId: 'primary' }, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000102', project_id: id(1), user_id: session.user.id, kind: 'event', ref_id: 'evt-future',
        meta: { title: 'Launch party', start: day(7) + 'T18:00:00Z', end: day(7) + 'T20:00:00Z', allDay: false }, created_at: now },
      { id: 'cccccccc-0000-4000-8000-000000000103', project_id: id(1), user_id: session.user.id, kind: 'event', ref_id: 'evt-old',
        meta: { title: 'Planning session', start: day(-5) + 'T09:00:00Z', end: day(-5) + 'T10:00:00Z', allDay: false }, created_at: now },
    ],
  }
})()
const OUTCOME = (() => {
  const pad = n => String(n).padStart(2, '0')
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const U = 'u1', T0 = '2026-01-01T00:00:00.000Z'
  const tx = (id, over) => ({ id, user_id: U, account_id: 'oa1', to_account_id: null, category_id: 'oc1', amount: 100, currency: 'EGP',
    tx_type: 'expense', payee: id, date: today, paid_at: today, note: null, is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: T0, ...over })
  return {
    finance_accounts: [{ id: 'oa1', user_id: U, name: 'Cash — Work', bank: '', account_type: 'payment', currency: 'EGP', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0 }],
    finance_categories: [
      { id: 'oc1', user_id: U, name: 'Meals', icon: '🍽', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0 },
      { id: 'oc2', user_id: U, name: 'Transport', icon: '🚕', color: '#1F4E7A', tx_type: 'expense', sort_order: 1, is_system: false, created_at: T0 }],
    finance_transactions: [tx('Lunch — Zomato', { amount: 640, paid_at: null, is_cleared: false }), tx('Old taxi', { category_id: 'oc2', amount: 120 })],
    habits: [
      { id: 'oh1', user_id: U, name: 'Networking', emoji: '🤝', color: '#7F77DD', frequency: 'daily', is_active: true, created_at: T0, type: 'boolean' },
      { id: 'oh2', user_id: U, name: 'Walk', emoji: '🚶', color: '#E0944A', frequency: 'daily', is_active: true, created_at: '2026-01-02T00:00:00.000Z', type: 'quantity', goal: 8000, unit: 'steps' }],
    habit_logs: [{ habit_id: 'oh2', user_id: U, date: today, completed: false, quantity: 5200 }],
  }
})()

// Loans: a lender owed part of what was borrowed, a second lender paid back in full
// (so the "paid back" fold has something in it), and the entries that make them —
// a borrowing, a repayment and a salary beside them. Served for the loans screens
// only (`loansFixture`), for the same reason as the outcome window's.
const LOANS = (() => {
  const pad = n => String(n).padStart(2, '0')
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const U = 'u1', T0 = '2026-01-01T00:00:00.000Z'
  const acc = (id, name, type, cur, extra = {}) => ({ id, user_id: U, name, bank: '', account_type: type, currency: cur, balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0, ...extra })
  const tx = (id, over) => ({ id, user_id: U, account_id: 'la1', to_account_id: null, category_id: 'lc1', amount: 100, currency: 'EGP',
    tx_type: 'expense', payee: id, date: today, paid_at: today, note: null, is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: T0, ...over })
  return {
    finance_accounts: [
      acc('la1', 'CIB', 'payment', 'EGP'),
      acc('la2', 'Ahmed', 'loan', 'EGP', { emoji: '🤝', sort_order: 1 }),
      acc('la3', 'Omar', 'loan', 'EGP', { emoji: '🤝', sort_order: 2 }),
    ],
    finance_categories: [{ id: 'lc1', user_id: U, name: 'Salary', icon: 'lucide:Wallet', color: '#0C8140', tx_type: 'both', sort_order: 0, is_system: false, created_at: T0, parent_id: null }],
    finance_transactions: [
      tx('Salary', { type: 'income', tx_type: 'income', amount: 20000 }),
      tx('Borrowed from Ahmed', { tx_type: 'transfer', account_id: 'la2', to_account_id: 'la1', category_id: null, amount: 10000 }),
      tx('Paid back Ahmed', { tx_type: 'transfer', account_id: 'la1', to_account_id: 'la2', category_id: null, amount: 4000 }),
      tx('Borrowed from Omar', { tx_type: 'transfer', account_id: 'la3', to_account_id: 'la1', category_id: null, amount: 500 }),
      tx('Paid back Omar', { tx_type: 'transfer', account_id: 'la1', to_account_id: 'la3', category_id: null, amount: 500 }),
    ],
  }
})()
let loansFixture = false

const AUDIT = (probe = []) => {
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
  const probed = []
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
    const txt = svg ? `<svg ${el.getAttribute('class') || ''}>`
      : [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 34)
    // A probe is an element the caller named, reported whether it passes or not:
    // the audit only lists failures, so "nothing listed" cannot say that a thing
    // was measured at all. It is what turns a quiet screen into a measured one.
    if (probe.some(p => txt.includes(p))) {
      probed.push({ text: txt, ratio: Math.round(cr * 100) / 100, need, probe: true, ok: cr >= need })
    }
    if (cr >= need) continue

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
  return [...[...seen.values()].sort((a, b) => a.ratio - b.ratio), ...probed]
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
    LIB_BOOK(0, 'Atomic Habits', ['James Clear'], 'reading', { watch_item_id: 'si1', to_buy: true, file_path: 'u1/00000000-0000-4000-8000-000000000000/book.pdf', pages: 3 }),
    LIB_BOOK(1, 'Deep Work', ['Cal Newport'], 'finished', { started_on: '2026-09-02', finished_on: '2026-09-20', paid_amount: 249.5, paid_currency: 'EGP', bought_on: '2026-09-01', bought_at: 'Diwan' }),
    LIB_BOOK(2, 'The Almanack of Naval Ravikant', ['Eric Jorgenson'], 'want'),
    LIB_BOOK(3, 'Sapiens', ['Yuval Noah Harari'], 'paused'),
    LIB_BOOK(4, 'Meditations', ['Marcus Aurelius'], 'finished', { finished_on: '2026-10-01' }),
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
    { id: 'f1', user_id: SU, kind: 'author', name: 'Cal Newport', query: 'author_key:OL123A', author_key: 'OL123A', seen_keys: ['/works/OL1W'], created_at: '2026-09-01T00:00:00Z', last_checked_at: '2026-10-12T05:40:00Z', last_check_ok: true },
    { id: 'f2', user_id: SU, kind: 'series', name: 'The Expanse', query: 'title:"The Expanse"', author_key: null, seen_keys: ['/works/OL1W', '/works/OL2W'], created_at: '2026-09-02T00:00:00Z', last_checked_at: '2026-10-12T05:40:00Z', last_check_ok: false },
  ],
  // What the daily check found overnight: drawn on the Following cards beside the live results.
  library_follow_news: [
    { id: 'n1', user_id: SU, follow_id: 'f1', work_key: '/works/OL9W', title: 'Slow Productivity', authors: ['Cal Newport'], isbn: null, published_year: 2024, cover_url: null, found_at: '2026-10-12T05:41:00Z', read_at: null },
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

const ALL_THEMES = ['sunlit-bento', 'warm-minimal', 'glass-depth', 'evergreen']
// **A theme id nobody has is not a theme to audit.** `INK_THEME` was taken on
// trust and written into `professor-ui`, where an id the app does not know
// falls back to Sunlit — so `INK_THEME=glass-and-depth` (the theme's *name*,
// not its id: it is `glass-depth`) audited Sunlit four screens at a time and
// reported it under a Glass label. Clean, and about the wrong theme. The exact
// vacuous result this file's own note was written about, arrived at from a new
// direction: it is not enough for a screen to be reached, the theme on it has
// to be the one asked for.
// Each theme's own `--sb-page`, as Chrome reports it. Written out rather than
// imported because this script does not run through Vite and cannot read
// `themes.ts`; a value that drifts fails the run loudly, which is the point.
const GROUNDS = {
  'sunlit-bento':  'rgb(247, 244, 234)',
  'warm-minimal':  'rgb(244, 241, 234)',
  'glass-depth':   'rgb(11, 10, 18)',
  'evergreen':     'rgb(245, 247, 246)',
}
const THEMES = process.env.INK_THEME ? [process.env.INK_THEME] : ALL_THEMES
for (const t of THEMES) {
  if (!ALL_THEMES.includes(t)) {
    console.error(`INK_THEME=${t} is not a theme id. One of: ${ALL_THEMES.join(', ')}`)
    process.exit(2)
  }
}
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

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
    if (outcomeFixture && t && OUTCOME[t] && GET) return r.fulfill({ json: OUTCOME[t] })
    if (loansFixture && t && LOANS[t] && GET) return r.fulfill({ json: LOANS[t] })
    if (projectsFixture && t && PROJECTS[t] && GET) return r.fulfill({ json: PROJECTS[t] })
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
    localStorage.setItem('bpa-wizard-done', '1')
    // **Merged, never replaced.** An init script runs before *every*
    // navigation, so writing this whole key again wiped whatever the run had
    // just put in it — and the Settings visit reaches its module by setting
    // `activeModule` and reloading. The reload re-ran this line, the app came
    // back up on the default module, and `Settings`, `Settings · Appearance`
    // and `Settings · Accounts & companies` measured nothing from the day this
    // file was written. The note under the count said that predated the rail
    // work, which was true, and the cause was this line all along.
    const prevUi = (() => {
      try { return JSON.parse(localStorage.getItem('professor-ui') ?? '{}') } catch { return {} }
    })()
    localStorage.setItem('professor-ui', JSON.stringify({
      ...prevUi, state: { ...(prevUi.state ?? {}), themeId: th }, version: 0,
    }))
    // The Shopping screen is behind a switch, and so is its tab in Finance.
    localStorage.setItem('shopping-settings', JSON.stringify({
      enabled: true, viewMode: 'byWeek', priceWatchFrequency: 'off',
      markCalendarDoneOnPurchase: false, markTaskDoneOnPurchase: false,
    }))
    localStorage.setItem('shopping-layout', 'list')
  }, [session, cals, theme])

  // A crash is the commonest way for a screen to measure nothing, and the
  // blindness warning says *that* it did, not *why*.
  page.on('pageerror', e => console.log('   [pageerror]', String(e).slice(0, 220)))
  await page.goto(`http://localhost:${process.argv[2]}/BPA/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3400)
  // Measured, not assumed: a theme that did not apply is a run about another
  // theme's colours. `--sb-page` differs in all four, so it answers this.
  const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  if (!GROUNDS[theme] || ground !== GROUNDS[theme]) {
    console.error(`${theme} did not apply — body is ${ground}, expected ${GROUNDS[theme] ?? '(unknown)'}`)
    process.exit(2)
  }
  await page.getByText('Skip for now').first().click().catch(() => {})
  await page.waitForTimeout(700)

  const found = []
  const seen = []
  // `floor` is the number of elements below which a screen is called blind. 40
  // suits the app's own screens, every one of which is dense; a deliberately
  // lean page — the stranger's booking page is 32 elements and all of them
  // real — says its own floor rather than being reported as never opened.
  const visit = async (label, go, floor = 40, probe = []) => {
    // INK_ONLY=<text>[|<text>…] runs only the screens whose name contains one of them: a screen
    // being worked on does not need the other forty re-measured each time.
    if (process.env.INK_ONLY && !process.env.INK_ONLY.split('|').some(t => label.includes(t))) return
    let opened = true
    try { await go() } catch (e) { opened = false; seen.push({ label, pairs: 0, why: String(e).split('\n')[0].slice(0, 70) }) }
    if (!opened) return
    await page.waitForTimeout(1500)
    const all = await page.evaluate(AUDIT, probe)
    const rows = all.filter(r => !r.probe)
    for (const p of all.filter(r => r.probe)) console.log(`   · probe [${label}] "${p.text}" ${p.ratio} (need ${p.need}) ${p.ok ? 'ok' : 'FAILS'}`)
    // `AUDIT` returns only the FAILING pairs, so it cannot say whether a screen
    // was measured at all. Count the text it actually looked at as well: a
    // screen that never opened reports 0 failures over 0 nodes, which reads
    // identically to a clean one and is how a whole module can slip the gate.
    const measured = await page.evaluate(() => document.querySelectorAll('body *').length)
    seen.push({ label, pairs: rows.length, nodes: measured, floor })
    for (const f of rows) found.push({ ...f, screen: label })
  }

  await visit('Today', async () => { await page.locator('[data-side-rail] button[aria-label="Today"]').click() })
  await visit('Calendar + event panel', async () => {
    await page.locator('[data-side-rail] button[aria-label="Calendar"]').click()
    await page.waitForTimeout(1600)
    await page.locator('.event-card').first().click()
  })
  // (the window above is closed by the next screen's first move)
  // The outcome window, every box open: what comes out of a meeting that is
  // done. It draws on tints (a box's own colour mixed into the card), on fills
  // (Confirm, Mark finished) and on the habit and book rows — so all four boxes
  // are opened before it is measured, or the screen only tests the first.
  await visit('Calendar · what came out of it', async () => {
    outcomeFixture = true
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    await page.locator('[data-side-rail] button[aria-label="Calendar"]').click()
    await page.waitForTimeout(1400)
    await page.locator('.event-card').first().hover()
    await page.waitForTimeout(350)
    const at = await page.evaluate(() => {
      const x = [...document.querySelectorAll('button')].find(e => /Mark done/i.test(e.getAttribute('aria-label') ?? e.title ?? ''))
      if (!x) return null
      const r = x.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    if (!at) throw new Error('no done tick on the first event')
    await page.mouse.move(at.x, at.y); await page.waitForTimeout(120); await page.mouse.down(); await page.mouse.up()
    await page.waitForTimeout(900)
    const dlg = page.locator('[role="dialog"][aria-label^="What came out of"]')
    if (await dlg.count() !== 1) throw new Error('the outcome window did not open')
    for (const id of ['tasks', 'expenses', 'habits', 'books', 'events']) {
      const box = dlg.locator(`[data-outcome-box="${id}"]`)
      if (await box.count() === 0) throw new Error(`the ${id} box is not drawn`)
      if (await box.getAttribute('data-open') !== '1') await box.locator('button[aria-expanded]').first().click()
      await page.waitForTimeout(250)
    }
    // And act on each, so the states that only exist afterwards are measured
    // too: a draft with its Confirm, a habit ticked, a task done and a sitting
    // logged are all drawn on fills the resting boxes never show. Tolerant by
    // design — the fixture has what it has — but each step says what it did.
    const acted = []
    const tryDo = async (what, fn) => { try { await fn(); acted.push(what) } catch (e) { console.log(`   · outcome window could not do "${what}": ${String(e).split('\n')[0].slice(0, 110)}`) } }
    await tryDo('a task is added', async () => {
      await dlg.getByLabel('Add a task from this meeting').fill('Send the proposal')
      await dlg.locator('[data-outcome-box="tasks"]').getByRole('button', { name: 'Add', exact: true }).click({ timeout: 2000 })
    })
    await tryDo('an expense is drafted', async () => {
      const ex = dlg.locator('[data-outcome-box="expenses"]')
      await ex.getByPlaceholder('Amount').fill('85', { timeout: 2000 })
      await ex.getByRole('button', { name: 'Add as draft' }).click({ timeout: 2000 })
    })
    await tryDo('a habit is ticked', async () => {
      await dlg.locator('[data-outcome-box="habits"]').getByRole('checkbox').first().click({ timeout: 2000 })
    })
    await tryDo('a book is quoted', async () => {
      const bk = dlg.locator('[data-outcome-box="books"]')
      await bk.getByLabel(/Save a quote from/).first().fill('A line worth keeping', { timeout: 2000 })
      await bk.getByRole('button', { name: 'Add quote' }).first().click({ timeout: 2000 })
    })
    if (process.env.INK_DEBUG) for (const id of ['tasks','expenses','habits','books','events']) console.log(`   [${id}]`, (await dlg.locator(`[data-outcome-box="${id}"]`).innerText()).replace(/\n+/g,' | ').slice(0,260))
    // The audit's Google answers a write with an empty body, so this lands on
    // the refusal — a state worth measuring in its own right (the error line).
    await tryDo('an event is scheduled (or refused, and said so)', async () => {
      const ev = dlg.locator('[data-outcome-box="events"]')
      await ev.getByRole('button', { name: /^Schedule$/ }).click({ timeout: 2000 })
      await page.waitForTimeout(900)
    })
    console.log(`   · outcome window acted on: ${acted.join(', ') || 'nothing'}`)
    await page.waitForTimeout(400)
  })
  // Booking: the owner's panel, and the same week with the open-hours bands on
  // it. The public page is a different document entirely — it renders above
  // the sign-in gate, with no session — so it is audited by its own file
  // rather than from in here.
  // The two ends of the thread, reached from the window just acted on: the
  // meeting's own card listing what was filed, and a task saying where it came
  // from. Each throws if its thing is not there, so a screen that never drew the
  // element is named blind rather than called clean.
  await visit('Calendar · outcomes on the meeting', async () => {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await page.locator('.event-card').first().click()
    await page.waitForTimeout(1200)
    if (await page.locator('[data-outcomes-card]').count() !== 1) throw new Error('the event panel has no Outcomes card')
  })
  await visit('Tasks · a task made in a meeting', async () => {
    await page.locator('[data-side-rail] button[aria-label="Tasks"]').click()
    await page.waitForTimeout(1500)
    await page.getByText('Send the proposal', { exact: true }).first().click({ timeout: 4000 })
    await page.waitForTimeout(800)
    if (await page.locator('[data-meeting-backlink="task"]').count() !== 1) throw new Error('the task shows no meeting chip')
  })
  // Projects: the grid with a card in every state, the new-project dialog, and
  // an existing one with its delete confirmation open (a danger-ink sentence).
  if (!process.env.INK_ONLY || process.env.INK_ONLY.includes('Projects')) {
    projectsFixture = true
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const projectsTab = async () => {
      await page.locator('[data-side-rail] button[aria-label="Projects"]').click()
      await page.locator('[data-project-card]').first().waitFor({ state: 'visible', timeout: 6000 })
    }
    await visit('Projects · grid', projectsTab)
    await visit('Projects · a project, overview', async () => {
      await page.locator('[data-project-card]').first().click()
      await page.locator('[data-project-overview]').waitFor({ state: 'visible', timeout: 5000 })
    })
    // The lens: Focus pressed on the page, and the rail's chip that is the way out.
    await visit('Projects · lens on, rail chip', async () => {
      await page.locator('[data-project-focus]').click()
      await page.locator('[data-project-lens]').waitFor({ state: 'visible', timeout: 5000 })
    })
    await page.locator('[data-project-lens] button').click()
    await visit('Projects · a project, tasks', async () => {
      await page.getByRole('tab', { name: /^Tasks/ }).click()
      await page.locator('[data-project-tasks]').waitFor({ state: 'visible', timeout: 5000 })
    })
    await visit('Projects · a project, timeline', async () => {
      await page.getByRole('tab', { name: 'Timeline' }).click()
      await page.locator('[data-timeline-axis]').waitFor({ state: 'visible', timeout: 5000 })
    })
    await visit('Projects · a project, calendar', async () => {
      await page.getByRole('tab', { name: /^Calendar/ }).click()
      await page.locator('[data-project-calendar]').waitFor({ state: 'visible', timeout: 5000 })
    })
    await visit('Projects · a project, mail', async () => {
      await page.getByRole('tab', { name: /^Mail/ }).click()
      await page.locator('[data-project-mail]').waitFor({ state: 'visible', timeout: 5000 })
    })
    await visit('Projects · back to the grid', async () => {
      await page.getByRole('button', { name: 'Back to all projects' }).click()
      await page.locator('[data-project-card]').first().waitFor({ state: 'visible', timeout: 5000 })
    })
    // The personal-life tabs, on the personal project: money, habits, books.
    const openPersonal = async tab => {
      await page.locator('[data-project-card]', { hasText: 'Kitchen renovation' }).first().click()
      await page.locator('[data-project-overview]').waitFor({ state: 'visible', timeout: 5000 })
      await page.getByRole('tab', { name: tab }).click()
    }
    await visit('Projects · money', async () => { await openPersonal(/^Money/); await page.locator('[data-project-money]').waitFor({ state: 'visible', timeout: 6000 }) })
    await visit('Projects · habits', async () => { await page.getByRole('tab', { name: /^Habits/ }).click(); await page.locator('[data-habit-week]').first().waitFor({ state: 'visible', timeout: 6000 }) })
    await visit('Projects · books', async () => { await page.getByRole('tab', { name: /^Books/ }).click(); await page.locator('[data-book-progress]').first().waitFor({ state: 'visible', timeout: 6000 }) })
    await page.getByRole('button', { name: 'Back to all projects' }).click()
    await page.locator('[data-project-card]').first().waitFor({ state: 'visible', timeout: 5000 })
    await visit('Projects · new project', async () => {
      await page.getByRole('button', { name: /New project/ }).click()
      await page.locator('[data-project-dialog]').waitFor({ state: 'visible' })
      await page.getByLabel('Start date').fill('2026-11-10')
      await page.getByLabel('Target date').fill('2026-11-01')   // opens the date-problem line
    }, 20)
    await visit('Projects · edit, delete confirmation', async () => {
      await page.keyboard.press('Escape')
      await page.locator('[data-project-card]').first().click()
      await page.locator('[data-project-overview]').waitFor({ state: 'visible', timeout: 5000 })
      await page.getByRole('button', { name: /Edit/ }).click()
      await page.locator('[data-project-dialog]').waitFor({ state: 'visible' })
      await page.getByRole('button', { name: 'Delete' }).click()
    }, 20)
    await page.keyboard.press('Escape')
    // The planner: the choices (no key in the audit, so the AI's own note shows), a template's
    // reviewable draft, and the dating tab on a project with one undated task.
    await visit('Projects · planner, choices', async () => {
      await page.getByRole('button', { name: 'Back to all projects' }).click()   // the edit dialog left project 1's page open
      await page.locator('[data-project-card]', { hasText: 'Kitchen renovation' }).first().click()
      await page.locator('[data-project-overview]').waitFor({ state: 'visible', timeout: 5000 })
      await page.getByRole('button', { name: /^Plan$|Plan$/ }).first().click()
      await page.locator('[data-planner-nokey]').waitFor({ state: 'visible', timeout: 5000 })
    })
    await visit('Projects · planner, a template draft', async () => {
      await page.locator('[data-template="renovation"]').click()
      await page.locator('[data-planner-preview]').waitFor({ state: 'visible', timeout: 5000 })
    })
    await visit('Projects · planner, dating tab', async () => {
      await page.locator('[data-project-planner]').getByRole('button', { name: 'Back', exact: true }).click()
      await page.getByRole('tab', { name: /Date my open tasks/ }).click()
    })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Back to all projects' }).click().catch(() => {})
    await page.locator('[data-project-card]').first().waitFor({ state: 'visible', timeout: 5000 })
    // The calendar's side of the link: the Project row in an event's own panel.
    await visit('Calendar · an event\'s project row', async () => {
      await page.locator('[data-side-rail] button[aria-label="Calendar"]').click()
      await page.locator('.event-card').first().click()
      await page.locator('[data-event-project]').first().waitFor({ state: 'visible', timeout: 8000 })
    })
    await page.keyboard.press('Escape')
    // The same row while the event is still being composed.
    await visit('Calendar · composer, project row', async () => {
      await page.locator('[data-side-rail] button[aria-label="Calendar"]').click()
      await page.getByRole('button', { name: /New event/i }).first().click()
      await page.locator('[data-composer-project]').waitFor({ state: 'visible', timeout: 8000 })
    })
    await page.keyboard.press('Escape')
    // The mail side: a filed row's chip, and the reader with its Project row and a suggestion.
    await visit('Mail · reader, project row and suggestion', async () => {
      await page.locator('[data-side-rail] button[aria-label="Mail"]').click()
      await page.getByRole('button', { name: 'Message number 1', exact: true }).first().click()
      await page.locator('[data-project-suggestion]').waitFor({ state: 'visible', timeout: 10000 })
    })
    // The same milestones on the calendar: a strip in the week, chips in the month.
    await visit('Calendar · milestone markers, week', async () => {
      await page.locator('[data-side-rail] button[aria-label="Calendar"]').click()
      await page.locator('[data-cal-milestones]').waitFor({ state: 'visible', timeout: 8000 })
    })
    await visit('Calendar · milestone markers, month', async () => {
      await page.getByRole('tab', { name: 'Month', exact: true }).click()
      await page.locator('.cal-cell [data-milestone-marker]').first().waitFor({ state: 'visible', timeout: 8000 })
    })
    await page.getByRole('tab', { name: 'Week', exact: true }).click().catch(() => {})
    projectsFixture = false
    await page.evaluate(() => { for (const k of ['professor-tasks', 'professor-projects', 'professor-ui']) if (k !== 'professor-ui') localStorage.removeItem(k) })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
  }
  // Money borrowed: the Loans group on Balances (one owed, one paid back and
  // folded open), the Borrowed / Repaid marks and the neutral amount in the feed
  // from the account it landed in, and Today's Borrowed chip and cash-flow line.
  // None of it exists without a lender, so the fixture is switched on for these
  // two visits and the page reloaded either side of them.
  const financeTab = name => page.locator('nav[aria-label="Finance sections"]').getByRole('button', { name, exact: true }).click()
  await visit('Finance · loans (Balances)', async () => {
    loansFixture = true
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    await page.locator('[data-side-rail] button[aria-label="Finance"]').click()
    await financeTab('Balance')
    await page.getByText('LOANS OWED').waitFor({ timeout: 6000 })
    await page.getByRole('button', { name: /paid back/ }).click({ timeout: 2000 })
    // The account it landed in, so the feed reads the move as money coming in.
    await page.getByText('CIB', { exact: true }).first().click()
  }, 40, ['LOANS OWED', 'Borrowed', 'Repaid', 'paid back', 'Pay back', '(EGP 6,000)', '(EGP 10,000)'])
  await visit('Finance · loans (Today)', async () => {
    await financeTab('Today')
    await page.getByText('Borrowed', { exact: true }).first().waitFor({ timeout: 6000 })
  }, 40, ['Borrowed', 'Net leaves out'])
  // The goal for a loan on a payment plan: its row, its card, the lane that
  // draws the instalments and the forecast's loans rule. The plan is a budget
  // rule, so it is put where the app keeps those before the Goals screen mounts.
  await visit('Finance · loans (Goals)', async () => {
    await page.evaluate(() => localStorage.setItem('finance-budget-rules', JSON.stringify({
      la2: { schedule: 'repeat', amount: 2000, frequency: 'monthly', rollover: false, warn80: false, bucket: 'fixed', currency: 'EGP',
             starts: new Date().toISOString().slice(0, 7), dueDay: 15, dueAccountId: 'la1' },
    })))
    await financeTab('Goals')
    await page.getByText('Repay Ahmed').first().waitFor({ timeout: 6000 })
    await page.getByText('See the rules').first().click()
  }, 40, ['Repay Ahmed', 'loan ·', '/mo', 'Pay back', 'payment plan is paid first'])
  if (loansFixture) {
    loansFixture = false
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
  }
  // INK_ONLY stops here: everything below depends on the screens before it, so
  // a filter on `visit` alone would leave later steps clicking in a page that
  // never got where they expect.
  if (!process.env.INK_ONLY) {
  outcomeFixture = false
  await visit('Calendar · booking panel', async () => {
    await page.keyboard.press('Escape')
    await page.locator('[data-side-rail] button[aria-label="Calendar"]').click()
    await page.waitForTimeout(1400)
    await page.getByRole('button', { name: /^Booking$/ }).click()
    await page.waitForTimeout(900)
  })
  await visit('Calendar · marking open hours', async () => {
    const mark = page.getByRole('button', { name: /Mark hours on the week/i })
    if (await mark.count()) { await mark.click(); await page.waitForTimeout(800) }
  })
  await visit('Mail', async () => { await page.locator('[data-side-rail] button[aria-label="Mail"]').click() })
  await visit('Tasks', async () => { await page.locator('[data-side-rail] button[aria-label="Tasks"]').click() })
  // The day planner is a view of Tasks now (it was a modal): measured on the page ground it sits on.
  await visit('Tasks · Plan view', async () => {
    await page.getByRole('tablist', { name: 'View' }).getByRole('tab', { name: 'Plan', exact: true }).click()
    await page.locator('[data-planner-view]').waitFor({ timeout: 6000 })
  })
  await page.getByRole('tablist', { name: 'View' }).getByRole('tab', { name: 'Board', exact: true }).click().catch(() => {})
  await visit('Habits', async () => { await page.locator('[data-side-rail] button[aria-label="Habits"]').click() })
  await visit('Finance', async () => { await page.locator('[data-side-rail] button[aria-label="Finance"]').click() })
  // Shopping: the list with an item open (every field of the editor), the board
  // (cards on a column ground), and the stores page with one opened.
  // Shopping has its own place in the main rail (it was a tab inside Finance).
  const shoppingTab = async () => {
    await page.locator('[data-side-rail] button[aria-label="Shopping"]').click()
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
    await page.locator('[data-side-rail] button[aria-label="Library"]').click()
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
    // The avatar is top right now, not in the rail. Scoped to the menu it
    // opens rather than to where it happens to sit, so moving it again does
    // not quietly turn this screen into one that measures nothing.
    await page.locator('button[aria-haspopup="menu"]').click({ timeout: 4000 })
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

  // ── The setup guide, all eight steps, reached through the admin's own test button ─
  const wzNext = async (skip) => {
    if (skip) await page.getByRole('button', { name: skip }).first().click({ timeout: 4000 })
    else await page.locator('.wz-panel .sb-btn[data-variant="primary"]').click({ timeout: 4000 })
    await page.waitForTimeout(700)
  }
  await visit('Setup guide · 1 you', async () => {
    await goAdmin()
    await page.locator('[data-test-wizard]').click({ timeout: 4000 })
    await page.locator('[data-wizard]').waitFor({ timeout: 6000 })
  })
  await visit('Setup guide · 2 accounts', () => wzNext())
  await visit('Setup guide · 3 AI key', () => wzNext())
  await visit('Setup guide · 4 rhythm', () => wzNext('Skip for now'))
  await visit('Setup guide · 5 automation', () => wzNext('Skip this step'))
  await visit('Setup guide · 6 habits', () => wzNext('Skip this step'))
  await visit('Setup guide · 7 finance', () => wzNext('Skip this step'))
  await visit('Setup guide · 8 done', () => wzNext('Skip this step'))
  await page.getByRole('button', { name: 'Leave the test' }).first().click({ timeout: 4000 }).catch(() => {})

  // ── The assistant: its face, the first-use question, and named ─────────────
  await visit('Assistant · first use (asks for a name)', async () => {
    await page.evaluate(() => { localStorage.setItem('assistant-persona', JSON.stringify({ name: '', asked: false })); window.dispatchEvent(new Event('professor:personaChanged')) })
    await page.getByRole('button', { name: /Talk to/ }).first().click({ timeout: 5000 })
    await page.getByText('What would you like to call me?').waitFor({ timeout: 5000 })
  })
  await visit('Assistant · named', async () => {
    await page.getByRole('button', { name: 'Hadi', exact: true }).click({ timeout: 5000 })
    await page.waitForTimeout(600)
  })
  await page.getByRole('button', { name: 'Close the assistant' }).last().click({ timeout: 3000 }).catch(() => {})

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

  } // end of the INK_ONLY gate

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
