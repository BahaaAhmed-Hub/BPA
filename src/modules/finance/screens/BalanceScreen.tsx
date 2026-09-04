import { useState } from 'react'
import { GripVertical } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useFinanceStore } from '../financeStore'
import { BudgetQuickPay } from '../components/BudgetQuickPay'
import { toBase, baseCurrency, currenciesNeedingRates } from '../fx'
import { AccountModal } from '../modals/AccountModal'
import { TransactionModal } from '../modals/TransactionModal'
import { IconPicker } from '../components/IconPicker'
import type { Account, AccountType, Transaction } from '../types'

// ─── Pill ─────────────────────────────────────────────────────────────────────

const RED = '#DA4A3E'
const GREEN = '#2FA869'

function Pill({ type, amount, currency }: { type: 'expense' | 'income' | 'transfer'; amount: number; currency: string }) {
  // Soft pill style: tinted background + matching text (no white text on colored bg)
  const bg    = type === 'expense' ? `${RED}18`   : type === 'income' ? `${GREEN}18`  : '#EDE7D9'
  const color = type === 'expense' ? RED           : type === 'income' ? GREEN         : '#6C6553'
  return (
    <span style={{
      display: 'inline-block',
      padding: '6px 13px',
      borderRadius: 9,
      fontSize: 13,
      fontWeight: 600,
      background: bg,
      color,
      whiteSpace: 'nowrap',
    }}>
      {type === 'expense' ? '−' : type === 'income' ? '+' : ''}{currency} {amount.toLocaleString('en-US')}
    </span>
  )
}

// ─── The Accounts / Cards / Cash pills ────────────────────────────────────────
// Three spans with the active one hardcoded — no state, no handler. Tapping
// them did nothing at all. They filter by account type, which is the field the
// group headings are already built from.

type AccountFilter = 'Accounts' | 'Cards' | 'Cash'

const ACCOUNT_FILTERS: Record<AccountFilter, (t: AccountType) => boolean> = {
  // Everything, which is what the screen showed before — so the default view
  // is unchanged and the other two only ever narrow it.
  Accounts: () => true,
  Cards:    t => t === 'credit_card',
  Cash:     t => t === 'wallet',
}

// ─── One account, draggable ───────────────────────────────────────────────────
// This lived inside BalanceScreen, which redefined it on every render — React
// sees a new component type each time and remounts the whole list, which would
// tear down a drag the moment anything else changed. It belongs out here.

function formatBalance(bal: number, currency = 'EGP'): string {
  if (bal < 0) return `(${currency} ${Math.abs(bal).toLocaleString('en-US')})`
  return `${currency} ${bal.toLocaleString('en-US')}`
}

function AccountRow({ account, hovered, onHover, onEdit, onIcon }: {
  account: Account
  hovered: boolean
  onHover: (id: string | null) => void
  onEdit:  (a: Account) => void
  onIcon:  (a: Account, emoji: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: account.id })
  const isNeg = account.balance < 0

  return (
    <div
      ref={setNodeRef}
      onMouseEnter={() => onHover(account.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onEdit(account)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(account) } }}
      title={`Open ${account.name}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 11,
        height: 46, padding: '0 12px 0 6px', borderRadius: 12,
        background: hovered ? '#FFFDF7' : '#FFFFFF',
        border: `1px solid ${hovered ? '#E4DCC6' : '#EFEADB'}`,
        boxSizing: 'border-box', position: 'relative', cursor: 'pointer',
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
        zIndex:  isDragging ? 2 : undefined,
        boxShadow: isDragging ? '0 6px 16px rgba(25,23,18,0.14)' : undefined,
      }}
    >
      {/* The handle, and only the handle, refuses the browser's touch gestures.
          Put touch-action: none on the whole row and the list stops scrolling
          on an iPad — you could reorder but never reach the bottom of it. */}
      <button
        {...attributes}
        {...listeners}
        onClick={e => e.stopPropagation()}
        aria-label={`Reorder ${account.name}`}
        title="Drag to reorder"
        style={{
          flexShrink: 0, width: 18, height: 30, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', borderRadius: 6,
          color: hovered || isDragging ? '#9B9180' : '#D8D0BE',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}>
        <GripVertical size={14} />
      </button>

      <IconPicker
        value={account.emoji}
        onChange={newEmoji => onIcon(account, newEmoji)}
        trigger={(onClick) => (
          <div onClick={onClick} title="Click to change icon" style={{
            width: 28, height: 28, borderRadius: 9, background: '#F0EBDC', color: '#6C6553',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, cursor: 'pointer', overflow: 'hidden', fontSize: 15,
          }}>
            {account.emoji.startsWith('data:') || account.emoji.startsWith('http')
              ? <img src={account.emoji} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span>{account.emoji}</span>}
          </div>
        )}
      />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#191712', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.name}</span>
        <span style={{ fontSize: 10.5, color: '#6C6553', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {account.bank ?? account.accountType}{account.last4 ? ` · ···· ${account.last4}` : ''}
        </span>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
        <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 14.5, fontWeight: 600, color: isNeg ? '#B4523A' : '#191712', fontVariantNumeric: 'tabular-nums' }}>
          {formatBalance(account.balance, account.currency)}
        </span>
        {account.last4 && <span style={{ fontSize: 10, color: '#6C6553' }}>cleared</span>}
      </div>
    </div>
  )
}

// ─── Balance Screen ───────────────────────────────────────────────────────────

export function BalanceScreen() {
  const C = {
    bg:        '#F7F4EA',
    surface:   '#FFFFFF',
    surfaceEl: '#FAF7EC',
    amberBg:   'rgba(245,209,78,0.12)',
    border:    '#E8E1CE',
    divFaint:  '#E8E1CE',
    amber:     '#F5D14E',
    amberSoft: '#D4A827',
    textPri:   '#191712',
    textMuted: '#6C6553',
    textDim:   '#9B9180',
    red:       '#DA4A3E',
    green:     '#2FA869',
    cyan:      '#46B6C9',
    purple:    '#7E78DD',
  }

  const { accounts, transactions, categories, upsertAccount, removeAccount, upsertTransaction, removeTransaction } = useFinanceStore()

  const [accountModal, setAccountModal] = useState<{ open: boolean; account: Account | null }>({ open: false, account: null })
  const [txModal, setTxModal] = useState<{ open: boolean; tx: Transaction | null }>({ open: false, tx: null })
  const [hoveredAccountId, setHoveredAccountId] = useState<string | null>(null)

  const _netWorth = accounts.reduce((s, a) => s + a.balance, 0); void _netWorth

  // Accounts shows the lot, which is what the screen did before this pill row
  // was anything but decoration. The other two narrow it by account type — the
  // same field the group headings below are built from.
  const [filter, setFilter] = useState<AccountFilter>('Accounts')

  // sortOrder is the order you put them in. Every account has been created
  // with 0, so until something is dragged this is the order they arrived in —
  // sort is stable, so equal values keep it.
  const bySort = (a: Account, b: Account) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  const shown = accounts.filter(a => ACCOUNT_FILTERS[filter](a.accountType))
  const paymentAccounts  = shown.filter(a => a.accountType === 'payment' || a.accountType === 'wallet').sort(bySort)
  const creditCards      = shown.filter(a => a.accountType === 'credit_card').sort(bySort)
  const otherAssets      = shown.filter(a => a.accountType === 'asset').sort(bySort)

  // A mouse drags straight away; a finger has to hold first, or the gesture is
  // indistinguishable from the scroll it usually is. The handle carries
  // touch-action: none so the rest of the row still scrolls.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 180, tolerance: 8 } }),
  )

  /** Renumber every account in the order they are shown, and send up only the
   *  ones that actually moved. One sequence across all three groups keeps
   *  sortOrder meaningful rather than three overlapping runs of 0..n. */
  function persistOrder(groups: Account[][]) {
    let i = 0
    for (const group of groups) {
      for (const acc of group) {
        if (acc.sortOrder !== i) void upsertAccount({ ...acc, sortOrder: i })
        i++
      }
    }
  }

  function reorder(group: Account[], e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = group.findIndex(a => a.id === active.id)
    const to   = group.findIndex(a => a.id === over.id)
    // Groups are split by account type, so a card can only move among cards.
    if (from < 0 || to < 0) return
    const moved = arrayMove(group, from, to)
    persistOrder([
      group === paymentAccounts ? moved : paymentAccounts,
      group === creditCards     ? moved : creditCards,
      group === otherAssets     ? moved : otherAssets,
    ])
  }

  // A USD account's balance is not the same number of pounds. Every total on
  // this screen added it as though it were; converted now, and an account in a
  // currency nobody has rated is left out rather than counted wrong.
  const base = baseCurrency()
  const inBase = (list: typeof accounts) =>
    list.reduce((s, a) => s + (toBase(a.balance, a.currency, base) ?? 0), 0)
  const unrated = currenciesNeedingRates(accounts, base)

  const paymentTotal = inBase(paymentAccounts)
  const creditTotal  = inBase(creditCards)
  const assetTotal   = inBase(otherAssets)

  // Sorted transactions desc
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date))

  // Held vs owed computations for net position card
  const totalHeld = inBase(accounts.filter(a => a.balance > 0))
  const totalOwed = Math.abs(inBase(accounts.filter(a => a.balance < 0)))
  const netPos    = totalHeld - totalOwed
  const heldPct   = totalHeld + totalOwed > 0 ? Math.round(totalHeld / (totalHeld + totalOwed) * 100) : 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        padding: '14px 26px 16px',
        display: 'flex', alignItems: 'flex-end', gap: 20,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', display: 'block', marginBottom: 4 }}>MONEY</span>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712', display: 'block' }}>Balances</span>
          <span style={{ fontSize: 12, color: '#6C6553', display: 'block', marginTop: 3 }}>
            {unrated.length > 0 && (
              <span style={{ color: '#8A6D0B' }}>
                {unrated.join(' and ')} not in these totals — no rate set ·{' '}
              </span>
            )}
            {filter === 'Accounts'
              ? `${shown.length} account${shown.length !== 1 ? 's' : ''} · held vs owed and what's already committed`
              : filter === 'Cards'
                ? `${shown.length} card${shown.length !== 1 ? 's' : ''} of ${accounts.length} accounts`
                : `${shown.length} cash account${shown.length !== 1 ? 's' : ''} of ${accounts.length}`}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 3 }}>
          {/* Filter pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 999, background: '#EDE7D9' }}>
            {(Object.keys(ACCOUNT_FILTERS) as AccountFilter[]).map(f => {
              const on = filter === f
              return (
                <button key={f} onClick={() => setFilter(f)} aria-pressed={on}
                  style={{ height: 28, padding: '0 13px', borderRadius: 999, border: 'none', fontFamily: 'inherit', background: on ? '#FFFFFF' : 'transparent', color: on ? '#191712' : '#6C6553', fontSize: 12, fontWeight: on ? 600 : 400, display: 'flex', alignItems: 'center', boxShadow: on ? '0 1px 3px rgba(25,23,18,0.16)' : 'none', cursor: 'pointer' }}>{f}</button>
              )
            })}
          </div>
          <button onClick={() => setAccountModal({ open: true, account: null })}
            style={{ height: 34, padding: '0 15px', borderRadius: 999, background: '#F5D14E', border: 'none', color: '#191712', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 0 rgba(25,23,18,0.14)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Add account
          </button>
        </div>
      </div>

      {/* Dark net position hero card */}
      <div style={{ flexShrink: 0, margin: '14px 26px 0', background: '#191712', borderRadius: 18, padding: '16px 20px', display: 'flex', gap: 22, alignItems: 'center', color: '#FDF8E7' }}>
        <div style={{ flexShrink: 0, width: 240 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', opacity: 0.6, display: 'block', marginBottom: 4 }}>NET POSITION</span>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 36, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', display: 'block' }}>
            EGP {netPos.toLocaleString('en-US')}
          </span>
          <span style={{ fontSize: 11, opacity: 0.65, display: 'block', marginTop: 4 }}>
            EGP {totalHeld.toLocaleString('en-US')} held · EGP {totalOwed.toLocaleString('en-US')} owed
          </span>
        </div>
        {/* Held/Owed bar */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, opacity: 0.55, marginBottom: 8 }}>
            <span>HELD</span><span style={{ marginLeft: 'auto' }}>OWED</span>
          </div>
          <div style={{ height: 14, borderRadius: 999, overflow: 'hidden', display: 'flex', background: 'rgba(255,255,255,0.12)' }}>
            <span style={{ width: `${heldPct}%`, background: '#F5D14E', display: 'block' }} />
            <span style={{ flex: 1, background: '#B4523A', display: 'block' }} />
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 10.5, opacity: 0.62, marginTop: 6 }}>
            <span>Payment {heldPct}%</span>
            <span>Cards {100 - heldPct}%</span>
          </div>
        </div>
        {/* Safe to spend */}
        <div style={{ width: 160, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', opacity: 0.55, display: 'block', marginBottom: 4 }}>SAFE TO SPEND</span>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', display: 'block' }}>
            EGP {Math.max(0, netPos - totalOwed * 0.1).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
          <span style={{ fontSize: 10.5, opacity: 0.6, display: 'block', marginTop: 2 }}>After committed bills</span>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left pane: accounts ── */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '22px 26px',
          borderRight: `1px solid #E8E1CE`,
        }}>
          {/* The envelopes, so paying one does not mean going to find it */}
          <div style={{ marginBottom: 16 }}>
            <BudgetQuickPay />
          </div>

          {/* ── Account groups ── */}
          {[
            { label: 'PAYMENT ACCOUNTS', accounts: paymentAccounts, total: paymentTotal, totalColor: '#5F7038' },
            { label: 'CARDS OWED', accounts: creditCards, total: creditTotal, totalColor: '#B4523A' },
            { label: 'OTHER ASSETS', accounts: otherAssets, total: assetTotal, totalColor: '#191712' },
          ].map(group => group.accounts.length > 0 && (
            <div key={group.label} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 30, padding: '0 12px', borderRadius: 10, background: '#EDE7D9', marginBottom: 7, boxSizing: 'border-box' as const }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553' }}>{group.label}</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'Outfit, sans-serif', fontSize: 13.5, fontWeight: 600, color: group.totalColor, fontVariantNumeric: 'tabular-nums' }}>
                  EGP {Math.abs(group.total).toLocaleString('en-US')}
                </span>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={e => reorder(group.accounts, e)}>
                <SortableContext items={group.accounts.map(a => a.id)} strategy={verticalListSortingStrategy}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {group.accounts.map(acc => (
                      <AccountRow
                        key={acc.id}
                        account={acc}
                        hovered={hoveredAccountId === acc.id}
                        onHover={setHoveredAccountId}
                        onEdit={a => setAccountModal({ open: true, account: a })}
                        onIcon={(a, emoji) => void upsertAccount({ ...a, emoji })}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          ))}

          {/* A filter that quietly shows nothing reads as a broken screen. Say
              what it was looking for — the type is editable in the account
              itself, which is a tap away now. */}
          {shown.length === 0 && (
            <div style={{
              padding: '26px 18px', textAlign: 'center', borderRadius: 12,
              background: '#FCFAF4', border: '1px dashed #E4DCC6',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#191712' }}>
                No {filter.toLowerCase()} yet
              </div>
              <div style={{ fontSize: 11.5, color: '#6C6553', marginTop: 5, lineHeight: 1.5 }}>
                {accounts.length === 0
                  ? 'Add an account to get started.'
                  : filter === 'Cards'
                    ? `None of your ${accounts.length} accounts are set to Credit Card. Open one to change its type.`
                    : `None of your ${accounts.length} accounts are set to Wallet. Open one to change its type.`}
              </div>
            </div>
          )}
        </div>

        {/* ── Right pane: transactions ── */}
        <div style={{
          flex: 1.05,
          overflowY: 'auto',
          padding: '22px 26px',
        }}>
          {/* Date range pill + Add button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
            }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.textPri }}>1 Jun 2026</span>
              <span style={{ color: C.textDim }}>›</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.textPri }}>30 Jun 2026</span>
              <span style={{ color: C.textDim, fontSize: 16, letterSpacing: 1 }}>···</span>
            </div>
            <button
              onClick={() => setTxModal({ open: true, tx: null })}
              style={{
                padding: '8px 14px',
                borderRadius: 9,
                background: C.amber,
                border: 'none',
                color: '#191712',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              + Add
            </button>
          </div>

          {/* Transaction feed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {sorted.map(tx => {
              const cat    = tx.categoryId ? categories.find(c => c.id === tx.categoryId) : null
              const emoji  = cat?.icon ?? (tx.type === 'income' ? '💼' : '💳')
              const txDate = new Date(tx.date)
              const dateStr = txDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              return (
                <div
                  key={tx.id}
                  onClick={() => setTxModal({ open: true, tx })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '11px 0',
                    borderBottom: `1px solid ${C.divFaint}`,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: tx.type === 'income' ? `${C.green}22` : `${C.red}22`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 17, flexShrink: 0,
                  }}>
                    {emoji}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 500, color: C.textPri,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {tx.payee?.trim() || cat?.name || 'Transaction'}
                    </div>
                    <div style={{ fontSize: 12, color: C.textDim, marginTop: 1, display: 'flex', gap: 6 }}>
                      <span style={{ color: C.green }}>{dateStr}</span>
                      {cat && tx.payee?.trim() && <span>· {cat.name}</span>}
                    </div>
                  </div>
                  <Pill
                    type={tx.type === 'income' ? 'income' : tx.type === 'transfer' ? 'transfer' : 'expense'}
                    amount={tx.amount}
                    currency={tx.currency}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Modals */}
      {accountModal.open && (
        <AccountModal
          account={accountModal.account}
          onSave={a => { upsertAccount(a); setAccountModal({ open: false, account: null }) }}
          onDelete={id => { removeAccount(id); setAccountModal({ open: false, account: null }) }}
          onClose={() => setAccountModal({ open: false, account: null })}
        />
      )}
      {txModal.open && (
        <TransactionModal
          transaction={txModal.tx}
          accounts={accounts}
          categories={categories}
          history={transactions}
          onSave={tx => { upsertTransaction(tx); setTxModal({ open: false, tx: null }) }}
          onDelete={id => { removeTransaction(id); setTxModal({ open: false, tx: null }) }}
          onClose={() => setTxModal({ open: false, tx: null })}
        />
      )}
    </div>
  )
}
