// ─── Every field of an item, edited where it is ──────────────────────────────
//
//  An item had four editable fields — category, notes, max price, and a store
//  picker that wrote to a derived field and reset itself. Everything else about
//  it could only be set once, in the Add modal, and never corrected: not its
//  name, not how many, not which list it is on, not what you actually paid.
//
//  So this is the whole of an item, in one place, used by **both** views — the
//  list's expanded row and the board's opened card. One component, because two
//  copies of a form is two forms that disagree about which fields exist.
//
//  The contract is the calendar composer's, to the millisecond: **every control
//  writes straight through**. A select, a pill or a tick is a decision and goes
//  the moment it is made; words are held 700ms so a keystroke is not a request,
//  and a pending edit is flushed on blur, on Enter, and on unmount — closing the
//  row is not how you lose the sentence you just typed.

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import type { ShoppingItem, ShoppingGroup, ShoppingStore } from './types'
import { ITEM_CATEGORIES } from './types'
import { storesToCheck } from './shoppingStore'
import { storeIdsSupported } from './shoppingDb'
import { baseCurrency, loadRates } from '../fx'

const C = {
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

const HOLD_MS = 700

// ─── A field that holds its words, then pushes them ──────────────────────────

function useHeldText(value: string, push: (v: string) => void) {
  const [text, setText] = useState(value)
  const timer   = useRef<number | null>(null)
  const dirty   = useRef(false)
  const textRef = useRef(value)
  const pushRef = useRef(push)

  pushRef.current = push
  textRef.current = text

  // A value arriving from outside — another device, an undo — is taken only
  // while nothing is half-typed here, or it overwrites the caret.
  useEffect(() => { if (!dirty.current) setText(value) }, [value])

  const commit = useCallback((v: string) => {
    dirty.current = false
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    pushRef.current(v)
  }, [])

  const onChange = useCallback((v: string) => {
    setText(v)
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => commit(v), HOLD_MS)
  }, [commit])

  const onBlur = useCallback(() => { if (dirty.current) commit(textRef.current) }, [commit])

  // The row closing is a commit, not a cancel.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (dirty.current) pushRef.current(textRef.current)
  }, [])

  return { text, onChange, onBlur }
}

// ─── Primitives ──────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  fontSize: 12, padding: '5px 7px', borderRadius: 6, width: '100%',
  border: `1px solid ${C.border}`, background: C.field, color: C.ink1,
  fontFamily: 'inherit', minWidth: 0,
}

function Field({ label, children, grow = 1 }: { label: string; children: ReactNode; grow?: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: `${grow} 1 0`, minWidth: 0 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: C.ink4, textTransform: 'uppercase' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>{children}</div>
}

function TextField({ label, value, onPush, placeholder, grow }: {
  label: string; value: string; onPush: (v: string) => void; placeholder?: string; grow?: number
}) {
  const { text, onChange, onBlur } = useHeldText(value, onPush)
  return (
    <Field label={label} grow={grow}>
      <input
        value={text}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={inputStyle}
      />
    </Field>
  )
}

function NumField({ label, value, onPush, placeholder, grow }: {
  label: string; value: number | undefined; onPush: (v: number | undefined) => void
  placeholder?: string; grow?: number
}) {
  const { text, onChange, onBlur } = useHeldText(
    value === undefined ? '' : String(value),
    v => {
      const trimmed = v.trim()
      if (!trimmed) return onPush(undefined)
      const n = parseFloat(trimmed)
      // A half-typed number is not a reason to write a zero.
      if (isFinite(n)) onPush(n)
    },
  )
  return (
    <Field label={label} grow={grow}>
      <input
        value={text}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={inputStyle}
      />
    </Field>
  )
}

function SelectField({ label, value, onPush, options, grow }: {
  label: string; value: string; onPush: (v: string) => void
  options: { value: string; label: string }[]; grow?: number
}) {
  return (
    <Field label={label} grow={grow}>
      <select value={value} onChange={e => onPush(e.target.value)} style={inputStyle}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  )
}

/** Three or four answers, each one tap. A select you must open to see what is
 *  possible is the wrong shape for a set this small. */
function Choice<T extends string | number>({ label, value, onPush, options, grow }: {
  label: string; value: T; onPush: (v: T) => void
  options: { value: T; label: string; color?: string }[]; grow?: number
}) {
  return (
    <Field label={label} grow={grow}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {options.map(o => {
          const on = o.value === value
          const tint = o.color ?? C.accent
          return (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => onPush(o.value)}
              style={{
                fontSize: 11, fontWeight: on ? 600 : 400, padding: '4px 10px', borderRadius: 7,
                cursor: 'pointer', whiteSpace: 'nowrap',
                border: `1px solid ${on ? tint : C.border}`,
                background: on ? `color-mix(in srgb, ${tint} 18%, ${C.card})` : C.field,
                color: on ? C.ink1 : C.ink3,
              }}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </Field>
  )
}

// ─── The whole item ──────────────────────────────────────────────────────────

export interface EnvelopeRow {
  id: string; name: string; remaining: number; currency: string; dueAccountName?: string
}

export interface ItemFieldsProps {
  item:      ShoppingItem
  groups:    ShoppingGroup[]
  stores:    ShoppingStore[]
  envelopes: EnvelopeRow[]
  onUpdate:  (patch: Partial<ShoppingItem>) => void
  onDelete:  () => void
  /** The name is drawn in the row header in the list view, and here on a board
   *  card that has no header of its own. */
  showName?: boolean
}

const STATUS_OPTIONS = [
  { value: 'wanted'    as const, label: 'Wanted' },
  { value: 'planned'   as const, label: 'Planned' },
  { value: 'purchased' as const, label: 'Purchased', color: C.pos },
]

const PRIORITY_OPTIONS = [
  { value: 0, label: 'Normal' },
  { value: 1, label: 'High' },
  { value: 2, label: 'Urgent', color: C.neg },
]

/** The currencies you have actually given a rate for, plus the base and this
 *  item's own — never a hard-coded three, which is how a figure in a fourth
 *  currency becomes uneditable. */
function currencyOptions(own: string): { value: string; label: string }[] {
  const base = baseCurrency()
  const set = new Set<string>([base, ...Object.keys(loadRates()), own].filter(Boolean))
  return [...set].sort().map(c => ({ value: c, label: c === base ? `${c} (base)` : c }))
}

export function ItemFields({ item, groups, stores, envelopes, onUpdate, onDelete, showName }: ItemFieldsProps) {
  const chosen    = item.storeIds ?? []
  const effective = storesToCheck(item, stores)
  const byCategory = !chosen.length
  const purchased = item.status === 'purchased'

  function toggleStore(id: string) {
    const next = chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id]
    onUpdate({ storeIds: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {showName && (
        <TextField label="Item" value={item.name} onPush={v => { if (v.trim()) onUpdate({ name: v.trim() }) }} />
      )}

      <Row>
        <NumField label="Quantity" value={item.quantity} onPush={v => onUpdate({ quantity: v ?? 1 })} grow={1} />
        <TextField label="Unit" value={item.unit ?? ''} onPush={v => onUpdate({ unit: v.trim() || undefined })} placeholder="kg, pack…" grow={1} />
        <SelectField
          label="Category" value={item.category} onPush={v => onUpdate({ category: v })} grow={2}
          options={ITEM_CATEGORIES.map(c => ({ value: c, label: c }))}
        />
      </Row>

      <Row>
        <SelectField
          label="List"
          value={item.groupId ?? ''}
          onPush={v => onUpdate({ groupId: v || undefined })}
          grow={2}
          options={[
            { value: '', label: 'No list' },
            ...groups.filter(g => g.status === 'active').map(g => ({ value: g.id, label: `${g.icon} ${g.name}` })),
          ]}
        />
        <NumField
          label={`Max price`} value={item.targetPriceMax}
          onPush={v => onUpdate({ targetPriceMax: v })} placeholder="No limit" grow={1}
        />
        <SelectField
          label="Currency" value={item.currency} onPush={v => onUpdate({ currency: v })} grow={1}
          options={currencyOptions(item.currency)}
        />
      </Row>

      <Row>
        <Choice label="Status" value={item.status} onPush={v => onUpdate({
          status: v,
          // Moving off purchased takes the purchase with it, or the history
          // shows a date for something that is back on the list.
          ...(v === 'purchased'
            ? { purchasedAt: item.purchasedAt ?? new Date().toISOString() }
            : { purchasedAt: undefined, finalPrice: undefined, storeUsedId: undefined }),
        })} options={STATUS_OPTIONS} grow={2} />
        <Choice label="Priority" value={item.priority} onPush={v => onUpdate({ priority: v })} options={PRIORITY_OPTIONS} grow={1} />
      </Row>

      {envelopes.length > 0 && (
        <SelectField
          label="Budget" value={item.budgetEnvelopeId ?? ''}
          onPush={v => onUpdate({ budgetEnvelopeId: v || undefined })}
          options={[
            { value: '', label: 'Not budgeted' },
            ...envelopes.map(e => ({ value: e.id, label: e.name })),
          ]}
        />
      )}

      {/* Which stores get checked. Your pick wins; with none picked it is the
          category match, and the caption says which of the two is in force —
          an empty row of pills used to look like "nowhere". */}
      {stores.length > 0 && (
        <Field label="Check prices at">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {stores.map(s => {
              const picked = chosen.includes(s.id)
              const inPlay = effective.some(e => e.id === s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleStore(s.id)}
                  title={picked ? `Checking ${s.name}` : inPlay ? `${s.name} — matched by category` : `Also check ${s.name}`}
                  style={{
                    fontSize: 11, padding: '3px 9px', borderRadius: 10, cursor: 'pointer',
                    background: picked ? `color-mix(in srgb, ${C.accent} 22%, ${C.card})` : C.field,
                    color: picked || inPlay ? C.ink1 : C.ink3,
                    border: `1px ${inPlay && !picked ? 'dashed' : 'solid'} ${picked ? C.accent : C.border}`,
                    fontWeight: picked ? 600 : 400,
                  }}
                >
                  {s.name}
                </button>
              )
            })}
          </div>
          <span style={{ fontSize: 10.5, color: C.ink4, marginTop: 3 }}>
            {byCategory
              ? effective.length
                ? `Nothing picked — checking the ${effective.length} store${effective.length === 1 ? '' : 's'} that carry ${item.category}.`
                : `No store carries ${item.category}. Give one that category, or pick one here.`
              : `Checking ${effective.length} picked store${effective.length === 1 ? '' : 's'}.`}
            {!storeIdsSupported() && ' Kept on this device only — 20260019 has not run.'}
          </span>
        </Field>
      )}

      <TextField label="Notes" value={item.notes ?? ''} onPush={v => onUpdate({ notes: v.trim() || undefined })} placeholder="Any notes…" />

      {/* What it actually cost, once it has been bought. Correcting the price
          you paid is the edit most worth having and there was no way to make
          it: the confirm dialog asked once and never again. */}
      {purchased && (
        <Row>
          <NumField label="Paid" value={item.finalPrice} onPush={v => onUpdate({ finalPrice: v })} placeholder="Actual price" grow={1} />
          <SelectField
            label="Bought at" value={item.storeUsedId ?? ''} onPush={v => onUpdate({ storeUsedId: v || undefined })} grow={1}
            options={[{ value: '', label: 'Not recorded' }, ...stores.map(s => ({ value: s.id, label: s.name }))]}
          />
          <Field label="Bought on" grow={1}>
            <input
              type="date"
              value={(item.purchasedAt ?? '').slice(0, 10)}
              onChange={e => onUpdate({
                purchasedAt: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : undefined,
              })}
              style={inputStyle}
            />
          </Field>
        </Row>
      )}

      <button
        type="button"
        onClick={onDelete}
        style={{
          alignSelf: 'flex-start', fontSize: 11, color: C.neg, background: 'none',
          border: 'none', cursor: 'pointer', padding: 0, marginTop: 2,
        }}
      >
        Remove item
      </button>
    </div>
  )
}
