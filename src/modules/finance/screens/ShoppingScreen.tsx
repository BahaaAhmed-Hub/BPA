// Shopping List Screen — lives inside Finance module as a sub-view.
// Groups are schedulable, recurring shopping lists. Items belong to groups.
// Price watching is automatic via Edge Function; stores are user-defined by URL.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useShoppingStore, storesToCheck } from '../shopping/shoppingStore'
import { useFinanceStore } from '../financeStore'
import type { ShoppingGroup, ShoppingItem, ShoppingStore, ShoppingViewMode } from '../shopping/types'
import { ITEM_CATEGORIES } from '../shopping/types'
import { ItemFields, type EnvelopeRow } from '../shopping/ItemFields'
import { StoresTab } from '../shopping/StoresTab'
import { BoardView, NO_LIST } from '../shopping/BoardView'
import { loadRules } from '../modals/BudgetRuleModal'
import { Segmented } from '@/components/ui'
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
  pos:     'var(--sb-positive)',
  neg:     'var(--sb-negative)',
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
  const color  = ratio >= 1 ? C.pos : ratio >= 0.5 ? 'var(--sb-accent-deep)' : C.neg
  const label  = ratio >= 1 ? 'Affordable' : ratio >= 0.5 ? 'Tight' : 'Over budget'
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: '0.06em', padding: '2px 6px', borderRadius: 4, background: `color-mix(in srgb, ${color} 15%, var(--sb-card))` }}>
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

interface ItemRowProps {
  item:      ShoppingItem
  groups:    ShoppingGroup[]
  stores:    ShoppingStore[]
  envelopes: EnvelopeRow[]
  onUpdate:  (patch: Partial<ShoppingItem>) => void
  onDelete:  () => void
  onPurchase:(finalPrice?: number, storeId?: string) => void
  onRefreshPrice: () => void
  priceLoading: boolean
  suggestedPaymentAccount?: string
}

function ItemRow({ item, groups, stores, envelopes, onUpdate, onDelete, onPurchase, onRefreshPrice, priceLoading, suggestedPaymentAccount }: ItemRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [confirmPurchase, setConfirmPurchase] = useState(false)
  const [editName, setEditName] = useState(false)
  const [nameVal, setNameVal]   = useState(item.name)
  const [finalPrice, setFinalPrice] = useState(item.finalPrice?.toString() ?? item.bestPrice?.price?.toString() ?? '')

  const purchased = item.status === 'purchased'

  function commitName() {
    const v = nameVal.trim()
    if (v && v !== item.name) onUpdate({ name: v })
    else setNameVal(item.name)
    setEditName(false)
  }

  return (
    <div style={{
      background: C.card, borderRadius: 10, border: `1px solid ${expanded ? C.accent : C.border}`,
      overflow: 'hidden', opacity: purchased && !expanded ? 0.55 : 1,
      transition: 'opacity 0.2s',
    }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 10, cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}>
        {/* Tick — and the way back off it, since a wrong tick used to be final */}
        <button
          onClick={e => {
            e.stopPropagation()
            if (purchased) onUpdate({ status: 'wanted', purchasedAt: undefined, finalPrice: undefined, storeUsedId: undefined })
            else setConfirmPurchase(true)
          }}
          title={purchased ? 'Put it back on the list' : 'Mark purchased'}
          style={{
            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
            border: `2px solid ${purchased ? C.pos : C.border}`,
            background: purchased ? C.pos : 'transparent',
            color: 'var(--sb-ink-on-fill)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
          }}
        >
          {purchased && <IconCheck size={12} />}
        </button>

        {/* Name + meta. The name is the field you most want to correct, so it is
            editable where it is read rather than only down in the editor. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {editName ? (
              <input
                autoFocus
                value={nameVal}
                onClick={e => e.stopPropagation()}
                onChange={e => setNameVal(e.target.value)}
                onBlur={commitName}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') { setNameVal(item.name); setEditName(false) }
                }}
                style={{ fontSize: 13.5, fontWeight: 600, background: C.field, border: `1px solid ${C.accent}`, borderRadius: 6, padding: '2px 6px', color: C.ink1, minWidth: 140 }}
              />
            ) : (
              <span
                onClick={e => { e.stopPropagation(); setNameVal(item.name); setEditName(true) }}
                title="Rename"
                style={{ textDecoration: purchased ? 'line-through' : 'none', cursor: 'text' }}
              >
                {item.name}
              </span>
            )}
            <span style={{ fontSize: 11, color: C.ink4, fontWeight: 400 }}>
              {item.quantity}{item.unit ? ` ${item.unit}` : ''}
            </span>
            {item.priority > 0 && (
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: item.priority >= 2 ? C.neg : 'var(--sb-accent-deep)' }}>
                {item.priority >= 2 ? 'Urgent' : 'High'}
              </span>
            )}
            <AffordabilityChip item={item} envelopes={envelopes} />
          </div>
          <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <BestPriceBadge item={item} />
            {purchased && item.finalPrice != null && (
              <span style={{ fontSize: 11, color: C.pos }}>
                paid {item.currency} {item.finalPrice.toLocaleString()}
              </span>
            )}
            {!purchased && item.targetPriceMax && (
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
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: priceLoading ? 'var(--sb-accent-deep)' : C.ink4, padding: 4 }}
          >
            <IconRefresh size={14} />
          </button>
        )}

        {/* Chevron */}
        <span style={{ color: C.ink4, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <IconChevronDown />
        </span>
      </div>

      {/* Every field, edited where it is. A purchased item opens too — what it
          actually cost is the thing most worth correcting, and the confirm
          dialog asked once and then never again. */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 12px' }}>
          <ItemFields
            item={item}
            groups={groups}
            stores={stores}
            envelopes={envelopes}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        </div>
      )}

      {/* Purchase confirm overlay */}
      {confirmPurchase && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 12px', background: `color-mix(in srgb, ${C.pos} 8%, ${C.card})` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.ink1, marginBottom: 8 }}>Mark as purchased?</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 11, color: C.ink3 }}>
              Final price
              <input
                type="number"
                value={finalPrice}
                onClick={e => e.stopPropagation()}
                onChange={e => setFinalPrice(e.target.value)}
                placeholder="Actual price paid"
                style={{ marginLeft: 6, fontSize: 12, padding: '3px 6px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.field, color: C.ink1, width: 100 }}
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
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, background: C.pos, color: 'var(--sb-ink-on-fill)', border: 'none', cursor: 'pointer' }}
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
  /** Every list, so an item's editor can move it to another one. */
  allGroups: ShoppingGroup[]
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

function GroupCard({ group, items, allGroups, stores, envelopes, onUpdateGroup, onDeleteGroup, onAddItem, onAddItemWithPrefill, onUpdateItem, onDeleteItem, onPurchaseItem, onRefreshGroupPrices, priceWatchLoading, refreshingItemId, onRefreshItemPrice, repeatSuggestions, suggestedPayments }: GroupCardProps) {
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
      // The store it is actually checked at — what you picked, or the category
      // match where you picked nothing. Reading `suggestedStores` here meant the
      // trip was ordered by the category match even for an item you had told it
      // exactly where to buy.
      const sid = storesToCheck(item, stores)[0]?.id
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
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--sb-accent-deep)', padding: '1px 6px', background: `color-mix(in srgb, var(--sb-accent) 20%, var(--sb-card))`, borderRadius: 4 }}>
              {RECURRENCE_LABELS[group.recurrence]}
            </span>
          )}
        </div>

        {/* Refresh prices for this group */}
        <button
          onClick={onRefreshGroupPrices}
          title="Refresh prices for this list"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: priceWatchLoading ? 'var(--sb-accent-deep)' : C.ink4, padding: 4 }}
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
                      background: `color-mix(in srgb, var(--sb-accent) 20%, var(--sb-card))`, border: `1px solid color-mix(in srgb, var(--sb-accent) 60%, transparent)`, color: C.ink1,
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
              groups={allGroups}
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
                    groups={allGroups}
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
              style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '9px', borderRadius: 10, background: C.ink1, color: 'var(--sb-ink-on-fill)', border: 'none', cursor: name.trim() ? 'pointer' : 'not-allowed' }}
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
                style={{ fontSize: 20, width: 36, height: 36, borderRadius: 8, border: `2px solid ${ic === icon ? C.accent : C.border}`, background: ic === icon ? `color-mix(in srgb, var(--sb-accent) 22%, var(--sb-card))` : C.field, cursor: 'pointer' }}>
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
              style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '9px', borderRadius: 10, background: C.ink1, color: 'var(--sb-ink-on-fill)', border: 'none', cursor: name.trim() ? 'pointer' : 'not-allowed' }}
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

function UnscheduledSection({ items, groups, stores, envelopes, onUpdate, onDelete, onPurchase, onRefreshPrice }: {
  items: ShoppingItem[]
  groups: ShoppingGroup[]
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
            groups={groups}
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

// ─── Which shape the lists are drawn in ──────────────────────────────────────
// Two views, two questions. **List** files each list under the week or month it
// is scheduled for and answers *when*. **Board** puts one column per list with
// its items as cards, so a whole week's lists are side by side and an item
// moves between them by being dragged — which is the same thought as the List
// field in its editor, done with the hand.

type ShoppingLayout = 'list' | 'board'
const LAYOUT_KEY = 'shopping-layout'

function loadLayout(): ShoppingLayout {
  try { return localStorage.getItem(LAYOUT_KEY) === 'board' ? 'board' : 'list' } catch { return 'list' }
}
function saveLayout(l: ShoppingLayout) {
  try { localStorage.setItem(LAYOUT_KEY, l) } catch { /* quota */ }
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function ShoppingScreen() {
  const {
    groups, items: rawItems, stores, snapshots, priceWatchLoading,
    addGroup, updateGroup, deleteGroup,
    addItem, updateItem, deleteItem, purchaseItem,
    addStore, updateStore, deleteStore,
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
  // Which shape the lists are drawn in. `viewMode` above is a different
  // question — that one is whether the *list* view files a list under its week
  // or its month, and it has nothing to say about the board.
  const [layout, setLayout] = useState<ShoppingLayout>(loadLayout)
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

  // How many live items each store is currently checked for. A store that is
  // checked for nothing looks identical to one that is doing the work, and the
  // difference is usually a category nobody ticked.
  const storeItemCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of enrichedItems) {
      if (item.status === 'purchased') continue
      for (const st of storesToCheck(item, stores)) {
        counts.set(st.id, (counts.get(st.id) ?? 0) + 1)
      }
    }
    return counts
  }, [enrichedItems, stores])

  // The way back off a tick. Marking something bought by accident used to be
  // final: the board and the list both hid the controls once it was purchased.
  const handleUnpurchase = useCallback((itemId: string) => {
    updateItem(itemId, { status: 'wanted', purchasedAt: undefined, finalPrice: undefined, storeUsedId: undefined })
  }, [updateItem])

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
  // `NO_LIST` is the board's column for items that are on no list — it is not a
  // group id, and writing it as one would send a string no `shopping_groups`
  // row can ever match into the item's foreign key.
  const handleAddItem = useCallback((groupId: string, item: Omit<ShoppingItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    addItem({ ...item, groupId: groupId === NO_LIST ? undefined : groupId, userId })
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

        {/* Which page you are on — the lists, the stores behind them, or what
            has already been bought. */}
        <Segmented
          value={activeTab}
          onChange={setActiveTab}
          aria-label="Section"
          options={[
            { value: 'list'    as const, label: 'Lists' },
            { value: 'stores'  as const, label: 'Stores' },
            { value: 'history' as const, label: 'History' },
          ]}
        />

        {/* How the lists are drawn. Only on the lists page: there is one shape
            of a store and one of a receipt. */}
        {activeTab === 'list' && (
          <Segmented
            value={layout}
            onChange={l => { setLayout(l); saveLayout(l) }}
            aria-label="Layout"
            options={[
              { value: 'list'  as const, label: 'List',  title: 'Lists stacked by when they are scheduled' },
              { value: 'board' as const, label: 'Board', title: 'A column per list, its items as cards' },
            ]}
          />
        )}

        {/* Week or month is a question about the *list* layout and the history,
            and nothing at all about the board — so it is not offered there. */}
        {(activeTab === 'history' || (activeTab === 'list' && layout === 'list')) && (
          <Segmented
            value={viewMode}
            onChange={mode => { setViewMode(mode); useShoppingStore.getState().updateSettings({ viewMode: mode }) }}
            aria-label="Group by"
            options={[
              { value: 'byWeek'  as const, label: 'Week' },
              { value: 'byMonth' as const, label: 'Month' },
            ]}
          />
        )}

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
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, background: C.ink1, color: 'var(--sb-ink-on-fill)', border: 'none', cursor: 'pointer' }}
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
          itemCounts={storeItemCounts}
          onAddStore={handleAddStore}
          onUpdateStore={updateStore}
          onDeleteStore={deleteStore}
        />
      )}

      {/* ── Lists, as a board: a column per list, its items as cards ────────── */}
      {activeTab === 'list' && layout === 'board' && (
        <BoardView
          groups={groups}
          items={enrichedItems}
          stores={stores}
          envelopes={envelopes}
          onUpdateItem={updateItem}
          onDeleteItem={deleteItem}
          onPurchaseItem={id => void handlePurchase(id)}
          onUnpurchaseItem={handleUnpurchase}
          onUpdateGroup={updateGroup}
          onAddItem={groupId => { setAddingItemPrefill(''); setAddingItemGroupId(groupId ?? NO_LIST) }}
          onNewList={() => setShowAddGroup(true)}
        />
      )}

      {/* ── Lists, stacked under the week or month they are scheduled for ───── */}
      {activeTab === 'list' && layout === 'list' && (
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
                  allGroups={groups}
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
                    allGroups={groups}
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
          groups={groups}
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
              style={{ marginTop: 8, fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, background: C.ink1, color: 'var(--sb-ink-on-fill)', border: 'none', cursor: 'pointer' }}
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
