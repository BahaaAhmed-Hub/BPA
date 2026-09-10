import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { X, ChevronDown, Check } from 'lucide-react'
import type { Category, Transaction } from '../types'
import { IconPicker } from '../components/IconPicker'
import { CategoryGlyph } from '../components/CategoryGlyph'
import { MoneyInput } from '../components/MoneyInput'
import { toBase } from '../fx'
import { settled, whenPaid } from '../unpaid'
import { ICON, STROKE } from '@/lib/type'

// ─── What an envelope is set to ──────────────────────────────────────────────
// This was a whole right-hand column: an amount, a fixed-or-flexible pair, five
// frequency pills, a start month, and four switches. Two of those switches —
// auto-raise with inflation, and count toward guilt-free spend — were never
// read by anything. They remembered their own position and that was the whole
// of what they did, so they are gone.
const DISPLAY = 'var(--sb-font-num)'

export type Frequency = 'weekly' | 'monthly' | 'every_2_months' | 'quarterly' | 'yearly'

/**
 * How a budget is laid out across the year.
 *
 * `repeat` is the same amount every so often, which is what every rule was
 * until now. It cannot say what school fees actually do: four instalments, on
 * four different dates, for four different amounts. Forcing that into one
 * monthly figure makes eight months look poorer than they are and four look
 * impossible — so `custom` takes the dates and amounts as they are, and `once`
 * is the single-payment case that used to have no shape at all.
 */
export type Schedule = 'repeat' | 'once' | 'custom'

/** One dated amount inside a custom schedule. */
export interface BudgetLine {
  id: string
  /** YYYY-MM-DD. */
  date: string
  amount: number
  /** What this instalment is, where that is worth writing down. */
  note?: string
}

export interface BudgetRule {
  /** Absent means `repeat` — every rule written before this reads unchanged. */
  schedule?: Schedule
  /** `once`: the day it falls. YYYY-MM-DD. */
  onDate?: string
  /** `custom`: the instalments, each with its own date and amount. */
  lines?: BudgetLine[]
  /** `custom`: whether those dates come round again next year. School fees do;
   *  a one-off set of build payments does not. */
  linesRepeat?: boolean
  amount: number
  frequency: Frequency
  rollover: boolean
  warn80: boolean
  /** The first month it applies to, 'YYYY-MM'. **Absent means every month**,
   *  which is what a budget usually is. It used to be filled in with whatever
   *  month the rule happened to be created in — never a choice anybody made —
   *  so stepping back to July showed a page of "set a budget" for budgets that
   *  plainly existed. A month is only a *start* when you say it is. */
  starts?: string
  /** The last month it applies to. Absent means it runs on. */
  ends?: string           // YYYY-MM
  /** What the amount is denominated in. There are no exchange rates in this
   *  app, so it is also which transactions the envelope counts. */
  currency?: string
  /** Which of the four a budget belongs to. Two — fixed against flexible —
   *  only ever said whether you could move it, which is not a plan. These four
   *  are, and they are the ones people actually work to: what you must pay,
   *  what you put to work, what you put by, and what is left to enjoy without
   *  keeping score. Kept as `fixedType` for the rules already written with it;
   *  read it through `bucketOf`. */
  bucket?: Bucket
  /** @deprecated the two-way version. `bucketOf` still reads it. */
  fixedType?: 'fixed' | 'flexible'
  /** The day of the month the money actually has to move, 1–31, where there is
   *  one. A budget says how much a category gets; this says when. A month too
   *  short for the day takes its last day rather than skipping. Absent means
   *  the budget is a monthly allowance with no particular day to it. */
  dueDay?: number
  /** Which account the money leaves. Only meaningful with a day: the entry
   *  written for that day has to come from somewhere. */
  dueAccountId?: string
  /** Kept so a rule written before budgets made entries still reads. Nothing
   *  uses it now — the entry lands on the day itself. */
  dueLeadDays?: number
}

export const FREQ_OPTS: { v: Frequency; label: string; per: number }[] = [
  { v: 'weekly',         label: 'Weekly',        per: 52 / 12 },
  { v: 'monthly',        label: 'Monthly',       per: 1 },
  { v: 'every_2_months', label: 'Every 2 months', per: 1 / 2 },
  { v: 'quarterly',      label: 'Quarterly',     per: 1 / 3 },
  { v: 'yearly',         label: 'Annual',        per: 1 / 12 },
]

/** The four worth offering. Every-2-months stays in the table above so a rule
 *  already set to it still reads and still divides correctly — it is just not
 *  something else to scroll past when picking. */
const FREQ_CHOICES: Frequency[] = ['weekly', 'monthly', 'quarterly', 'yearly']

/** Every category's budget, as the Budget screen keeps them. It reads this
 *  file's shape, so the reader belongs here rather than being spelt out again
 *  wherever a budget is needed. */
export function loadRules(): Record<string, BudgetRule> {
  try {
    const parsed = JSON.parse(localStorage.getItem('finance-budget-rules') ?? '{}') as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, BudgetRule>) : {}
  } catch { return {} }
}

/** 1st, 2nd, 3rd, 21st … — a day of the month reads as a day, not a number.
 *  The teens are the exception every naive version gets wrong. */
/** "every month", "every quarter" — how often the entry lands. */
export function freqPhrase(f: Frequency): string {
  return f === 'weekly' ? 'every week'
    : f === 'every_2_months' ? 'every two months'
    : f === 'quarterly' ? 'every quarter'
    : f === 'yearly' ? 'once a year'
    : 'every month'
}

export function ordinal(n: number): string {
  const teen = n % 100
  if (teen >= 11 && teen <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

export function defaultRule(): BudgetRule {
  return {
    amount: 0, frequency: 'monthly', rollover: false, warn80: true,
    bucket: 'guiltfree',
    schedule: 'repeat',
  }
}

// ─── The four a budget can belong to ─────────────────────────────────────────
//
//  A month's money divides four ways and the split is the plan: what you are
//  committed to, what you put to work, what you put by, and what is genuinely
//  yours to spend. "Fixed or flexible" answered a smaller question — whether a
//  line could be moved — and answered it about one line at a time, so nothing
//  on any screen could add them up.

export type Bucket = 'fixed' | 'investment' | 'savings' | 'guiltfree'

export const BUCKETS: {
  id: Bucket
  /** What fits on a pill four-across. */
  short: string
  /** What it is actually called. */
  name: string
  /** What belongs in it. */
  help: string
  color: string
}[] = [
  { id: 'fixed',      short: 'Fixed',      name: 'Fixed costs',
    help: 'Rent, school fees, utilities, insurance, a loan — what leaves whether or not you think about it.',
    color: 'var(--sb-ink-2)' },
  { id: 'investment', short: 'Invest',     name: 'Investments',
    help: 'Money put to work rather than put by — a fund, a pension, a stake in something.',
    color: 'var(--sb-info)' },
  { id: 'savings',    short: 'Save',       name: 'Savings',
    help: 'Money set aside and kept as money: a goal, a deposit, the buffer.',
    color: 'var(--sb-positive)' },
  { id: 'guiltfree',  short: 'Guilt-free', name: 'Guilt-free spending',
    help: 'What is left after the other three, and the whole point of them — spend it without keeping score.',
    color: 'var(--sb-accent-deep)' },
]

/**
 *  Which of the four a rule belongs to.
 *
 *  A rule written before this carries `fixedType` instead: `fixed` was the
 *  same thing, and `flexible` meant money you steer, which is guilt-free
 *  spending. Nothing has to be re-answered for the old ones to read.
 */
export function bucketOf(r?: Pick<BudgetRule, 'bucket' | 'fixedType'>): Bucket {
  if (r?.bucket) return r.bucket
  return r?.fixedType === 'fixed' ? 'fixed' : 'guiltfree'
}

export const bucketMeta = (b: Bucket) => BUCKETS.find(x => x.id === b) ?? BUCKETS[3]

/** Absent is `repeat`, so nothing written before this changed meaning. */
export const scheduleOf = (r?: Pick<BudgetRule, 'schedule'>): Schedule => r?.schedule ?? 'repeat'

/** The instalments of a custom rule, sorted, with anything unusable dropped. */
export function linesOf(rule: Pick<BudgetRule, 'lines'>): BudgetLine[] {
  return (rule.lines ?? [])
    .filter(l => l && /^\d{4}-\d{2}-\d{2}$/.test(l.date) && l.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 *  A budget with dates on it is not a monthly allowance.
 *
 *  Four instalments of 45,000 are four instalments of 45,000. Divided into a
 *  monthly figure they become 15,000 a month, which is a number that never
 *  leaves the account on any day of the year — and measuring a month's spending
 *  against it is measuring against something nobody agreed to. So a dated rule
 *  reports its **total**, and is measured over the span it is spread across.
 */
export const isDated = (r?: Pick<BudgetRule, 'schedule'>): boolean =>
  scheduleOf(r) === 'once' || scheduleOf(r) === 'custom'

/**
 *  What this budget is, as one figure, without dividing it.
 *
 *  A repeating rule's figure is its month — that is what it is. A dated rule's
 *  is the sum of its dates, in the year given, or across all of them when no
 *  year is named.
 */
export function budgetTotal(rule?: BudgetRule, year?: string): number {
  if (!rule) return 0
  const kind = scheduleOf(rule)
  if (kind === 'once') {
    if (!(rule.amount > 0)) return 0
    return !year || rule.onDate?.slice(0, 4) === year ? rule.amount : 0
  }
  if (kind === 'custom') {
    const lines = linesOf(rule)
    // A set that comes round every year is that set, whichever year is asked
    // for; one that does not is only in its own.
    if (!year || rule.linesRepeat) return lines.reduce((n, l) => n + l.amount, 0)
    return lines.filter(l => l.date.slice(0, 4) === year).reduce((n, l) => n + l.amount, 0)
  }
  return monthlyAmount(rule)
}

/** How long a dated budget is measured over — the words for it, and the span. */
export function budgetSpan(rule?: BudgetRule): 'month' | 'year' {
  return isDated(rule) ? 'year' : 'month'
}

/** What a custom or one-off rule asks for across a whole year. */
export function yearlyTotal(rule: BudgetRule): number {
  const kind = scheduleOf(rule)
  if (kind === 'once') return rule.amount > 0 ? rule.amount : 0
  if (kind === 'custom') return linesOf(rule).reduce((n, l) => n + l.amount, 0)
  return monthlyAmount(rule) * 12
}

/** Whether this budget is one that applies to the month being looked at.
 *  Both ends were collected and neither was consulted: a budget starting in
 *  September was compared against January's spending as readily as
 *  September's, and one that had ended never stopped. */
export function activeIn(rule: Pick<BudgetRule, 'starts' | 'ends'> | undefined, monthKey: string): boolean {
  if (!rule) return false
  if (rule.starts && monthKey < rule.starts) return false
  if (rule.ends   && monthKey > rule.ends)   return false
  return true
}

/** What this envelope is worth in a single month. The frequency was collected
 *  and then ignored: a yearly budget of 12,000 was compared against one
 *  month's spending as though it were 12,000 a month. */
export function monthlyAmount(rule?: BudgetRule, monthKey?: string): number {
  if (!rule) return 0
  const kind = scheduleOf(rule)

  if (kind === 'once') {
    if (!(rule.amount > 0)) return 0
    // With a month in hand the answer is exact: the whole amount in the month
    // it falls, nothing in any other. Without one it is the year's average,
    // which is what an envelope is "worth" over twelve months.
    if (!monthKey) return rule.amount / 12
    return rule.onDate?.slice(0, 7) === monthKey ? rule.amount : 0
  }

  if (kind === 'custom') {
    const lines = linesOf(rule)
    if (lines.length === 0) return 0
    if (!monthKey) return lines.reduce((n, l) => n + l.amount, 0) / 12
    return lines
      // A repeating set comes round every year, so only the month and day matter.
      .filter(l => rule.linesRepeat
        ? l.date.slice(5, 7) === monthKey.slice(5, 7)
        : l.date.slice(0, 7) === monthKey)
      .reduce((n, l) => n + l.amount, 0)
  }

  if (!rule.amount) return 0
  return rule.amount * (FREQ_OPTS.find(f => f.v === rule.frequency)?.per ?? 1)
}

const PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 42, boxSizing: 'border-box',
  padding: '0 14px', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body)', fontFamily: 'inherit', cursor: 'pointer', minWidth: 0,
}
const ROUND: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', cursor: 'pointer',
}
function isoToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 *  Open a native date or month picker from a control that is hiding one.
 *
 *  These two pills are a label with an invisible `<input type="month">` laid
 *  over them, so the pill can be styled like everything else here. Clicking one
 *  therefore lands inside the input's own segments — which are invisible — and
 *  the calendar itself only ever opens from the indicator, which is invisible
 *  too. So the pill looked like a button and did nothing at all. `showPicker`
 *  is the only way to ask for it; it throws where the browser will not oblige,
 *  and then focus is at least something.
 */
function openPicker(e: React.MouseEvent<HTMLElement>) {
  const input = (e.currentTarget as HTMLElement).querySelector('input')
  if (!input) return
  e.preventDefault()
  try { (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.() }
  catch { /* not allowed here — the focus below is the fallback */ }
  input.focus()
}

const LABEL: React.CSSProperties = { width: 74, flexShrink: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)', fontWeight: 500 }
const ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 }

/**
 * The instalments of a custom schedule.
 *
 * School fees are four payments, on four dates, for four different amounts.
 * Every shape this modal had before — an amount and an interval — can only say
 * one of those things, so it said the wrong one: a quarter of the year's total
 * on an evenly spaced day. These are the dates as they actually are.
 */
function LinesEditor({ rule, cur, onChange }: {
  rule: BudgetRule
  cur: string
  onChange: (r: BudgetRule) => void
}) {
  const lines = rule.lines ?? []
  const set = (next: BudgetLine[]) => onChange({ ...rule, lines: next })
  const total = linesOf(rule).reduce((n, l) => n + l.amount, 0)
  const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })

  const add = () => {
    const last = linesOf(rule).at(-1)
    const d = new Date()
    // The next one is most likely three months after the last, which is the
    // shape of every instalment plan anybody types in here.
    const seed = last
      ? new Date(Number(last.date.slice(0, 4)), Number(last.date.slice(5, 7)) - 1 + 3, Number(last.date.slice(8, 10)))
      : d
    set([...lines, {
      id: crypto.randomUUID(),
      date: `${seed.getFullYear()}-${String(seed.getMonth() + 1).padStart(2, '0')}-${String(seed.getDate()).padStart(2, '0')}`,
      amount: last?.amount ?? 0,
    }])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {lines.map((line, i) => {
        // A date that has already gone writes nothing. The ledger records what
        // is owed, and money that was due in June either moved — in which case
        // it is already an entry — or did not, which is not something a budget
        // should invent three months later. Said here, because a line sitting
        // in the list looking exactly like the others is how you end up
        // wondering where its entry went.
        const past = line.date < isoToday()
        return (
        <div key={line.id} style={{ display: 'flex', alignItems: 'center', gap: 7, opacity: past ? 0.6 : 1 }}>
          <span
            title={past ? 'This date has gone — no entry is written for it. It still counts in the total.' : undefined}
            style={{
              width: 18, flexShrink: 0, textAlign: 'right',
              fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', fontVariantNumeric: 'tabular-nums',
            }}>{past ? '✓' : i + 1}</span>
          <input
            type="date"
            value={line.date}
            onChange={e => set(lines.map(l => l.id === line.id ? { ...l, date: e.target.value } : l))}
            aria-label={`Date of instalment ${i + 1}`}
            style={{
              ...PILL, flex: '1 1 130px', minWidth: 0, cursor: 'text',
              background: 'var(--sb-field)', color: 'var(--sb-ink-1)',
              fontFamily: DISPLAY, fontSize: 'var(--sb-t-body-s)',
            }} />
          <span style={{ ...PILL, flex: '1 1 110px', minWidth: 0, cursor: 'text', background: 'var(--sb-field)', gap: 6 }}>
            <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: 'var(--sb-ink-4)', flexShrink: 0 }}>{cur}</span>
            <MoneyInput
              value={line.amount || 0}
              min={0}
              onChange={n => set(lines.map(l => l.id === line.id ? { ...l, amount: n } : l))}
              placeholder="0"
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                fontFamily: DISPLAY, fontSize: 'var(--sb-t-body)', fontWeight: 600, color: 'var(--sb-ink-1)',
                textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: 0,
              }} />
          </span>
          <button type="button" onClick={() => set(lines.filter(l => l.id !== line.id))}
            title="Remove this date"
            style={{ ...ROUND, flexShrink: 0 }}>
            <X size={ICON.sm} strokeWidth={STROKE.active} />
          </button>
        </div>
      )})}

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <button type="button" onClick={add}
          style={{ ...PILL, gap: 6, color: 'var(--sb-ink-2)', fontWeight: 600 }}>
          + Add a date
        </button>
        {lines.length > 0 && (
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
            fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)',
          }}>
            <input
              type="checkbox"
              checked={rule.linesRepeat !== false}
              onChange={e => onChange({ ...rule, linesRepeat: e.target.checked })}
              style={{ width: 16, height: 16, accentColor: 'var(--sb-positive)' }} />
            the same dates every year
          </label>
        )}
        {total > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', whiteSpace: 'nowrap' }}>
            {linesOf(rule).length} dates · {cur} {fmt(total)} a year
          </span>
        )}
      </div>
    </div>
  )
}

/** An honest dropdown. The interval was a native select under a pill, which
 *  works but does not look like anything you can press. */
function IntervalPicker({ value, onChange }: { value: Frequency; onChange: (f: Frequency) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const current = FREQ_OPTS.find(f => f.v === value) ?? FREQ_OPTS[1]
  // Whatever it is set to is always offered, even if it is not one of the four.
  const choices = FREQ_CHOICES.includes(value) ? FREQ_CHOICES : [...FREQ_CHOICES, value]

  useEffect(() => {
    if (!open) return
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  return (
    <span ref={box} style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
      <button type="button" onClick={() => setOpen(o => !o)} title="How often this budget renews"
        style={{ ...PILL, gap: 5, color: 'var(--sb-ink-3)', whiteSpace: 'nowrap' }}>
        {current.label}
        <ChevronDown size={ICON.sm} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-ink-4)' }} />
      </button>
      {open && (
        <div className="sb-blur-surface" style={{
          position: 'absolute', top: 46, right: 0, minWidth: 168, zIndex: 30, padding: 5,
          background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
          boxShadow: 'var(--sb-shadow-menu)',
        }}>
          {choices.map(v => {
            const opt = FREQ_OPTS.find(f => f.v === v)!
            const on = v === value
            return (
              <button key={v} type="button" onClick={() => { onChange(v); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 10px',
                  border: 'none', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer', fontFamily: 'inherit',
                  background: on ? 'rgba(var(--sb-accent-rgb),0.18)' : 'transparent',
                  fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', textAlign: 'left',
                }}>
                <span style={{ flex: 1 }}>{opt.label}</span>
                {on && <Check size={ICON.sm} strokeWidth={STROKE.active} style={{ color: 'var(--sb-accent-deep)' }} />}
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}

function Switch({ on, onChange, label, sub }: {
  on: boolean; onChange: (v: boolean) => void; label: string; sub: string
}) {
  return (
    <button onClick={() => onChange(!on)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 11, width: '100%', padding: '10px 0',
        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
      }}>
      <span style={{
        width: 34, height: 20, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, marginTop: 1,
        background: on ? 'var(--sb-ink-1)' : 'var(--sb-border)', position: 'relative', transition: 'background .15s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: 'var(--sb-r-pill)',
          background: 'var(--sb-card)', boxShadow: 'var(--sb-shadow-control)', transition: 'left .15s',
        }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 2 }}>{sub}</span>
      </span>
    </button>
  )
}

interface Props {
  category: Category
  /** Set when this one sits inside another — it changes what the window is
   *  for, and gives somewhere to go back to. */
  parent?: Category | null
  /** What its sub-categories are budgeted between them, per month. Where this
   *  one has no figure of its own, that is what it is measured against. */
  partsBudget?: number
  rule: BudgetRule
  subs: Category[]
  transactions: Transaction[]
  monthKey: string          // YYYY-MM
  /** True when this category has no figure of its own and its parts carry
   *  dates — the figure shown is then a year's, like theirs. */
  partsDated?: boolean
  /** Each part's own rule, so its figure is read over the span *it* is
   *  measured on rather than the one its parent happens to be. */
  subRules?: Record<string, BudgetRule | undefined>
  currency: string
  /** Only so a budget with a day can say where its money comes from. */
  accounts?: { id: string; name: string }[]
  onChange: (rule: BudgetRule) => void
  /** Clear the budget entirely, as opposed to setting it to nothing. */
  onDelete: () => void
  /** Take it out of its parent and let it stand on its own. */
  onPromote: () => void
  /** Name and icon are edited here rather than in a second window. */
  onRename: (patch: Partial<Category>) => void
  onEditCategory: () => void
  onAddSub: () => void
  onEditSub: (sub: Category) => void
  onDrill: () => void
  onClose: () => void
}

export function BudgetRuleModal({
  category, parent, partsBudget = 0, partsDated = false, rule, subs, subRules = {}, transactions, monthKey, currency, accounts = [],
  onChange, onDelete, onPromote, onRename, onEditCategory, onAddSub, onEditSub, onDrill, onClose,
}: Props) {
  const box = useRef<HTMLDivElement>(null)
  // Held locally while it is being typed, so every keystroke is not a write.
  const [name, setName] = useState(category.name)
  useEffect(() => { setName(category.name) }, [category.id, category.name])

  useEffect(() => {
    const openedAt = Date.now()
    const away = (e: Event) => {
      if (Date.now() - openedAt < 400) return
      if (box.current && !box.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [onClose])

  const payFrom = accounts.find(a => a.id === rule.dueAccountId)
  const cur = rule.currency ?? currency
  const wanted = category.txType === 'income' ? 'income' : 'expense'
  const ids = new Set([category.id, ...subs.map(s => s.id)])
  // A dated budget is measured over the year it is spread across, not against
  // one month of it — dividing four instalments into twelve equal months
  // invents a figure that never leaves the account.
  const own0 = activeIn(rule, monthKey) ? budgetTotal(rule, monthKey.slice(0, 4)) : 0
  const span = isDated(rule) || (own0 === 0 && partsDated) ? 'year' : 'month'
  const scope = span === 'year' ? monthKey.slice(0, 4) : monthKey
  // The same reading the Budget screen makes, to the letter.
  //
  // This filed by the entry's own date and counted the unpaid, while the
  // envelope behind it filed by the day the money moved and counted only what
  // had. So a fee due in August and paid on 10 September was August's here and
  // September's there: open the envelope whose ring says 135,000 and the panel
  // said nothing had been spent. Two answers to one question, and the panel had
  // the wrong one — an envelope holds what has come out of it.
  const mine = settled(transactions).filter(tx =>
    tx.type === wanted && tx.categoryId && ids.has(tx.categoryId) && whenPaid(tx).startsWith(scope))
  // Converted into what the budget is written in, so 117 USD counts against an
  // EGP envelope at what it is actually worth. Anything with no rate behind it
  // is still left out and named — a guessed rate is worse than a stated gap.
  let spent = 0
  const othersSet = new Set<string>()
  for (const tx of mine) {
    const v = toBase(Math.abs(tx.amount), tx.currency, cur)
    if (v === null) othersSet.add(tx.currency)
    else spent += v
  }
  const others = [...othersSet]

  const running = activeIn(rule, monthKey)
  const own    = running ? budgetTotal(rule, monthKey.slice(0, 4)) : 0
  // Same rule the envelope uses: its own figure where there is one, otherwise
  // what its parts add up to. Never both — that would count a split twice.
  const budget = own > 0 ? own : partsBudget
  const fromParts = own === 0 && partsBudget > 0
  const pct    = budget > 0 ? Math.min(spent / budget, 1) : 0
  const over   = budget > 0 && spent > budget
  const near   = budget > 0 && !over && rule.warn80 && spent / budget >= 0.8
  const tone   = category.txType === 'income' ? 'var(--sb-positive)' : 'var(--sb-negative)'

  const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  const monthLabel = (m: string) => new Date(m + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, padding: 18,
        background: 'var(--sb-scrim)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <div ref={box} style={{
        width: 'clamp(320px, 94vw, 440px)', maxHeight: '90vh', overflowY: 'auto',
        boxSizing: 'border-box', scrollbarWidth: 'thin',
        background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
        boxShadow: 'var(--sb-shadow-frame)', padding: '18px 20px 22px',
      }}>

        {/* Which envelope, and the way out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* The icon is the picker — a logo you have uploaded, or an emoji */}
          <IconPicker
            value={category.icon}
            onChange={icon => onRename({ icon })}
            trigger={onClick => (
              <button onClick={onClick} title="Change the icon"
                style={{
                  width: 40, height: 40, borderRadius: 'var(--sb-r-nav)', flexShrink: 0, padding: 0,
                  border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-field)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                <CategoryGlyph icon={category.icon} size={21} color="var(--sb-ink-1)" />
              </button>
            )}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <input
              autoFocus={!category.name}
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => { const n = name.trim(); if (n && n !== category.name) onRename({ name: n }); else setName(category.name) }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') { setName(category.name); (e.target as HTMLInputElement).blur() }
              }}
              placeholder="Name this category"
              title="Click to rename"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '2px 6px', marginLeft: -6,
                background: 'transparent', border: 'var(--sb-border-width) solid transparent', borderRadius: 'var(--sb-r-chip)',
                fontFamily: DISPLAY, fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em',
                color: 'var(--sb-ink-1)', outline: 'none',
              }}
              onFocus={e => { e.target.style.background = 'var(--sb-field)'; e.target.style.borderColor = 'var(--sb-border)' }}
              onBlurCapture={e => { e.target.style.background = 'transparent'; e.target.style.borderColor = 'transparent' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 1 }}>
              <span>{new Date(monthKey + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
              {parent && (
                <>
                  <span>·</span>
                  <button onClick={onPromote} title="Take it out and let it stand on its own"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                    inside {parent.name}
                  </button>
                </>
              )}
            </div>
          </div>
          <button onClick={onClose} title="Close" style={ROUND}><X size={ICON.sm} /></button>
        </div>

        {/* Where it stands this month */}
        <div style={{
          marginTop: 14, padding: '13px 15px', borderRadius: 'var(--sb-r-nav)',
          background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 'var(--sb-t-h2)', fontWeight: 700, letterSpacing: '-0.03em', color: over ? tone : 'var(--sb-ink-1)', fontVariantNumeric: 'tabular-nums' }}>
              {fmt(spent)}
            </span>
            <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
              {budget > 0
                ? `of ${cur} ${fmt(budget)} ${span === 'year' ? `across ${monthKey.slice(0, 4)}` : 'this month'}${fromParts ? ', from its sub-categories' : ''}`
                : rule.amount > 0 && !running
                  ? `budget not running this month`
                  : 'no budget set'}
            </span>
            <span style={{ flex: 1 }} />
            {spent > 0 && (
              <button onClick={onDrill}
                style={{ height: 26, padding: '0 10px', borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-positive-tint)', border: 'var(--sb-border-width) solid var(--sb-positive-tint)', color: 'var(--sb-positive)', fontSize: 'var(--sb-t-meta)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                View all →
              </button>
            )}
          </div>
          {budget > 0 && (
            <>
              <div style={{ height: 6, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-field)', marginTop: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct * 100}%`, background: over ? tone : near ? 'var(--sb-accent)' : 'var(--sb-positive)', borderRadius: 'var(--sb-r-pill)' }} />
              </div>
              <div style={{ fontSize: 'var(--sb-t-meta)', color: over ? tone : near ? 'var(--sb-accent-deep)' : 'var(--sb-ink-3)', marginTop: 7 }}>
                {over  ? `Over by ${cur} ${fmt(spent - budget)}`
                 : near ? `${cur} ${fmt(budget - spent)} left — past 80%`
                        : `${cur} ${fmt(budget - spent)} left`}
              </div>
            </>
          )}
        </div>

        {others.length > 0 && (
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 8, lineHeight: 1.5 }}>
            {others.join(' and ')} spending in this category is not counted — there are no
            exchange rates here, so only {cur} is measured against a {cur} budget.
          </div>
        )}

        <div style={{ height: 1, background: 'var(--sb-hairline)', margin: '18px 0' }} />

        {/* The budget itself: one number, and how often it renews */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* How the money is laid out. A budget that is one payment, or four
              dated instalments, could only be typed here as an average before —
              and an average is the one thing it is not. */}
          <div style={ROW}>
            <span style={LABEL}>Shape</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 7 }}>
              {([
                ['repeat', 'Every…', 'The same amount, again and again'],
                ['once',   'Once',   'One payment, on one date'],
                ['custom', 'Set dates', 'Each instalment on its own date, for its own amount'],
              ] as const).map(([v, label, title]) => {
                const on = scheduleOf(rule) === v
                return (
                  <button key={v} type="button" title={title}
                    onClick={() => onChange({
                      ...rule,
                      schedule: v,
                      // Moving to dates of its own means the day-of-the-month no
                      // longer says anything, and leaving it set would write a
                      // second entry every month beside the instalments.
                      ...(v === 'custom' ? { dueDay: undefined, lines: rule.lines ?? [] } : {}),
                      ...(v === 'once' ? { dueDay: undefined, onDate: rule.onDate ?? isoToday() } : {}),
                    })}
                    style={{
                      ...PILL, flex: 1, justifyContent: 'center',
                      background: on ? 'var(--sb-ink-1)' : 'var(--sb-card)',
                      border: on ? 'none' : 'var(--sb-border-width) solid var(--sb-border)',
                      color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                      fontWeight: on ? 600 : 500,
                    }}>{label}</button>
                )
              })}
            </span>
          </div>

          {scheduleOf(rule) === 'custom' ? (
            <div style={{ ...ROW, alignItems: 'flex-start' }}>
              <span style={{ ...LABEL, paddingTop: 11 }}>Dates</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <LinesEditor rule={rule} cur={cur} onChange={onChange} />
              </span>
            </div>
          ) : (
          <div style={ROW}>
            <span style={LABEL}>Budget</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 7 }}>
              <span style={{
                ...PILL, flex: 1, cursor: 'text', gap: 8,
                background: 'var(--sb-field)',
              }}>
                <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                  <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, color: 'var(--sb-ink-3)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {cur}<ChevronDown size={ICON.sm} strokeWidth={STROKE.active} style={{ color: 'var(--sb-ink-4)' }} />
                  </span>
                  <select value={cur} onChange={e => onChange({ ...rule, currency: e.target.value })}
                    title="What this budget is in"
                    style={{ position: 'absolute', inset: -6, opacity: 0, width: 'calc(100% + 12px)', height: 'calc(100% + 12px)', cursor: 'pointer', border: 'none' }}>
                    {['EGP', 'USD', 'AED'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </span>
                <MoneyInput
                  value={rule.amount || 0}
                  min={0}
                  onChange={n => onChange({ ...rule, amount: n })}
                  placeholder="0"
                  style={{
                    flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                    fontFamily: DISPLAY, fontSize: 'var(--sb-t-h2)', fontWeight: 600, color: 'var(--sb-ink-1)',
                    textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: 0,
                  }} />
              </span>
              {scheduleOf(rule) === 'once' ? (
                <input
                  type="date"
                  value={rule.onDate ?? ''}
                  onChange={e => onChange({ ...rule, onDate: e.target.value || undefined })}
                  title="The day this payment falls"
                  aria-label="The day this payment falls"
                  style={{
                    ...PILL, flexShrink: 0, cursor: 'text', background: 'var(--sb-field)',
                    color: 'var(--sb-ink-1)', fontFamily: DISPLAY, fontSize: 'var(--sb-t-body-s)',
                  }} />
              ) : (
                <IntervalPicker value={rule.frequency} onChange={f => onChange({ ...rule, frequency: f })} />
              )}
            </span>
          </div>
          )}

          {fromParts && (
            <div style={{ ...ROW, marginTop: -4 }}>
              <span style={LABEL} />
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
                Its sub-categories are budgeted {cur} {fmt(partsBudget)} between them.
                A figure here replaces that rather than adding to it.
              </span>
            </div>
          )}

          {budget > 0 && (scheduleOf(rule) !== 'repeat' || rule.frequency !== 'monthly') && (
            <div style={{ ...ROW, marginTop: -4 }}>
              <span style={LABEL} />
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
                {scheduleOf(rule) === 'repeat'
                  ? `${cur} ${fmt(budget)} a month, which is what the envelope is measured against`
                  : `${cur} ${fmt(budget)} in total across ${linesOf(rule).length || 1} `
                    + `${(linesOf(rule).length || 1) === 1 ? 'date' : 'dates'} — measured over the whole year, `
                    + `not divided into months it never leaves in`}
              </span>
            </div>
          )}

          <div style={ROW}>
            <span style={LABEL}>Type</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 7 }}>
              {([['expense', 'Spending'], ['income', 'Earning']] as const).map(([v, label]) => {
                const on = (category.txType === 'income') === (v === 'income')
                return (
                  <button key={v} onClick={() => onRename({ txType: v })}
                    style={{
                      ...PILL, flex: 1, justifyContent: 'center',
                      background: on ? (v === 'income' ? 'var(--sb-positive)' : 'var(--sb-negative)') : 'var(--sb-card)',
                      border: on ? 'none' : 'var(--sb-border-width) solid var(--sb-border)',
                      color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                      fontWeight: on ? 600 : 400,
                    }}>{label}</button>
                )
              })}
            </span>
          </div>

          {/* Four across one line. Two 42px pills had the room for whole words;
              four do not, so these are short labels with the real name in the
              title, a smaller pill, and a dot in the bucket's own colour — the
              same colour the Budget header splits the month by, so the pill and
              the bar are recognisably the same four things. They wrap rather
              than crush below about 370px. */}
          {/* The label is narrowed for this row alone. Four pills need every
              pixel of a 320px modal, "Kind" is four letters, and the caption
              under them names the one that is chosen anyway. */}
          <div style={{ ...ROW, gap: 8 }}>
            <span style={{ ...LABEL, width: 44 }}>Kind</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {BUCKETS.map(b => {
                const on = bucketOf(rule) === b.id
                return (
                  <button key={b.id} onClick={() => onChange({ ...rule, bucket: b.id, fixedType: undefined })}
                    title={`${b.name} — ${b.help}`}
                    style={{
                      ...PILL, flex: '1 1 auto', justifyContent: 'center', gap: 4,
                      height: 34, padding: '0 7px', minWidth: 0,
                      fontSize: 'var(--sb-t-meta)', whiteSpace: 'nowrap',
                      background: on ? 'var(--sb-ink-1)' : 'var(--sb-card)',
                      border: on ? 'none' : 'var(--sb-border-width) solid var(--sb-border)',
                      color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                      fontWeight: on ? 600 : 400,
                    }}>
                    <span aria-hidden style={{
                      width: 7, height: 7, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
                      background: b.color, opacity: on ? 1 : 0.75,
                    }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.short}</span>
                  </button>
                )
              })}
            </span>
          </div>
          <p style={{ margin: '-2px 0 0 52px', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
            {bucketMeta(bucketOf(rule)).name} — {bucketMeta(bucketOf(rule)).help}
          </p>

          {/* When the money actually has to move. A budget on its own is an
              allowance for the month; a rent is a day. The other two shapes
              carry their own dates, so asking for one here would write a second
              entry every month beside the instalments. */}
          {scheduleOf(rule) === 'repeat' && (<>
          <div style={ROW}>
            <span style={LABEL}>Paid on</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
              <label style={{ ...PILL, flex: 1, position: 'relative', justifyContent: 'center' }}
                title="The day of the month it leaves. A month too short for it takes its last day.">
                <span style={{ color: rule.dueDay ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>
                  {rule.dueDay ? `the ${ordinal(rule.dueDay)}` : 'no fixed day'}
                </span>
                <select
                  value={rule.dueDay ?? ''}
                  onChange={e => onChange({
                    ...rule,
                    dueDay: e.target.value ? Number(e.target.value) : undefined,
                    // A day needs somewhere for the money to come from, and
                    // the first account is a visible answer rather than a
                    // silent one — it is named in the pill beside it.
                    dueAccountId: e.target.value ? (rule.dueAccountId ?? accounts[0]?.id) : rule.dueAccountId,
                  })}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
                  <option value="">no fixed day</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>the {ordinal(d)}</option>
                  ))}
                </select>
              </label>
              {rule.dueDay != null && (
                <>
                  <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', flexShrink: 0 }}>from</span>
                  <label style={{ ...PILL, flex: 1, position: 'relative', justifyContent: 'center' }}
                    title="The account the money leaves. The entry is filed against it.">
                    <span style={{
                      color: payFrom ? 'var(--sb-ink-1)' : 'var(--sb-negative)', minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{payFrom?.name ?? 'which account?'}</span>
                    <select value={rule.dueAccountId ?? ''}
                      onChange={e => onChange({ ...rule, dueAccountId: e.target.value || undefined })}
                      style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
                      <option value="">which account?</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                  <button onClick={() => onChange({ ...rule, dueDay: undefined })}
                    title="No particular day" style={{ ...ROUND, width: 26, height: 26 }}><X size={ICON.sm} /></button>
                </>
              )}
            </span>
          </div>
          {rule.dueDay != null && (
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.5, margin: '-2px 0 8px' }}>
              An entry is written for that day, {freqPhrase(rule.frequency)}, marked
              unpaid until you tick it — so it is owed rather than spent, and in no
              balance or total until the money moves.
            </div>
          )}
          </>)}

          {scheduleOf(rule) !== 'repeat' && (
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.5, margin: '-2px 0 8px' }}>
              {scheduleOf(rule) === 'once'
                ? 'One entry is written for that date, marked unpaid until you tick it.'
                : `An entry is written for each date above, for its own amount, marked unpaid `
                  + `until you tick it${rule.linesRepeat !== false ? ' — and the same dates come round next year' : ''}.`}
              {' '}Until then it is owed rather than spent, and in no balance or total.
            </div>
          )}

          <div style={ROW}>
            <span style={LABEL}>Runs</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
              <label onClick={openPicker}
                style={{ ...PILL, flex: 1, position: 'relative', justifyContent: 'center' }}
                title="First month this budget applies to">
                {rule.starts ? monthLabel(rule.starts) : 'every month'}
                <input type="month" value={rule.starts ?? ''}
                  onChange={e => onChange({ ...rule, starts: e.target.value || undefined })}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
              </label>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', flexShrink: 0 }}>to</span>
              <label onClick={openPicker}
                style={{ ...PILL, flex: 1, position: 'relative', justifyContent: 'center' }}
                title="Last month it applies to">
                <span style={{ color: rule.ends ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>{rule.ends ? monthLabel(rule.ends) : 'no end'}</span>
                <input type="month" value={rule.ends ?? ''} min={rule.starts}
                  onChange={e => onChange({ ...rule, ends: e.target.value || undefined })}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
              </label>
              {rule.ends && (
                <button onClick={() => onChange({ ...rule, ends: undefined })} title="Let it run on"
                  style={{ ...ROUND, width: 26, height: 26 }}><X size={ICON.sm} /></button>
              )}
            </span>
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--sb-hairline)', margin: '14px 0 4px' }} />

        <Switch on={rule.rollover} onChange={v => onChange({ ...rule, rollover: v })}
          label="Roll unspent into next month" sub="Underspend carries, overspend does not" />
        <Switch on={rule.warn80} onChange={v => onChange({ ...rule, warn80: v })}
          label="Warn at 80%" sub="A quiet nudge here, not a block" />

        {/* Its children, if it can have any. One level of nesting is all this
            models, so a sub-category is offered none. */}
        {!parent && (<>
        <div style={{ height: 1, background: 'var(--sb-hairline)', margin: '14px 0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: subs.length ? 8 : 0 }}>
          <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)' }}>
            SUB-CATEGORIES
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={onAddSub} style={{ ...PILL, height: 28, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>+ Add</button>
        </div>
        {subs.map(sub => {
          const subSpend = settled(transactions)
            .filter(tx => tx.categoryId === sub.id
              && whenPaid(tx).startsWith(isDated(subRules[sub.id]) ? monthKey.slice(0, 4) : monthKey))
            .reduce((s, tx) => s + (toBase(Math.abs(tx.amount), tx.currency, cur) ?? 0), 0)
          return (
            <button key={sub.id} onClick={() => onEditSub(sub)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 0',
                background: 'none', border: 'none', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}>
              <CategoryGlyph icon={sub.icon} size={15} color="var(--sb-ink-3)" />
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.name}</span>
              {subSpend > 0 && (
                <span style={{ fontFamily: DISPLAY, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: tone, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(subSpend)}
                </span>
              )}
            </button>
          )
        })}

        </>)}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <Button variant="primary" onClick={onClose} block>
            <Check size={ICON.sm} strokeWidth={STROKE.active} /> Done
          </Button>
          <button onClick={onEditCategory} title="Colour, type, parent, delete"
            style={{ ...PILL, color: 'var(--sb-ink-3)' }}>More…</button>
        </div>
        <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 10, textAlign: 'center' }}>
          Name, icon and budget save as you change them
        </div>

        {rule.amount > 0 && (
          <button
            onClick={() => { onDelete(); onClose() }}
            title="Remove the budget — the category and its transactions stay"
            style={{
              marginTop: 12, width: '100%', height: 'var(--sb-h-pill)', borderRadius: 'var(--sb-r-sm)',
              background: 'none', border: 'none', fontFamily: 'inherit',
              color: 'var(--sb-negative)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer',
            }}>
            Remove this budget
          </button>
        )}
      </div>
    </div>
  )
}

