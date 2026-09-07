import { useState } from 'react'
import { SWATCHES } from '@/lib/palettes'
import { X, ChevronDown, Check } from 'lucide-react'
import type { Category } from '../types'
import { IconPicker } from '../components/IconPicker'
import { CategoryGlyph } from '../components/CategoryGlyph'
import { ICON, STROKE } from '@/lib/type'

// ─── Naming a category ───────────────────────────────────────────────────────
// The last window still in the old dialect: a bordered form with stacked
// labels, a raw <input type="color">, and a red Delete block. Same vocabulary
// as everything else now — an eyebrow pill, one pill per value, a black pill
// for the action that commits.
const DISPLAY = 'var(--sb-font-num)'

const PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 42, boxSizing: 'border-box',
  padding: '0 14px', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-card)', border: '1px solid var(--sb-border)',
  color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body)', fontFamily: 'inherit', cursor: 'pointer', minWidth: 0,
}
const ROUND: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--sb-card)', border: '1px solid var(--sb-border)', color: 'var(--sb-ink-3)', cursor: 'pointer',
}
const LABEL: React.CSSProperties = { width: 62, flexShrink: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)', fontWeight: 500 }
const ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 }

/** Enough colours to tell envelopes apart, without a colour wheel nobody wants
 *  to operate on a tablet. */

interface Props {
  category?: Category | null
  categories: Category[]
  onSave: (c: Category) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

export function CategoryModal({ category, categories, onSave, onDelete, onClose }: Props) {
  // A category opened from a "+" button arrives with no name: that is creation,
  // not editing, even though it carries a parent and a type already.
  const isEdit = !!(category?.name)
  const txTypeLocked = !isEdit && !!category?.txType

  const [name,     setName]     = useState(category?.name     ?? '')
  const [icon,     setIcon]     = useState(category?.icon     ?? '📁')
  const [color,    setColor]    = useState(category?.color    ?? SWATCHES[8])
  const [txType,   setTxType]   = useState<Category['txType']>(category?.txType ?? 'expense')
  const [parentId, setParentId] = useState<string>(category?.parentId ?? '')

  const tops = categories.filter(c => !c.parentId && c.id !== category?.id)
  const parent = tops.find(c => c.id === parentId)
  const canSave = !!name.trim()

  function handleSave() {
    if (!canSave) return
    onSave({
      id:        category?.id || crypto.randomUUID(),
      name:      name.trim(),
      icon:      icon || '📁',
      color,
      parentId:  parentId || undefined,
      isSystem:  category?.isSystem ?? false,
      txType,
      sortOrder: category?.sortOrder,
    })
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100, padding: 18,
        background: 'color-mix(in srgb, var(--sb-ink-1) 45.0%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <div style={{
        width: 'clamp(320px, 94vw, 430px)', maxHeight: '90vh', overflowY: 'auto',
        boxSizing: 'border-box', scrollbarWidth: 'thin',
        background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
        boxShadow: 'var(--sb-shadow-frame)', padding: '18px 20px 22px',
      }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 11px',
            borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-field)', color: 'var(--sb-ink-2)', fontSize: 'var(--sb-t-meta)',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: 'var(--sb-r-pill)', background: color, flexShrink: 0 }} />
            {isEdit ? 'Category' : txTypeLocked ? 'New sub-category' : 'New category'}
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} title="Close" style={ROUND}><X size={ICON.sm} /></button>
        </div>

        {/* Icon and name, the way they read on the screen itself */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 14 }}>
          <IconPicker
            value={icon}
            onChange={setIcon}
            trigger={onClick => (
              <button onClick={onClick} title="Pick an icon, or upload one"
                style={{
                  width: 46, height: 46, borderRadius: 'var(--sb-r-nav)', flexShrink: 0, padding: 0,
                  border: '1px solid var(--sb-border)', background: 'var(--sb-field)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                <CategoryGlyph icon={icon} size={24} color="var(--sb-ink-1)" />
              </button>
            )}
          />
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }}
            placeholder="Name it"
            style={{
              flex: 1, minWidth: 0, boxSizing: 'border-box',
              background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
              padding: '13px 15px', fontFamily: DISPLAY, fontSize: 'var(--sb-t-h2)', fontWeight: 600,
              letterSpacing: '-0.02em', color: 'var(--sb-ink-1)', outline: 'none',
            }} />
        </div>

        <div style={{ height: 1, background: 'var(--sb-hairline)', margin: '18px 0' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Money out or money in — locked when it was decided by where you clicked */}
          <div style={ROW}>
            <span style={LABEL}>Type</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 7 }}>
              {([['expense', 'Spending'], ['income', 'Earning']] as const).map(([v, label]) => {
                const on = txType === v
                return (
                  <button key={v} disabled={txTypeLocked}
                    onClick={() => setTxType(v)}
                    title={txTypeLocked ? 'Set by the category this sits under' : undefined}
                    style={{
                      ...PILL, flex: 1, justifyContent: 'center',
                      background: on ? (v === 'income' ? 'var(--sb-positive)' : 'var(--sb-negative)') : 'var(--sb-card)',
                      border: on ? 'none' : '1px solid var(--sb-border)',
                      color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                      fontWeight: on ? 600 : 400,
                      opacity: txTypeLocked && !on ? 0.45 : 1,
                      cursor: txTypeLocked ? 'default' : 'pointer',
                    }}>{label}</button>
                )
              })}
            </span>
          </div>

          <div style={ROW}>
            <span style={LABEL}>Sits in</span>
            <span style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex' }}>
              <span style={{ ...PILL, flex: 1, justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {parent && <CategoryGlyph icon={parent.icon} size={15} color="var(--sb-ink-3)" />}
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: parent ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>
                    {parent ? parent.name : 'Nothing — it stands on its own'}
                  </span>
                </span>
                <ChevronDown size={ICON.sm} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-ink-4)', flexShrink: 0 }} />
              </span>
              <select value={parentId} onChange={e => setParentId(e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
                <option value="">Nothing — it stands on its own</option>
                {tops.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </span>
          </div>

          <div style={{ ...ROW, alignItems: 'flex-start' }}>
            <span style={{ ...LABEL, paddingTop: 9 }}>Colour</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {SWATCHES.map(c => (
                <button key={c} onClick={() => setColor(c)} title={c}
                  style={{
                    width: 30, height: 30, borderRadius: 'var(--sb-r-sm)', cursor: 'pointer', padding: 0,
                    background: c, border: color === c ? '2px solid var(--sb-ink-1)' : '1px solid color-mix(in srgb, var(--sb-ink-1) 12.0%, transparent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  {color === c && <Check size={ICON.sm} strokeWidth={STROKE.active} color="var(--sb-card)" />}
                </button>
              ))}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={handleSave} disabled={!canSave} style={{
            ...PILL, flex: 1, justifyContent: 'center', fontWeight: 600,
            background: canSave ? 'var(--sb-ink-1)' : 'var(--sb-field)',
            border: 'none', color: canSave ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-4)',
            cursor: canSave ? 'pointer' : 'default',
          }}>{isEdit ? 'Save changes' : 'Add category'}</button>
          <button onClick={onClose} style={{ ...PILL, color: 'var(--sb-ink-3)' }}>Cancel</button>
        </div>

        {isEdit && onDelete && (
          <button
            onClick={() => { onDelete(category!.id); onClose() }}
            title="Its transactions stay; they simply stop being filed here"
            style={{
              marginTop: 12, width: '100%', height: 34, borderRadius: 'var(--sb-r-sm)',
              background: 'none', border: 'none', fontFamily: 'inherit',
              color: 'var(--sb-negative)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer',
            }}>
            Delete this category
          </button>
        )}
      </div>
    </div>
  )
}
