// ─── Expenses, from the meeting ──────────────────────────────────────────────
//
// Money spent on the way to, or at, a meeting is the thing most easily lost: a
// taxi, a lunch, parking. This box files it in the ledger without leaving the
// window, under four rules that all come from how Finance already works.
//
// **An expense made here is a draft — an unpaid entry — until you confirm it.**
// An entry with no payment date is money still owed, so it is kept out of every
// balance, envelope and report (`unpaid.ts`) and drawn dotted in the feeds. A
// figure typed into a calendar window is a guess about money, and a guess does
// not belong in a balance; confirming is one press, and the same gesture the
// ledger already uses for "paid".
//
// **The lock still stands.** Finance is behind a lock because a browser left
// open is read over your shoulder, and this window would be a way round it: the
// budget left and the unpaid bills are exactly what the lock hides. Locked, the
// box says so and asks for the same password or device check — in place.
//
// **A module that is off is not drawn** — and was never loaded, so there would
// be nothing to show anyway.
//
// **No figure is claimed that cannot be checked.** "Left in the envelope" is
// said only for a plain monthly budget in force that month and only when every
// entry converts; a dated budget, a missing rate or no budget says nothing,
// because a wrong "left" is worse than none.

import { useEffect, useMemo, useState } from 'react'
import { Banknote, Check, Lock, Pencil, Link as LinkIcon } from 'lucide-react'
import { useFinanceStore } from '@/modules/finance/financeStore'
import { MoneyInput } from '@/modules/finance/components/MoneyInput'
import { group } from '@/modules/finance/format'
import { isUnpaid, settled, whenPaid } from '@/modules/finance/unpaid'
import { loadRules, activeIn, monthlyAmount, isDated } from '@/modules/finance/modals/BudgetRuleModal'
import { txIn } from '@/modules/finance/txRates'
import { ruleAt } from '@/modules/finance/budgetSteps'
import { baseCurrency } from '@/modules/finance/fx'
import {
  biometricName, checkPassword, loadLock, loadPasskey, markActive, verifyPasskey,
} from '@/modules/finance/lock'
import { useFinanceLock } from '@/modules/finance/useFinanceLock'
import type { Transaction } from '@/modules/finance/types'
import type { DynamicCompany } from '@/types'
import { moduleIsOff } from '@/lib/entitlements'
import { ICON } from '@/lib/type'
import {
  addOutcomeLink, removeOutcomeLink, linksForEvent, linksForRecord, subscribeOutcomeLinks,
} from '@/lib/meetingOutcomes'
import { OutcomeBox, EYEBROW, FIELD, chip, ymd, fromYmd, type OutcomeEvent } from './shared'

const TINT = 'var(--sb-positive)'
const MEMORY_KEY = 'outcome-expense-memory'

/** What you filed last time for this company: a convenience of this device, so
 *  the next taxi opens on the account and category the last one used. */
interface Memory { accountId?: string; categoryId?: string }
const loadMemory = (): Record<string, Memory> => {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '{}') as Record<string, Memory> } catch { return {} }
}
const saveMemory = (key: string, m: Memory) => {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify({ ...loadMemory(), [key]: m })) } catch { /* quota */ }
}

const daysApart = (a: string, b: string) => Math.abs(fromYmd(a).getTime() - fromYmd(b).getTime()) / 86400000
const money = (n: number) => group(n, Number.isInteger(n) ? 0 : 2)
const dayLabel = (d: string) => fromYmd(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** The envelope for a category this month, or null when nothing true can be
 *  said. Own budget first, then the parent's (a sub-category is counted inside
 *  its parent's envelope, with its siblings). */
function envelopeFor(
  categoryId: string | undefined, monthKey: string,
  categories: { id: string; name: string; parentId?: string }[], txs: Transaction[],
): { name: string; left: number; budget: number; cur: string } | null {
  if (!categoryId) return null
  const rules = loadRules()
  const own = categories.find(c => c.id === categoryId)
  const chain = [own, own?.parentId ? categories.find(c => c.id === own.parentId) : undefined].filter(Boolean) as typeof categories
  for (const cat of chain) {
    const rule = rules[cat.id]
    if (!rule || isDated(rule) || !activeIn(rule, monthKey)) continue
    const budget = monthlyAmount(rule, monthKey)
    if (!(budget > 0)) continue
    const cur = ruleAt(rule, monthKey).currency ?? baseCurrency()
    const ids = new Set([cat.id, ...categories.filter(c => c.parentId === cat.id).map(c => c.id)])
    let spent = 0
    for (const t of settled(txs)) {
      if (t.type !== 'expense' || !t.categoryId || !ids.has(t.categoryId)) continue
      if (whenPaid(t).slice(0, 7) !== monthKey) continue
      const v = txIn(t, cur)
      if (v === null) return null // a rate nobody gave: say nothing rather than add it wrong
      spent += v
    }
    return { name: cat.name, left: budget - spent, budget, cur }
  }
  return null
}

// ─── Locked ──────────────────────────────────────────────────────────────────

export function Unlock({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const passkey = loadPasskey()

  async function byPassword() {
    setBusy(true); setError(null)
    try {
      if (await checkPassword(pw, loadLock())) { setPw(''); onDone() }
      else setError('That is not the password.')
    } finally { setBusy(false) }
  }
  async function byDevice() {
    setBusy(true); setError(null)
    try {
      if (await verifyPasskey()) onDone()
      else setError('That did not check out. Use your password.')
    } catch { setError(`${biometricName()} could not be used here. Use your password.`) }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); void byPassword() }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
        Finance is locked, and this is part of Finance. Unlock it the same way — nothing about your money shows until you do.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="password" autoComplete="current-password" aria-label="Finance password"
          value={pw} onChange={e => setPw(e.target.value)} placeholder="Finance password"
          style={{ ...FIELD, flex: '1 1 220px', height: 48, borderRadius: 'var(--sb-r-nav)' }} />
        <button type="submit" disabled={busy || !pw} style={{
          height: 48, padding: '0 18px', borderRadius: 'var(--sb-r-nav)', border: 'none', cursor: pw ? 'pointer' : 'default',
          background: 'var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)', fontFamily: 'inherit', fontWeight: 700,
          fontSize: 'var(--sb-t-body-s)', opacity: pw ? 1 : 0.45,
        }}>Unlock</button>
        {passkey && (
          <button type="button" onClick={() => void byDevice()} disabled={busy} style={{ ...chip(), height: 48, borderRadius: 'var(--sb-r-nav)' }}>
            Use {biometricName()}
          </button>
        )}
      </div>
      {error && <span role="alert" style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative-deep)' }}>{error}</span>}
    </form>
  )
}

// ─── One entry ───────────────────────────────────────────────────────────────

function ExpenseRow({ tx, accountName, categoryName, accounts, categories, linkedHere, madeHere, editing,
  onConfirm, onUnconfirm, onEdit, onUndoMade, onChange }: {
  tx: Transaction
  accountName: string
  categoryName: string
  accounts: { id: string; name: string }[]
  categories: { id: string; name: string }[]
  linkedHere: boolean
  madeHere: boolean
  editing: boolean
  onConfirm: () => void
  onUnconfirm: () => void
  onEdit: () => void
  onUndoMade: () => void
  onChange: (patch: Partial<Transaction>) => void
}) {
  const unpaid = isUnpaid(tx)
  const elsewhere = linksForRecord('expense', tx.id)[0]
  const [payee, setPayee] = useState(tx.payee)
  useEffect(() => setPayee(tx.payee), [tx.payee])
  // `MoneyInput` commits the value its parent holds, so the parent has to be
  // holding what was typed — a fixed value commits the old amount on blur.
  const [amt, setAmt] = useState(Math.abs(tx.amount))
  useEffect(() => setAmt(Math.abs(tx.amount)), [tx.amount])

  return (
    <div
      data-outcome-expense={tx.id}
      data-draft={unpaid ? '1' : '0'}
      data-editing={editing ? '1' : '0'}
      style={{
        borderRadius: 'var(--sb-r-nav)', padding: '0 12px', display: 'flex', flexDirection: 'column',
        background: unpaid ? 'var(--sb-card)' : 'var(--sb-positive-tint)',
        border: `var(--sb-border-width) ${unpaid ? 'dotted' : 'solid'} ${editing ? 'var(--sb-ink-1)' : unpaid ? 'var(--sb-negative)' : 'var(--sb-border)'}`,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 56 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--sb-t-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tx.payee || 'Expense'}
          </div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            {[dayLabel(tx.date), categoryName, accountName].filter(Boolean).join(' · ')}
          </div>
        </div>
        <b style={{ fontSize: 'var(--sb-t-body)' }}>{tx.currency} {money(Math.abs(tx.amount))}</b>
        {unpaid
          ? <span title="Not paid — kept out of every balance and budget until confirmed" style={{
              fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              color: 'var(--sb-negative-deep)', background: 'var(--sb-negative-tint)', borderRadius: 'var(--sb-r-pill)', padding: '3px 9px',
            }}>Draft</span>
          : linkedHere && <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-positive-deep)' }}>Confirmed · linked</span>}
        {linkedHere ? (
          <span title="Linked to this meeting" style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--sb-t-meta)', fontWeight: 600,
            color: 'var(--sb-ink-1)', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-pill)', padding: '3px 9px',
          }}><LinkIcon size={12} />this meeting</span>
        ) : elsewhere ? (
          <span style={{
            fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', background: 'var(--sb-field)',
            borderRadius: 'var(--sb-r-pill)', padding: '3px 9px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>from {elsewhere.eventTitle}</span>
        ) : null}
        {unpaid && (
          <button onClick={onConfirm} aria-label={`Confirm: ${tx.payee || 'expense'}`}
            style={{ ...chip(), background: 'var(--sb-positive)', color: 'var(--sb-ink-on-fill)', border: 'none', fontWeight: 700 }}>
            <Check size={14} strokeWidth={3} />Confirm
          </button>
        )}
        {madeHere && <button onClick={onUndoMade} style={chip()}>Undo</button>}
        {!unpaid && !madeHere && linkedHere && <button onClick={onUnconfirm} style={chip()}>Undo</button>}
        <button onClick={onEdit} aria-label={`${editing ? 'Close' : 'Edit'} ${tx.payee || 'expense'}`} aria-expanded={editing}
          style={{ ...chip(editing), width: 36, padding: 0, justifyContent: 'center' }}>
          <Pencil size={ICON.sm} />
        </button>
      </div>

      {editing && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, padding: '2px 0 12px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            What it was
            <input aria-label="What it was" value={payee} onChange={e => setPayee(e.target.value)}
              onBlur={() => { if (payee !== tx.payee) onChange({ payee }) }}
              style={{ ...FIELD, width: '100%' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            Amount ({tx.currency})
            <MoneyInput value={amt} onChange={setAmt}
              onCommit={n => { if (n > 0 && n !== Math.abs(tx.amount)) onChange({ amount: n }); else setAmt(Math.abs(tx.amount)) }}
              style={{ ...FIELD, width: '100%' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            Category
            <select aria-label="Category" value={tx.categoryId ?? ''} onChange={e => onChange({ categoryId: e.target.value || undefined })}
              style={{ ...FIELD, width: '100%' }}>
              <option value="">None</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            Paid from
            <select aria-label="Paid from" value={tx.accountId} onChange={e => onChange({ accountId: e.target.value })}
              style={{ ...FIELD, width: '100%' }}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

// ─── The box ─────────────────────────────────────────────────────────────────

function ExpensesInner({ event, co, open, onToggle }: {
  event: OutcomeEvent
  co: DynamicCompany | undefined
  open: boolean
  onToggle: () => void
}) {
  const { locked, unlock } = useFinanceLock()
  const accounts = useFinanceStore(s => s.accounts)
  const categories = useFinanceStore(s => s.categories)
  const transactions = useFinanceStore(s => s.transactions)
  const upsert = useFinanceStore(s => s.upsertTransaction)
  const remove = useFinanceStore(s => s.removeTransaction)

  const [, bump] = useState(0)
  useEffect(() => subscribeOutcomeLinks(() => bump(n => n + 1)), [])

  const today = ymd(new Date())
  const date = event.date ?? today
  const coKey = co?.id ?? 'personal'

  const spendAccounts = useMemo(() => accounts.filter(a => a.accountType !== 'asset'), [accounts])
  const expenseCats = useMemo(
    () => categories.filter(c => c.txType === 'expense' || c.txType === 'both'), [categories])

  // The three categories you reach for most — used, not guessed — with the one
  // filed last time for this company first.
  const memory = loadMemory()[coKey]
  const chipCats = useMemo(() => {
    const count = new Map<string, number>()
    for (const t of transactions) if (t.type === 'expense' && t.categoryId) count.set(t.categoryId, (count.get(t.categoryId) ?? 0) + 1)
    const ranked = expenseCats
      .filter(c => (count.get(c.id) ?? 0) > 0)
      .sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0))
    const first = memory?.categoryId ? expenseCats.find(c => c.id === memory.categoryId) : undefined
    return [...(first ? [first] : []), ...ranked.filter(c => c.id !== first?.id)].slice(0, 3)
  }, [transactions, expenseCats, memory?.categoryId])

  const [amount, setAmount] = useState(0)
  const [payee, setPayee] = useState('')
  const [categoryId, setCategoryId] = useState<string>(memory?.categoryId ?? '')
  const [accountId, setAccountId] = useState<string>(memory?.accountId ?? '')
  const effAccountId = spendAccounts.some(a => a.id === accountId) ? accountId : (spendAccounts[0]?.id ?? '')
  const account = spendAccounts.find(a => a.id === effAccountId)

  const [editing, setEditing] = useState<string | null>(null)
  /** Entries this window made — their Undo deletes the entry rather than
   *  un-confirming it. Session-only: one from last time is just a record. */
  const [madeHere, setMadeHere] = useState<Set<string>>(new Set())

  const linked = linksForEvent(event.id, 'expense')
  const linkedIds = new Set(linked.map(l => l.recordId))
  const madeCount = linked.filter(l => l.role === 'made').length

  // One list, in an order that does not depend on what was just done — a row
  // that changes parent when confirmed is remounted and drops keyboard focus.
  const rows = useMemo(() => {
    const here = transactions.filter(t => linkedIds.has(t.id))
    // Unpaid bills close to the day of the meeting: the lunch that is owed and
    // not yet recorded as paid. Entries carry no company, so the day is the
    // honest link — said as "near this day", never "for Teradix".
    const near = event.date
      ? transactions.filter(t => t.type === 'expense' && isUnpaid(t) && !linkedIds.has(t.id) && daysApart(t.date, event.date!) <= 7)
          .sort((a, b) => daysApart(a.date, event.date!) - daysApart(b.date, event.date!)).slice(0, 4)
      : []
    return [...here, ...near].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, event.date, linked.map(l => l.recordId).join(',')])

  const draftsHere = rows.filter(t => linkedIds.has(t.id) && isUnpaid(t)).length
  const summary = locked
    ? 'Locked'
    : [
        rows.length ? `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}` : 'Nothing filed yet',
        madeCount ? `${madeCount} added here` : '',
        draftsHere ? `${draftsHere} to confirm` : '',
      ].filter(Boolean).join(' · ')

  const accName = (id: string) => accounts.find(a => a.id === id)?.name ?? ''
  const catName = (id?: string) => categories.find(c => c.id === id)?.name ?? ''
  const link = (id: string, role: 'made' | 'touched') =>
    addOutcomeLink({ eventId: event.id, eventTitle: event.title, eventDate: event.date, kind: 'expense', recordId: id, role })

  const env = envelopeFor(categoryId || undefined, date.slice(0, 7), expenseCats, transactions)

  function add() {
    if (!(amount > 0) || !account) return
    const tx: Transaction = {
      id: crypto.randomUUID(),
      accountId: account.id,
      amount,
      currency: account.currency,
      type: 'expense',
      payee: payee.trim() || event.title,
      ...(categoryId ? { categoryId } : {}),
      date,
      // No paidAt: an unpaid draft, kept out of every balance until confirmed.
      note: `From "${event.title}"`,
      isCleared: false,
      isRecurring: false,
      createdAt: new Date().toISOString(),
    }
    void upsert(tx)
    link(tx.id, 'made')
    setMadeHere(prev => new Set(prev).add(tx.id))
    saveMemory(coKey, { accountId: account.id, categoryId: categoryId || undefined })
    setAmount(0); setPayee('')
  }

  const patchTx = (tx: Transaction, patch: Partial<Transaction>) => {
    void upsert({ ...tx, ...patch })
    if (!linkedIds.has(tx.id)) link(tx.id, 'touched')
  }

  function confirm(tx: Transaction) {
    // Paid on the day it was due, or today if that day has not come: money that
    // has not left yet cannot have a payment date in the future.
    void upsert({ ...tx, paidAt: tx.date > today ? today : tx.date, isCleared: true })
    if (!linkedIds.has(tx.id)) link(tx.id, 'touched')
  }
  function unconfirm(tx: Transaction) {
    void upsert({ ...tx, paidAt: undefined, isCleared: false })
    const l = linked.find(x => x.recordId === tx.id)
    if (l?.role === 'touched') removeOutcomeLink(event.id, 'expense', tx.id)
  }
  function undoMade(tx: Transaction) {
    void remove(tx.id)
    removeOutcomeLink(event.id, 'expense', tx.id)
    setMadeHere(prev => { const n = new Set(prev); n.delete(tx.id); return n })
    if (editing === tx.id) setEditing(null)
  }

  return (
    <OutcomeBox
      id="expenses" icon={locked ? <Lock size={ICON.lg} /> : <Banknote size={ICON.lg} />}
      title="Expenses" summary={summary} open={open} onToggle={onToggle} tint={TINT}>

      {locked ? <Unlock onDone={() => { unlock(); markActive(); window.dispatchEvent(new CustomEvent('finance:lockChanged')) }} /> : (
        <>
          {rows.length > 0 && <p style={EYEBROW}>{event.date ? 'Filed here, and unpaid near this day' : 'Filed here'}</p>}
          {rows.map(tx => (
            <ExpenseRow
              key={tx.id} tx={tx}
              accountName={accName(tx.accountId)} categoryName={catName(tx.categoryId)}
              accounts={spendAccounts} categories={expenseCats}
              linkedHere={linkedIds.has(tx.id)} madeHere={madeHere.has(tx.id)} editing={editing === tx.id}
              onConfirm={() => confirm(tx)} onUnconfirm={() => unconfirm(tx)}
              onEdit={() => setEditing(editing === tx.id ? null : tx.id)}
              onUndoMade={() => undoMade(tx)}
              onChange={patch => patchTx(tx, patch)} />
          ))}

          {spendAccounts.length === 0 ? (
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
              No account to file an expense against yet — add one in Finance first.
            </p>
          ) : (
            <form
              onSubmit={e => { e.preventDefault(); add() }}
              style={{
                display: 'flex', flexDirection: 'column', gap: 10, padding: 12, marginTop: 2,
                background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
              }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: 170, flexShrink: 0 }}>
                  <MoneyInput value={amount} onChange={setAmount} placeholder="Amount"
                    style={{ ...FIELD, width: '100%', height: 46, fontSize: 'var(--sb-t-body)', fontWeight: 600, background: 'var(--sb-card)' }} />
                  <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)' }}>{account?.currency}</span>
                </span>
                <input aria-label="What it was" value={payee} onChange={e => setPayee(e.target.value)}
                  placeholder="What was it? — taxi, lunch, parking…"
                  style={{ ...FIELD, flex: 1, height: 46, background: 'var(--sb-card)' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {chipCats.map(c => (
                  <button type="button" key={c.id} onClick={() => setCategoryId(categoryId === c.id ? '' : c.id)}
                    aria-pressed={categoryId === c.id}
                    style={categoryId === c.id ? { ...chip(true), background: 'var(--sb-positive)', color: 'var(--sb-ink-on-fill)' } : chip()}>{c.name}</button>
                ))}
                <select aria-label="Another category"
                  value={chipCats.some(c => c.id === categoryId) ? '' : categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                  style={{ ...FIELD, height: 36, borderRadius: 'var(--sb-r-pill)', fontSize: 'var(--sb-t-meta)', fontWeight: 600 }}>
                  <option value="">{chipCats.length ? 'More…' : 'Category'}</option>
                  {expenseCats.filter(c => !chipCats.some(x => x.id === c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <span style={{ flex: 1 }} />
                <select aria-label="Paid from" value={effAccountId} onChange={e => setAccountId(e.target.value)}
                  style={{ ...FIELD, height: 36, borderRadius: 'var(--sb-r-pill)', fontSize: 'var(--sb-t-meta)', fontWeight: 600 }}>
                  {spendAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button type="submit" disabled={!(amount > 0)} style={{
                  height: 40, padding: '0 18px', borderRadius: 'var(--sb-r-sm)', border: 'none', fontFamily: 'inherit',
                  fontSize: 'var(--sb-t-body-s)', fontWeight: 700, cursor: amount > 0 ? 'pointer' : 'default',
                  background: 'var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)', opacity: amount > 0 ? 1 : 0.45,
                }}>Add as draft</button>
              </div>
              {env && (
                <span data-outcome-envelope style={{ fontSize: 'var(--sb-t-meta)', color: env.left < 0 ? 'var(--sb-negative-deep)' : 'var(--sb-ink-2)' }}>
                  <b>{env.name}</b> · {env.left < 0 ? `${env.cur} ${money(-env.left)} over` : `${env.cur} ${money(env.left)} left`} of {env.cur} {money(env.budget)} this month
                </span>
              )}
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
                Saved as an unpaid draft: it counts in no balance or budget until you confirm it.
              </span>
            </form>
          )}
        </>
      )}
    </OutcomeBox>
  )
}

export function ExpensesBox(props: { event: OutcomeEvent; co: DynamicCompany | undefined; open: boolean; onToggle: () => void }) {
  // A module that is off is not drawn: it was never loaded either, so there is
  // nothing true to show, and an empty box would read as "no expenses".
  if (moduleIsOff('finance')) return null
  return <ExpensesInner {...props} />
}
