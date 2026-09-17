// Shopping List Screen — lives inside Finance module as a sub-view.
// Groups are schedulable, recurring shopping lists. Items belong to groups.
// Price watching is automatic via Edge Function; stores are user-defined by URL.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useShoppingStore } from '../shopping/shoppingStore'
import { useFinanceStore } from '../financeStore'
import type { ShoppingGroup, ShoppingItem, ShoppingStore, ShoppingViewMode } from '../shopping/types'
import { ITEM_CATEGORIES } from '../shopping/types'
import { loadRules } from '../modals/BudgetRuleModal'
import { suggestStoresForCountry } from '../shopping/storeSuggestions'
import { supabase } from '@/lib/supabase'
import { notify } from '@/lib/undo'

// ─── Sunlit Bento tokens used ─────────────────────────────────────────────────
const C = {
  page:    'var(--sb-page)',
  card:    'var(--sb-card)',
  field:   'var(--sb-field)',
  border:  'var(--sb-border)',
  ink1:    'var(--sb-ink-1)',
  ink3:    'var(--sb-ink-3)',
  ink4:    'var(--sb-ink-4)',
  accent:  'var(--sb-accent)',
  pos:     '#0C8140',
  neg:     '#C62828',
  amber:   '#F5D14E',
} as const

// ─── Small icon components ────────────────────────────────────────────────────

function IconPlus({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}
function IconCheck({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}
function IconRefresh({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  )
}
function IconTrash({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/>
    </svg>
  )
}
function IconChevronDown({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )
}
function IconCalendar({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>
    </svg>
  )
}

// ─── Affordability chip ───────────────────────────────────────────────────────

function AffordabilityChip({ item, envelopes }: { item: ShoppingItem; envelopes: { id: string; remaining: number; currency: string }[] }) {
  if (!item.budgetEnvelopeId || !item.targetPriceMax) return null
  const env = envelopes.find(e => e.id === item.budgetEnvelopeId)
  if (!env) return null
  const ratio = env.remaining / item.targetPriceMax
  const color  = ratio >= 1 ? C.pos : ratio >= 0.5 ? '#B05939' : C.neg
  const label  = ratio >= 1 ? 'Affordable' : ratio >= 0.5 ? 'Tight' : 'Over budget'
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: '0.06em', padding: '2px 6px', borderRadius: 4, background: `${color}18` }}>
      {label}
    </span>
  )
}

// ─── Best price badge ─────────────────────────────────────────────────────────

function BestPriceBadge({ item }: { item: ShoppingItem }) {
  if (!item.bestPrice) return null
  const isBelowTarget = item.targetPriceMax && item.bestPrice.price < item.targetPriceMax
  return (
    <span style={{ fontSize: 11, color: isBelowTarget ? C.pos : C.ink3, display: 'flex', alignItems: 'center', gap: 3 }}>
      {isBelowTarget && <span>↓</span>}
      {item.bestPrice.currency} {item.bestPrice.price.toLocaleString()} · {item.bestPrice.storeName}
    </span>
  )
}

// ─── Item row ─────────────────────────────────────────────────────────────────

type EnvelopeRow = { id: string; name: string; remaining: number; currency: string; dueAccountName?: string }

interface ItemRowProps {
  item:      ShoppingItem
  stores:    ShoppingStore[]
  envelopes: EnvelopeRow[]
  onUpdate:  (patch: Partial<ShoppingItem>) => void
  onDelete:  () => void
  onPurchase:(finalPrice?: number, storeId?: string) => void
  onRefreshPrice: () => void
  priceLoading: boolean
  suggestedPaymentAccount?: string
}

function ItemRow({ item, stores, envelopes, onUpdate, onDelete, onPurchase, onRefreshPrice, priceLoading, suggestedPaymentAccount }: ItemRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [confirmPurchase, setConfirmPurchase] = useState(false)
  const [finalPrice, setFinalPrice] = useState(item.finalPrice?.toString() ?? item.bestPrice?.price?.toString() ?? '')

  const purchased = item.status === 'purchased'

  return (
    <div style={{
      background: C.card, borderRadius: 10, border: `1px solid ${C.border}`,
      overflow: 'hidden', opacity: purchased ? 0.55 : 1,
      transition: 'opacity 0.2s',
    }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 10, cursor: 'pointer' }}
        onClick={() => !purchased && setExpanded(e => !e)}>
        {/* Tick */}
        <button
          onClick={e => { e.stopPropagation(); if (!purchased) setConfirmPurchase(true) }}
          style={{
            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
            border: `2px solid ${purchased ? C.pos : C.border}`,
            background: purchased ? C.pos : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
        >
          {purchased && <IconCheck size={12} />}
        </button>

        {/* Name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ textDecoration: purchased ? 'line-through' : 'none' }}>{item.name}</span>
            <span style={{ fontSize: 11, color: C.ink4, fontWeight: 400 }}>
              {item.quantity}{item.unit ? ` ${item.unit}` : ''}
            </span>
            <AffordabilityChip item={item} envelopes={envelopes} />
          </div>
          <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <BestPriceBadge item={item} />
            {item.targetPriceMax && (
              <span style={{ fontSize: 11, color: C.ink4 }}>
                max {item.currency} {item.targetPriceMax.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* Refresh price button */}
        {!purchased && (
          <button
            onClick={e => { e.stopPropagation(); onRefreshPrice() }}
            title="Refresh price"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: priceLoading ? C.accent : C.ink4, padding: 4 }}
          >
            <IconRefresh size={14} />
          </button>
        )}

        {/* Chevron */}
        {!purchased && (
          <span style={{ color: C.ink4, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <IconChevronDown />
          </span>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && !purchased && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Category */}
          <label style={{ fontSize: 11, color: C.ink3, display: 'flex', flexDirection: 'column', gap: 3 }}>
            CATEGORY
            <select
              value={item.category}
              onChange={e => onUpdate({ category: e.target.value })}
              style={{ fontSize: 12, padding: '4px 6px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }}
            >
              {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          {/* Notes */}
          <label style={{ fontSize: 11, color: C.ink3, display: 'flex', flexDirection: 'column', gap: 3 }}>
            NOTES
            <input
              value={item.notes ?? ''}
              onChange={e => onUpdate({ notes: e.target.value })}
              placeholder="Any notes…"
              style={{ fontSize: 12, padding: '4px 6px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }}
            />
          </label>

          {/* Max price */}
          <label style={{ fontSize: 11, color: C.ink3, display: 'flex', flexDirection: 'column', gap: 3 }}>
            MAX PRICE ({item.currency})
            <input
              type="number"
              value={item.targetPriceMax ?? ''}
              onChange={e => onUpdate({ targetPriceMax: parseFloat(e.target.value) || undefined })}
              placeholder="No limit"
              style={{ fontSize: 12, padding: '4px 6px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }}
            />
          </label>

          {/* Store picker */}
          {stores.length > 0 && (
            <div style={{ fontSize: 11, color: C.ink3 }}>
              CHECK PRICES AT
              <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {stores.map(s => {
                  const selected = (item.suggestedStores ?? []).includes(s.id)
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        const current = item.suggestedStores ?? []
                        onUpdate({ suggestedStores: selected ? current.filter(id => id !== s.id) : [...current, s.id] })
                      }}
                      style={{
                        fontSize: 11, padding: '3px 9px', borderRadius: 10, cursor: 'pointer',
                        background: selected ? C.accent : C.field,
                        color: selected ? '#191712' : C.ink3,
                        border: `1px solid ${selected ? C.accent : C.border}`,
                        fontWeight: selected ? 600 : 400,
                      }}
                    >
                      {s.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Price history sparkline placeholder */}
          {(item.priceHistory?.length ?? 0) > 1 && (
            <div style={{ fontSize: 11, color: C.ink3 }}>
              PRICE HISTORY ({item.priceHistory?.length} readings)
              <div style={{ marginTop: 4, height: 28, background: C.field, borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                {item.priceHistory?.slice(0, 8).map((snap, i) => (
                  <span key={i} style={{ fontSize: 10, color: C.ink4, marginRight: 6 }}>
                    {snap.price.toLocaleString()}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Delete */}
          <button
            onClick={onDelete}
            style={{ alignSelf: 'flex-start', fontSize: 11, color: C.neg, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
          >
            <IconTrash size={12} /> Remove item
          </button>
        </div>
      )}

      {/* Purchase confirm overlay */}
      {confirmPurchase && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 12px', background: `${C.pos}10` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.ink1, marginBottom: 8 }}>Mark as purchased?</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 11, color: C.ink3 }}>
              Final price
              <input
                type="number"
                value={finalPrice}
                onChange={e => setFinalPrice(e.target.value)}
                placeholder="Actual price paid"
                style={{ marginLeft: 6, fontSize: 12, padding: '3px 6px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.field, width: 100 }}
              />
            </label>
            {suggestedPaymentAccount && (
              <span style={{ fontSize: 11, color: C.ink3, padding: '2px 8px', borderRadius: 6, background: C.field, border: `1px solid ${C.border}` }}>
                Pay with <strong style={{ color: C.ink1 }}>{suggestedPaymentAccount}</strong>
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { onPurchase(parseFloat(finalPrice) || undefined); setConfirmPurchase(false) }}
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, background: C.pos, color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmPurchase(false)}
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: 'transparent', color: C.ink3, border: `1px solid ${C.border}`, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Group card ───────────────────────────────────────────────────────────────

interface GroupCardProps {
  group:    ShoppingGroup
  items:    ShoppingItem[]
  stores:   ShoppingStore[]
  envelopes: EnvelopeRow[]
  onUpdateGroup:  (patch: Partial<ShoppingGroup>) => void
  onDeleteGroup:  () => void
  onAddItem:            () => void
  onAddItemWithPrefill: (name: string) => void
  onUpdateItem:         (id: string, patch: Partial<ShoppingItem>) => void
  onDeleteItem:   (id: string) => void
  onPurchaseItem: (id: string, finalPrice?: number, storeId?: string) => void
  onRefreshGroupPrices: () => void
  priceWatchLoading: boolean
  refreshingItemId: string | null
  onRefreshItemPrice: (itemId: string) => void
  repeatSuggestions: string[]
  suggestedPayments: Map<string, string>
}

const RECURRENCE_LABELS: Record<string, string> = {
  none: 'One-time', daily: 'Daily', weekly: 'Weekly',
  biweekly: 'Every 2 weeks', monthly: 'Monthly', custom: 'Custom',
}

function GroupCard({ group, items, stores, envelopes, onUpdateGroup, onDeleteGroup, onAddItem, onAddItemWithPrefill, onUpdateItem, onDeleteItem, onPurchaseItem, onRefreshGroupPrices, priceWatchLoading, refreshingItemId, onRefreshItemPrice, repeatSuggestions, suggestedPayments }: GroupCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [editName, setEditName] = useState(false)
  const [nameVal, setNameVal] = useState(group.name)
  const [showSchedulePicker, setShowSchedulePicker] = useState(false)
  const [showRecurrencePicker, setShowRecurrencePicker] = useState(false)

  const activeItems    = items.filter(i => i.status !== 'purchased')
  const purchasedItems = items.filter(i => i.status === 'purchased')

  // Optimize trip: re-sort active items so same-store items are grouped together
  function handleOptimizeTrip() {
    const storeGroups = new Map<string, string[]>()
    const noStore: string[] = []
    for (const item of activeItems) {
      const sid = item.suggestedStores?.[0]
      if (sid) {
        if (!storeGroups.has(sid)) storeGroups.set(sid, [])
        storeGroups.get(sid)!.push(item.id)
      } else {
        noStore.push(item.id)
      }
    }
    let order = 0
    for (const ids of storeGroups.values()) for (const id of ids) onUpdateItem(id, { sortOrder: order++ })
    for (const id of noStore) onUpdateItem(id, { sortOrder: order++ })
    notify(`Trip optimized — ${storeGroups.size} store${storeGroups.size !== 1 ? 's' : ''} in order`)
  }

  // Group affordability summary
  const groupTotal = activeItems.reduce((sum, item) => sum + (item.targetPriceMax ?? item.bestPrice?.price ?? 0), 0)
  const linkedEnvBalance = (() => {
    const envIds = [...new Set(activeItems.map(i => i.budgetEnvelopeId).filter(Boolean))]
    return envIds.reduce((sum, eid) => sum + (envelopes.find(e => e.id === eid)?.remaining ?? 0), 0)
  })()

  return (
    <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 1px 4px rgba(25,23,18,0.05)' }}>
      {/* Group header */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>{group.icon}</span>

        {editName ? (
          <input
            autoFocus
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={() => { onUpdateGroup({ name: nameVal }); setEditName(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { onUpdateGroup({ name: nameVal }); setEditName(false) } }}
            style={{ flex: 1, fontSize: 15, fontWeight: 700, background: C.field, border: `1px solid ${C.accent}`, borderRadius: 6, padding: '3px 8px', color: C.ink1 }}
          />
        ) : (
          <span
            onDoubleClick={() => setEditName(true)}
            style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.ink1, cursor: 'text' }}
          >
            {group.name}
          </span>
        )}

        {/* Meta row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {group.scheduledDate && (
            <span style={{ fontSize: 11, color: C.ink3, display: 'flex', alignItems: 'center', gap: 3 }}>
              <IconCalendar size={11} />
              {new Date(group.scheduledDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )}
          {group.recurrence !== 'none' && (
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: C.accent, padding: '1px 6px', background: `${C.accent}22`, borderRadius: 4 }}>
              {RECURRENCE_LABELS[group.recurrence]}
            </span>
          )}
        </div>

        {/* Refresh prices for this group */}
        <button
          onClick={onRefreshGroupPrices}
          title="Refresh prices for this list"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: priceWatchLoading ? C.accent : C.ink4, padding: 4 }}
        >
          <IconRefresh size={14} />
        </button>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.ink4, padding: 4, transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }}
        >
          <IconChevronDown />
        </button>
      </div>

      {/* Affordability summary bar */}
      {groupTotal > 0 && (
        <div style={{ padding: '0 16px 10px', fontSize: 11, color: C.ink3, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>{activeItems.length} items · {items[0]?.currency ?? 'EGP'} {groupTotal.toLocaleString()} estimated</span>
          {linkedEnvBalance > 0 && (
            <span style={{ color: linkedEnvBalance >= groupTotal ? C.pos : C.neg }}>
              · {linkedEnvBalance >= groupTotal ? 'within' : 'over'} budget
            </span>
          )}
        </div>
      )}

      {/* Items list */}
      {!collapsed && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>

          {/* Repeat purchase suggestions */}
          {repeatSuggestions.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: C.ink4, textTransform: 'uppercase', marginBottom: 5 }}>
                Often bought
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {repeatSuggestions.map(name => (
                  <button
                    key={name}
                    onClick={() => { onAddItemWithPrefill(name) }}
                    title={`Quick-add ${name}`}
                    style={{
                      fontSize: 11, padding: '3px 9px', borderRadius: 10, cursor: 'pointer',
                      background: `${C.accent}20`, border: `1px solid ${C.accent}60`, color: C.ink1,
                    }}
                  >
                    + {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeItems.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              stores={stores}
              envelopes={envelopes}
              onUpdate={patch => onUpdateItem(item.id, patch)}
              onDelete={() => onDeleteItem(item.id)}
              onPurchase={(price, sid) => onPurchaseItem(item.id, price, sid)}
              onRefreshPrice={() => onRefreshItemPrice(item.id)}
              priceLoading={refreshingItemId === item.id}
              suggestedPaymentAccount={suggestedPayments.get(item.id)}
            />
          ))}

          {/* Purchased items (collapsed by default) */}
          {purchasedItems.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 11, color: C.ink4, cursor: 'pointer', listStyle: 'none', padding: '4px 0' }}>
                {purchasedItems.length} purchased
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                {purchasedItems.map(item => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    stores={stores}
                    envelopes={envelopes}
                    onUpdate={patch => onUpdateItem(item.id, patch)}
                    onDelete={() => onDeleteItem(item.id)}
                    onPurchase={(price, sid) => onPurchaseItem(item.id, price, sid)}
                    onRefreshPrice={() => {}}
                    priceLoading={false}
                  />
                ))}
              </div>
            </details>
          )}

          {/* Add item */}
          <button
            onClick={onAddItem}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, color: C.ink4, background: 'none', border: `1px dashed ${C.border}`,
              borderRadius: 8, padding: '7px 10px', cursor: 'pointer', marginTop: 2,
            }}
          >
            <IconPlus size={12} /> Add item
          </button>

          {/* Group actions */}
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {showSchedulePicker ? (
              <input
                type="date"
                autoFocus
                defaultValue={group.scheduledDate ?? ''}
                onChange={e => onUpdateGroup({ scheduledDate: e.target.value || undefined })}
                onBlur={() => setShowSchedulePicker(false)}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: `1px solid ${C.accent}`, background: C.field, color: C.ink1 }}
              />
            ) : (
              <GroupActionButton
                label={group.scheduledDate ? `📅 ${new Date(group.scheduledDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Schedule'}
                onClick={() => setShowSchedulePicker(true)}
              />
            )}
            {showRecurrencePicker ? (
              <select
                autoFocus
                value={group.recurrence}
                onChange={e => { onUpdateGroup({ recurrence: e.target.value as ShoppingGroup['recurrence'] }); setShowRecurrencePicker(false) }}
                onBlur={() => setShowRecurrencePicker(false)}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: `1px solid ${C.accent}`, background: C.field, color: C.ink1 }}
              >
                <option value="none">One-time</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom</option>
              </select>
            ) : (
              <GroupActionButton
                label={group.recurrence !== 'none' ? RECURRENCE_LABELS[group.recurrence] : 'Recurrence'}
                onClick={() => setShowRecurrencePicker(true)}
              />
            )}
            <GroupActionButton label="Optimize trip" onClick={handleOptimizeTrip} />
            <GroupActionButton label="Archive" onClick={() => onUpdateGroup({ status: 'archived' })} />
            <GroupActionButton label="Delete" onClick={onDeleteGroup} danger />
          </div>
        </div>
      )}
    </div>
  )
}

function GroupActionButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6,
        border: `1px solid ${danger ? C.neg + '40' : C.border}`,
        background: 'none', color: danger ? C.neg : C.ink3, cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

// ─── Add item modal ───────────────────────────────────────────────────────────

interface AddItemModalProps {
  groupId: string
  currency: string
  prefillName?: string
  onAdd: (item: Omit<ShoppingItem, 'id' | 'createdAt' | 'updatedAt'>) => void
  onClose: () => void
}

function AddItemModal({ groupId, currency, prefillName, onAdd, onClose }: AddItemModalProps) {
  const [name, setName]         = useState(prefillName ?? '')
  const [category, setCategory] = useState('Groceries')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit]         = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  function handleAdd() {
    if (!name.trim()) return
    onAdd({
      userId: 'pending',   // caller (handleAddItem) overrides with real userId
      groupId, name: name.trim(), category,
      quantity: parseFloat(quantity) || 1,
      unit: unit || undefined,
      targetPriceMax: parseFloat(maxPrice) || undefined,
      currency, priority: 0, status: 'wanted', sortOrder: 0,
    })
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(25,23,18,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: C.card, borderRadius: '16px 16px 0 0', padding: '20px 20px 32px', width: '100%', maxWidth: 480 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink1, marginBottom: 14 }}>Add item</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Item name"
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            style={{ fontSize: 14, padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              style={{ flex: 1, fontSize: 12, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }}
            >
              {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="Qty"
              type="number"
              style={{ width: 60, fontSize: 12, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }}
            />
            <input
              value={unit}
              onChange={e => setUnit(e.target.value)}
              placeholder="unit"
              style={{ width: 64, fontSize: 12, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }}
            />
          </div>
          <input
            value={maxPrice}
            onChange={e => setMaxPrice(e.target.value)}
            placeholder={`Max price (${currency})`}
            type="number"
            style={{ fontSize: 12, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={handleAdd}
              disabled={!name.trim()}
              style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '9px', borderRadius: 10, background: C.ink1, color: '#fff', border: 'none', cursor: name.trim() ? 'pointer' : 'not-allowed' }}
            >
              Add
            </button>
            <button
              onClick={onClose}
              style={{ fontSize: 13, padding: '9px 14px', borderRadius: 10, background: C.field, color: C.ink3, border: `1px solid ${C.border}`, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add group modal ──────────────────────────────────────────────────────────

interface AddGroupModalProps {
  onAdd: (g: Omit<ShoppingGroup, 'id' | 'createdAt' | 'updatedAt'>) => void
  onClose: () => void
}

const GROUP_ICONS = ['🛒', '🥦', '💊', '🏠', '👕', '🎮', '📚', '🐾', '🏋️', '🎁', '🚗', '✏️']

function AddGroupModal({ onAdd, onClose }: AddGroupModalProps) {
  const [name, setName]             = useState('')
  const [icon, setIcon]             = useState('🛒')
  const [_color, _setColor]         = useState('#F5D14E')
  const [scheduledDate, setDate]    = useState('')
  const [recurrence, setRecurrence] = useState<ShoppingGroup['recurrence']>('none')

  function handleAdd() {
    if (!name.trim()) return
    onAdd({ userId: 'pending', name: name.trim(), icon, scheduledDate: scheduledDate || undefined, recurrence, status: 'active', sortOrder: 0, color: _color })
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(25,23,18,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: C.card, borderRadius: '16px 16px 0 0', padding: '20px 20px 32px', width: '100%', maxWidth: 480 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink1, marginBottom: 14 }}>New shopping list</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Icon picker */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {GROUP_ICONS.map(ic => (
              <button key={ic} onClick={() => setIcon(ic)}
                style={{ fontSize: 20, width: 36, height: 36, borderRadius: 8, border: `2px solid ${ic === icon ? C.accent : C.border}`, background: ic === icon ? `${C.accent}22` : C.field, cursor: 'pointer' }}>
                {ic}
              </button>
            ))}
          </div>

          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="List name"
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            style={{ fontSize: 14, padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="date"
              value={scheduledDate}
              onChange={e => setDate(e.target.value)}
              style={{ flex: 1, fontSize: 12, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }}
            />
            <select
              value={recurrence}
              onChange={e => setRecurrence(e.target.value as ShoppingGroup['recurrence'])}
              style={{ flex: 1, fontSize: 12, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }}
            >
              <option value="none">One-time</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={handleAdd}
              disabled={!name.trim()}
              style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '9px', borderRadius: 10, background: C.ink1, color: '#fff', border: 'none', cursor: name.trim() ? 'pointer' : 'not-allowed' }}
            >
              Create list
            </button>
            <button onClick={onClose}
              style={{ fontSize: 13, padding: '9px 14px', borderRadius: 10, background: C.field, color: C.ink3, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Unscheduled items section ────────────────────────────────────────────────

function UnscheduledSection({ items, stores, envelopes, onUpdate, onDelete, onPurchase, onRefreshPrice }: {
  items: ShoppingItem[]
  stores: ShoppingStore[]
  envelopes: EnvelopeRow[]
  onUpdate: (id: string, patch: Partial<ShoppingItem>) => void
  onDelete: (id: string) => void
  onPurchase: (id: string, price?: number, storeId?: string) => void
  onRefreshPrice: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: C.ink4, textTransform: 'uppercase', marginBottom: 8 }}>
        Unscheduled
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(item => (
          <ItemRow
            key={item.id}
            item={item}
            stores={stores}
            envelopes={envelopes}
            onUpdate={patch => onUpdate(item.id, patch)}
            onDelete={() => onDelete(item.id)}
            onPurchase={(price, sid) => onPurchase(item.id, price, sid)}
            onRefreshPrice={() => onRefreshPrice(item.id)}
            priceLoading={false}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Stores tab ──────────────────────────────────────────────────────────────

const COUNTRY_OPTIONS = [
  { code: 'EG', label: 'Egypt' },
  { code: 'AE', label: 'UAE' },
  { code: 'SA', label: 'Saudi Arabia' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
]

interface StoresTabProps {
  stores:       ShoppingStore[]
  userId:       string
  onAddStore:   (s: Omit<ShoppingStore, 'id' | 'createdAt' | 'updatedAt'>) => void
  onDeleteStore:(id: string) => void
}

function StoresTab({ stores, userId, onAddStore, onDeleteStore }: StoresTabProps) {
  const [showForm, setShowForm]     = useState(false)
  const [name, setName]             = useState('')
  const [url, setUrl]               = useState('')
  const [country, setCountry]       = useState('EG')
  const [selCats, setSelCats]       = useState<string[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const suggestions = suggestStoresForCountry(country)

  function applyTemplate(s: { name: string; url: string; categories: string[]; country: string }) {
    setName(s.name); setUrl(s.url); setSelCats(s.categories)
  }

  function toggleCat(c: string) {
    setSelCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  }

  function handleAdd() {
    if (!name.trim() || !url.trim()) return
    onAddStore({ userId, name: name.trim(), url: url.trim(), country: country || undefined, categories: selCats, sortOrder: stores.length })
    setName(''); setUrl(''); setSelCats([]); setShowForm(false)
    notify(`Store "${name.trim()}" added`)
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Existing stores list */}
      {stores.length > 0 && (
        <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
          {stores.map((store, idx) => (
            <div key={store.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
              borderBottom: idx < stores.length - 1 ? `1px solid ${C.border}` : 'none',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.ink1 }}>{store.name}</div>
                <div style={{ fontSize: 11, color: C.ink4, marginTop: 1, wordBreak: 'break-all' }}>{store.url}</div>
                {store.categories.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                    {store.categories.map(c => (
                      <span key={c} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: C.field, color: C.ink3, border: `1px solid ${C.border}` }}>{c}</span>
                    ))}
                  </div>
                )}
                {store.lastScrapedAt && (
                  <div style={{ fontSize: 10, color: C.ink4, marginTop: 3 }}>
                    Last checked {new Date(store.lastScrapedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    {store.lastScrapeOk === false && <span style={{ color: C.neg, marginLeft: 4 }}>· failed</span>}
                  </div>
                )}
              </div>
              {deleteConfirm === store.id ? (
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: C.ink3 }}>Remove?</span>
                  <button onClick={() => { onDeleteStore(store.id); setDeleteConfirm(null) }}
                    style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: C.neg, color: '#fff', border: 'none', cursor: 'pointer' }}>Yes</button>
                  <button onClick={() => setDeleteConfirm(null)}
                    style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, background: C.field, color: C.ink3, border: `1px solid ${C.border}`, cursor: 'pointer' }}>No</button>
                </div>
              ) : (
                <button onClick={() => setDeleteConfirm(store.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.ink4, padding: 4, flexShrink: 0, marginTop: 2 }}>
                  <IconTrash size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add store form */}
      {showForm ? (
        <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink1, marginBottom: 2 }}>Add store</div>

          {/* Country + quick picks */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={country} onChange={e => setCountry(e.target.value)}
              style={{ fontSize: 12, padding: '5px 8px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }}>
              {COUNTRY_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
            <span style={{ fontSize: 11, color: C.ink4 }}>Quick-pick:</span>
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {suggestions.map(s => (
              <button key={s.url} onClick={() => applyTemplate(s)}
                style={{ fontSize: 11, padding: '3px 9px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.field, color: C.ink1, cursor: 'pointer' }}>
                {s.name}
              </button>
            ))}
          </div>

          <input value={name} onChange={e => setName(e.target.value)} placeholder="Store name"
            style={{ fontSize: 13, padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }} />
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"
            style={{ fontSize: 12, padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.field, color: C.ink1 }} />

          {/* Category multi-select */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: C.ink4, textTransform: 'uppercase', marginBottom: 5 }}>CATEGORIES</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {ITEM_CATEGORIES.map(c => (
                <button key={c} onClick={() => toggleCat(c)}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${selCats.includes(c) ? C.accent : C.border}`,
                    background: selCats.includes(c) ? `${C.accent}22` : C.field,
                    color: selCats.includes(c) ? C.ink1 : C.ink3 }}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleAdd} disabled={!name.trim() || !url.trim()}
              style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '8px', borderRadius: 9, background: C.ink1, color: '#fff', border: 'none', cursor: name.trim() && url.trim() ? 'pointer' : 'not-allowed' }}>
              Add store
            </button>
            <button onClick={() => { setShowForm(false); setName(''); setUrl(''); setSelCats([]) }}
              style={{ fontSize: 13, padding: '8px 14px', borderRadius: 9, background: C.field, color: C.ink3, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.ink4, background: 'none', border: `1px dashed ${C.border}`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', alignSelf: 'flex-start' }}>
          <IconPlus size={13} /> Add a store
        </button>
      )}

      {stores.length === 0 && !showForm && (
        <div style={{ textAlign: 'center', paddingTop: 40, color: C.ink4 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏪</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink3 }}>No stores yet</div>
          <div style={{ fontSize: 12, color: C.ink4, marginTop: 4 }}>Add stores to enable price tracking and trip optimization.</div>
        </div>
      )}
    </div>
  )
}

// ─── Weekly / monthly view helpers ───────────────────────────────────────────

function weekLabel(date: string): string {
  const d = new Date(date)
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return `Week of ${monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}–${sunday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}

function monthLabel(date: string): string {
  return new Date(date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function groupKey(date: string, mode: ShoppingViewMode): string {
  const d = new Date(date)
  if (mode === 'byWeek') {
    const monday = new Date(d)
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return monday.toISOString().slice(0, 10)
  }
  return date.slice(0, 7)
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function ShoppingScreen() {
  const {
    groups, items: rawItems, stores, snapshots, priceWatchLoading,
    addGroup, updateGroup, deleteGroup,
    addItem, updateItem, deleteItem, purchaseItem,
    addStore, deleteStore,
    refreshPrices, loadAll, settings,
  } = useShoppingStore()

  const enrichedItems = useMemo(
    () => useShoppingStore.getState().enrichedItems(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawItems, snapshots, stores],
  )
  const { accounts } = useFinanceStore()

  const [viewMode, setViewMode] = useState<ShoppingViewMode>(settings.viewMode)
  const [activeTab, setActiveTab] = useState<'list' | 'stores' | 'history'>('list')
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [addingItemGroupId, setAddingItemGroupId] = useState<string | null>(null)
  const [addingItemPrefill, setAddingItemPrefill] = useState<string>('')
  const [refreshingItemId, setRefreshingItemId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string>('local')

  // Load data and get user id on mount
  useEffect(() => {
    void loadAll()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
  }, [loadAll])

  // Budget envelopes with payment account suggestion
  const accountNameById = useMemo(() =>
    new Map(accounts.map(a => [a.id, a.name])), [accounts])

  const envelopes = useMemo(() => {
    const rules = loadRules()
    return Object.entries(rules).map(([catId, rule]) => ({
      id: catId,
      name: catId,
      remaining: rule.amount ?? 0,
      currency: rule.currency ?? 'EGP',
      dueAccountName: rule.dueAccountId ? accountNameById.get(rule.dueAccountId) : undefined,
    }))
  }, [accountNameById])

  // Map item id → suggested payment account name
  const suggestedPayments = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of enrichedItems) {
      if (!item.budgetEnvelopeId) continue
      const env = envelopes.find(e => e.id === item.budgetEnvelopeId)
      if (env?.dueAccountName) map.set(item.id, env.dueAccountName)
    }
    return map
  }, [enrichedItems, envelopes])

  // Repeat purchase suggestions: item names bought 2+ times (for quick-add)
  const repeatSuggestions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of rawItems) {
      if (item.status !== 'purchased') continue
      const key = item.name.trim().toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name]) => name.charAt(0).toUpperCase() + name.slice(1))
  }, [rawItems])

  // History: purchased items grouped by purchasedAt week/month
  const historyByPeriod = useMemo(() => {
    const purchased = enrichedItems
      .filter(i => i.status === 'purchased' && (i.purchasedAt ?? i.updatedAt))
      .sort((a, b) => (b.purchasedAt ?? b.updatedAt).localeCompare(a.purchasedAt ?? a.updatedAt))
    const map = new Map<string, { label: string; items: typeof purchased }>()
    for (const item of purchased) {
      const dateStr = (item.purchasedAt ?? item.updatedAt).slice(0, 10)
      const key   = groupKey(dateStr, viewMode)
      const label = viewMode === 'byWeek' ? weekLabel(dateStr) : monthLabel(dateStr)
      if (!map.has(key)) map.set(key, { label, items: [] })
      map.get(key)!.items.push(item)
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a))
  }, [enrichedItems, viewMode])

  // Handle purchase with cross-module completion chain
  const handlePurchase = useCallback(async (itemId: string, finalPrice?: number, storeId?: string) => {
    const item = enrichedItems.find(i => i.id === itemId)
    if (!item) return

    purchaseItem(itemId, finalPrice, storeId)
    notify(`${item.name} purchased`)

    // Cross-module: mark calendar event done (if opt-in)
    if (settings.markCalendarDoneOnPurchase && item.calendarEventId) {
      try {
        await supabase.functions.invoke('google-calendar-write', {
          body: {
            action: 'update_event',
            event_id: item.calendarEventId,
            description: `✓ Purchased`,
          },
        })
      } catch { /* non-blocking */ }
    }

    // Cross-module: complete linked task (if opt-in)
    if (settings.markTaskDoneOnPurchase && item.taskId) {
      try {
        const mod = await import('@/store/taskStore')
        mod.useTaskStore.getState().updateTask(item.taskId, {
          completed: true,
          completedAt: new Date().toISOString(),
        })
      } catch { /* non-blocking */ }
    }
  }, [enrichedItems, purchaseItem, settings])

  // Refresh price for a single item
  const handleRefreshItemPrice = useCallback(async (itemId: string) => {
    setRefreshingItemId(itemId)
    await refreshPrices([itemId])
    setRefreshingItemId(null)
  }, [refreshPrices])

  // Add group with user id
  const handleAddGroup = useCallback((g: Omit<ShoppingGroup, 'id' | 'createdAt' | 'updatedAt'>) => {
    addGroup({ ...g, userId })
  }, [addGroup, userId])

  // Add item with user id
  const handleAddItem = useCallback((groupId: string, item: Omit<ShoppingItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    addItem({ ...item, groupId, userId })
  }, [addItem, userId])

  // Open add-item modal pre-filled with a name (from repeat suggestion chips)
  const handleAddItemWithPrefill = useCallback((groupId: string, name: string) => {
    setAddingItemPrefill(name)
    setAddingItemGroupId(groupId)
  }, [])

  // Add store with user id
  const handleAddStore = useCallback((s: Omit<ShoppingStore, 'id' | 'createdAt' | 'updatedAt'>) => {
    addStore({ ...s, userId })
  }, [addStore, userId])

  // Build grouped view
  const activeGroups  = groups.filter(g => g.status === 'active').sort((a, b) => a.sortOrder - b.sortOrder)
  const unscheduled   = enrichedItems.filter(i => !i.groupId && i.status !== 'purchased')

  // Group the active groups by week/month based on their scheduled date
  const scheduledGroups  = activeGroups.filter(g => g.scheduledDate)
  const unscheduledGroups = activeGroups.filter(g => !g.scheduledDate)

  const groupsByPeriod = useMemo(() => {
    const map = new Map<string, { label: string; groups: ShoppingGroup[] }>()
    for (const g of scheduledGroups) {
      const key   = groupKey(g.scheduledDate!, viewMode)
      const label = viewMode === 'byWeek' ? weekLabel(g.scheduledDate!) : monthLabel(g.scheduledDate!)
      if (!map.has(key)) map.set(key, { label, groups: [] })
      map.get(key)!.groups.push(g)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [scheduledGroups, viewMode])

  // Total impact summary
  const totalEstimated = useMemo(() =>
    enrichedItems
      .filter(i => i.status !== 'purchased')
      .reduce((sum, i) => sum + (i.targetPriceMax ?? i.bestPrice?.price ?? 0), 0),
    [enrichedItems])

  const currency = rawItems[0]?.currency ?? 'EGP'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.page, overflow: 'hidden' }}>

      {/* Screen header */}
      <div style={{ padding: '14px 24px 12px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.ink1, fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.02em' }}>
            Shopping List
          </div>
          {activeTab === 'list' && totalEstimated > 0 && (
            <div style={{ fontSize: 12, color: C.ink3, marginTop: 2 }}>
              {currency} {totalEstimated.toLocaleString()} estimated across {enrichedItems.filter(i => i.status !== 'purchased').length} items
            </div>
          )}
        </div>

        {/* List / Stores / History tabs */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.border}` }}>
          {(['list', 'stores', 'history'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', border: 'none', cursor: 'pointer',
                background: activeTab === tab ? C.ink1 : C.card,
                color: activeTab === tab ? '#fff' : C.ink3 }}>
              {tab === 'list' ? 'List' : tab === 'stores' ? 'Stores' : 'History'}
            </button>
          ))}
        </div>

        {/* View mode toggle */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.border}` }}>
          {(['byWeek', 'byMonth'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => { setViewMode(mode); useShoppingStore.getState().updateSettings({ viewMode: mode }) }}
              style={{
                fontSize: 11, fontWeight: 600, padding: '5px 10px', border: 'none', cursor: 'pointer',
                background: viewMode === mode ? C.ink1 : C.card,
                color: viewMode === mode ? '#fff' : C.ink3,
              }}
            >
              {mode === 'byWeek' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>

        {activeTab === 'list' && (
          <>
            {/* Refresh all */}
            <button
              onClick={() => void refreshPrices()}
              disabled={priceWatchLoading}
              title="Refresh all prices"
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.ink3, cursor: 'pointer' }}
            >
              <IconRefresh size={13} /> {priceWatchLoading ? 'Checking…' : 'Refresh prices'}
            </button>
            {/* New list */}
            <button
              onClick={() => setShowAddGroup(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, background: C.ink1, color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              <IconPlus size={13} /> New list
            </button>
          </>
        )}
      </div>

      {/* ── History tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {historyByPeriod.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: 60, color: C.ink4 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ink3 }}>No purchase history yet</div>
              <div style={{ fontSize: 12, color: C.ink4, marginTop: 4 }}>Items you mark as purchased will appear here.</div>
            </div>
          )}
          {historyByPeriod.map(([key, period]) => (
            <div key={key}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: C.ink4, textTransform: 'uppercase', marginBottom: 10 }}>
                {period.label}
              </div>
              <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                {period.items.map((item, idx) => {
                  const store = item.storeUsedId ? stores.find(s => s.id === item.storeUsedId) : undefined
                  return (
                    <div key={item.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                      borderBottom: idx < period.items.length - 1 ? `1px solid ${C.border}` : 'none',
                    }}>
                      <span style={{ fontSize: 13, color: C.pos }}>✓</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink1 }}>{item.name}</div>
                        <div style={{ fontSize: 11, color: C.ink4, marginTop: 1 }}>
                          {item.category}
                          {store && ` · ${store.name}`}
                          {item.purchasedAt && ` · ${new Date(item.purchasedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                        </div>
                      </div>
                      {item.finalPrice && (
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.ink1 }}>
                          {item.currency} {item.finalPrice.toLocaleString()}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Stores tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'stores' && (
        <StoresTab
          stores={stores}
          userId={userId}
          onAddStore={handleAddStore}
          onDeleteStore={deleteStore}
        />
      )}

      {/* ── List tab ─────────────────────────────────────────────────────────── */}
      {activeTab === 'list' && (
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Unscheduled groups */}
        {unscheduledGroups.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {unscheduledGroups.map(group => {
              const groupItems = enrichedItems.filter(i => i.groupId === group.id)
              return (
                <GroupCard
                  key={group.id}
                  group={group}
                  items={groupItems}
                  stores={stores}
                  envelopes={envelopes}
                  onUpdateGroup={patch => updateGroup(group.id, patch)}
                  onDeleteGroup={() => deleteGroup(group.id)}
                  onAddItem={() => { setAddingItemPrefill(''); setAddingItemGroupId(group.id) }}
                  onAddItemWithPrefill={name => handleAddItemWithPrefill(group.id, name)}
                  onUpdateItem={updateItem}
                  onDeleteItem={deleteItem}
                  onPurchaseItem={handlePurchase}
                  onRefreshGroupPrices={() => void refreshPrices(enrichedItems.filter(i => i.groupId === group.id).map(i => i.id))}
                  priceWatchLoading={priceWatchLoading}
                  refreshingItemId={refreshingItemId}
                  onRefreshItemPrice={handleRefreshItemPrice}
                  repeatSuggestions={repeatSuggestions}
                  suggestedPayments={suggestedPayments}
                />
              )
            })}
          </div>
        )}

        {/* Period-grouped scheduled groups */}
        {groupsByPeriod.map(([_key, period]) => (
          <div key={_key}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: C.ink4, textTransform: 'uppercase', marginBottom: 10 }}>
              {period.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {period.groups.map(group => {
                const groupItems = enrichedItems.filter(i => i.groupId === group.id)
                return (
                  <GroupCard
                    key={group.id}
                    group={group}
                    items={groupItems}
                    stores={stores}
                    envelopes={envelopes}
                    onUpdateGroup={patch => updateGroup(group.id, patch)}
                    onDeleteGroup={() => deleteGroup(group.id)}
                    onAddItem={() => { setAddingItemPrefill(''); setAddingItemGroupId(group.id) }}
                    onAddItemWithPrefill={name => handleAddItemWithPrefill(group.id, name)}
                    onUpdateItem={updateItem}
                    onDeleteItem={deleteItem}
                    onPurchaseItem={handlePurchase}
                    onRefreshGroupPrices={() => void refreshPrices(enrichedItems.filter(i => i.groupId === group.id).map(i => i.id))}
                    priceWatchLoading={priceWatchLoading}
                    refreshingItemId={refreshingItemId}
                    onRefreshItemPrice={handleRefreshItemPrice}
                    repeatSuggestions={repeatSuggestions}
                    suggestedPayments={suggestedPayments}
                  />
                )
              })}
            </div>
          </div>
        ))}

        {/* Unscheduled solo items */}
        <UnscheduledSection
          items={unscheduled}
          stores={stores}
          envelopes={envelopes}
          onUpdate={updateItem}
          onDelete={deleteItem}
          onPurchase={handlePurchase}
          onRefreshPrice={handleRefreshItemPrice}
        />

        {/* Empty state */}
        {!activeGroups.length && !unscheduled.length && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, paddingTop: 60, color: C.ink4 }}>
            <span style={{ fontSize: 40 }}>🛒</span>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.ink3 }}>No shopping lists yet</div>
            <div style={{ fontSize: 13, color: C.ink4, textAlign: 'center', maxWidth: 280 }}>
              Create a list for your weekly groceries, monthly household items, or any shopping trip.
            </div>
            <button
              onClick={() => setShowAddGroup(true)}
              style={{ marginTop: 8, fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, background: C.ink1, color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              New shopping list
            </button>
          </div>
        )}
      </div>
      )}

      {/* Modals */}
      {showAddGroup && (
        <AddGroupModal
          onAdd={handleAddGroup}
          onClose={() => setShowAddGroup(false)}
        />
      )}

      {addingItemGroupId && (
        <AddItemModal
          groupId={addingItemGroupId}
          currency={currency}
          prefillName={addingItemPrefill}
          onAdd={item => handleAddItem(addingItemGroupId, item)}
          onClose={() => { setAddingItemGroupId(null); setAddingItemPrefill('') }}
        />
      )}
    </div>
  )
}
