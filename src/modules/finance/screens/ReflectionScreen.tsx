import { useState } from 'react'
import { useFinanceStore } from '../financeStore'

// ─── Inline row types (store may not export them yet) ─────────────────────────

interface PlanRow     { id: string; category_id: string; year: number; month: number; planned_amount: number }
interface OverrideRow { id: string; category_id: string; year: number; month: number; override_amount: number }
interface CommentRow  { id: string; category_id: string; year: number; month: number; comment: string }

// ─── Semantic colours ─────────────────────────────────────────────────────────

const RED   = '#DA4A3E'
const GREEN = '#2FA869'
const CYAN  = '#46B6C9'
const AMBER = '#C49A3C'

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
const fmt = (v: number) => v ? v.toLocaleString('en-US') : '·'

// ─── Segmented control ────────────────────────────────────────────────────────

function Seg<T extends string>({
  options, value, onChange, themeSurface, themeBorder, themeAccent, themeAccentFill, themeTextDim,
}: {
  options: { v: T; label: string }[]
  value: T
  onChange: (v: T) => void
  themeSurface: string
  themeBorder: string
  themeAccent: string
  themeAccentFill: string
  themeTextDim: string
}) {
  return (
    <div style={{ display:'flex', background: themeSurface, border:`1px solid ${themeBorder}`, borderRadius:9, overflow:'hidden' }}>
      {options.map(({ v, label }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          style={{
            padding:'7px 13px', border:'none', cursor:'pointer',
            fontFamily:'inherit', fontSize:12,
            background: value === v ? themeAccentFill : 'transparent',
            color: value === v ? themeAccent : themeTextDim,
            fontWeight: value === v ? 600 : 400,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ─── Donut chart (expenses share) ─────────────────────────────────────────────

function ShareDonut({
  groups, themeBg, themeTextMuted, themeTextDim, themeText,
}: {
  groups: { name: string; color: string; total: number }[]
  themeBg: string
  themeTextMuted: string
  themeTextDim: string
  themeText: string
}) {
  const grandTotal = groups.reduce((s, g) => s + g.total, 0)
  if (grandTotal === 0) return null

  const r = 52, cx = 75, cy = 75, sw = 16
  const circ = 2 * Math.PI * r
  let offset = 0
  const segs = groups.map(g => {
    const pct  = g.total / grandTotal
    const dash = pct * circ
    const seg  = { ...g, pct, dash, gap: circ - dash, offset }
    offset += dash
    return seg
  })

  return (
    <div style={{ display:'flex', gap:34, alignItems:'center' }}>
      <div style={{ position:'relative', flexShrink:0, width:150, height:150 }}>
        <svg width={150} height={150} viewBox="0 0 150 150">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={themeBg} strokeWidth={sw} />
          {segs.map((seg, i) => (
            <circle
              key={i} cx={cx} cy={cy} r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={sw}
              strokeDasharray={`${seg.dash} ${seg.gap}`}
              strokeDashoffset={-seg.offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          ))}
          <circle cx={cx} cy={cy} r={r - sw / 2 - 4} fill={themeBg} />
        </svg>
        <div style={{
          position:'absolute', inset:0, display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center', pointerEvents:'none',
        }}>
          <span style={{ fontSize:9.5, color:themeTextMuted, textAlign:'center', lineHeight:1.4 }}>
            Expenses<br />/ share
          </span>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 24px' }}>
        {segs.map((seg, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ width:10, height:10, borderRadius:2, background:seg.color, flexShrink:0 }} />
            <span style={{ fontSize:12, color:themeTextMuted }}>{seg.name}</span>
            <span style={{ fontSize:11, color:themeTextDim, marginLeft:4 }}>{Math.round(seg.pct*100)}%</span>
            <span style={{ fontSize:11, color:themeText,    marginLeft:4 }}>{(seg.total/1000).toFixed(0)}K</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ReflectionScreen(_props?: any) {

  // ── Store reads (defensive — store agent may still be building) ──────────
  const categories    = useFinanceStore(s => s.categories)
  const transactions  = useFinanceStore(s => s.transactions)
  const plans         = useFinanceStore(s => (s as any).plans    ?? []) as PlanRow[]
  const overrides     = useFinanceStore(s => (s as any).overrides ?? []) as OverrideRow[]
  const comments      = useFinanceStore(s => (s as any).comments  ?? []) as CommentRow[]
  const setPlan       = useFinanceStore(s => (s as any).setPlan      ?? (() => {})) as (catId: string, year: number, month: number, amount: number) => Promise<void>
  const setOverride   = useFinanceStore(s => (s as any).setOverride  ?? (() => {})) as (catId: string, year: number, month: number, amount: number) => Promise<void>
  const clearOverride = useFinanceStore(s => (s as any).clearOverride ?? (() => {})) as (catId: string, year: number, month: number) => Promise<void>
  const setComment    = useFinanceStore(s => (s as any).setComment   ?? (() => {})) as (catId: string, year: number, month: number, comment: string) => Promise<void>
  const clearComment  = useFinanceStore(s => (s as any).clearComment ?? (() => {})) as (catId: string, year: number, month: number) => Promise<void>
  void clearOverride
  void clearComment

  // ── Local state ──────────────────────────────────────────────────────────
  const [view,         setView]         = useState<'table' | 'bars'>('table')
  const [tableMode,    setTableMode]    = useState<'planning' | 'actual' | 'compare'>('actual')
  const [showValues,   setShowValues]   = useState(false)
  const [openGroups,   setOpenGroups]   = useState<Record<string, boolean>>({})
  const [by,           setBy]           = useState<'cat' | 'type'>('cat')
  const [detail,       setDetail]       = useState<'stacked' | 'totals'>('stacked')
  const [editingCell,  setEditingCell]  = useState<{ catId: string; month: number } | null>(null)
  const [editValue,    setEditValue]    = useState('')
  const [commentCell,  setCommentCell]  = useState<{ catId: string; month: number } | null>(null)
  const [commentText,  setCommentText]  = useState('')
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({})

  const currentYear = new Date().getFullYear()

  // ── Category hierarchy ───────────────────────────────────────────────────
  const topCategories = categories.filter(c => !c.parentId)
  const getChildren   = (parentId: string) => categories.filter(c => c.parentId === parentId)

  const incomeTopCats  = topCategories.filter(c => c.txType === 'income' || c.txType === 'both')
  const expenseTopCats = topCategories.filter(c => c.txType === 'expense' || c.txType === 'both')

  // ── Data helpers ─────────────────────────────────────────────────────────

  function getActual(catId: string, monthIdx: number): number {
    return transactions
      .filter(tx => {
        const d = new Date(tx.date)
        return tx.categoryId === catId &&
               d.getFullYear() === currentYear &&
               d.getMonth() === monthIdx
      })
      .reduce((s, tx) => s + tx.amount, 0)
  }

  function getCellValue(catId: string, monthIdx: number): number {
    if (tableMode === 'planning') {
      const plan = plans.find(p => p.category_id === catId && p.year === currentYear && p.month === monthIdx + 1)
      return plan?.planned_amount ?? 0
    }
    const override = overrides.find(o => o.category_id === catId && o.year === currentYear && o.month === monthIdx + 1)
    if (override) return override.override_amount
    return getActual(catId, monthIdx)
  }

  function getPlanned(catId: string, monthIdx: number): number {
    const plan = plans.find(p => p.category_id === catId && p.year === currentYear && p.month === monthIdx + 1)
    return plan?.planned_amount ?? 0
  }

  function hasOverride(catId: string, monthIdx: number): boolean {
    return overrides.some(o => o.category_id === catId && o.year === currentYear && o.month === monthIdx + 1)
  }

  function hasComment(catId: string, monthIdx: number): boolean {
    return comments.some(c => c.category_id === catId && c.year === currentYear && c.month === monthIdx + 1)
  }

  function getCommentText(catId: string, monthIdx: number): string {
    return comments.find(c => c.category_id === catId && c.year === currentYear && c.month === monthIdx + 1)?.comment ?? ''
  }

  // Sum all descendants of a top category for a given month
  function getGroupMonthTotal(parentId: string, monthIdx: number): number {
    const children = getChildren(parentId)
    if (children.length === 0) return getCellValue(parentId, monthIdx)
    return children.reduce((s, c) => s + getCellValue(c.id, monthIdx), 0)
  }

  // ── Comment submit ───────────────────────────────────────────────────────
  function submitComment() {
    if (!commentCell) return
    if (commentText.trim()) {
      setComment(commentCell.catId, currentYear, commentCell.month + 1, commentText.trim())
    }
    setCommentCell(null)
    setCommentText('')
  }

  // ── Cell renderer ────────────────────────────────────────────────────────
  function renderCell(catId: string, monthIdx: number, isIncome: boolean) {
    const val      = getCellValue(catId, monthIdx)
    const planned  = getPlanned(catId, monthIdx)
    const isOver   = tableMode === 'actual' && hasOverride(catId, monthIdx)
    const hasCmt   = hasComment(catId, monthIdx)
    const isEditing = editingCell?.catId === catId && editingCell?.month === monthIdx

    let bgColor = 'transparent'
    if (tableMode === 'compare' && planned > 0) {
      if (isIncome)  bgColor = val >= planned ? 'rgba(47,168,105,0.15)' : 'rgba(218,74,62,0.15)'
      else           bgColor = val <= planned ? 'rgba(47,168,105,0.15)' : 'rgba(218,74,62,0.15)'
    }

    if ((tableMode === 'planning' || tableMode === 'actual') && isEditing) {
      return (
        <div
          key={monthIdx}
          style={{ flex:1, minWidth:72, textAlign:'right', padding:'0 6px', position:'relative' }}
        >
          <input
            autoFocus
            type="number"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => {
              if (tableMode === 'planning') setPlan(catId, currentYear, monthIdx + 1, Number(editValue))
              else setOverride(catId, currentYear, monthIdx + 1, Number(editValue))
              setEditingCell(null)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (tableMode === 'planning') setPlan(catId, currentYear, monthIdx + 1, Number(editValue))
                else setOverride(catId, currentYear, monthIdx + 1, Number(editValue))
                setEditingCell(null)
              }
              if (e.key === 'Escape') setEditingCell(null)
            }}
            style={{
              width:'100%', background:'transparent', border:'none',
              borderBottom:`1px solid ${'#F5D14E'}`, color:'#191712',
              fontSize:11, textAlign:'right', outline:'none', padding:'2px 0',
              fontFamily:'inherit',
            }}
          />
        </div>
      )
    }

    return (
      <div
        key={monthIdx}
        onClick={() => {
          if (tableMode !== 'compare') {
            setEditingCell({ catId, month: monthIdx })
            setEditValue(String(val))
          }
        }}
        title={hasCmt ? getCommentText(catId, monthIdx) : undefined}
        style={{
          flex:1, minWidth:72, textAlign:'right', padding:'0 6px',
          fontSize:11, color: val ? '#6C6553' : '#9B9180',
          position:'relative', background:bgColor,
          cursor: tableMode !== 'compare' ? 'pointer' : 'default',
        }}
      >
        {fmt(val)}
        {isOver && (
          <span style={{
            position:'absolute', top:2, right:2,
            width:5, height:5, borderRadius:'50%', background:AMBER,
          }} title="Manual override" />
        )}
        {hasCmt && (
          <span
            onClick={e => {
              e.stopPropagation()
              setCommentCell({ catId, month: monthIdx })
              setCommentText(getCommentText(catId, monthIdx))
            }}
            style={{
              position:'absolute', bottom:2, right:2,
              width:5, height:5, borderRadius:'50%', background:CYAN, cursor:'pointer',
            }}
            title={getCommentText(catId, monthIdx)}
          />
        )}
      </div>
    )
  }

  // ── Derived totals ───────────────────────────────────────────────────────

  const incomeByMonth: number[] = MONTHS.map((_, mi) =>
    incomeTopCats.reduce((s, cat) => s + getGroupMonthTotal(cat.id, mi), 0)
  )

  const expenseByMonth: number[] = MONTHS.map((_, mi) =>
    expenseTopCats.reduce((s, cat) => s + getGroupMonthTotal(cat.id, mi), 0)
  )

  const netByMonth     = MONTHS.map((_, mi) => incomeByMonth[mi] - expenseByMonth[mi])
  const cumulative: number[] = []
  let running = 0
  for (let i = 0; i < 12; i++) { running += netByMonth[i]; cumulative.push(running) }

  const grandIncome  = sum(incomeByMonth)
  const grandExpense = sum(expenseByMonth)
  const grandNet     = grandIncome - grandExpense

  // ── Shared cell styles ───────────────────────────────────────────────────
  const cellBase: React.CSSProperties = {
    flex:1, minWidth:72, textAlign:'right', padding:'0 5px', position:'relative',
  }

  const colLabel: React.CSSProperties = {
    width:182, flexShrink:0, fontSize:10, color:'#6C6553',
  }

  const colTotal: React.CSSProperties = {
    width:84, textAlign:'right', flexShrink:0,
  }

  const colPct: React.CSSProperties = {
    width:46, textAlign:'right', flexShrink:0,
  }

  const rowFlex: React.CSSProperties = {
    display:'flex', alignItems:'center',
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TABLE VIEW
  // ─────────────────────────────────────────────────────────────────────────────

  function renderTableView() {
    // Donut data
    const donutGroups = expenseTopCats.map(cat => ({
      name:  cat.name,
      color: cat.color,
      total: sum(MONTHS.map((_, mi) => getGroupMonthTotal(cat.id, mi))),
    })).filter(g => g.total > 0)

    return (
      <div>
        {/* Share donut card */}
        {donutGroups.length > 0 && (
          <div style={{
            background: '#FFFFFF', border:`1px solid ${'#E8E1CE'}`,
            borderRadius:14, padding:'18px 20px', marginBottom:12,
          }}>
            <ShareDonut
              groups={donutGroups}
              themeBg={'#F7F4EA'}
              themeTextMuted={'#9B9180'}
              themeTextDim={'#6C6553'}
              themeText={'#191712'}
            />
          </div>
        )}

        {/* Data table */}
        <div style={{
          background: '#FFFFFF', border:`1px solid ${'#E8E1CE'}`,
          borderRadius:12, overflow:'hidden', padding:'14px 16px',
        }}>
          <div style={{ minWidth: 1100, overflowX:'auto' }}>

            {/* Header row */}
            <div style={{ ...rowFlex, paddingBottom:8, borderBottom:`1px solid ${'#E8E1CE'}`, marginBottom:4 }}>
              <div style={{ ...colLabel }}>EGP</div>
              {MONTHS.map(m => (
                <div key={m} style={{ ...cellBase, fontSize:10, color:'#9B9180', fontWeight:600 }}>{m}</div>
              ))}
              <div style={{ ...colTotal, fontSize:10, color:'#9B9180', fontWeight:600 }}>Total</div>
              <div style={{ ...colPct,   fontSize:10, color:'#9B9180', fontWeight:600 }}>%</div>
            </div>

            {/* ── INCOME section ── */}
            <div style={{
              ...rowFlex, padding:'6px 0',
              borderBottom:`1px solid ${'#E8E1CE'}`,
            }}>
              <div style={{ ...colLabel, fontSize:10.5, fontWeight:700, letterSpacing:'0.7px', color:GREEN, textTransform:'uppercase' }}>
                INCOME
              </div>
              {incomeByMonth.map((v, mi) => (
                <div key={mi} style={{ ...cellBase, color:GREEN, fontWeight:600, fontSize:11 }}>{fmt(v)}</div>
              ))}
              <div style={{ ...colTotal, fontSize:11.5, fontWeight:700, color:GREEN }}>{fmt(grandIncome)}</div>
              <div style={{ ...colPct, fontSize:10, color:'#6C6553' }}>100%</div>
            </div>

            {incomeTopCats.map(cat => {
              const children = getChildren(cat.id)
              const isOpen   = openGroups[cat.id]
              const rowTotals = MONTHS.map((_, mi) => getGroupMonthTotal(cat.id, mi))
              const catTotal  = sum(rowTotals)
              const pct       = grandIncome > 0 ? Math.round((catTotal / grandIncome) * 100) : 0

              return (
                <div key={cat.id}>
                  {/* Group row */}
                  <div
                    onClick={() => setOpenGroups(prev => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                    style={{
                      ...rowFlex, padding:'5px 0',
                      cursor:'pointer',
                      borderBottom:`1px solid ${'#E8E1CE'}`,
                      background: `${cat.color}0A`,
                      borderLeft:`3px solid ${cat.color}`,
                      paddingLeft:6,
                    }}
                  >
                    <div style={{ width:182-6, flexShrink:0, display:'flex', alignItems:'center', gap:5 }}>
                      <span style={{ fontSize:10, color:'#9B9180' }}>{isOpen ? '▾' : '▸'}</span>
                      <span style={{ fontSize:12 }}>{cat.icon}</span>
                      <span style={{ fontSize:11.5, fontWeight:700, color:cat.color }}>{cat.name}</span>
                    </div>
                    {rowTotals.map((v, mi) => (
                      <div key={mi} style={{ ...cellBase, fontWeight:600, color:'#191712', fontSize:11 }}>{fmt(v)}</div>
                    ))}
                    <div style={{ ...colTotal, fontSize:11.5, fontWeight:700, color:'#191712' }}>{fmt(catTotal)}</div>
                    <div style={{ ...colPct, fontSize:10, color:'#6C6553' }}>{pct}%</div>
                  </div>

                  {/* Sub-rows */}
                  {isOpen && (children.length > 0 ? children : [cat]).map(sub => {
                    const subVals  = MONTHS.map((_, mi) => getCellValue(sub.id, mi))
                    const subTotal = sum(subVals)
                    const subPct   = catTotal > 0 ? Math.round((subTotal / catTotal) * 100) : 0
                    return (
                      <div key={sub.id} style={{
                        ...rowFlex, padding:'3px 0',
                        borderBottom:`1px solid ${'#E8E1CE'}`,
                      }}>
                        <div style={{ width:182, flexShrink:0, display:'flex', alignItems:'center', gap:5, paddingLeft:22 }}>
                          <div style={{ width:7, height:7, borderRadius:1, background:sub.color, flexShrink:0 }} />
                          <span style={{ fontSize:11, color:'#6C6553' }}>{sub.name}</span>
                        </div>
                        {MONTHS.map((_, mi) => renderCell(sub.id, mi, true))}
                        <div style={{ ...colTotal, fontSize:11, fontWeight:600, color:'#191712' }}>{fmt(subTotal)}</div>
                        <div style={{ ...colPct, fontSize:10, color:'#6C6553' }}>{subPct}%</div>
                        {/* Comment input row */}
                        {commentCell?.catId === sub.id && (
                          <div style={{
                            position:'absolute', left:0, right:0,
                            background:'#FFFFFF', border:`1px solid ${'#E8E1CE'}`,
                            padding:'6px 10px', display:'flex', gap:6, alignItems:'center', zIndex:10,
                          }}>
                            <input
                              autoFocus
                              type="text"
                              value={commentText}
                              onChange={e => setCommentText(e.target.value)}
                              onKeyDown={e => { if (e.key==='Enter') submitComment(); if (e.key==='Escape') { setCommentCell(null); setCommentText('') } }}
                              style={{
                                flex:1, background:'transparent', border:`1px solid ${'#E8E1CE'}`,
                                color:'#191712', fontSize:12, borderRadius:4, padding:'3px 6px',
                                outline:'none', fontFamily:'inherit',
                              }}
                              placeholder="Add comment…"
                            />
                            <button onClick={submitComment} style={{ background:'#F5D14E', border:'none', borderRadius:4, color:'#fff', fontSize:11, padding:'3px 8px', cursor:'pointer', fontFamily:'inherit' }}>OK</button>
                            <button onClick={() => { setCommentCell(null); setCommentText('') }} style={{ background:'none', border:'none', color:'#6C6553', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {/* ── EXPENSES section ── */}
            <div style={{
              ...rowFlex, padding:'8px 0 4px',
              borderBottom:`1px solid ${'#E8E1CE'}`,
            }}>
              <div style={{ ...colLabel, fontSize:10.5, fontWeight:700, letterSpacing:'0.7px', color:'#6C6553', textTransform:'uppercase' }}>
                EXPENSES
              </div>
              {expenseByMonth.map((v, mi) => (
                <div key={mi} style={{ ...cellBase, color:'#6C6553', fontSize:11 }}>{fmt(v)}</div>
              ))}
              <div style={{ ...colTotal, fontSize:11.5, fontWeight:700, color:'#6C6553' }}>{fmt(grandExpense)}</div>
              <div style={{ ...colPct, fontSize:10, color:'#6C6553' }}>—</div>
            </div>

            {expenseTopCats.map(cat => {
              const children  = getChildren(cat.id)
              const isOpen    = openGroups[cat.id]
              const rowTotals = MONTHS.map((_, mi) => getGroupMonthTotal(cat.id, mi))
              const catTotal  = sum(rowTotals)
              const pct       = grandExpense > 0 ? Math.round((catTotal / grandExpense) * 100) : 0

              return (
                <div key={cat.id}>
                  {/* Group row */}
                  <div
                    onClick={() => setOpenGroups(prev => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                    style={{
                      ...rowFlex, padding:'5px 0',
                      cursor:'pointer',
                      borderBottom:`1px solid ${'#E8E1CE'}`,
                      background:`${cat.color}0A`,
                      borderLeft:`3px solid ${cat.color}`,
                      paddingLeft:6,
                    }}
                  >
                    <div style={{ width:182-6, flexShrink:0, display:'flex', alignItems:'center', gap:5 }}>
                      <span style={{ fontSize:10, color:'#9B9180' }}>{isOpen ? '▾' : '▸'}</span>
                      <span style={{ fontSize:12 }}>{cat.icon}</span>
                      <span style={{ fontSize:11.5, fontWeight:700, color:cat.color }}>{cat.name}</span>
                    </div>
                    {rowTotals.map((v, mi) => (
                      <div key={mi} style={{ ...cellBase, fontWeight:600, color:'#191712', fontSize:11 }}>{fmt(v)}</div>
                    ))}
                    <div style={{ ...colTotal, fontSize:11.5, fontWeight:700, color:'#191712' }}>{fmt(catTotal)}</div>
                    <div style={{ ...colPct, fontSize:10, color:'#6C6553' }}>{pct}%</div>
                  </div>

                  {/* Sub-rows */}
                  {isOpen && (children.length > 0 ? children : [cat]).map(sub => {
                    const subVals  = MONTHS.map((_, mi) => getCellValue(sub.id, mi))
                    const subTotal = sum(subVals)
                    const subPct   = catTotal > 0 ? Math.round((subTotal / catTotal) * 100) : 0
                    const isCommentOpen = commentCell?.catId === sub.id
                    return (
                      <div key={sub.id} style={{ position:'relative' }}>
                        <div style={{
                          ...rowFlex, padding:'3px 0',
                          borderBottom:`1px solid ${'#E8E1CE'}`,
                        }}>
                          <div style={{ width:182, flexShrink:0, display:'flex', alignItems:'center', gap:5, paddingLeft:22 }}>
                            <div style={{ width:7, height:7, borderRadius:1, background:sub.color, flexShrink:0 }} />
                            <span style={{ fontSize:11, color:'#6C6553' }}>{sub.name}</span>
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                setCommentCell(isCommentOpen ? null : { catId:sub.id, month: commentCell?.month ?? 0 })
                                setCommentText(isCommentOpen ? '' : getCommentText(sub.id, commentCell?.month ?? 0))
                              }}
                              style={{
                                background:'none', border:'none', cursor:'pointer',
                                color:'#9B9180', fontSize:11, padding:'0 2px',
                                lineHeight:1, fontFamily:'inherit', marginLeft:2,
                              }}
                              title="Add comment"
                            >
                              💬
                            </button>
                          </div>
                          {MONTHS.map((_, mi) => renderCell(sub.id, mi, false))}
                          <div style={{ ...colTotal, fontSize:11, fontWeight:600, color:'#191712' }}>{fmt(subTotal)}</div>
                          <div style={{ ...colPct, fontSize:10, color:'#6C6553' }}>{subPct}%</div>
                        </div>
                        {isCommentOpen && (
                          <div style={{
                            background:'#FFFFFF', border:`1px solid ${'#E8E1CE'}`,
                            padding:'6px 10px', display:'flex', gap:6, alignItems:'center',
                          }}>
                            <input
                              autoFocus
                              type="text"
                              value={commentText}
                              onChange={e => setCommentText(e.target.value)}
                              onKeyDown={e => { if (e.key==='Enter') submitComment(); if (e.key==='Escape') { setCommentCell(null); setCommentText('') } }}
                              style={{
                                flex:1, background:'transparent', border:`1px solid ${'#E8E1CE'}`,
                                color:'#191712', fontSize:12, borderRadius:4, padding:'3px 6px',
                                outline:'none', fontFamily:'inherit',
                              }}
                              placeholder="Add comment…"
                            />
                            <button onClick={submitComment} style={{ background:'#F5D14E', border:'none', borderRadius:4, color:'#fff', fontSize:11, padding:'3px 8px', cursor:'pointer', fontFamily:'inherit' }}>OK</button>
                            <button onClick={() => { setCommentCell(null); setCommentText('') }} style={{ background:'none', border:'none', color:'#6C6553', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {/* ── TOTALS section ── */}
            <div style={{ marginTop:6, borderRadius:8, overflow:'hidden', background:`rgba(255,255,255,0.03)` }}>

              {/* Total income */}
              <div style={{ ...rowFlex, padding:'5px 6px' }}>
                <div style={{ width:182, flexShrink:0, display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ color:GREEN, fontSize:12 }}>▲</span>
                  <span style={{ fontSize:11, color:'#6C6553' }}>Total income</span>
                </div>
                {incomeByMonth.map((v, mi) => (
                  <div key={mi} style={{ ...cellBase, color:GREEN, fontWeight:600, fontSize:11 }}>{fmt(v)}</div>
                ))}
                <div style={{ ...colTotal, fontSize:11.5, fontWeight:700, color:GREEN }}>{fmt(grandIncome)}</div>
                <div style={{ ...colPct }} />
              </div>

              {/* Total expenses */}
              <div style={{ ...rowFlex, padding:'5px 6px' }}>
                <div style={{ width:182, flexShrink:0, display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ color:RED, fontSize:12 }}>▼</span>
                  <span style={{ fontSize:11, color:'#6C6553' }}>Total expenses</span>
                </div>
                {expenseByMonth.map((v, mi) => (
                  <div key={mi} style={{ ...cellBase, color:AMBER, fontWeight:600, fontSize:11 }}>{fmt(v)}</div>
                ))}
                <div style={{ ...colTotal, fontSize:11.5, fontWeight:700, color:AMBER }}>{fmt(grandExpense)}</div>
                <div style={{ ...colPct }} />
              </div>

              {/* Net month */}
              <div style={{ ...rowFlex, padding:'5px 6px', borderTop:`1px solid ${'#E8E1CE'}` }}>
                <div style={{ width:182, flexShrink:0, display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ color:'#9B9180', fontSize:12 }}>=</span>
                  <span style={{ fontSize:11, color:'#6C6553', fontWeight:600 }}>Net month</span>
                </div>
                {netByMonth.map((v, mi) => (
                  <div key={mi} style={{ ...cellBase, color: v >= 0 ? GREEN : RED, fontWeight:600, fontSize:11 }}>
                    {v >= 0 ? '' : '−'}{fmt(Math.abs(v))}
                  </div>
                ))}
                <div style={{ ...colTotal, fontSize:11.5, fontWeight:700, color: grandNet >= 0 ? GREEN : RED }}>
                  {grandNet >= 0 ? '' : '−'}{fmt(Math.abs(grandNet))}
                </div>
                <div style={{ ...colPct }} />
              </div>

              {/* Cumulative */}
              <div style={{ ...rowFlex, padding:'5px 6px' }}>
                <div style={{ width:182, flexShrink:0, display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ color:'#9B9180', fontSize:12 }}>∑</span>
                  <span style={{ fontSize:11, color:'#6C6553' }}>Cumulative</span>
                </div>
                {cumulative.map((v, mi) => (
                  <div key={mi} style={{ ...cellBase, color: v >= 0 ? GREEN : RED, fontSize:11 }}>
                    {v >= 0 ? '' : '−'}{fmt(Math.abs(v))}
                  </div>
                ))}
                <div style={{ ...colTotal }} />
                <div style={{ ...colPct }} />
              </div>

            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BARS VIEW
  // ─────────────────────────────────────────────────────────────────────────────

  function renderBarsView() {
    if (categories.length === 0) {
      return (
        <div style={{
          background:'#FFFFFF', border:`1px solid ${'#E8E1CE'}`,
          borderRadius:14, padding:'40px 24px', textAlign:'center',
          color:'#6C6553', fontSize:14,
        }}>
          Add categories in Accounts &amp; Categories to see charts here.
        </div>
      )
    }

    type BarSeries = { name: string; color: string; data: number[] }

    // Income series
    const incSeries: BarSeries[] = incomeTopCats.map(cat => ({
      name:  cat.name,
      color: cat.color,
      data:  MONTHS.map((_, mi) => getGroupMonthTotal(cat.id, mi)),
    }))

    // Expense series
    let expSeries: BarSeries[]
    if (by === 'cat') {
      expSeries = expenseTopCats.map(cat => ({
        name:  cat.name,
        color: cat.color,
        data:  MONTHS.map((_, mi) => getGroupMonthTotal(cat.id, mi)),
      }))
    } else {
      // by type
      const byType: Record<string, { color: string; data: number[] }> = {
        expense: { color: RED,   data: Array(12).fill(0) as number[] },
        income:  { color: GREEN, data: Array(12).fill(0) as number[] },
        both:    { color: CYAN,  data: Array(12).fill(0) as number[] },
      }
      for (const cat of categories) {
        for (let mi = 0; mi < 12; mi++) {
          byType[cat.txType].data[mi] += getCellValue(cat.id, mi)
        }
      }
      expSeries = Object.entries(byType).map(([type, { color, data }]) => ({
        name: type.charAt(0).toUpperCase() + type.slice(1), color, data,
      }))
    }

    const visibleInc = incSeries.filter(s => !hiddenSeries[s.name])
    const visibleExp = expSeries.filter(s => !hiddenSeries[s.name])

    const maxValue = Math.max(
      ...MONTHS.map((_, mi) => Math.max(
        visibleInc.reduce((s, ser) => s + ser.data[mi], 0),
        visibleExp.reduce((s, ser) => s + ser.data[mi], 0),
      )),
      1,
    )

    const maxTotals = Math.max(
      ...MONTHS.map((_, mi) => Math.max(incomeByMonth[mi], expenseByMonth[mi])),
      1,
    )

    const trendPoints = (vals: number[], maxV: number) =>
      vals.map((v, i) => `${((i + 0.5) * (1200 / 12)).toFixed(1)},${(240 - (v / maxV) * 220).toFixed(1)}`).join(' ')

    const toggleSeries = (name: string) =>
      setHiddenSeries(prev => ({ ...prev, [name]: !prev[name] }))

    return (
      <div style={{
        background:'#FFFFFF', border:`1px solid ${'#E8E1CE'}`,
        borderRadius:14, padding:'20px 22px',
      }}>
        {detail === 'stacked' ? (
          <>
            {/* Stacked legend */}
            <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:16 }}>
              <span style={{ fontSize:10.5, color:'#9B9180', fontWeight:700 }}>INCOME</span>
              {incSeries.map(s => (
                <button
                  key={s.name}
                  onClick={() => toggleSeries(s.name)}
                  style={{
                    background:'none', border:'none', cursor:'pointer', fontFamily:'inherit',
                    fontSize:11.5, color:'#6C6553',
                    display:'flex', alignItems:'center', gap:5,
                    textDecoration: hiddenSeries[s.name] ? 'line-through' : 'none',
                    opacity: hiddenSeries[s.name] ? 0.28 : 1,
                  }}
                >
                  <div style={{ width:10, height:10, borderRadius:2, background:s.color }} />
                  {s.name}
                </button>
              ))}
              <div style={{ width:1, height:14, background:'#E8E1CE' }} />
              <span style={{ fontSize:10.5, color:'#9B9180', fontWeight:700 }}>OUTFLOW</span>
              {expSeries.map(s => (
                <button
                  key={s.name}
                  onClick={() => toggleSeries(s.name)}
                  style={{
                    background:'none', border:'none', cursor:'pointer', fontFamily:'inherit',
                    fontSize:11.5, color:'#6C6553',
                    display:'flex', alignItems:'center', gap:5,
                    textDecoration: hiddenSeries[s.name] ? 'line-through' : 'none',
                    opacity: hiddenSeries[s.name] ? 0.28 : 1,
                  }}
                >
                  <div style={{ width:10, height:10, borderRadius:2, background:s.color }} />
                  {s.name}
                </button>
              ))}
            </div>

            {/* Stacked bar chart */}
            <div style={{ display:'flex', gap:10, alignItems:'flex-end', marginBottom:8 }}>
              {MONTHS.map((mo, mi) => {
                const incTotal = visibleInc.reduce((s, ser) => s + ser.data[mi], 0)
                const expTotal = visibleExp.reduce((s, ser) => s + ser.data[mi], 0)
                const incH = Math.round((incTotal / maxValue) * 240)
                const expH = Math.round((expTotal / maxValue) * 240)

                return (
                  <div key={mo} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center' }}>
                    {showValues && (
                      <div style={{ fontSize:9, color:'#6C6553', marginBottom:2, textAlign:'center' }}>
                        {(incTotal / 1000).toFixed(0)}K
                      </div>
                    )}
                    <div style={{ display:'flex', gap:2, alignItems:'flex-end', height:240 }}>
                      {/* Income bar */}
                      <div style={{ width:30, height:incH, display:'flex', flexDirection:'column-reverse', overflow:'hidden', borderRadius:'3px 3px 0 0' }}>
                        {visibleInc.map(ser => {
                          const segH = Math.round((ser.data[mi] / maxValue) * 240)
                          return segH > 0 ? (
                            <div key={ser.name} style={{ height:segH, background:ser.color, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                              {showValues && segH >= 15 && (
                                <span style={{ fontSize:8, color:'rgba(0,0,0,0.6)', transform:'rotate(-90deg)', whiteSpace:'nowrap' }}>
                                  {(ser.data[mi] / 1000).toFixed(0)}K
                                </span>
                              )}
                            </div>
                          ) : null
                        })}
                      </div>
                      {/* Outflow bar */}
                      <div style={{ width:30, height:expH, display:'flex', flexDirection:'column-reverse', overflow:'hidden', borderRadius:'3px 3px 0 0' }}>
                        {visibleExp.map(ser => {
                          const segH = Math.round((ser.data[mi] / maxValue) * 240)
                          return segH > 0 ? (
                            <div key={ser.name} style={{ height:segH, background:ser.color, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                              {showValues && segH >= 15 && (
                                <span style={{ fontSize:8, color:'rgba(0,0,0,0.5)', transform:'rotate(-90deg)', whiteSpace:'nowrap' }}>
                                  {(ser.data[mi] / 1000).toFixed(0)}K
                                </span>
                              )}
                            </div>
                          ) : null
                        })}
                      </div>
                    </div>
                    <div style={{ fontSize:11, color:'#9B9180', marginTop:6 }}>{mo}</div>
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize:11, color:'#6C6553', marginTop:8 }}>
              Left bar = income · Right bar = outflow
            </div>
          </>
        ) : (
          <>
            {/* Totals mode legend */}
            <div style={{ display:'flex', gap:18, marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <div style={{ width:10, height:10, borderRadius:2, background:GREEN }} />
                <span style={{ fontSize:11.5, color:'#9B9180' }}>Income</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <div style={{ width:10, height:10, borderRadius:2, background:AMBER }} />
                <span style={{ fontSize:11.5, color:'#9B9180' }}>Outflow</span>
              </div>
            </div>

            {/* MoM income % row above */}
            <div style={{ display:'flex', gap:10, marginBottom:4 }}>
              {MONTHS.map((_, mi) => {
                if (mi === 0) return <div key={mi} style={{ flex:1 }} />
                const prev = incomeByMonth[mi - 1]
                const curr = incomeByMonth[mi]
                const pct  = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : 0
                const up   = pct >= 0
                return (
                  <div key={mi} style={{ flex:1, textAlign:'center', fontSize:9.5, color: up ? GREEN : RED }}>
                    {up ? '▲' : '▼'}{Math.abs(pct)}%
                  </div>
                )
              })}
            </div>

            {/* Bars + trend */}
            <div style={{ position:'relative' }}>
              <div style={{ display:'flex', gap:10, alignItems:'flex-end', height:260, position:'relative' }}>
                {MONTHS.map((mo, mi) => {
                  const incH = Math.round((incomeByMonth[mi]  / maxTotals) * 220)
                  const expH = Math.round((expenseByMonth[mi] / maxTotals) * 220)
                  return (
                    <div key={mo} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center' }}>
                      {showValues && (
                        <div style={{ fontSize:9, color:'#6C6553', marginBottom:2 }}>
                          {(incomeByMonth[mi] / 1000).toFixed(0)}K
                        </div>
                      )}
                      <div style={{ display:'flex', gap:2, alignItems:'flex-end', height:240 }}>
                        <div style={{ width:30, height:incH, background:GREEN, borderRadius:'3px 3px 0 0' }} />
                        <div style={{ width:30, height:expH, background:AMBER, borderRadius:'3px 3px 0 0' }} />
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Trend lines */}
              <svg style={{ position:'absolute', left:0, top:0, width:'100%', height:260, pointerEvents:'none' }}
                   viewBox="0 0 1200 260" preserveAspectRatio="none">
                <polyline points={trendPoints(incomeByMonth, maxTotals)}
                  fill="none" stroke="#67D6A0" strokeWidth={1.5} strokeLinejoin="round" />
                <polyline points={trendPoints(expenseByMonth, maxTotals)}
                  fill="none" stroke="#E0C57E" strokeWidth={1.5} strokeLinejoin="round" />
              </svg>
            </div>

            {/* Month labels */}
            <div style={{ display:'flex', gap:10, marginTop:4 }}>
              {MONTHS.map(mo => (
                <div key={mo} style={{ flex:1, textAlign:'center', fontSize:11, color:'#9B9180' }}>{mo}</div>
              ))}
            </div>

            {/* MoM outflow % row */}
            <div style={{ display:'flex', gap:10, marginTop:4 }}>
              {MONTHS.map((_, mi) => {
                if (mi === 0) return <div key={mi} style={{ flex:1 }} />
                const prev = expenseByMonth[mi - 1]
                const curr = expenseByMonth[mi]
                const pct  = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : 0
                const up   = pct >= 0
                return (
                  <div key={mi} style={{ flex:1, textAlign:'center', fontSize:9.5, color: up ? RED : GREEN }}>
                    {up ? '▲' : '▼'}{Math.abs(pct)}%
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ height:'100%', overflowY:'auto', padding:'26px 30px 60px', background:'#F7F4EA' }}>

      {/* Top controls bar */}
      <div style={{
        display:'flex', flexWrap:'wrap', gap:12, marginBottom:16, paddingBottom:16,
        borderBottom:`1px solid ${'#E8E1CE'}`,
        alignItems:'flex-end', justifyContent:'space-between',
      }}>
        {/* Left: title */}
        <div>
          <div style={{ fontSize:10, textTransform:'uppercase', color:'#9B9180', letterSpacing:'0.8px', fontWeight:700, marginBottom:4 }}>
            Finance · Reflect
          </div>
          <div style={{ fontSize:24, fontWeight:700, color:'#191712' }}>
            Financials Reflection
          </div>
        </div>

        {/* Right: controls */}
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>

          {/* Table mode toggle (table view only) */}
          {view === 'table' && (
            <Seg
              options={[
                { v: 'planning', label: 'Planning' },
                { v: 'actual',   label: 'Actual'   },
                { v: 'compare',  label: 'Compare'  },
              ]}
              value={tableMode}
              onChange={v => setTableMode(v as 'planning' | 'actual' | 'compare')}
              themeSurface={'#FFFFFF'}
              themeBorder={'#E8E1CE'}
              themeAccent={'#F5D14E'}
              themeAccentFill={'rgba(245,209,78,0.12)'}
              themeTextDim={'#6C6553'}
            />
          )}

          {/* Bars-only controls */}
          {view === 'bars' && (
            <>
              <Seg
                options={[{ v:'stacked', label:'Stacked' }, { v:'totals', label:'Totals' }]}
                value={detail}
                onChange={v => setDetail(v as 'stacked' | 'totals')}
                themeSurface={'#FFFFFF'}
                themeBorder={'#E8E1CE'}
                themeAccent={'#F5D14E'}
                themeAccentFill={'rgba(245,209,78,0.12)'}
                themeTextDim={'#6C6553'}
              />

              {detail === 'stacked' && (
                <Seg
                  options={[{ v:'cat', label:'By category' }, { v:'type', label:'By type' }]}
                  value={by}
                  onChange={v => setBy(v as 'cat' | 'type')}
                  themeSurface={'#FFFFFF'}
                  themeBorder={'#E8E1CE'}
                  themeAccent={'#F5D14E'}
                  themeAccentFill={'rgba(245,209,78,0.12)'}
                  themeTextDim={'#6C6553'}
                />
              )}

              <button
                onClick={() => setShowValues(v => !v)}
                style={{
                  padding:'7px 13px', borderRadius:9,
                  border:`1px solid ${showValues ? '#F5D14E' : '#E8E1CE'}`,
                  background: showValues ? 'rgba(245,209,78,0.12)' : '#FFFFFF',
                  color: showValues ? '#F5D14E' : '#6C6553',
                  fontSize:12, cursor:'pointer', fontFamily:'inherit',
                }}
              >
                Show values
              </button>
            </>
          )}

          {/* View toggle */}
          <Seg
            options={[{ v:'table', label:'📋 Category table' }, { v:'bars', label:'📊 Cashflow bars' }]}
            value={view}
            onChange={v => setView(v as 'table' | 'bars')}
            themeSurface={'#FFFFFF'}
            themeBorder={'#E8E1CE'}
            themeAccent={'#F5D14E'}
            themeAccentFill={'rgba(245,209,78,0.12)'}
            themeTextDim={'#6C6553'}
          />
        </div>
      </div>

      {/* Type legend */}
      <div style={{ display:'flex', gap:16, marginBottom:12, alignItems:'center', flexWrap:'wrap' }}>
        {[
          { label:'Income',     color:GREEN },
          { label:'Fixed',      color:AMBER },
          { label:'Guilt-free', color:CYAN  },
          { label:'Goal',       color:'#2FB06C' },
        ].map(({ label, color }) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:5 }}>
            <div style={{ width:10, height:10, borderRadius:2, background:color, flexShrink:0 }} />
            <span style={{ fontSize:12, color:'#9B9180' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Main content */}
      {view === 'table' ? renderTableView() : renderBarsView()}

    </div>
  )
}
