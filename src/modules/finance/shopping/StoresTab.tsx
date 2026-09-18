// ─── Stores, and correcting one ──────────────────────────────────────────────
//
//  A store could be added and deleted and nothing in between: `updateStore` was
//  in the store from the first commit and no screen ever called it. A typo in a
//  URL therefore meant deleting the store — which takes its price history with
//  it, since the snapshots cascade — and adding it again.
//
//  So a row opens, and every field in it writes straight through on the same
//  contract as an item: words held 700ms, a pill or a select the moment it is
//  tapped. The categories matter more than they look: they are what decides
//  which items a store is checked for when nobody has picked by hand.

import { useState, useRef, useEffect, useCallback } from 'react'
import type { ShoppingStore } from './types'
import { ITEM_CATEGORIES } from './types'
import { suggestStoresForCountry } from './storeSuggestions'
import { notify } from '@/lib/undo'

const C = {
  card:   'var(--sb-card)',
  field:  'var(--sb-field)',
  border: 'var(--sb-border)',
  ink1:   'var(--sb-ink-1)',
  ink3:   'var(--sb-ink-3)',
  ink4:   'var(--sb-ink-4)',
  accent: 'var(--sb-accent)',
  neg:    'var(--sb-negative)',
} as const

const HOLD_MS = 700

export const COUNTRY_OPTIONS = [
  { code: 'EG', label: 'Egypt' },
  { code: 'AE', label: 'UAE' },
  { code: 'SA', label: 'Saudi Arabia' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
]

const inputStyle: React.CSSProperties = {
  fontSize: 12, padding: '5px 7px', borderRadius: 6, width: '100%',
  border: `1px solid ${C.border}`, background: C.field, color: C.ink1,
  fontFamily: 'inherit', minWidth: 0,
}

function IconPlus({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}
function IconTrash({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/>
    </svg>
  )
}
function IconPencil({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>
    </svg>
  )
}

// The same held-text contract the item fields use.
function useHeldText(value: string, push: (v: string) => void) {
  const [text, setText] = useState(value)
  const timer = useRef<number | null>(null)
  const dirty = useRef(false)
  const textRef = useRef(value)
  const pushRef = useRef(push)
  pushRef.current = push
  textRef.current = text

  useEffect(() => { if (!dirty.current) setText(value) }, [value])

  const commit = useCallback((v: string) => {
    dirty.current = false
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    pushRef.current(v)
  }, [])

  const onChange = useCallback((v: string) => {
    setText(v); dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => commit(v), HOLD_MS)
  }, [commit])

  const onBlur = useCallback(() => { if (dirty.current) commit(textRef.current) }, [commit])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (dirty.current) pushRef.current(textRef.current)
  }, [])

  return { text, onChange, onBlur }
}

function Field({ label, children, grow = 1 }: { label: string; children: React.ReactNode; grow?: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: `${grow} 1 0`, minWidth: 0 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: C.ink4, textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>
  )
}

function HeldInput({ label, value, onPush, placeholder, grow }: {
  label: string; value: string; onPush: (v: string) => void; placeholder?: string; grow?: number
}) {
  const { text, onChange, onBlur } = useHeldText(value, onPush)
  return (
    <Field label={label} grow={grow}>
      <input
        value={text} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} onBlur={onBlur}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={inputStyle}
      />
    </Field>
  )
}

function CategoryPills({ selected, onToggle }: { selected: string[]; onToggle: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {ITEM_CATEGORIES.map(c => {
        const on = selected.includes(c)
        return (
          <button key={c} type="button" onClick={() => onToggle(c)}
            style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${on ? C.accent : C.border}`,
              background: on ? `color-mix(in srgb, ${C.accent} 22%, ${C.card})` : C.field,
              color: on ? C.ink1 : C.ink3,
            }}>
            {c}
          </button>
        )
      })}
    </div>
  )
}

// ─── One store ───────────────────────────────────────────────────────────────

function StoreRow({ store, itemCount, last, onUpdate, onDelete }: {
  store: ShoppingStore
  /** How many items this store is currently checked for — a store with none is
   *  drawn but doing nothing, which is worth saying rather than leaving you to
   *  work out from its categories. */
  itemCount: number
  last: boolean
  onUpdate: (patch: Partial<ShoppingStore>) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)

  function toggleCat(c: string) {
    const cats = store.categories.includes(c)
      ? store.categories.filter(x => x !== c)
      : [...store.categories, c]
    onUpdate({ categories: cats })
  }

  return (
    <div style={{ borderBottom: last ? 'none' : `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px' }}>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.ink1 }}>{store.name}</div>
          <div style={{ fontSize: 11, color: C.ink4, marginTop: 1, wordBreak: 'break-all' }}>{store.url}</div>
          {store.categories.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
              {store.categories.map(c => (
                <span key={c} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: C.field, color: C.ink3, border: `1px solid ${C.border}` }}>{c}</span>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10, color: C.ink4, marginTop: 3 }}>
            {itemCount > 0
              ? `Checked for ${itemCount} item${itemCount === 1 ? '' : 's'}`
              : store.categories.length
                ? 'No items in its categories yet'
                : 'No categories — it is checked only where you pick it by hand'}
            {store.lastScrapedAt && ` · last checked ${new Date(store.lastScrapedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
            {store.lastScrapeOk === false && <span style={{ color: C.neg, marginLeft: 4 }}>· failed</span>}
          </div>
        </div>

        <button onClick={() => setOpen(o => !o)} title={open ? 'Done' : 'Edit store'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: open ? 'var(--sb-accent-deep)' : C.ink4, padding: 4, flexShrink: 0 }}>
          <IconPencil />
        </button>

        {confirm ? (
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: C.ink3 }}>Remove?</span>
            <button onClick={() => { onDelete(); setConfirm(false) }}
              style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: C.neg, color: 'var(--sb-ink-on-fill)', border: 'none', cursor: 'pointer' }}>Yes</button>
            <button onClick={() => setConfirm(false)}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, background: C.field, color: C.ink3, border: `1px solid ${C.border}`, cursor: 'pointer' }}>No</button>
          </div>
        ) : (
          <button onClick={() => setConfirm(true)} title="Remove store"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.ink4, padding: 4, flexShrink: 0 }}>
            <IconTrash />
          </button>
        )}
      </div>

      {open && (
        <div style={{ padding: '2px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10, background: `color-mix(in srgb, ${C.field} 55%, transparent)` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <HeldInput label="Name" value={store.name} onPush={v => { if (v.trim()) onUpdate({ name: v.trim() }) }} grow={2} />
            <Field label="Country" grow={1}>
              <select value={store.country ?? ''} onChange={e => onUpdate({ country: e.target.value || undefined })} style={inputStyle}>
                <option value="">Not set</option>
                {COUNTRY_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <HeldInput label="Address" value={store.url} onPush={v => { if (v.trim()) onUpdate({ url: v.trim() }) }} placeholder="https://…" />
          <Field label="Categories it carries">
            <CategoryPills selected={store.categories} onToggle={toggleCat} />
          </Field>
          {store.url && (
            <a href={store.url} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: C.ink3, alignSelf: 'flex-start' }}>
              Open {store.name} ↗
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// ─── The tab ─────────────────────────────────────────────────────────────────

export interface StoresTabProps {
  stores:       ShoppingStore[]
  userId:       string
  /** store id → how many live items it is currently checked for. */
  itemCounts:   Map<string, number>
  onAddStore:   (s: Omit<ShoppingStore, 'id' | 'createdAt' | 'updatedAt'>) => void
  onUpdateStore:(id: string, patch: Partial<ShoppingStore>) => void
  onDeleteStore:(id: string) => void
}

export function StoresTab({ stores, userId, itemCounts, onAddStore, onUpdateStore, onDeleteStore }: StoresTabProps) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName]         = useState('')
  const [url, setUrl]           = useState('')
  const [country, setCountry]   = useState('EG')
  const [selCats, setSelCats]   = useState<string[]>([])

  const suggestions = suggestStoresForCountry(country)

  function applyTemplate(s: { name: string; url: string; categories: string[] }) {
    setName(s.name); setUrl(s.url); setSelCats(s.categories)
  }

  function toggleCat(c: string) {
    setSelCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  }

  function handleAdd() {
    if (!name.trim() || !url.trim()) return
    onAddStore({ userId, name: name.trim(), url: url.trim(), country: country || undefined, categories: selCats, sortOrder: stores.length })
    notify(`Store "${name.trim()}" added`)
    setName(''); setUrl(''); setSelCats([]); setShowForm(false)
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {stores.length > 0 && (
        <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
          {stores.map((store, idx) => (
            <StoreRow
              key={store.id}
              store={store}
              itemCount={itemCounts.get(store.id) ?? 0}
              last={idx === stores.length - 1}
              onUpdate={patch => onUpdateStore(store.id, patch)}
              onDelete={() => onDeleteStore(store.id)}
            />
          ))}
        </div>
      )}

      {showForm ? (
        <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink1, marginBottom: 2 }}>Add store</div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={country} onChange={e => setCountry(e.target.value)}
              style={{ ...inputStyle, width: 'auto' }}>
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

          <input value={name} onChange={e => setName(e.target.value)} placeholder="Store name" style={{ ...inputStyle, fontSize: 13, padding: '7px 10px' }} />
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" style={{ ...inputStyle, padding: '7px 10px' }} />

          <Field label="Categories">
            <CategoryPills selected={selCats} onToggle={toggleCat} />
          </Field>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleAdd} disabled={!name.trim() || !url.trim()}
              style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '8px', borderRadius: 9, background: C.ink1, color: 'var(--sb-ink-on-fill)', border: 'none', cursor: name.trim() && url.trim() ? 'pointer' : 'not-allowed' }}>
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
          <IconPlus /> Add a store
        </button>
      )}

      {stores.length === 0 && !showForm && (
        <div style={{ textAlign: 'center', paddingTop: 40, color: C.ink4 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden>🏪</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink3 }}>No stores yet</div>
          <div style={{ fontSize: 12, color: C.ink4, marginTop: 4 }}>Add stores to enable price tracking and trip optimization.</div>
        </div>
      )}
    </div>
  )
}
