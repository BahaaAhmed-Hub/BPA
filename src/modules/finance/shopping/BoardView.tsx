// ─── The board: a column per list, a card per item ───────────────────────────
//
//  The list view answers *when* — lists stacked down the page under the week or
//  month they are scheduled for. It cannot answer *what is on each of them*
//  side by side, because two lists are never on screen together once either has
//  more than a few items on it.
//
//  So: one column per list, the items as cards inside it, and the whole of a
//  week visible at once. **Dragging a card to another column is how an item
//  changes list** — the same thought as the field in the editor, done with the
//  hand instead. dnd-kit with a `DragOverlay`, as the Budget screen does, and
//  the same two sensors, because this board is used on an iPad and `dragstart`
//  never fires for a finger.
//
//  "No list" is a column like any other and is always drawn, or an item has no
//  way *out* of a list — you could put things in and never take them out again.

import { useState, useRef, useLayoutEffect } from 'react'
import {
  DndContext, pointerWithin, PointerSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable, DragOverlay, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import type { ShoppingGroup, ShoppingItem, ShoppingStore } from './types'
import { ItemFields, type EnvelopeRow } from './ItemFields'

const C = {
  page:   'var(--sb-page)',
  card:   'var(--sb-card)',
  field:  'var(--sb-field)',
  border: 'var(--sb-border)',
  ink1:   'var(--sb-ink-1)',
  ink3:   'var(--sb-ink-3)',
  ink4:   'var(--sb-ink-4)',
  accent: 'var(--sb-accent)',
  pos:    'var(--sb-positive)',
  neg:    'var(--sb-negative)',
} as const

/** The column an item with no list lives in. Not a group id — a group can
 *  never have this id, because every group id is a uuid. */
export const NO_LIST = 'no-list'

function IconPlus({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}
function IconCheck({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

// ─── Drag primitives, as the Budget screen has them ──────────────────────────

function Draggable({ id, disabled, children }: {
  id: string; disabled?: boolean; children: (dragging: boolean) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      style={{ touchAction: 'none', opacity: isDragging ? 0.35 : 1 }}>
      {children(isDragging)}
    </div>
  )
}

function DropZone({ id, disabled, children }: {
  id: string; disabled?: boolean; children: (over: boolean) => React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled })
  return <div ref={setNodeRef} style={{ display: 'flex', flex: 1, minHeight: 0 }}>{children(isOver && !disabled)}</div>
}

// ─── A card ──────────────────────────────────────────────────────────────────

const PRIORITY_MARK: Record<number, { label: string; color: string } | undefined> = {
  1: { label: 'High',   color: 'var(--sb-accent-deep)' },
  2: { label: 'Urgent', color: C.neg },
}

function ItemCard({ item, groups, stores, envelopes, open, onOpen, onUpdate, onDelete, onPurchase, dragging }: {
  item: ShoppingItem
  groups: ShoppingGroup[]
  stores: ShoppingStore[]
  envelopes: EnvelopeRow[]
  open: boolean
  onOpen: () => void
  onUpdate: (patch: Partial<ShoppingItem>) => void
  onDelete: () => void
  onPurchase: () => void
  dragging?: boolean
}) {
  const purchased = item.status === 'purchased'
  const mark = PRIORITY_MARK[item.priority]

  return (
    <div style={{
      background: C.card, border: `1px solid ${open ? C.accent : C.border}`, borderRadius: 10,
      boxShadow: dragging ? '0 6px 18px rgba(25,23,18,.18)' : '0 1px 2px rgba(25,23,18,.05)',
      opacity: purchased ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px' }}>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onPurchase() }}
          title={purchased ? 'Back on the list' : 'Mark purchased'}
          style={{
            width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
            border: `2px solid ${purchased ? C.pos : C.border}`,
            background: purchased ? C.pos : 'transparent',
            color: 'var(--sb-ink-on-fill)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
          }}
        >
          {purchased && <IconCheck />}
        </button>

        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onOpen}>
          <div style={{
            fontSize: 12.5, fontWeight: 600, color: C.ink1, lineHeight: 1.3,
            textDecoration: purchased ? 'line-through' : 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {item.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, color: C.ink4 }}>
              {item.quantity}{item.unit ? ` ${item.unit}` : ''} · {item.category}
            </span>
            {mark && (
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: mark.color, textTransform: 'uppercase' }}>
                {mark.label}
              </span>
            )}
          </div>
          {(item.bestPrice || item.targetPriceMax || item.finalPrice) && (
            <div style={{ fontSize: 10.5, color: C.ink3, marginTop: 2 }}>
              {purchased && item.finalPrice != null
                ? `Paid ${item.currency} ${item.finalPrice.toLocaleString()}`
                : item.bestPrice
                  ? `${item.bestPrice.currency} ${item.bestPrice.price.toLocaleString()} · ${item.bestPrice.storeName}`
                  : `max ${item.currency} ${item.targetPriceMax?.toLocaleString()}`}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px', background: `color-mix(in srgb, ${C.field} 55%, transparent)` }}>
          <ItemFields
            item={item} groups={groups} stores={stores} envelopes={envelopes}
            onUpdate={onUpdate} onDelete={onDelete} showName
          />
        </div>
      )}
    </div>
  )
}

// ─── A column ────────────────────────────────────────────────────────────────

interface ColumnProps {
  id: string
  group?: ShoppingGroup
  items: ShoppingItem[]
  groups: ShoppingGroup[]
  stores: ShoppingStore[]
  envelopes: EnvelopeRow[]
  openItemId: string | null
  dragging: string | null
  onOpenItem: (id: string | null) => void
  onUpdateItem: (id: string, patch: Partial<ShoppingItem>) => void
  onDeleteItem: (id: string) => void
  onPurchaseItem: (id: string) => void
  onUnpurchaseItem: (id: string) => void
  onUpdateGroup?: (patch: Partial<ShoppingGroup>) => void
  onAddItem?: () => void
}

function Column({
  id, group, items, groups, stores, envelopes, openItemId, dragging,
  onOpenItem, onUpdateItem, onDeleteItem, onPurchaseItem, onUnpurchaseItem, onUpdateGroup, onAddItem,
}: ColumnProps) {
  const [editName, setEditName] = useState(false)
  const [nameVal, setNameVal]   = useState(group?.name ?? '')

  const live      = items.filter(i => i.status !== 'purchased').sort((a, b) => a.sortOrder - b.sortOrder)
  const purchased = items.filter(i => i.status === 'purchased')
  const estimated = live.reduce((s, i) => s + (i.targetPriceMax ?? i.bestPrice?.price ?? 0), 0)
  const currency  = live[0]?.currency ?? 'EGP'

  return (
    <DropZone id={`col:${id}`} disabled={!dragging}>
      {over => (
        <div style={{
          width: 268, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0,
          background: over ? `color-mix(in srgb, ${C.accent} 12%, ${C.page})` : C.page,
          border: `1px ${over ? 'solid' : 'dashed'} ${over ? C.accent : C.border}`,
          borderRadius: 14, transition: 'background .15s',
        }}>
          {/* Header */}
          <div style={{ padding: '10px 12px 8px', display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            <span style={{ fontSize: 16 }} aria-hidden>{group?.icon ?? '📥'}</span>
            {editName && group && onUpdateGroup ? (
              <input
                autoFocus value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                onBlur={() => { if (nameVal.trim()) onUpdateGroup({ name: nameVal.trim() }); setEditName(false) }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setNameVal(group.name); setEditName(false) } }}
                style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, background: C.field, border: `1px solid ${C.accent}`, borderRadius: 6, padding: '2px 6px', color: C.ink1 }}
              />
            ) : (
              <span
                onClick={() => { if (group && onUpdateGroup) { setNameVal(group.name); setEditName(true) } }}
                title={group ? 'Rename this list' : 'Items that are not on any list'}
                style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: C.ink1, cursor: group ? 'text' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {group?.name ?? 'No list'}
              </span>
            )}
            <span style={{ fontSize: 11, color: C.ink4, flexShrink: 0 }}>{live.length}</span>
          </div>

          {(group?.scheduledDate || estimated > 0) && (
            <div style={{ padding: '0 12px 8px', fontSize: 10.5, color: C.ink4, display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
              {group?.scheduledDate && (
                <span>{new Date(group.scheduledDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              )}
              {estimated > 0 && <span>{currency} {estimated.toLocaleString()} est.</span>}
            </div>
          )}

          {/* Cards */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 60 }}>
            {live.map(item => (
              <Draggable key={item.id} id={item.id} disabled={openItemId === item.id}>
                {isDragging => (
                  <ItemCard
                    item={item} groups={groups} stores={stores} envelopes={envelopes}
                    open={openItemId === item.id}
                    onOpen={() => onOpenItem(openItemId === item.id ? null : item.id)}
                    onUpdate={patch => onUpdateItem(item.id, patch)}
                    onDelete={() => onDeleteItem(item.id)}
                    onPurchase={() => onPurchaseItem(item.id)}
                    dragging={isDragging}
                  />
                )}
              </Draggable>
            ))}

            {!live.length && !purchased.length && (
              <div style={{ fontSize: 11, color: C.ink4, textAlign: 'center', padding: '18px 8px' }}>
                {dragging ? 'Drop an item here' : 'Nothing on this list'}
              </div>
            )}

            {purchased.length > 0 && (
              <details>
                <summary style={{ fontSize: 10.5, color: C.ink4, cursor: 'pointer', listStyle: 'none', padding: '4px 2px' }}>
                  {purchased.length} purchased
                </summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 5 }}>
                  {purchased.map(item => (
                    <ItemCard
                      key={item.id}
                      item={item} groups={groups} stores={stores} envelopes={envelopes}
                      open={openItemId === item.id}
                      onOpen={() => onOpenItem(openItemId === item.id ? null : item.id)}
                      onUpdate={patch => onUpdateItem(item.id, patch)}
                      onDelete={() => onDeleteItem(item.id)}
                      onPurchase={() => onUnpurchaseItem(item.id)}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>

          {onAddItem && (
            <button
              onClick={onAddItem}
              style={{
                margin: '0 8px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                fontSize: 11.5, color: C.ink4, background: 'none', border: `1px dashed ${C.border}`,
                borderRadius: 8, padding: '7px', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <IconPlus /> Add item
            </button>
          )}
        </div>
      )}
    </DropZone>
  )
}

// ─── The board ───────────────────────────────────────────────────────────────

export interface BoardViewProps {
  groups:    ShoppingGroup[]
  items:     ShoppingItem[]
  stores:    ShoppingStore[]
  envelopes: EnvelopeRow[]
  onUpdateItem:   (id: string, patch: Partial<ShoppingItem>) => void
  onDeleteItem:   (id: string) => void
  onPurchaseItem: (id: string) => void
  onUnpurchaseItem: (id: string) => void
  onUpdateGroup:  (id: string, patch: Partial<ShoppingGroup>) => void
  onAddItem:      (groupId: string | undefined) => void
  onNewList:      () => void
}

/**
 * How tall the board may be, **measured**, not guessed at.
 *
 * `height: 100%` is no use here: the Shopping screen sits in a column that is
 * sized to its content, so its own 100% resolves to whatever the list view
 * happened to draw — 269px of a 1000px window. A `calc(100vh - 212px)` in its
 * place would be a guess about the height of every bar above it, which is the
 * mistake the calendar panel made and put its footer below the fold.
 *
 * So the board asks where it actually starts and takes the rest of the window,
 * and asks again whenever the window changes.
 */
function useFillsTheWindow() {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()

  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      setHeight(Math.max(260, window.innerHeight - top - 16))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  return { ref, height }
}

export function BoardView({
  groups, items, stores, envelopes,
  onUpdateItem, onDeleteItem, onPurchaseItem, onUnpurchaseItem, onUpdateGroup, onAddItem, onNewList,
}: BoardViewProps) {
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [dragging, setDragging]     = useState<string | null>(null)
  const { ref, height } = useFillsTheWindow()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 180, tolerance: 8 } }),
  )

  const active = groups.filter(g => g.status === 'active').sort((a, b) => a.sortOrder - b.sortOrder)
  const dragged = dragging ? items.find(i => i.id === dragging) : undefined

  function handleDragStart(e: DragStartEvent) {
    setDragging(String(e.active.id))
    setOpenItemId(null)
  }

  function handleDragEnd(e: DragEndEvent) {
    const itemId = String(e.active.id)
    setDragging(null)
    const target = e.over ? String(e.over.id) : null
    if (!target?.startsWith('col:')) return
    const colId = target.slice(4)
    const item  = items.find(i => i.id === itemId)
    if (!item) return
    const groupId = colId === NO_LIST ? undefined : colId
    if ((item.groupId ?? undefined) === groupId) return
    // Land at the end of the column it was dropped on.
    const siblings = items.filter(i => (i.groupId ?? undefined) === groupId)
    const sortOrder = siblings.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1
    onUpdateItem(itemId, { groupId, sortOrder })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setDragging(null)}>
      <div ref={ref} style={{ height, minHeight: 0, overflowX: 'auto', overflowY: 'hidden', padding: '16px 24px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', height: '100%', minHeight: 0 }}>
          {active.map(g => (
            <Column
              key={g.id}
              id={g.id}
              group={g}
              items={items.filter(i => i.groupId === g.id)}
              groups={groups} stores={stores} envelopes={envelopes}
              openItemId={openItemId} dragging={dragging}
              onOpenItem={setOpenItemId}
              onUpdateItem={onUpdateItem}
              onDeleteItem={onDeleteItem}
              onPurchaseItem={onPurchaseItem}
              onUnpurchaseItem={onUnpurchaseItem}
              onUpdateGroup={patch => onUpdateGroup(g.id, patch)}
              onAddItem={() => onAddItem(g.id)}
            />
          ))}

          <Column
            id={NO_LIST}
            items={items.filter(i => !i.groupId)}
            groups={groups} stores={stores} envelopes={envelopes}
            openItemId={openItemId} dragging={dragging}
            onOpenItem={setOpenItemId}
            onUpdateItem={onUpdateItem}
            onDeleteItem={onDeleteItem}
            onPurchaseItem={onPurchaseItem}
            onUnpurchaseItem={onUnpurchaseItem}
            onAddItem={() => onAddItem(undefined)}
          />

          <button
            onClick={onNewList}
            style={{
              width: 148, flexShrink: 0, alignSelf: 'flex-start', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6, fontSize: 12, color: C.ink4, background: 'none',
              border: `1px dashed ${C.border}`, borderRadius: 14, padding: '14px 10px', cursor: 'pointer',
            }}
          >
            <IconPlus /> New list
          </button>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragged && (
          <div style={{ width: 252 }}>
            <ItemCard
              item={dragged} groups={groups} stores={stores} envelopes={envelopes}
              open={false} onOpen={() => {}} onUpdate={() => {}} onDelete={() => {}} onPurchase={() => {}}
              dragging
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
