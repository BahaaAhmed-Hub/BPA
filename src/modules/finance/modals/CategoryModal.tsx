import { useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'
import type { Category } from '../types'
import { IconPicker } from '../components/IconPicker'

const RED   = '#DA4A3E'
const GREEN = '#2FA869'
void GREEN

interface Props {
  category?: Category | null
  categories: Category[]
  onSave: (c: Category) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

export function CategoryModal({ category, categories, onSave, onDelete, onClose }: Props) {
  const theme = getTheme(useUIStore(s => s.themeId))

  // A "real edit" is when the category already has a name (exists in store).
  // Opening from a section "+" button has name='' — it's creation, not editing.
  const isEdit = !!(category?.name)
  // When created from a section button, the txType is pre-determined and should be locked.
  const txTypeLocked = !isEdit && !!category?.txType

  const [name,     setName]     = useState(category?.name     ?? '')
  const [icon,     setIcon]     = useState(category?.icon     ?? '📁')
  const [color,    setColor]    = useState(category?.color    ?? '#8C8071')
  const [txType,   setTxType]   = useState<Category['txType']>(category?.txType ?? 'expense')
  const [parentId, setParentId] = useState<string>(category?.parentId ?? '')

  const topCategories = categories.filter(c => !c.parentId && c.id !== category?.id)

  function handleSave() {
    const saved: Category = {
      id:        category?.id ?? crypto.randomUUID(),
      name:      name.trim(),
      icon:      icon || '📁',
      color,
      parentId:  parentId || undefined,
      isSystem:  category?.isSystem ?? false,
      txType,
      sortOrder: category?.sortOrder,
    }
    onSave(saved)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${theme.border}`,
    background: theme.bg,
    color: theme.text,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: theme.textDim,
    marginBottom: 5,
    fontWeight: 500,
  }

  const fieldStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column' as const,
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div style={{
        width: 460,
        maxHeight: '90vh',
        overflowY: 'auto',
        background: theme.surface,
        borderRadius: 16,
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: theme.text }}>
              {isEdit ? 'Edit Category' : 'New Category'}
            </span>
            {txTypeLocked && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.8px',
                padding: '3px 8px', borderRadius: 5,
                background: txType === 'income' ? 'rgba(47,168,105,0.15)' : 'rgba(218,74,62,0.15)',
                color: txType === 'income' ? '#2FA869' : '#DA4A3E',
                textTransform: 'uppercase' as const,
              }}>
                {txType}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 20,
              color: theme.textDim,
              lineHeight: 1,
              padding: '0 4px',
              fontFamily: 'inherit',
            }}
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Name */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Name</label>
            <input
              style={inputStyle}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Category name"
            />
          </div>

          {/* Icon */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Icon</label>
            <IconPicker value={icon} onChange={setIcon} size={44} />
          </div>

          {/* Color */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Color</label>
            <input
              style={{ ...inputStyle, padding: '6px 12px', height: 40, cursor: 'pointer' }}
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
            />
          </div>

          {/* Type — locked when creating from a section button */}
          {!txTypeLocked && (
            <div style={fieldStyle}>
              <label style={labelStyle}>Type</label>
              <select
                style={inputStyle}
                value={txType}
                onChange={e => setTxType(e.target.value as Category['txType'])}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="both">Both</option>
              </select>
            </div>
          )}

          {/* Parent Category */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Parent Category</label>
            <select
              style={inputStyle}
              value={parentId}
              onChange={e => setParentId(e.target.value)}
            >
              <option value="">None</option>
              {topCategories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>

        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          paddingTop: 8,
          borderTop: `1px solid ${theme.border}`,
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: theme.textDim,
              padding: '8px 14px',
              fontFamily: 'inherit',
              borderRadius: 8,
            }}
          >
            Cancel
          </button>

          {isEdit && onDelete && (
            <button
              onClick={() => { onDelete(category!.id); onClose() }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
                color: RED,
                padding: '8px 14px',
                fontFamily: 'inherit',
                borderRadius: 8,
              }}
            >
              Delete
            </button>
          )}

          <button
            onClick={handleSave}
            style={{
              background: theme.accent,
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: '#fff',
              padding: '8px 20px',
              fontFamily: 'inherit',
              borderRadius: 8,
              fontWeight: 600,
            }}
          >
            Save
          </button>
        </div>

      </div>
    </div>
  )
}
