import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from 'react'
import { ChevronDown, ChevronRight, ChevronsUpDown, ChevronsDownUp, GripVertical, X, Trash2, Plus } from 'lucide-react'
import { useFinanceStore } from '../financeStore'
import type { Category } from '../types'
import { CategoryGlyph } from '../components/CategoryGlyph'
import { toBase, baseCurrency, currenciesNeedingRates } from '../fx'
import { acct, outflow } from '../format'
import { findDuplicates } from '../duplicates'
import { DuplicateMark } from '../components/DuplicateMark'
import { isUnpaid, unpaidRow, UNPAID_TITLE } from '../unpaid'
import { TransactionModal } from '../modals/TransactionModal'
import type { Transaction } from '../types'
import { todayISO } from '../dates'

// ─── 16F · Financials YTD ─────────────────────────────────────────────────────
// Spreadsheet-style table: each income/expense category as a row,
// 12 monthly columns, totals + cumulative running cash at the bottom.

/** A header cell that stays put needs its own bottom edge: with
 *  border-collapse the row's border belongs to the cells under it, and those
 *  scroll away. */
const HEAD_EDGE: React.CSSProperties = { boxShadow: 'inset 0 -2px 0 #E8E1CE' }

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const OLIVE = '#0C8140'
const RUST  = '#C62828'

/** Income reads plain, money leaving reads bracketed, an empty cell reads as a
 *  dash — the three things a ledger column does. `fmt` takes the figure as it
 *  is stored (a magnitude for both sections) and `out` says which section it
 *  belongs to. */
function fmt(v: number): string { return acct(v, { zero: '–' }) }
function fmtOut(v: number): string { return v === 0 ? '–' : outflow(v) }

function netColor(v: number) { return v > 0 ? OLIVE : v < 0 ? RUST : '#9B9180' }

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Line { cat: { id: string; name: string; icon: string; color: string }; amounts: number[] }
interface Row extends Line { children: Line[] }

/** One category's line, and — when it is open — its parts underneath. Both
 *  sections drew this twice, with the same markup and slightly different
 *  colours, which is how the income rows kept a stray element the expense ones
 *  did not. */
/** The order every screen reads a category list in. */
const byOrder = (a: Category, b: Category) =>
  (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)

/** The handle a row is dragged by.
 *
 *  Pointer events rather than HTML5 drag-and-drop: this table is reordered on
 *  a tablet as often as on a desktop, and `dragstart` never fires for a
 *  finger. `touchAction: none` is what stops the drag from scrolling the page
 *  instead. */
function Grip({ onGrab, lifted }: { onGrab: (e: React.PointerEvent) => void; lifted: boolean }) {
  return (
    <span
      onPointerDown={onGrab}
      onClick={e => e.stopPropagation()}
      title="Drag to reorder"
      style={{
        display: 'inline-flex', flexShrink: 0, marginLeft: 3, padding: '3px 0',
        color: lifted ? '#191712' : '#CFC7B2',
        cursor: lifted ? 'grabbing' : 'grab', touchAction: 'none',
      }}>
      <GripVertical size={13} strokeWidth={2} />
    </span>
  )
}

function CategoryRows({ row, tone, open, hidden, onToggleOpen, onToggleHide, onDrill, onGrab, regRow, dragId, overId, months, ROW_H, numCell, fmt }: {
  row: Row
  tone: string
  open: boolean
  hidden: (id: string) => boolean
  onToggleOpen: (id: string) => void
  onToggleHide: (id: string) => void
  /** A figure is a set of entries. `month` is null for the year column. */
  onDrill: (ids: string[], label: string, month: number | null) => void
  /** Picks a row up. It can only be put down among its own siblings. */
  onGrab: (cat: Category) => (e: React.PointerEvent) => void
  /** Lends the row's element out, so a drag can tell what it is over. */
  regRow: (id: string) => (el: HTMLTableRowElement | null) => void
  /** The row being carried, and the row it is currently over. */
  dragId: string | null
  overId: string | null
  months: number[]
  ROW_H: number
  numCell: (v: number, isNet?: boolean) => React.CSSProperties
  fmt: (v: number) => string
}) {
  const isHidden = hidden(row.cat.id)
  const lifted  = dragId === row.cat.id
  const isOver  = overId === row.cat.id && !lifted
  // A dragged-over row is tinted, and the tint has to reach the sticky name
  // cell too — it paints its own background over whatever the row has.
  const bg = isOver ? '#FBF1D2' : isHidden ? '#FAF7EC' : '#FFFFFF'
  const total = months.reduce((s, v) => s + v, 0)
  const kids = row.children
  // A hidden part is taken out of the parent's figure, so it has to be out of
  // the parent's list too, or the two disagree.
  const ownIds = [row.cat.id, ...kids.filter(k => !hidden(k.cat.id)).map(k => k.cat.id)]

  /** A figure worth opening is one with something behind it. The click has to
   *  be stopped here or it reaches the row, whose job is to hide it. */
  const cell = (v: number, ids: string[], label: string, month: number | null, style: React.CSSProperties) =>
    v === 0 ? <td style={style}>{fmt(v)}</td> : (
      <td
        style={{ ...style, cursor: 'pointer' }}
        title={`${label} — see the entries`}
        onClick={e => { e.stopPropagation(); onDrill(ids, label, month) }}
      >
        <span style={{ borderBottom: '1px solid transparent', paddingBottom: 1 }}
          onMouseEnter={e => { e.currentTarget.style.borderBottomColor = '#C5BCA8' }}
          onMouseLeave={e => { e.currentTarget.style.borderBottomColor = 'transparent' }}>
          {fmt(v)}
        </span>
      </td>
    )

  return (
    <>
      <tr
        ref={regRow(row.cat.id)}
        onClick={() => onToggleHide(row.cat.id)}
        title={isHidden ? 'Click to include in totals' : 'Click to hide from totals'}
        style={{
          borderBottom: '1px solid #F0EBDC', cursor: 'pointer',
          background: isOver ? '#FBF1D2' : isHidden ? '#FAF7EC' : 'transparent',
          opacity: lifted ? 0.4 : isHidden ? 0.45 : 1,
        }}
      >
        <td style={{ padding: '0 14px', height: ROW_H, position: 'sticky', left: 0, background: bg, zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {/* The arrow opens the row; it must not also hide it. */}
            {kids.length > 0 ? (
              <button
                onClick={e => { e.stopPropagation(); onToggleOpen(row.cat.id) }}
                title={open ? 'Fold its sub-categories away' : `Show its ${kids.length} sub-categories`}
                style={{
                  width: 16, height: 16, padding: 0, flexShrink: 0, borderRadius: 4,
                  background: 'none', border: 'none', cursor: 'pointer', color: '#9B9180',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {open ? <ChevronDown size={13} strokeWidth={2.2} /> : <ChevronRight size={13} strokeWidth={2.2} />}
              </button>
            ) : <span style={{ width: 16, flexShrink: 0 }} />}
            <span style={{ display: 'inline-flex', color: row.cat.color }}><CategoryGlyph icon={row.cat.icon} size={12} /></span>
            <span style={{ fontSize: 13, color: isHidden ? '#9B9180' : '#191712', textDecoration: isHidden ? 'line-through' : 'none', fontWeight: 500 }}>
              {row.cat.name}
            </span>
            {kids.length > 0 && !open && (
              <span style={{ fontSize: 10, color: '#C5BCA8' }}>+{kids.length}</span>
            )}
            <span style={{ flex: 1 }} />
            <Grip lifted={lifted} onGrab={onGrab(row.cat as Category)} />
          </div>
        </td>
        {months.map((v, mi) => (
          <Fragment key={mi}>{cell(v, ownIds, `${row.cat.name} · ${MONTHS_SHORT[mi]}`, mi, numCell(v))}</Fragment>
        ))}
        {cell(total, ownIds, `${row.cat.name} · the year`, null,
          { ...numCell(total), fontWeight: 700, color: total === 0 ? '#C5BCA8' : tone })}
      </tr>

      {open && kids.map(kid => {
        const kidHidden = hidden(kid.cat.id) || isHidden
        const kidLifted = dragId === kid.cat.id
        const kidOver   = overId === kid.cat.id && !kidLifted
        const kidBg = kidOver ? '#FBF1D2' : kidHidden ? '#FAF7EC' : '#FDFCF7'
        const kidTotal = kid.amounts.reduce((s, v) => s + v, 0)
        return (
          <tr key={kid.cat.id}
            ref={regRow(kid.cat.id)}
            onClick={() => onToggleHide(kid.cat.id)}
            title={hidden(kid.cat.id) ? 'Click to include in totals' : 'Click to hide from totals'}
            style={{
              borderBottom: '1px solid #F5F1E6', cursor: 'pointer', background: kidBg,
              opacity: kidLifted ? 0.4 : kidHidden ? 0.45 : 1,
            }}
          >
            <td style={{ padding: '0 14px', height: ROW_H - 4, position: 'sticky', left: 0, background: kidBg, zIndex: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingLeft: 23 }}>
                <span style={{ width: 8, height: 1, background: '#DCD3BF', flexShrink: 0 }} />
                <span style={{ display: 'inline-flex', color: kid.cat.color }}><CategoryGlyph icon={kid.cat.icon} size={11} /></span>
                <span style={{ fontSize: 12, color: kidHidden ? '#9B9180' : '#4A4438', textDecoration: hidden(kid.cat.id) ? 'line-through' : 'none' }}>
                  {kid.cat.name}
                </span>
                <span style={{ flex: 1 }} />
                <Grip lifted={kidLifted} onGrab={onGrab(kid.cat as Category)} />
              </div>
            </td>
            {kid.amounts.map((v, mi) => (
              <Fragment key={mi}>
                {cell(v, [kid.cat.id], `${kid.cat.name} · ${MONTHS_SHORT[mi]}`, mi,
                  { ...numCell(v), fontSize: 11.5, color: v === 0 ? '#D8D0BE' : '#6C6553' })}
              </Fragment>
            ))}
            {cell(kidTotal, [kid.cat.id], `${kid.cat.name} · the year`, null,
              { ...numCell(kidTotal), fontSize: 11.5, fontWeight: 600, color: kidTotal === 0 ? '#D8D0BE' : tone, opacity: 0.85 })}
          </tr>
        )
      })}
    </>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ReflectionScreen(_props?: any) {
  const { transactions, categories, accounts, upsertTransaction, removeTransaction, upsertCategory } = useFinanceStore()
  // The year lives in the store because it decides what gets fetched. Held
  // locally, stepping back a year filtered a set of transactions that only
  // ever contained the current one — so the whole grid came back empty and
  // looked like a year with nothing in it.
  const year    = useFinanceStore(s => s.currentYear)
  const setYear = useFinanceStore(s => s.setYear)

  const today = new Date()
  const base = baseCurrency()

  // Two ways to read a year, and they are different years.
  //
  //   "due"  — an entry sits in the month it belongs to, whether or not the
  //            money has moved. September's rent is September's, paid or not.
  //   "paid" — an entry sits in the month the money actually left, and an entry
  //            that has not been paid is not in the table at all.
  //
  // Settings holds the default; this remembers what was last looked at here.
  const [basis, setBasis] = useState<'due' | 'paid'>(() => {
    try {
      return (localStorage.getItem('finance-financials-basis')
        ?? localStorage.getItem('finance-count-on')) === 'paid' ? 'paid' : 'due'
    } catch { return 'due' }
  })
  function pickBasis(b: 'due' | 'paid') {
    setBasis(b)
    try { localStorage.setItem('finance-financials-basis', b) } catch { /* private mode */ }
  }

  /** The date a figure is filed under, or null when this basis cannot place it:
   *  an entry with no payment date has not been paid, and money that has not
   *  moved does not belong in a table of money that has. */
  const filedOn = useCallback(
    (tx: Transaction): string | null => (basis === 'paid' ? tx.paidAt ?? null : tx.date),
    [basis],
  )
  const filedIn = useCallback(
    (tx: Transaction, prefix: string) => { const d = filedOn(tx); return !!d && d.startsWith(prefix) },
    [filedOn],
  )

  // Entries that look like they were put in twice, this year. The rows here are
  // monthly sums, so the flag cannot sit on a figure — it sits in the header,
  // with the list of what to go and look at.
  const [dupesOpen, setDupesOpen] = useState(false)
  const yearTx = useMemo(
    () => transactions.filter(t => filedIn(t, String(year))),
    [transactions, year, filedIn],
  )
  const dupes = useMemo(() => findDuplicates(yearTx), [yearTx])
  const suspects = useMemo(
    () => yearTx.filter(t => dupes.has(t.id)).sort((a, b) => b.date.localeCompare(a.date)),
    [yearTx, dupes],
  )

  const [fxTick, setFxTick] = useState(0)
  useEffect(() => {
    const h = () => setFxTick(n => n + 1)
    window.addEventListener('professor:fxRatesChanged', h)
    return () => window.removeEventListener('professor:fxRatesChanged', h)
  }, [])

  // Build categoryId → monthly amounts map for given year
  const { incomeRows, expenseRows, monthlyIncome, monthlyExpense } = useMemo(() => {
    // Filter to the selected year
    const yearTx = transactions.filter(tx => filedIn(tx, String(year)))

    const wants = (c: { txType: string }, kind: 'income' | 'expense') =>
      c.txType === kind || c.txType === 'both'

    /** A month-by-month row for one category. `ids` is the category plus, for a
     *  parent, its children — money filed under "Groceries · Fruit" is money
     *  out of Groceries, and the parent's row said nothing about it before. */
    function amountsFor(ids: Set<string>, type: 'income' | 'expense') {
      return MONTHS_SHORT.map((_, mi) => {
        const prefix = `${year}-${String(mi + 1).padStart(2, '0')}`
        return yearTx
          .filter(tx => tx.type === type && tx.categoryId && ids.has(tx.categoryId) && filedIn(tx, prefix))
          // This added the raw figure whatever it was in, so a salary in USD
          // was counted as though it were the same number of pounds. Converted
          // now; something with no rate is left out and said so below.
          .reduce((s, tx) => s + (toBase(Math.abs(tx.amount), tx.currency, base) ?? 0), 0)
      })
    }

    function buildRows(kind: 'income' | 'expense') {
      return categories
        .filter(c => !c.parentId && wants(c, kind))
        .sort(byOrder)
        .map(cat => {
          const kids = categories.filter(c => c.parentId === cat.id).sort(byOrder)
          return {
            cat,
            // The parent's own line covers everything filed beneath it.
            amounts: amountsFor(new Set([cat.id, ...kids.map(k => k.id)]), kind),
            children: kids.map(kid => ({ cat: kid, amounts: amountsFor(new Set([kid.id]), kind) })),
          }
        })
    }

    const incomeRows  = buildRows('income')
    const expenseRows = buildRows('expense')

    const monthly = (type: 'income' | 'expense') => MONTHS_SHORT.map((_, mi) => {
      const prefix = `${year}-${String(mi + 1).padStart(2,'0')}`
      return yearTx.filter(tx => tx.type === type && filedIn(tx, prefix))
        .reduce((s, tx) => s + (toBase(Math.abs(tx.amount), tx.currency, base) ?? 0), 0)
    })
    const monthlyIncome  = monthly('income')
    const monthlyExpense = monthly('expense')

    return { incomeRows, expenseRows, monthlyIncome, monthlyExpense }
  }, [transactions, categories, year, base, fxTick, filedIn])

  // ─── Dragging a row into place ──────────────────────────────────────────
  // A row moves among its own siblings and nowhere else: the top-level rows of
  // one section, or the parts of one category. The set it may be dropped into
  // is worked out when it is picked up, so a parent can never land inside
  // somebody else's sub-categories however far the pointer wanders.
  const rowEls = useRef(new Map<string, HTMLTableRowElement>())
  const [drag, setDrag] = useState<{ id: string; scope: string[]; over: string | null } | null>(null)
  // A drag ends in a click on whatever was under the finger. That click would
  // otherwise hide the row it landed on.
  const justDragged = useRef(false)

  const regRow = useCallback((id: string) => (el: HTMLTableRowElement | null) => {
    if (el) rowEls.current.set(id, el)
    else rowEls.current.delete(id)
  }, [])

  const grab = useCallback((kind: 'income' | 'expense') => (cat: Category) => (e: React.PointerEvent) => {
    // Without this the row underneath takes the press as a click, and the
    // browser starts selecting text across the table as the pointer moves.
    e.preventDefault()
    e.stopPropagation()
    const scope = (cat.parentId
      ? categories.filter(c => c.parentId === cat.parentId)
      : categories.filter(c => !c.parentId && (c.txType === kind || c.txType === 'both'))
    ).slice().sort(byOrder).map(c => c.id)
    setDrag({ id: cat.id, scope, over: null })
  }, [categories])

  useEffect(() => {
    if (!drag) return

    /** What a row occupies on screen. An open parent stands over its parts as
     *  well, so dragging across an expanded neighbour still points at it. */
    const spanOf = (id: string): { top: number; bottom: number } | null => {
      const el = rowEls.current.get(id)
      if (!el) return null
      const r = el.getBoundingClientRect()
      let bottom = r.bottom
      for (const kid of categories.filter(c => c.parentId === id)) {
        const k = rowEls.current.get(kid.id)
        if (k) bottom = Math.max(bottom, k.getBoundingClientRect().bottom)
      }
      return { top: r.top, bottom }
    }

    const move = (e: PointerEvent) => {
      let over: string | null = null
      for (const id of drag.scope) {
        const span = spanOf(id)
        if (span && e.clientY >= span.top && e.clientY <= span.bottom) { over = id; break }
      }
      setDrag(d => (d && d.over !== over ? { ...d, over } : d))
    }

    const up = () => {
      const { id, over, scope } = drag
      if (over && over !== id) {
        const from = scope.indexOf(id)
        const to   = scope.indexOf(over)
        if (from >= 0 && to >= 0) {
          const next = scope.slice()
          next.splice(to, 0, next.splice(from, 1)[0])
          // Written back as positions rather than whatever numbers were there,
          // so a list where everything shares one sort order still comes out
          // in an order. Only what actually moved is written.
          next.forEach((cid, n) => {
            const c = categories.find(x => x.id === cid)
            if (!c || c.sortOrder === n) return
            void upsertCategory({ ...c, sortOrder: n })
          })
        }
      }
      justDragged.current = true
      setTimeout(() => { justDragged.current = false }, 0)
      setDrag(null)
    }

    const prevSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      document.body.style.userSelect = prevSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, categories, upsertCategory])

  // Hidden rows (by category id) — toggling removes row from totals
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  function toggleHide(id: string) {
    if (justDragged.current) return
    setHiddenIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const needRates = useMemo(
    () => currenciesNeedingRates(transactions.filter(t => filedIn(t, String(year))), base),
    [transactions, year, base, fxTick, filedIn],
  )

  // ── What is behind a figure ────────────────────────────────────────────────
  // Each cell is a sum; this is the list it was summed from, so an entry filed
  // wrong can be corrected where the wrongness is visible.
  const [drill, setDrill] = useState<
    { ids: string[] | null; label: string; month: number | null; kind: 'income' | 'expense' | 'both' } | null
  >(null)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [adding, setAdding] = useState(false)

  function openDrill(ids: string[] | null, label: string, month: number | null, kind: 'income' | 'expense' | 'both') {
    setDrill({ ids, label, month, kind })
  }

  const drillTx = useMemo(() => {
    if (!drill) return []
    const prefix = drill.month === null
      ? String(year)
      : `${year}-${String(drill.month + 1).padStart(2, '0')}`
    const ids = drill.ids ? new Set(drill.ids) : null
    const wanted = (t: string) => drill.kind === 'both' ? (t === 'income' || t === 'expense') : t === drill.kind
    return transactions
      .filter(tx => wanted(tx.type) && filedIn(tx, prefix))
      .filter(tx => (ids ? !!tx.categoryId && ids.has(tx.categoryId) : true))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [drill, transactions, year, filedIn])

  /** A figure covering exactly one category can say where a new entry goes; one
   *  covering a whole section cannot, so the entry asks. And a month figure
   *  dates it into that month — the 1st, or today when today is inside it. */
  const addTarget = useMemo(() => {
    if (!drill || !drill.ids || drill.ids.length === 0) return null
    const cat = categories.find(c => c.id === drill.ids![0])
    return cat ? { id: cat.id, name: cat.name } : null
  }, [drill, categories])

  const addDate = useMemo(() => {
    if (!drill) return undefined
    const today = todayISO()
    if (drill.month === null) return today.startsWith(String(year)) ? today : `${year}-01-01`
    const prefix = `${year}-${String(drill.month + 1).padStart(2, '0')}`
    return today.startsWith(prefix) ? today : `${prefix}-01`
  }, [drill, year])

  // Which parents are showing their parts.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  function toggleOpen(id: string) {
    setOpenIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Every row that has anything to open. Opening them one at a time is fine
  // for two; with a dozen it is the only thing you do before reading anything.
  const foldable = [...incomeRows, ...expenseRows].filter(r => r.children.length).map(r => r.cat.id)
  const allOpen  = foldable.length > 0 && foldable.every(id => openIds.has(id))
  function toggleAll() {
    setOpenIds(allOpen ? new Set() : new Set(foldable))
  }

  /** A parent's row already includes its children, so a hidden child has to
   *  come off its parent's line too — otherwise hiding one changes nothing and
   *  the totals disagree with the rows they are made of. */
  function rowMonths(row: { cat: { id: string }; amounts: number[]; children: { cat: { id: string }; amounts: number[] }[] }) {
    return row.amounts.map((v, mi) =>
      v - row.children.reduce((s, c) => s + (hiddenIds.has(c.cat.id) ? c.amounts[mi] : 0), 0))
  }

  // Visible income / expense sums per month (respecting hidden rows)
  const visIncome  = MONTHS_SHORT.map((_, mi) => incomeRows.filter(r => !hiddenIds.has(r.cat.id)).reduce((s, r) => s + rowMonths(r)[mi], 0))
  const visExpense = MONTHS_SHORT.map((_, mi) => expenseRows.filter(r => !hiddenIds.has(r.cat.id)).reduce((s, r) => s + rowMonths(r)[mi], 0))
  const netPerMonth = MONTHS_SHORT.map((_, mi) => visIncome[mi] - visExpense[mi])

  /** The categories a figure covers: a hidden parent is out entirely, a hidden
   *  part is out of its parent. Same rule the sums above use. */
  const visibleIds = (rows: { cat: { id: string }; children: { cat: { id: string } }[] }[]) =>
    rows.filter(r => !hiddenIds.has(r.cat.id))
      .flatMap(r => [r.cat.id, ...r.children.filter(c => !hiddenIds.has(c.cat.id)).map(c => c.cat.id)])

  // Cumulative (running) cash
  const cumulative: number[] = []
  let cum = 0
  netPerMonth.forEach(n => { cum += n; cumulative.push(cum) })

  const currentMonth = today.getMonth() // 0-indexed
  // Entries the paid view has nothing to place: due this year, never paid.
  const unpaidThisYear = useMemo(
    () => transactions.filter(t => !t.paidAt && t.date.startsWith(String(year))).length,
    [transactions, year],
  )

  const throughLabel = MONTHS_SHORT[Math.min(currentMonth, 11)]

  const totalIncome  = visIncome.reduce((s, v) => s + v, 0)
  const totalExpense = visExpense.reduce((s, v) => s + v, 0)
  const totalNet = totalIncome - totalExpense

  const COL_W  = 78
  const ROW_H  = 36
  const NAME_W = 160

  // ── Shared cell style ─────────────────────────────────────────────────────

  function numCell(v: number, isNet = false): React.CSSProperties {
    return {
      width: COL_W, minWidth: COL_W, textAlign: 'right' as const, padding: '0 10px',
      fontFamily: 'Outfit, sans-serif', fontSize: 12.5, fontWeight: isNet ? 700 : 500,
      color: isNet ? netColor(v) : v === 0 ? '#C5BCA8' : '#191712',
      fontVariantNumeric: 'tabular-nums' as const,
      whiteSpace: 'nowrap' as const,
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F7F4EA', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid #E8E1CE', padding: '14px 26px 14px', display: 'flex', alignItems: 'flex-end', gap: 20 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', display: 'block', marginBottom: 4 }}>FINANCE · REFLECT</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => void setYear(year - 1)} style={{ background: 'none', border: 'none', color: '#6C6553', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>‹</button>
            <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712' }}>
              Financials, {year}
            </span>
            <button onClick={() => void setYear(year + 1)} style={{ background: 'none', border: 'none', color: '#6C6553', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>›</button>
          </div>
          <span style={{ fontSize: 12, color: '#6C6553', marginTop: 3, display: 'block' }}>
            Every income &amp; expense line by month — hide any row and every total recalculates
            {needRates.length > 0 && (
              <span style={{ color: '#8A6D0B' }}>
                {' · '}{needRates.join(' and ')} left out — no rate set, see Settings → Finance
              </span>
            )}
          </span>
        </div>

        {/* Stats bar */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, paddingBottom: 4, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <span style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 999, background: '#EDE7D9' }}>
              {([
                ['due',  'When it is due', 'Every entry in the month it belongs to, paid or not'],
                ['paid', 'When it was paid', 'Only money that has actually moved, in the month it moved'],
              ] as const).map(([id, label, why]) => (
                <button key={id} onClick={() => pickBasis(id)} title={why}
                  style={{
                    height: 26, padding: '0 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 11.5, fontWeight: basis === id ? 700 : 500,
                    background: basis === id ? '#FFFFFF' : 'transparent',
                    color: basis === id ? '#191712' : '#6C6553',
                    boxShadow: basis === id ? '0 1px 3px rgba(25,23,18,0.16)' : 'none',
                  }}>{label}</button>
              ))}
            </span>
            {basis === 'paid' && unpaidThisYear > 0 && (
              <span style={{ fontSize: 10.5, color: '#C08A2E' }}>
                {unpaidThisYear} not paid yet, so not in this view
              </span>
            )}
          </div>
          {suspects.length > 0 && (
            <span style={{ position: 'relative' }}>
              <button
                onClick={() => setDupesOpen(o => !o)}
                title="Identical entries filed twice on one day, or twice in one month"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, height: 28,
                  padding: '0 11px', borderRadius: 999, cursor: 'pointer',
                  background: dupesOpen ? '#F5D14E' : '#FBEBC8',
                  border: '1px solid #EFE1B4', color: '#7A5F09',
                  fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700,
                }}>
                {suspects.length} to check
              </button>
              {dupesOpen && (
                <div style={{
                  position: 'absolute', top: 34, right: 0, zIndex: 30, width: 340,
                  maxHeight: 320, overflowY: 'auto', padding: 12,
                  background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 14,
                  boxShadow: '0 16px 40px rgba(25,23,18,0.18)', textAlign: 'left',
                }}>
                  <div style={{ fontSize: 11.5, color: '#6C6553', lineHeight: 1.5, marginBottom: 10 }}>
                    Same amount, account, category and payee. Filed twice on one day is
                    usually a slip; twice in one month may be real. Nothing has been changed —
                    open one from Today or Balances to fix it.
                  </div>
                  {suspects.map(t => (
                    <div key={t.id} style={{
                      display: 'flex', alignItems: 'baseline', gap: 8,
                      padding: '6px 0', borderTop: '1px solid #F5F1E6', fontSize: 12,
                    }}>
                      <span style={{ color: '#9B9180', fontVariantNumeric: 'tabular-nums' }}>{t.date}</span>
                      <span style={{ flex: 1, minWidth: 0, color: '#191712', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.payee?.trim() || categories.find(c => c.id === t.categoryId)?.name || 'Entry'}
                      </span>
                      <span style={{ color: dupes.get(t.id) === 'day' ? '#8A6D0B' : '#B0A488', fontSize: 10, fontWeight: 700 }}>
                        {dupes.get(t.id) === 'day' ? 'SAME DAY' : 'SAME MONTH'}
                      </span>
                      <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 600, color: '#3D3926', fontVariantNumeric: 'tabular-nums' }}>
                        {acct(Math.abs(t.amount), { currency: t.currency })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </span>
          )}
          {hiddenIds.size > 0 && (
            <span style={{ fontSize: 11.5, color: '#9B9180', fontStyle: 'italic' }}>
              {hiddenIds.size} row{hiddenIds.size > 1 ? 's' : ''} hidden
              <button onClick={() => setHiddenIds(new Set())} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#6C6553', cursor: 'pointer', fontSize: 11.5, textDecoration: 'underline', padding: 0 }}>Show all</button>
            </span>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', fontWeight: 700, color: '#9B9180' }}>NET THROUGH {throughLabel}</div>
            <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: netColor(totalNet) }}>
              {acct(totalNet, { currency: 'EGP', zero: '–' })}
            </div>
          </div>
        </div>
      </div>

      {/* Table scroll area */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: NAME_W + COL_W * 12 + 120 }}>

          {/* Column headers */}
          <thead>
            <tr style={{ background: '#FCFAF4' }}>
              <th style={{ width: NAME_W, minWidth: NAME_W, textAlign: 'left', padding: '8px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#9B9180', position: 'sticky', top: 0, left: 0, background: '#FCFAF4', zIndex: 4, ...HEAD_EDGE }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span>CATEGORY</span>
                  {foldable.length > 0 && (
                    <button
                      onClick={toggleAll}
                      title={allOpen ? 'Fold every sub-category away' : `Open all ${foldable.length} that have sub-categories`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, height: 20,
                        padding: '0 7px', borderRadius: 999, cursor: 'pointer',
                        background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#6C6553',
                        fontFamily: 'inherit', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em',
                      }}>
                      {allOpen ? <ChevronsDownUp size={11} strokeWidth={2.2} /> : <ChevronsUpDown size={11} strokeWidth={2.2} />}
                      {allOpen ? 'COLLAPSE ALL' : 'EXPAND ALL'}
                    </button>
                  )}
                </span>
              </th>
              {MONTHS_SHORT.map(m => (
                <th key={m} style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#9B9180', position: 'sticky', top: 0, background: '#FCFAF4', zIndex: 3, ...HEAD_EDGE }}>{m.toUpperCase()}</th>
              ))}
              <th style={{ width: 100, textAlign: 'right', padding: '8px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#9B9180', position: 'sticky', top: 0, background: '#FCFAF4', zIndex: 3, ...HEAD_EDGE }}>TOTAL</th>
            </tr>
          </thead>

          <tbody>

            {/* ── INCOME section ── */}
            <SectionHeader label="INCOME" colCount={12} colWidth={COL_W} nameWidth={NAME_W}
              monthTotals={monthlyIncome} rowTotal={monthlyIncome.reduce((s, v) => s + v, 0)}
              onDrill={(label, month) => openDrill(null, label, month, 'income')} />

            {incomeRows.map(row => (
              <CategoryRows key={row.cat.id} row={row} tone={OLIVE}
                onGrab={grab('income')} regRow={regRow}
                dragId={drag?.id ?? null} overId={drag?.over ?? null}
                open={openIds.has(row.cat.id)} hidden={id => hiddenIds.has(id)}
                onToggleOpen={toggleOpen} onToggleHide={toggleHide}
                months={rowMonths(row)} ROW_H={ROW_H} numCell={numCell} fmt={fmt}
                onDrill={(ids, label, month) => openDrill(ids, label, month, 'income')} />
            ))}

            {/* Total income row */}
            <TotalRow label="Total income" months={visIncome} total={totalIncome} sign={1} COL_W={COL_W} NAME_W={NAME_W}
              onDrill={(label, month) => openDrill(visibleIds(incomeRows), label, month, 'income')} />

            {/* Spacer */}
            <tr style={{ height: 12 }}><td colSpan={14} /></tr>

            {/* ── EXPENSES section ── */}
            <SectionHeader label="EXPENSES" colCount={12} colWidth={COL_W} nameWidth={NAME_W}
              monthTotals={monthlyExpense} rowTotal={monthlyExpense.reduce((s, v) => s + v, 0)} out
              onDrill={(label, month) => openDrill(null, label, month, 'expense')} />

            {expenseRows.map(row => (
              <CategoryRows key={row.cat.id} row={row} tone={RUST}
                onGrab={grab('expense')} regRow={regRow}
                dragId={drag?.id ?? null} overId={drag?.over ?? null}
                open={openIds.has(row.cat.id)} hidden={id => hiddenIds.has(id)}
                onToggleOpen={toggleOpen} onToggleHide={toggleHide}
                months={rowMonths(row)} ROW_H={ROW_H} numCell={numCell} fmt={fmtOut}
                onDrill={(ids, label, month) => openDrill(ids, label, month, 'expense')} />
            ))}

            {/* Total expenses row */}
            <TotalRow label="Total expenses" months={visExpense} total={totalExpense} sign={-1} COL_W={COL_W} NAME_W={NAME_W}
              onDrill={(label, month) => openDrill(visibleIds(expenseRows), label, month, 'expense')} />

            {/* Spacer */}
            <tr style={{ height: 8 }}><td colSpan={14} /></tr>

            {/* Net per month */}
            <NetRow label="Net by month" months={netPerMonth} total={totalNet} COL_W={COL_W} NAME_W={NAME_W}
              onDrill={(label, month) => openDrill([...visibleIds(incomeRows), ...visibleIds(expenseRows)], label, month, 'both')} />

            {/* Cumulative cash */}
            <CumulativeRow months={cumulative} COL_W={COL_W} NAME_W={NAME_W} />

          </tbody>
        </table>
      </div>

      {/* What one figure was summed from. Same card the other detail panels
          use — eyebrow pill, round close, a black pill for the one action. */}
      {drill && (
        <div
          onClick={() => setDrill(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 900,
            background: 'rgba(25,23,18,0.42)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 560, maxHeight: '84vh', display: 'flex', flexDirection: 'column',
              background: '#FCFAF4', border: '1px solid #E8E1CE', borderRadius: 20,
              boxShadow: '0 30px 80px rgba(25,23,18,0.28)', padding: '18px 20px 20px',
            }}>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: '#F3EEE0', borderRadius: 999, padding: '5px 12px',
                fontSize: 11.5, fontWeight: 600, color: '#6C6553',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: drill.kind === 'income' ? OLIVE : drill.kind === 'expense' ? RUST : '#6C6553' }} />
                {drill.kind === 'income' ? 'Income' : drill.kind === 'expense' ? 'Spending' : 'In and out'}
              </span>
              <button onClick={() => setDrill(null)} title="Close"
                style={{
                  marginLeft: 'auto', width: 30, height: 30, borderRadius: '50%', padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#6C6553', cursor: 'pointer',
                }}><X size={14} /></button>
            </div>

            <div style={{ flexShrink: 0 }}>
              <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 21, fontWeight: 600, letterSpacing: '-0.03em', color: '#191712' }}>
                {drill.label}
              </div>
              <div style={{ fontSize: 12, color: '#6C6553', marginTop: 3 }}>
                {drillTx.length} {drillTx.length === 1 ? 'entry' : 'entries'} ·{' '}
                {acct(drillTx.reduce((n, t) => {
                  const v = toBase(Math.abs(t.amount), t.currency, base) ?? 0
                  return n + (t.type === 'income' ? v : -v)
                }, 0), { currency: base })}
              </div>
            </div>

            <div style={{ height: 1, background: '#F0EBDC', margin: '14px 0 2px' }} />

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', margin: '0 -2px', padding: '0 2px' }}>
              {drillTx.length === 0 && (
                <div style={{ fontSize: 13, color: '#9B9180', textAlign: 'center', padding: '34px 0' }}>
                  Nothing behind this figure any more
                </div>
              )}
              {drillTx.map(tx => {
                const cat = categories.find(c => c.id === tx.categoryId)
                return (
                  <div key={tx.id}
                    title={isUnpaid(tx) ? UNPAID_TITLE : undefined}
                    style={{
                    display: 'flex', alignItems: 'center', gap: 11,
                    padding: '11px 0', borderBottom: '1px solid #F0EBDC',
                    ...unpaidRow(isUnpaid(tx)),
                  }}>
                    <span
                      onClick={() => setEditing(tx)}
                      title="Open this entry"
                      style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer' }}>
                      <span style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: '#F1ECDE', color: cat?.color ?? '#6C6553',
                      }}>
                        <CategoryGlyph icon={cat?.icon} size={15} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: '#191712', fontWeight: 500 }}>
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tx.payee?.trim() || cat?.name || 'Entry'}
                          </span>
                          <DuplicateMark scope={dupes.get(tx.id)} />
                        </span>
                        <span style={{ display: 'block', fontSize: 11.5, color: '#9B9180', marginTop: 1 }}>
                          {tx.date}{cat && tx.payee?.trim() ? ` · ${cat.name}` : ''}
                        </span>
                      </span>
                      <span style={{
                        fontFamily: 'Outfit, sans-serif', fontSize: 13.5, fontWeight: 600,
                        color: tx.type === 'income' ? OLIVE : RUST, fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                      }}>
                        {acct(tx.type === 'income' ? Math.abs(tx.amount) : -Math.abs(tx.amount), { currency: tx.currency })}
                      </span>
                    </span>
                    <button
                      onClick={() => {
                        if (!window.confirm(`Delete ${tx.payee?.trim() || 'this entry'} of ${acct(Math.abs(tx.amount), { currency: tx.currency })}?`)) return
                        void removeTransaction(tx.id)
                      }}
                      title="Delete this entry"
                      style={{
                        width: 28, height: 28, borderRadius: '50%', padding: 0, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#9B9180', cursor: 'pointer',
                      }}><Trash2 size={13} /></button>
                  </div>
                )
              })}
            </div>

            <div style={{ height: 1, background: '#F0EBDC', margin: '14px 0' }} />

            {/* One more of the same thing, already knowing where it goes */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 11.5, color: '#9B9180' }}>
                {addTarget
                  ? `New entries land in ${addTarget.name}${drill.month === null ? '' : `, ${MONTHS_SHORT[drill.month]}`}`
                  : 'Pick the category on the entry itself'}
              </span>
              <span style={{ flex: 1 }} />
              <button
                onClick={() => setAdding(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, height: 38,
                  padding: '0 18px', borderRadius: 10, cursor: 'pointer',
                  background: '#191712', border: '1px solid #191712', color: '#FDF8E7',
                  fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
                }}>
                <Plus size={14} /> Add an entry
              </button>
            </div>
          </div>
        </div>
      )}

      {adding && drill && (
        <TransactionModal
          transaction={null}
          initial={{
            categoryId: addTarget?.id,
            type: drill.kind === 'income' ? 'income' : 'expense',
            date: addDate,
          }}
          accounts={accounts}
          categories={categories}
          history={transactions}
          onSave={tx => { void upsertTransaction(tx); setAdding(false) }}
          onClose={() => setAdding(false)}
        />
      )}

      {editing && (
        <TransactionModal
          transaction={editing}
          accounts={accounts}
          categories={categories}
          history={transactions}
          onSave={tx => { void upsertTransaction(tx); setEditing(null) }}
          onDelete={id => { void removeTransaction(id); setEditing(null) }}
          onClose={() => setEditing(null)}
        />
      )}

    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ label, colCount: _colCount, colWidth, nameWidth: _nameWidth, monthTotals, rowTotal, out, onDrill }: {
  label: string; colCount: number; colWidth: number; nameWidth: number
  monthTotals: number[]; rowTotal: number; out?: boolean
  onDrill: (label: string, month: number | null) => void
}) {
  const f = out ? fmtOut : fmt
  return (
    <tr style={{ background: '#F0EBDC', borderTop: '1px solid #E8E1CE', borderBottom: '1px solid #E8E1CE' }}>
      <td style={{ padding: '5px 14px', position: 'sticky', left: 0, background: '#F0EBDC', zIndex: 2 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553' }}>{label}</span>
      </td>
      {monthTotals.map((v, i) => (
        <td key={i}
          onClick={v === 0 ? undefined : () => onDrill(`${label} · ${MONTHS_SHORT[i]}`, i)}
          style={{ width: colWidth, textAlign: 'right', padding: '5px 10px', fontFamily: 'Outfit, sans-serif', fontSize: 11, color: v === 0 ? '#C5BCA8' : '#6C6553', fontVariantNumeric: 'tabular-nums', cursor: v === 0 ? 'default' : 'pointer' }}>
          {f(v)}
        </td>
      ))}
      <td
        onClick={rowTotal === 0 ? undefined : () => onDrill(`${label} · the year`, null)}
        style={{ width: 100, textAlign: 'right', padding: '5px 14px', fontFamily: 'Outfit, sans-serif', fontSize: 11.5, fontWeight: 700, color: '#6C6553', fontVariantNumeric: 'tabular-nums', cursor: rowTotal === 0 ? 'default' : 'pointer' }}>
        {f(rowTotal)}
      </td>
    </tr>
  )
}

function TotalRow({ label, months, total, sign, COL_W, NAME_W: _NAME_W, onDrill }: {
  label: string; months: number[]; total: number; sign: 1 | -1
  COL_W: number; NAME_W: number
  onDrill: (label: string, month: number | null) => void
}) {
  const col = sign === 1 ? OLIVE : RUST
  return (
    <tr style={{ background: '#F7F4EA', borderTop: '2px solid #E8E1CE', borderBottom: '2px solid #E8E1CE' }}>
      <td style={{ padding: '0 14px', height: 38, position: 'sticky', left: 0, background: '#F7F4EA', zIndex: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#191712' }}>{label}</span>
      </td>
      {months.map((v, mi) => (
        <td key={mi}
          onClick={v === 0 ? undefined : () => onDrill(`${label} · ${MONTHS_SHORT[mi]}`, mi)}
          style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '0 10px', fontFamily: 'Outfit, sans-serif', fontSize: 13, fontWeight: 700, color: v === 0 ? '#C5BCA8' : col, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', cursor: v === 0 ? 'default' : 'pointer' }}>
          {sign === 1 ? fmt(v) : fmtOut(v)}
        </td>
      ))}
      <td
        onClick={total === 0 ? undefined : () => onDrill(`${label} · the year`, null)}
        style={{ width: 100, textAlign: 'right', padding: '0 14px', fontFamily: 'Outfit, sans-serif', fontSize: 13.5, fontWeight: 700, color: total === 0 ? '#C5BCA8' : col, fontVariantNumeric: 'tabular-nums', cursor: total === 0 ? 'default' : 'pointer' }}>
        {sign === 1 ? fmt(total) : fmtOut(total)}
      </td>
    </tr>
  )
}

function NetRow({ label, months, total, COL_W, NAME_W: _NAME_W2, onDrill }: {
  label: string; months: number[]; total: number; COL_W: number; NAME_W: number
  onDrill: (label: string, month: number | null) => void
}) {
  return (
    <tr style={{ background: '#FCFAF4', borderBottom: '1px solid #E8E1CE' }}>
      <td style={{ padding: '0 14px', height: 38, position: 'sticky', left: 0, background: '#FCFAF4', zIndex: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#191712' }}>{label}</span>
      </td>
      {months.map((v, mi) => (
        <td key={mi}
          onClick={v === 0 ? undefined : () => onDrill(`${label} · ${MONTHS_SHORT[mi]}`, mi)}
          style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '0 10px', fontFamily: 'Outfit, sans-serif', fontSize: 13, fontWeight: 700, color: v === 0 ? '#9B9180' : v > 0 ? OLIVE : RUST, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', cursor: v === 0 ? 'default' : 'pointer' }}>
          {fmt(v)}
        </td>
      ))}
      <td
        onClick={total === 0 ? undefined : () => onDrill(`${label} · the year`, null)}
        style={{ width: 100, textAlign: 'right', padding: '0 14px', fontFamily: 'Outfit, sans-serif', fontSize: 13.5, fontWeight: 700, color: total === 0 ? '#9B9180' : total > 0 ? OLIVE : RUST, fontVariantNumeric: 'tabular-nums', cursor: total === 0 ? 'default' : 'pointer' }}>
        {fmt(total)}
      </td>
    </tr>
  )
}

function CumulativeRow({ months, COL_W, NAME_W: _NAME_W3 }: { months: number[]; COL_W: number; NAME_W: number }) {
  return (
    <tr style={{ background: '#191712', borderBottom: '1px solid #2C2920' }}>
      <td style={{ padding: '0 14px', height: 40, position: 'sticky', left: 0, background: '#191712', zIndex: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A8272' }}>CUMULATIVE CASH</span>
      </td>
      {months.map((v, mi) => (
        <td key={mi} style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '0 10px', fontFamily: 'Outfit, sans-serif', fontSize: 12.5, fontWeight: 700, color: v === 0 ? '#4A4438' : v > 0 ? '#7EC878' : '#E87A65', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {fmt(v)}
        </td>
      ))}
      <td style={{ width: 100, textAlign: 'right', padding: '0 14px', color: '#4A4438', fontSize: 12 }}>
        YTD
      </td>
    </tr>
  )
}
