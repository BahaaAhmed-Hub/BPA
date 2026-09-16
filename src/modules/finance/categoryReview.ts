// ─── Reading the shape of your own categories ────────────────────────────────
//
// Every figure in this module is measured against categories *you* made up.
// That is the right way round — nobody else knows that "Teradix" is a client
// and not a shop — but it means the quality of every budget, envelope and
// report rests on a tree nothing has ever looked at.
//
// This looks at it. Not to tidy it: to say what the ledger suggests, name the
// evidence, and leave the decision alone. Four rules hold it together, and they
// are the same four that keep the forecast rules trustworthy:
//
// **Never guess.** Every finding names the entries behind it. A finding with no
// evidence is not raised at all, and a benchmark with nothing to compare goes
// dormant and says what it is waiting for.
//
// **Never act.** Nothing here renames, merges, moves or deletes a category. It
// produces sentences; the buttons that act live on the screen, and each one is
// a thing you press.
//
// **Your view wins, permanently.** "Keep as it is" is a real answer and it
// sticks. The note is against the finding *as it was when you looked* — the
// same rule `duplicateAcks.ts` follows — so a finding you dismissed comes back
// only if the evidence behind it has materially changed.
//
// **Say the size.** A suggestion with no money attached is an opinion. Every
// finding that can carry an amount carries one, so you can tell the ones worth
// ten minutes from the ones worth none.

import type { Category, Transaction } from './types'
import { toBase } from './fx'
import { settled, whenPaid } from './unpaid'
import { todayISO } from './dates'
import { foldText } from '@/lib/pickSearch'
import { bucketOf, BUCKETS, type Bucket, type BudgetRule } from './modals/BudgetRuleModal'

export type FindingKind =
  | 'unfiled'      // spending with no category at all
  | 'overlap'      // two categories the same payees land in
  | 'similar'      // two names that read as the same thing
  | 'needsParts'   // one big category with no way to see inside it
  | 'outgrown'     // a sub-category that is really its own category
  | 'bothWays'     // money going both directions through one category
  | 'unused'       // a category nothing has been filed under
  | 'split'        // the benchmark: how the month divides four ways

export type Severity = 'worth-a-look' | 'noted'

export interface Finding {
  /** Stable, and carries what made it a finding. Dismissing keys on this, so a
   *  finding returns when its evidence changes and not before. */
  id: string
  kind: FindingKind
  severity: Severity
  title: string
  detail: string
  /** The money the finding is about, in the base currency. Absent where the
   *  finding is not about an amount. */
  amount?: number
  /** What it is about, so the screen can select or open them. */
  categoryIds: string[]
  /** Example entries, so "we found this" can be checked rather than believed. */
  evidence: string[]
}

export interface ReviewInput {
  categories: Category[]
  transactions: Transaction[]
  /** categoryId → rule, as the Budget screen holds them. */
  rules: Record<string, BudgetRule | undefined>
  base: string
  today?: string
  /** How far back to read. Twelve months by default: less than that and a
   *  category used quarterly reads as unused. */
  months?: number
}

export interface Review {
  findings: Finding[]
  /** How many months of settled history it actually had. Under three, nothing
   *  is claimed — a tree read from one month is a tree nobody has used yet. */
  readFrom: number
  /** Total spending in the window, so a share can be stated rather than felt. */
  spend: number
  currency: string
}

const norm = (s: string | undefined) => foldText(s ?? '')

/** Singular and plural are the same category typed twice, and they are the
 *  commonest duplicate of all: "Grocery" beside "Groceries" is three edits
 *  apart, which no sane distance threshold would catch, and one stem apart,
 *  which is the thing actually being asked. */
function stem(s: string): string {
  return s.replace(/ies\b/g, 'y').replace(/([^s])s\b/g, '$1')
}

/** Edit distance, capped: two names are compared, not two essays. */
function close(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (stem(a) === stem(b)) return true
  if (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a))) return true
  const [s, t] = a.length <= b.length ? [a, b] : [b, a]
  if (t.length - s.length > 2) return false
  let prev = [...Array(s.length + 1).keys()]
  for (let j = 1; j <= t.length; j++) {
    const row = [j]
    for (let i = 1; i <= s.length; i++) {
      row[i] = Math.min(prev[i] + 1, row[i - 1] + 1, prev[i - 1] + (s[i - 1] === t[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[s.length] <= Math.max(1, Math.floor(t.length / 4))
}

export function reviewCategories(input: ReviewInput): Review {
  const today = input.today ?? todayISO()
  const months = input.months ?? 12
  const base = input.base
  const cutoff = new Date(`${today}T12:00:00`)
  cutoff.setMonth(cutoff.getMonth() - months)
  const from = cutoff.toISOString().slice(0, 10)

  const rows = settled(input.transactions).filter(t => whenPaid(t) >= from)
  const seen = new Set(rows.map(t => whenPaid(t).slice(0, 7)))
  const readFrom = seen.size

  const byId = new Map(input.categories.map(c => [c.id, c]))
  const kids = new Map<string, Category[]>()
  for (const c of input.categories) {
    if (!c.parentId) continue
    kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c])
  }

  // ── one pass over the ledger, everything measured from it ──────────────────
  let spend = 0
  let unfiled = 0
  const unfiledPayees = new Map<string, number>()
  const spendBy = new Map<string, number>()            // categoryId → base spent
  const payeesBy = new Map<string, Map<string, number>>()  // categoryId → folded payee → base
  // Folding is for matching; a name on screen is the one you typed.
  const asTyped = new Map<string, string>()
  const wayBy = new Map<string, { inc: number; exp: number }>()
  const usedAt = new Map<string, number>()             // categoryId → entry count

  for (const t of rows) {
    if (t.type !== 'expense' && t.type !== 'income') continue
    const v = toBase(Math.abs(t.amount), t.currency, base)
    if (v === null) continue
    const cid = t.categoryId
    if (t.type === 'expense') spend += v
    if (!cid) {
      if (t.type === 'expense') { unfiled += v; unfiledPayees.set(t.payee || '(no payee)', (unfiledPayees.get(t.payee || '(no payee)') ?? 0) + v) }
      continue
    }
    usedAt.set(cid, (usedAt.get(cid) ?? 0) + 1)
    const w = wayBy.get(cid) ?? { inc: 0, exp: 0 }
    if (t.type === 'income') w.inc += v; else w.exp += v
    wayBy.set(cid, w)
    if (t.type !== 'expense') continue
    spendBy.set(cid, (spendBy.get(cid) ?? 0) + v)
    const p = norm(t.payee)
    if (!p) continue
    if (!asTyped.has(p)) asTyped.set(p, (t.payee ?? '').trim())
    const m = payeesBy.get(cid) ?? new Map<string, number>()
    m.set(p, (m.get(p) ?? 0) + v)
    payeesBy.set(cid, m)
  }

  const findings: Finding[] = []
  const money = (n: number) => Math.round(n)
  const share = (n: number) => (spend > 0 ? Math.round((n / spend) * 100) : 0)

  if (readFrom < 3) {
    return { findings, readFrom, spend, currency: base }
  }

  // ── spending with no home ──────────────────────────────────────────────────
  if (unfiled > 0 && share(unfiled) >= 3) {
    const top = [...unfiledPayees.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    findings.push({
      id: `unfiled|${share(unfiled)}`,
      kind: 'unfiled',
      severity: 'worth-a-look',
      title: `${share(unfiled)}% of your spending has no category`,
      detail: `Nothing files it, so it is in no envelope and no budget can ever cover it. `
        + `The biggest of it is ${top.map(([p]) => p).join(', ')}.`,
      amount: money(unfiled),
      categoryIds: [],
      evidence: top.map(([p, v]) => `${p} — ${money(v).toLocaleString('en-GB')}`),
    })
  }

  // ── two categories the same payees land in ────────────────────────────────
  const ids = [...payeesBy.keys()]
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = byId.get(ids[i]), b = byId.get(ids[j])
      if (!a || !b) continue
      if (a.parentId === b.id || b.parentId === a.id) continue      // a part and its parent share payees by design
      const pa = payeesBy.get(ids[i])!, pb = payeesBy.get(ids[j])!
      const shared = [...pa.keys()].filter(p => pb.has(p))
      if (shared.length < 2) continue
      const weight = shared.reduce((n, p) => n + (pa.get(p) ?? 0) + (pb.get(p) ?? 0), 0)
      if (share(weight) < 2) continue
      findings.push({
        id: `overlap|${[a.id, b.id].sort().join('|')}|${shared.length}`,
        kind: 'overlap',
        severity: 'worth-a-look',
        title: `${a.name} and ${b.name} take the same payees`,
        detail: `${shared.length} payees have been filed under both. If they are one thing, `
          + `two envelopes are splitting it and neither total is the real one. `
          + `If they are genuinely different, nothing needs doing.`,
        amount: money(weight),
        categoryIds: [a.id, b.id],
        evidence: shared.slice(0, 4).map(p => asTyped.get(p) ?? p),
      })
    }
  }

  // ── two names that read as the same thing ─────────────────────────────────
  for (let i = 0; i < input.categories.length; i++) {
    for (let j = i + 1; j < input.categories.length; j++) {
      const a = input.categories[i], b = input.categories[j]
      if (a.parentId === b.id || b.parentId === a.id) continue
      if (a.parentId && a.parentId === b.parentId) continue          // siblings are meant to be alike
      if (!close(norm(a.name), norm(b.name))) continue
      if (findings.some(f => f.kind === 'overlap' && f.categoryIds.includes(a.id) && f.categoryIds.includes(b.id))) continue
      findings.push({
        id: `similar|${[a.id, b.id].sort().join('|')}`,
        kind: 'similar',
        severity: 'noted',
        title: `"${a.name}" and "${b.name}" read as the same category`,
        detail: `Two names this close are usually one category typed twice. `
          + `They hold ${money((spendBy.get(a.id) ?? 0) + (spendBy.get(b.id) ?? 0)).toLocaleString('en-GB')} between them.`,
        amount: money((spendBy.get(a.id) ?? 0) + (spendBy.get(b.id) ?? 0)),
        categoryIds: [a.id, b.id],
        evidence: [a.name, b.name],
      })
    }
  }

  // ── a category too big to see inside ──────────────────────────────────────
  for (const c of input.categories) {
    if (c.parentId) continue
    if ((kids.get(c.id)?.length ?? 0) > 0) continue
    const v = spendBy.get(c.id) ?? 0
    const distinct = payeesBy.get(c.id)?.size ?? 0
    if (share(v) < 15 || distinct < 6) continue
    const top = [...(payeesBy.get(c.id) ?? new Map())].sort((a, b) => b[1] - a[1]).slice(0, 3)
    findings.push({
      id: `needsParts|${c.id}|${share(v)}`,
      kind: 'needsParts',
      severity: 'worth-a-look',
      title: `${c.name} is ${share(v)}% of your spending, in one lump`,
      detail: `${distinct} different payees, no parts. A budget on it can say whether you went over `
        + `but never which half of it did. The three biggest are ${top.map(([p]) => asTyped.get(p as string) ?? p).join(', ')}.`,
      amount: money(v),
      categoryIds: [c.id],
      evidence: top.map(([p, n]) => `${asTyped.get(p as string) ?? p} — ${money(n as number).toLocaleString('en-GB')}`),
    })
  }

  // ── a part that has outgrown being a part ─────────────────────────────────
  const topLevelSpend = input.categories
    .filter(c => !c.parentId)
    .map(c => spendBy.get(c.id) ?? 0)
    .filter(v => v > 0)
    .sort((a, b) => a - b)
  const median = topLevelSpend.length
    ? topLevelSpend[Math.floor(topLevelSpend.length / 2)]
    : 0
  for (const c of input.categories) {
    if (!c.parentId) continue
    const v = spendBy.get(c.id) ?? 0
    const siblings = (kids.get(c.parentId) ?? []).filter(k => k.id !== c.id)
    const rest = siblings.reduce((n, k) => n + (spendBy.get(k.id) ?? 0), 0)
    if (v <= rest || v <= median || share(v) < 8) continue
    findings.push({
      id: `outgrown|${c.id}|${share(v)}`,
      kind: 'outgrown',
      severity: 'noted',
      title: `${c.name} is bigger than the category it sits in`,
      detail: `It is ${share(v)}% of your spending on its own — more than every other part of `
        + `${byId.get(c.parentId)?.name ?? 'its parent'} put together, and more than a typical top-level `
        + `category. It may deserve to be one.`,
      amount: money(v),
      categoryIds: [c.id, c.parentId],
      evidence: [`${c.name} ${money(v).toLocaleString('en-GB')}`, `the rest of its parent ${money(rest).toLocaleString('en-GB')}`],
    })
  }

  // ── money going both ways through one category ────────────────────────────
  for (const [cid, w] of wayBy) {
    const c = byId.get(cid)
    if (!c || c.txType === 'both') continue
    const minor = Math.min(w.inc, w.exp)
    if (minor === 0 || minor / Math.max(w.inc, w.exp) < 0.08) continue
    findings.push({
      id: `bothWays|${cid}|${Math.round((minor / Math.max(w.inc, w.exp)) * 100)}`,
      kind: 'bothWays',
      severity: 'noted',
      title: `${c.name} has money going both ways`,
      detail: `It is marked ${c.txType === 'income' ? 'income' : 'spending'}, but carries `
        + `${money(minor).toLocaleString('en-GB')} the other way. Every screen that sums one side `
        + `is leaving that out. Setting it to "both" counts it on the side it belongs.`,
      amount: money(minor),
      categoryIds: [cid],
      evidence: [`in ${money(w.inc).toLocaleString('en-GB')}`, `out ${money(w.exp).toLocaleString('en-GB')}`],
    })
  }

  // ── a category nothing has been filed under ───────────────────────────────
  const idle = input.categories.filter(c => !c.isSystem && !usedAt.has(c.id) && !(kids.get(c.id)?.length))
  if (idle.length >= 3) {
    findings.push({
      id: `unused|${idle.map(c => c.id).sort().join(',')}`,
      kind: 'unused',
      severity: 'noted',
      title: `${idle.length} categories have nothing in them`,
      detail: `Nothing has been filed under them in ${readFrom} months. They are in every picker `
        + `and every list, which makes filing an entry a longer decision than it needs to be.`,
      categoryIds: idle.map(c => c.id),
      evidence: idle.slice(0, 6).map(c => c.name),
    })
  }

  // ── the benchmark ─────────────────────────────────────────────────────────
  findings.push(splitFinding(input, spendBy, spend))

  // Worth a look first, then by the money at stake. A list ordered by anything
  // else is a list you read top to bottom instead of acting on.
  findings.sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === 'worth-a-look' ? -1 : 1)
    || (b.amount ?? 0) - (a.amount ?? 0))

  return { findings, readFrom, spend, currency: base }
}

/**
 * How the month divides four ways, against a rule of thumb.
 *
 * The 50/30/20 split is a well-known heuristic, not a standard and certainly
 * not a reading of your life — a year with school fees in it cannot hit it and
 * should not try. It is here because a share with nothing beside it is a
 * number you cannot judge, and one familiar reference point is enough to make
 * it mean something. It is stated as a rule of thumb every time it appears.
 *
 * It needs budget rules with a bucket on them. Without those there is nothing
 * to divide, so it goes dormant and says so rather than inventing a split.
 */
function splitFinding(
  input: ReviewInput,
  spendBy: Map<string, number>,
  spend: number,
): Finding {
  const tally: Record<Bucket, number> = { fixed: 0, investment: 0, savings: 0, guiltfree: 0 }
  let covered = 0
  for (const [cid, v] of spendBy) {
    const rule = input.rules[cid]
    if (!rule) continue
    tally[bucketOf(rule)] += v
    covered += v
  }
  const pct = (n: number) => (covered > 0 ? Math.round((n / covered) * 100) : 0)

  if (covered === 0 || spend === 0) {
    return {
      id: 'split|dormant',
      kind: 'split',
      severity: 'noted',
      title: 'How your month divides four ways',
      detail: 'Nothing to divide yet: this reads the bucket on each budget — fixed, invest, '
        + 'save or guilt-free — and none of your categories carries one. Set a budget with a '
        + 'kind on it and the split appears here.',
      categoryIds: [],
      evidence: [],
    }
  }

  const need = Math.round(((spend - covered) / spend) * 100)
  const fixed = pct(tally.fixed)
  const put = pct(tally.investment) + pct(tally.savings)
  const free = pct(tally.guiltfree)
  const names = BUCKETS.map(b => `${b.short} ${pct(tally[b.id])}%`).join(' · ')

  return {
    id: `split|${fixed}|${put}|${free}`,
    kind: 'split',
    severity: 'noted',
    title: `Your budgeted month is ${names}`,
    detail: `A common rule of thumb is half on fixed costs, thirty on what you choose, twenty put `
      + `away — yours is ${fixed}, ${free}, ${put}. It is a reference point, not a target: a year `
      + `carrying school fees cannot hit it and should not try.`
      + (need > 0 ? ` ${need}% of your spending is in categories with no budget, so it is in none of these.` : ''),
    categoryIds: [],
    evidence: BUCKETS.map(b => `${b.name} ${pct(tally[b.id])}%`),
  }
}

// ─── Your view, kept ─────────────────────────────────────────────────────────
//
// Same shape as `duplicateAcks.ts`, and for the same reason: a suggestion list
// that cannot be answered is a list you learn to scroll past. "Keep as it is"
// is an answer, it sticks, and because the key carries the evidence a finding
// only returns when the evidence has moved.

const KEY = 'finance-category-review-kept'
export const REVIEW_EVENT = 'finance:categoryReviewChanged'

export function loadKept(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? (raw as string[]) : [])
  } catch { return new Set() }
}

function save(kept: Set<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...kept])) } catch { /* private mode */ }
  window.dispatchEvent(new Event(REVIEW_EVENT))
}

/** "This is how I want it." */
export function keepAsIs(finding: Finding): void {
  const kept = loadKept()
  kept.add(finding.id)
  save(kept)
}

export function unkeep(finding: Finding): void {
  const kept = loadKept()
  kept.delete(finding.id)
  save(kept)
}

export function forgetAllKept(): void { save(new Set()) }
