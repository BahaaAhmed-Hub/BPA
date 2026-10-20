import { useMemo, useState } from 'react'
import { Lock, X } from 'lucide-react'
import { ICON } from '@/lib/type'
import { inputStyle } from '@/modules/library/fieldStyle'
import { useFinanceLock } from '@/modules/finance/useFinanceLock'
import { markActive } from '@/modules/finance/lock'
import { useFinanceStore } from '@/modules/finance/financeStore'
import { baseCurrency } from '@/modules/finance/fx'
import { isUnpaid } from '@/modules/finance/unpaid'
import { Unlock } from '@/modules/calendar/outcome/ExpensesBox'
import { useProjectStore } from '@/store/projectStore'
import { entryLinks, entryMeta, moneyTotals } from './projectLife'
import type { EntryMeta, Project } from './types'

const CARD: React.CSSProperties = {
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-control)',
}
const CAP: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--sb-ink-3)',
}
const money = (n: number, cur: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n) }
  catch { return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${cur}` }
}
const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** The project's money. **Behind the finance lock, like everything else that
 *  shows a figure** — locked, this draws nothing of the ledger and asks to be
 *  unlocked in place. A module that is off is not drawn at all (the caller). */
export function ProjectMoney({ project }: { project: Project }) {
  const { locked, unlock } = useFinanceLock()
  if (locked) {
    return (
      <div data-project-money-locked style={{ ...CARD, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, ...CAP }}><Lock size={ICON.sm} /> Money</span>
        <Unlock onDone={() => { unlock(); markActive(); window.dispatchEvent(new CustomEvent('finance:lockChanged')) }} />
      </div>
    )
  }
  return <MoneyOpen project={project} />
}

function MoneyOpen({ project }: { project: Project }) {
  const links = useProjectStore(s => s.links)
  const addLink = useProjectStore(s => s.addLink)
  const removeLink = useProjectStore(s => s.removeLink)
  const transactions = useFinanceStore(s => s.transactions)
  const currentYear = useFinanceStore(s => s.currentYear)
  const loading = useFinanceStore(s => s.loading)
  const [q, setQ] = useState('')
  const base = baseCurrency()

  const mine = useMemo(() => entryLinks(project.id, links), [project.id, links])
  const rows = useMemo(() => mine.map(l => ({ link: l, meta: l.meta as EntryMeta | undefined })), [mine])
  const totals = useMemo(() => moneyTotals(rows.filter((r): r is { link: typeof r.link; meta: EntryMeta } => !!r.meta)), [rows])

  // Offered: expenses and income in the year Finance has open, not yet filed
  // against any project. Entries from other years are not loaded, so they cannot
  // be offered — Finance moves to that year first.
  const taken = new Set(links.filter(l => l.kind === 'entry').map(l => l.refId))
  const options = useMemo(() => transactions
    .filter(t => (t.type === 'expense' || t.type === 'income') && !taken.has(t.id)
      && (!q.trim() || `${t.payee} ${t.note ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 60),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [transactions, links, q])

  // Gone from Finance? Only knowable for the year that is loaded.
  const missing = (l: { refId: string }, m?: EntryMeta) =>
    !!m && !loading && Number(m.date.slice(0, 4)) === currentYear && !transactions.some(t => t.id === l.refId)

  return (
    <div data-project-money style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 12 }}>
        {[
          { k: 'spent', label: 'Spent', value: money(totals.spent, base) },
          { k: 'received', label: 'Received', value: money(totals.received, base) },
          { k: 'owed', label: 'Still owed', value: money(totals.owed.total, base), sub: totals.owed.count ? `${totals.owed.count} unpaid` : 'Nothing unpaid' },
        ].map(s => (
          <div key={s.k} data-project-money-stat={s.k} style={{ ...CARD, padding: '14px 16px' }}>
            <div style={CAP}>{s.label}</div>
            <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', marginTop: 6, color: 'var(--sb-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
            {s.sub && <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginTop: 2 }}>{s.sub}</div>}
          </div>
        ))}
      </div>
      {totals.unconverted.length > 0 && (
        <p data-project-money-unconverted style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative-deep)' }}>
          No exchange rate for {totals.unconverted.join(', ')} — {totals.unconverted.length > 1 ? 'those are' : 'that is'} left out of these figures rather than guessed. Set one in Finance.
        </p>
      )}

      <div style={{ ...CARD, padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an entry by payee" aria-label="Find an entry" style={{ ...inputStyle, flex: '1 1 200px', width: 'auto' }} />
        <select aria-label="Link an entry" value="" style={{ ...inputStyle, flex: '1 1 260px', width: 'auto' }}
          onChange={e => {
            const t = transactions.find(x => x.id === e.target.value)
            if (t) addLink(project.id, 'entry', t.id, entryMeta(t))
          }}>
          <option value="">{options.length ? `Link an entry from ${currentYear}…` : `No entries to link in ${currentYear}`}</option>
          {options.map(t => <option key={t.id} value={t.id}>{`${t.date} · ${t.payee || '(no payee)'} · ${t.type === 'income' ? '+' : ''}${t.amount} ${t.currency}`}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <p data-project-money-empty style={{ margin: '8px 0', textAlign: 'center', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)' }}>
          No entries linked yet. Link the expenses that belong to this project and its spending adds up here.
        </p>
      ) : (
        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ ...CAP, padding: '12px 12px 6px' }}>Entries · {rows.length}</div>
          {rows.map(({ link, meta }) => (
            <div key={link.id} data-project-entry={link.refId}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)', flexWrap: 'wrap' }}>
              <span style={{ flex: '0 0 96px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{meta ? fmtDay(meta.date) : ''}</span>
              <span style={{ flex: '1 1 160px', minWidth: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {meta ? (meta.payee || '(no payee)') : 'An entry'}
                {missing(link, meta) && <span data-entry-missing style={{ marginLeft: 8, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative-deep)', fontWeight: 600 }}>not in Finance any more</span>}
              </span>
              {meta && (
                <span data-entry-status style={{ flex: '0 0 auto', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sb-ink-3)', background: 'var(--sb-field)', borderRadius: 999, padding: '3px 8px' }}>
                  {meta.type === 'income' ? (isUnpaid(meta) ? 'Not received' : 'Received') : (isUnpaid(meta) ? 'Unpaid' : 'Paid')}
                </span>
              )}
              <span style={{ flex: '0 0 auto', minWidth: 96, textAlign: 'right', fontSize: 'var(--sb-t-body)', fontWeight: 600, color: 'var(--sb-ink-1)', fontVariantNumeric: 'tabular-nums' }}>
                {meta ? `${meta.type === 'income' ? '+' : ''}${money(meta.amount, meta.currency)}` : ''}
              </span>
              <button type="button" aria-label={`Take ${meta?.payee || 'the entry'} out of this project`} title="Take it out of this project — the entry stays in Finance"
                onClick={() => removeLink(link.id)}
                style={{ flexShrink: 0, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--sb-ink-4)', display: 'flex' }}>
                <X size={ICON.sm} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
