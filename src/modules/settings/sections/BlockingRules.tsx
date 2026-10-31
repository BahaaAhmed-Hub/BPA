import { useState, useEffect } from 'react'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { loadBlockingRules, saveBlockingRules, type BlockingRule, type DetailLevel, loadCachedCalendars, type CachedCalEntry } from '@/lib/blockingRules'
import { ICON } from '@/lib/type'
import { SearchSelect } from '@/components/SearchSelect'
import { selectStyle } from '@/lib/fields'
import { Toggle, Block, DRow } from '../ui'

// ─── CHUNK 6b: Productivity Blocking section ─────────────────────────────────

const DETAIL_LEVELS: { value: DetailLevel; label: string; desc: string }[] = [
  { value: 'busy',         label: 'Busy',         desc: 'Just marks time as unavailable' },
  { value: 'focus_time',   label: 'Focus Time',   desc: 'Shows "Focus Time" + source cal name' },
  { value: 'full_details', label: 'Full Details',  desc: 'Copies title, description & location' },
]

const DETAIL_BADGE: Record<DetailLevel, { bg: string; color: string }> = {
  busy:         { bg: 'color-mix(in srgb, var(--sb-negative) 12.0%, transparent)',   color: 'var(--sb-negative)' },
  focus_time:   { bg: 'color-mix(in srgb, var(--sb-positive) 12.0%, transparent)',  color: 'var(--sb-positive)' },
  full_details: { bg: 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)',   color: 'var(--sb-info)' },
}

export function BlockingRulesSection() {
  const [rules, setRulesState]     = useState<BlockingRule[]>(loadBlockingRules)
  const [cals, setCals]            = useState<CachedCalEntry[]>([])
  const [showForm, setShowForm]    = useState(false)
  const [editingRule, setEditingRule] = useState<BlockingRule | null>(null)

  // Form state (used for both add and edit)
  const [srcCal,     setSrcCal]    = useState('')
  const [tgtCal,     setTgtCal]    = useState('')
  const [detail,     setDetail]    = useState<DetailLevel>('busy')
  const [autoApply,   setAutoApply]  = useState(false)
  const [hideBlocked, setHideBlocked] = useState(false)

  useEffect(() => {
    setCals(loadCachedCalendars())
  }, [])

  function saveRules(updated: BlockingRule[]) {
    saveBlockingRules(updated)
    setRulesState(updated)
  }

  function resetForm() {
    setSrcCal(''); setTgtCal(''); setDetail('busy'); setAutoApply(false); setHideBlocked(false)
    setShowForm(false); setEditingRule(null)
  }

  function openEdit(rule: BlockingRule) {
    setCals(loadCachedCalendars())
    setSrcCal(rule.sourceCalendarId)
    setTgtCal(rule.targetCalendarId)
    setDetail(rule.detailLevel)
    setAutoApply(rule.autoApply)
    setHideBlocked(rule.hideBlocked)
    setEditingRule(rule)
    setShowForm(true)
  }

  function saveForm() {
    if (!srcCal || !tgtCal || srcCal === tgtCal) return
    const srcEntry = cals.find(c => c.id === srcCal)
    const tgtEntry = cals.find(c => c.id === tgtCal)
    if (!srcEntry || !tgtEntry) return

    if (editingRule) {
      // Update existing rule — preserve id, enabled state, and applied-blocks map key
      saveRules(rules.map(r => r.id === editingRule.id ? {
        ...r,
        autoApply,
        hideBlocked,
        sourceCalendarId:   srcEntry.id,
        sourceCalendarName: srcEntry.summary ?? srcEntry.id,
        sourceAccountEmail: srcEntry.accountEmail,
        targetCalendarId:   tgtEntry.id,
        targetCalendarName: tgtEntry.summary ?? tgtEntry.id,
        targetAccountEmail: tgtEntry.accountEmail,
        detailLevel:        detail,
      } : r))
    } else {
      saveRules([...rules, {
        id:                  crypto.randomUUID(),
        enabled:             true,
        autoApply,
        hideBlocked,
        sourceCalendarId:    srcEntry.id,
        sourceCalendarName:  srcEntry.summary ?? srcEntry.id,
        sourceAccountEmail:  srcEntry.accountEmail,
        targetCalendarId:    tgtEntry.id,
        targetCalendarName:  tgtEntry.summary ?? tgtEntry.id,
        targetAccountEmail:  tgtEntry.accountEmail,
        detailLevel:         detail,
      }])
    }
    resetForm()
  }

  function deleteRule(id: string) {
    saveRules(rules.filter(r => r.id !== id))
  }

  function toggleRule(id: string) {
    saveRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r))
  }

  const badge = (level: DetailLevel) => {
    const { bg, color } = DETAIL_BADGE[level]
    const label = DETAIL_LEVELS.find(d => d.value === level)?.label ?? level
    return (
      <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--sb-r-card)', background: bg, color }}>
        {label}
      </span>
    )
  }

  const formInvalid = !srcCal || !tgtCal || srcCal === tgtCal
  const smallBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 4, flexShrink: 0 }

  return (
    <Block sub="When an event appears on a source calendar, a matching block is automatically created on the target calendar. Choose how much detail to share.">
      {/* Rule list */}
      {rules.length === 0 && !showForm && (
        <p style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', margin: 0, textAlign: 'center', padding: '14px 0' }}>
          No rules yet — add one below.
        </p>
      )}

      {rules.map(rule => (
        <DRow key={rule.id}
          label={`${rule.sourceCalendarName} → ${rule.targetCalendarName}`}
          sub={rule.sourceAccountEmail === rule.targetAccountEmail
            ? rule.sourceAccountEmail
            : `${rule.sourceAccountEmail} → ${rule.targetAccountEmail}`}>
          {badge(rule.detailLevel)}
          {rule.autoApply && (
            <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--sb-r-card)', background: 'color-mix(in srgb, var(--sb-positive) 12.0%, transparent)', color: 'var(--sb-positive)' }}>
              Auto
            </span>
          )}
          {rule.hideBlocked && (
            <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--sb-r-card)', background: 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)', color: 'var(--sb-info)' }}>
              Originals only
            </span>
          )}
          <Toggle checked={rule.enabled} onChange={() => toggleRule(rule.id)} />
          <button onClick={() => openEdit(rule)}
            style={{ ...smallBtn, color: 'var(--sb-ink-3)' }}
            title="Edit rule" aria-label="Edit rule">
            <Pencil size={ICON.sm} />
          </button>
          <button onClick={() => deleteRule(rule.id)}
            style={{ ...smallBtn, color: 'var(--sb-negative)' }}
            title="Delete rule" aria-label="Delete rule">
            <Trash2 size={ICON.sm} />
          </button>
        </DRow>
      ))}

      {/* Add rule form — rows in the same card, not a box inside it */}
      {showForm ? (
        <>
          <p style={{ margin: 0, padding: '14px 0 0', fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
            {editingRule ? 'Edit blocking rule' : 'New blocking rule'}
          </p>
          <DRow label="Source calendar" sub="Events to watch">
            <SearchSelect
              value={srcCal}
              onChange={setSrcCal}
              options={cals.map(c => ({ value: c.id, label: c.summary ?? c.id, hint: c.accountEmail }))}
              placeholder="— choose —"
              ariaLabel="Source calendar"
              style={{ ...selectStyle, width: 260 }}
            />
          </DRow>
          <DRow label="Target calendar" sub="Where blocks are created">
            <SearchSelect
              value={tgtCal}
              onChange={setTgtCal}
              options={cals.filter(c => c.id !== srcCal).map(c => ({ value: c.id, label: c.summary ?? c.id, hint: c.accountEmail }))}
              placeholder="— choose —"
              ariaLabel="Target calendar"
              style={{ ...selectStyle, width: 260 }}
            />
          </DRow>
          <DRow label="Detail level" sub="How much of the source event the block shows">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {DETAIL_LEVELS.map(d => (
                <button key={d.value} onClick={() => setDetail(d.value)}
                  style={{
                    flex: '1 1 120px', padding: '7px 8px', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer', textAlign: 'center',
                    background: detail === d.value ? DETAIL_BADGE[d.value].bg : 'var(--sb-card)',
                    border: `var(--sb-border-width) solid ${detail === d.value ? DETAIL_BADGE[d.value].color + '80' : 'var(--sb-border)'}`,
                    color: detail === d.value ? DETAIL_BADGE[d.value].color : 'var(--sb-ink-3)',
                    transition: 'all 0.15s',
                  }}>
                  <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', fontWeight: 600 }}>{d.label}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', opacity: 0.7, lineHeight: 1.3 }}>{d.desc}</p>
                </button>
              ))}
            </div>
          </DRow>
          <DRow label="Auto-apply" sub="Run this rule automatically whenever the calendar loads">
            <Toggle checked={autoApply} onChange={setAutoApply} />
          </DRow>
          <DRow label="Show originals only" sub="Hide created blocks from your calendar view (blocks still exist for recipients)">
            <Toggle checked={hideBlocked} onChange={setHideBlocked} />
          </DRow>
          <DRow label={editingRule ? 'Update this rule' : 'Add this rule'} last>
            <button onClick={resetForm}
              style={{
                padding: '8px 16px', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
                background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)',
                color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)',
              }}>
              Cancel
            </button>
            <button onClick={saveForm}
              disabled={formInvalid}
              style={{
                padding: '8px 16px', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
                background: formInvalid ? 'var(--sb-card)' : 'rgba(var(--sb-accent-rgb),0.12)',
                border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.31)',
                color: formInvalid ? 'var(--sb-ink-3)' : 'var(--sb-ink-1)',
                fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
              }}>
              {editingRule ? 'Update Rule' : 'Add Rule'}
            </button>
          </DRow>
        </>
      ) : (
        <div style={{ padding: '14px 0' }}>
          <button onClick={() => { setCals(loadCachedCalendars()); setEditingRule(null); setShowForm(true) }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
              background: 'rgba(var(--sb-accent-rgb),0.10)',
              border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.25)',
              color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)',
            }}>
            <Plus size={ICON.sm} /> Add Rule
          </button>
        </div>
      )}
    </Block>
  )
}
