// ─── What a card earns, and what that is worth ───────────────────────────────
//
//  A rewards card pays you back for spending on it, and the app knew nothing
//  about it: the ledger recorded 40,000 leaving and no part of the app could
//  say that 400 of it came back. That is not a rounding error over a year.
//
//  Two figures make the whole of it, and they are two because banks state them
//  separately and each moves on its own:
//
//    **earn**    — points per 1 of the card's currency spent, per channel.
//    **value**   — what one point is worth in that currency when redeemed.
//
//  Multiply and you have the return: `1 point per 10 EGP` at `0.50 EGP a point`
//  is 5%. Stating it as one blended percentage instead would be tidier and
//  wrong, because the bank changes one of the two at a time and you would have
//  no way to correct the one that moved.
//
//  Four rules hold this file together:
//
//  - **Nothing is invented.** A scheme with no figures is *dormant*: it says
//    what it is missing and contributes nothing, exactly as a forecast rule
//    does. There is no default earn rate, because a made-up one produces a
//    made-up figure in EGP on a screen full of real ones.
//  - **A looked-up figure is a suggestion until you say otherwise.** The model
//    is asked what a bank's programme pays; what comes back is marked
//    `suggested` and every screen says so. A figure you type is `yours` and
//    nothing overwrites it — not a later lookup, not a different device.
//  - **Cash never earns.** Not a low rate, not a capped one: zero, and not
//    editable. A cash advance on a credit card is a loan at the card's own
//    rate from the hour it is taken, which is the opposite of a reward, and
//    `isCashUse` is what the rest of the app asks to keep such an account out
//    of anything that treats a card as money.
//  - **Points are not cash.** What they are worth is worth knowing and is never
//    added to a balance, a capacity, a goal or a plan. See `goalPlan.ts`.

import type { Account, Currency, Transaction } from './types'
import { toBase } from './fx'
import { settled, whenPaid } from './unpaid'

/** Where the money was spent. The three the banks themselves distinguish. */
export type SpendChannel = 'pos' | 'online' | 'cash'

export const CHANNEL_LABEL: Record<SpendChannel, string> = {
  pos:    'In person',
  online: 'Online',
  cash:   'Cash',
}

/** Where each figure came from. A screen that cannot tell these apart is a
 *  screen that presents a guess as a measurement. */
export type RewardSource =
  /** You typed it. Nothing overwrites it. */
  | 'yours'
  /** Looked up from the bank's programme. Shown, and marked as unconfirmed. */
  | 'suggested'

export interface RewardScheme {
  /** Points per 1 unit of the card's own currency, by channel. `cash` is
   *  absent by construction — it is not a rate anybody may set. */
  earn: { pos: number; online: number }
  /** Money per point, in the card's currency. */
  pointValue: number
  /** The most points this card earns in a month. 0 or absent is no ceiling. */
  monthlyCap?: number
  /** Months before unredeemed points lapse. 0 or absent is never. */
  expiryMonths?: number
  /** Points already in the account that the ledger cannot know about — what
   *  the bank's statement says you are holding today. */
  openingPoints?: number
  source: RewardSource
  /** The programme's own name, where it has one ("Meeza Rewards"). */
  programme?: string
  /** What the lookup said, in a sentence, so the figures can be argued with. */
  note?: string
  /** ISO date the lookup ran. A scheme nobody has checked in two years is
   *  worth saying so about. */
  checkedAt?: string
}

/** The scheme's own arithmetic in one figure: what a unit spent comes back as,
 *  0..1. `null` where the scheme cannot say. */
export function returnRate(s: RewardScheme | null, channel: 'pos' | 'online'): number | null {
  if (!s) return null
  const earn = s.earn[channel]
  if (!isFinite(earn) || earn <= 0 || !isFinite(s.pointValue) || s.pointValue <= 0) return null
  return earn * s.pointValue
}

/** A scheme with nothing to say. Kept as a value rather than as `null` so a
 *  card can be marked as having a programme whose figures are not in yet. */
export function isDormant(s: RewardScheme | null | undefined): boolean {
  if (!s) return true
  const any = s.earn.pos > 0 || s.earn.online > 0
  return !any || !(s.pointValue > 0)
}

/** What a dormant scheme is waiting for, named. Never a silent zero. */
export function dormantWhy(s: RewardScheme | null | undefined): string {
  if (!s) return 'No rewards programme is set for this card.'
  if (!(s.earn.pos > 0 || s.earn.online > 0)) return 'No earn rate has been given — how many points per unit spent?'
  if (!(s.pointValue > 0)) return 'No point value has been given — what is one point worth?'
  return ''
}

// ─── Where the schemes live ──────────────────────────────────────────────────
//
//  `finance_accounts` has no column for any of this and adding one would be a
//  migration per field. It rides in localStorage beside the other things the
//  finance screens keep there (`finance-credit-limits`, `finance-transfer-
//  targets`) and syncs through `prefSync`, so it follows you between devices.

const KEY = 'finance-card-rewards'

type Store = Record<string, RewardScheme>

function load(): Store {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Store
  } catch { return {} }
}

function save(s: Store): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent('finance:cardRewardsChanged'))
}

export function schemeFor(accountId: string): RewardScheme | null {
  return load()[accountId] ?? null
}

export function allSchemes(): Store { return load() }

export function setScheme(accountId: string, scheme: RewardScheme | null): void {
  const all = load()
  if (scheme) all[accountId] = scheme
  else delete all[accountId]
  save(all)
}

// ─── The overall settings ────────────────────────────────────────────────────
//
//  One place for the things that are true of every card rather than of one:
//  whether to draw points as money at all, and the value to assume for a card
//  whose own programme has not been filled in. That second one is deliberately
//  **absent by default** — see "nothing is invented" above. Setting it is a
//  decision somebody makes; it is not a number the app picks for them.

export interface RewardSettings {
  /** Draw the money value of points beside the points themselves. */
  showAsMoney: boolean
  /** A point's worth where a card's own scheme does not say, in the base
   *  currency. 0 means "no answer", which is what it starts as. */
  defaultPointValue: number
  /** Count points earned only from the start of this month, this year, or from
   *  everything loaded. A year is what a statement talks about. */
  window: 'month' | 'year'
}

const SETTINGS_KEY = 'finance-rewards-settings'

export const DEFAULT_REWARD_SETTINGS: RewardSettings = {
  showAsMoney: true,
  defaultPointValue: 0,
  window: 'year',
}

export function loadRewardSettings(): RewardSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<RewardSettings> | null
    return raw ? { ...DEFAULT_REWARD_SETTINGS, ...raw } : DEFAULT_REWARD_SETTINGS
  } catch { return DEFAULT_REWARD_SETTINGS }
}

export function saveRewardSettings(s: RewardSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent('finance:cardRewardsChanged'))
}

// ─── Which transactions earned anything ──────────────────────────────────────

/**
 * Cash use of a card — the one thing a rewards card must never be treated as.
 *
 * A transfer **out of** a card is a cash advance: the bank hands over money at
 * the card's own interest rate from the hour it is taken, with no grace period
 * and usually a fee on top. It earns nothing, and it is the shape of every
 * "use the card as savings" mistake this module exists to stop.
 *
 * A transfer *into* a card is the opposite — paying it off — and is fine.
 */
export function isCashUse(tx: Transaction, cardIds: Set<string>): boolean {
  if (tx.type !== 'transfer') return false
  return cardIds.has(tx.accountId)
}

/** The channel a card purchase was made through.
 *
 *  Stored per entry rather than inferred: a category cannot tell a card tapped
 *  in a shop from the same shop's website, and a rate that differs by channel
 *  applied to a guess about the channel is a figure nobody can check. Absent,
 *  it is `pos` — the ordinary case, and the one the entry panel offers to
 *  change in a tap. */
const CHANNEL_KEY = 'finance-tx-channels'

function loadChannels(): Record<string, SpendChannel> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHANNEL_KEY) ?? '{}') as unknown
    return (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, SpendChannel>
  } catch { return {} }
}

export function channelOf(txId: string): SpendChannel {
  return loadChannels()[txId] ?? 'pos'
}

export function setChannel(txId: string, channel: SpendChannel | null): void {
  const all = loadChannels()
  if (channel && channel !== 'pos') all[txId] = channel
  else delete all[txId]
  try { localStorage.setItem(CHANNEL_KEY, JSON.stringify(all)) } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent('finance:cardRewardsChanged'))
}

export interface CardPoints {
  accountId: string
  /** Points earned inside the window, from the ledger. */
  earned: number
  /** …plus whatever the statement said you were already holding. */
  total: number
  /** `total` in the card's own currency, or null where nothing can say. */
  worth: number | null
  /** The spend the points were earned on, by channel, in the card's currency. */
  spend: { pos: number; online: number }
  /** Cash taken on the card inside the window. It earns nothing and is called
   *  out rather than quietly left out. */
  cashUse: number
  /** Points not earned because the monthly ceiling was reached. */
  cappedAway: number
  /** Why there is no figure, where there is none. */
  dormant: string
}

/**
 * What a card has earned, out of the ledger.
 *
 * Only what has actually been paid counts — `settled` — and it is filed by the
 * day the money moved, `whenPaid`, which is what every other figure in this app
 * does. An entry dated ahead is a plan; a bank does not award points for one.
 */
export function pointsFor(
  account: Account,
  transactions: Transaction[],
  scheme: RewardScheme | null,
  opts: { window?: 'month' | 'year'; today?: Date } = {},
): CardPoints {
  const today = opts.today ?? new Date()
  const win = opts.window ?? 'year'
  const from = win === 'month'
    ? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    : `${today.getFullYear()}`

  const out: CardPoints = {
    accountId: account.id, earned: 0, total: 0, worth: null,
    spend: { pos: 0, online: 0 }, cashUse: 0, cappedAway: 0,
    dormant: dormantWhy(scheme),
  }

  const cardIds = new Set([account.id])
  // Per month, so a monthly ceiling can be applied to the month it belongs to
  // rather than to the whole window — a cap of 5,000 a month is not a cap of
  // 5,000 a year, and applying it as one would understate a heavy December.
  const byMonth = new Map<string, { pos: number; online: number }>()

  for (const tx of settled(transactions)) {
    if (tx.accountId !== account.id) continue
    const on = whenPaid(tx)
    if (!on.startsWith(from)) continue

    if (isCashUse(tx, cardIds)) {
      const v = toBase(Math.abs(tx.amount), tx.currency, account.currency)
      if (v !== null) out.cashUse += v
      continue
    }
    // Money coming back — a refund, or the card being paid off — is not spend.
    if (tx.type !== 'expense') continue

    const v = toBase(Math.abs(tx.amount), tx.currency, account.currency)
    if (v === null) continue
    const ch = channelOf(tx.id)
    if (ch === 'cash') { out.cashUse += v; continue }

    out.spend[ch] += v
    const month = on.slice(0, 7)
    const bucket = byMonth.get(month) ?? { pos: 0, online: 0 }
    bucket[ch] += v
    byMonth.set(month, bucket)
  }

  if (isDormant(scheme) || !scheme) return out

  for (const spend of byMonth.values()) {
    const raw = spend.pos * scheme.earn.pos + spend.online * scheme.earn.online
    const cap = scheme.monthlyCap && scheme.monthlyCap > 0 ? scheme.monthlyCap : Infinity
    const kept = Math.min(raw, cap)
    out.earned += kept
    out.cappedAway += raw - kept
  }

  out.total = out.earned + Math.max(0, scheme.openingPoints ?? 0)
  out.worth = scheme.pointValue > 0 ? out.total * scheme.pointValue : null
  return out
}

/** Every card with a scheme, summed. Used by the Balances header and by the
 *  settings block, which both want one figure rather than a list. */
export function totalPoints(
  accounts: Account[],
  transactions: Transaction[],
  opts: { window?: 'month' | 'year'; today?: Date } = {},
): { rows: CardPoints[]; worthInBase: number | null; noRate: Currency[] } {
  const rows: CardPoints[] = []
  const noRate = new Set<Currency>()
  let worth: number | null = null

  for (const a of accounts) {
    if (a.accountType !== 'credit_card') continue
    const scheme = schemeFor(a.id)
    if (!scheme) continue
    const p = pointsFor(a, transactions, scheme, opts)
    rows.push(p)
    if (p.worth === null) continue
    const inBase = toBase(p.worth, a.currency)
    // Never fall back to the raw figure: adding 900 USD-worth of points to an
    // EGP total as 900 is the one mistake `fx.ts` exists to stop.
    if (inBase === null) { noRate.add(a.currency); continue }
    worth = (worth ?? 0) + inBase
  }
  return { rows, worthInBase: worth, noRate: [...noRate] }
}
