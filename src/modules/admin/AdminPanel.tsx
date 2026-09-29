import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listModules, listPlanModules, listUsers, recentChanges, resolvedFor,
  setOverride, setPlanModule,
  type AdminUser, type ModuleRow, type Override, type PlanRow,
} from '@/lib/admin'
import { notify } from '@/lib/undo'
import type { AdminSection } from '../../AdminApp'
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react'

// ─── Shared tokens ─────────────────────────────────────────────────────────
const CARD: React.CSSProperties = {
  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden',
}
const TH: React.CSSProperties = {
  padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  color: '#64748B', textTransform: 'uppercase', textAlign: 'left',
  borderBottom: '1px solid #E2E8F0', background: '#F8FAFC',
}
const TD: React.CSSProperties = {
  padding: '12px 14px', fontSize: 13, color: '#0F172A',
  borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle',
}
const EYEBROW: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em',
  color: '#94A3B8', textTransform: 'uppercase', marginBottom: 6,
}

// ─── Stat tile ─────────────────────────────────────────────────────────────
function Stat({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div style={{ ...CARD, padding: '18px 20px' }}>
      <div style={EYEBROW}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: accent ?? '#0F172A', lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 5 }}>{sub}</div>}
    </div>
  )
}

// ─── Plan badge ────────────────────────────────────────────────────────────
const PLAN_COLORS: Record<string, { bg: string; color: string }> = {
  free:         { bg: '#F1F5F9', color: '#475569' },
  starter:      { bg: '#DBEAFE', color: '#1D4ED8' },
  pro:          { bg: '#EDE9FE', color: '#5B21B6' },
  professional: { bg: '#EDE9FE', color: '#5B21B6' },
  business:     { bg: '#FEF3C7', color: '#92400E' },
  enterprise:   { bg: '#FEF3C7', color: '#92400E' },
}
function planColor(plan: string) {
  return PLAN_COLORS[plan.toLowerCase()] ?? { bg: '#F1F5F9', color: '#475569' }
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  active:    { bg: '#D1FAE5', color: '#065F46' },
  trialing:  { bg: '#DBEAFE', color: '#1E40AF' },
  canceled:  { bg: '#FEE2E2', color: '#991B1B' },
  cancelled: { bg: '#FEE2E2', color: '#991B1B' },
  past_due:  { bg: '#FEF3C7', color: '#92400E' },
  none:      { bg: '#F1F5F9', color: '#64748B' },
}
function statusColor(s: string) {
  return STATUS_COLORS[s.toLowerCase()] ?? { bg: '#F1F5F9', color: '#64748B' }
}

function Badge({ text }: { text: string }) {
  const c = planColor(text)
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, ...c }}>
      {text}
    </span>
  )
}
function StatusBadge({ text }: { text: string }) {
  const c = statusColor(text || 'none')
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, ...c }}>
      {text || 'free'}
    </span>
  )
}

// ─── Avatar ────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#6366F1','#8B5CF6','#EC4899','#F59E0B','#10B981','#3B82F6','#EF4444']
function avatar(text: string) { return AVATAR_COLORS[(text.charCodeAt(0) + text.charCodeAt(1)) % AVATAR_COLORS.length] }
function initials(u: AdminUser) {
  if (u.full_name) { const p = u.full_name.trim().split(' '); return (p[0][0] + (p[1]?.[0] ?? '')).toUpperCase() }
  return u.email[0].toUpperCase()
}

// ─── Date ──────────────────────────────────────────────────────────────────
function fmt(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
function isRecent(iso: string) {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() < 30 * 24 * 60 * 60 * 1000
}

// ─── Override pill ─────────────────────────────────────────────────────────
function OverridePill({ value, onChange, disabled }: {
  value: 'inherit' | 'on' | 'off'
  onChange: (v: 'inherit' | 'on' | 'off') => void
  disabled?: boolean
}) {
  const opts: { v: 'inherit' | 'on' | 'off'; label: string }[] = [
    { v: 'inherit', label: 'Plan' },
    { v: 'on', label: 'On' },
    { v: 'off', label: 'Off' },
  ]
  return (
    <div style={{ display: 'flex', background: '#F1F5F9', borderRadius: 7, padding: 2, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : undefined }}>
      {opts.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)}
          style={{
            padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 11.5, fontWeight: 600,
            background: value === o.v ? '#fff' : 'transparent',
            color: value === o.v ? (o.v === 'on' ? '#10B981' : o.v === 'off' ? '#EF4444' : '#6366F1') : '#94A3B8',
            boxShadow: value === o.v ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
          }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function AdminPanel({ section }: { section: AdminSection }) {
  const [modules, setModules] = useState<ModuleRow[]>([])
  const [users,   setUsers]   = useState<AdminUser[]>([])
  const [plans,   setPlans]   = useState<PlanRow[]>([])
  const [log,     setLog]     = useState<(Override & { by: string | null })[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState('')
  const [planFilter, setPlanFilter] = useState('all')
  const [openId, setOpenId]   = useState<string | null>(null)
  const [resolved, setResolved] = useState<Record<string, boolean>>({})

  const reload = useCallback(async () => {
    const [m, u, p, l] = await Promise.all([listModules(), listUsers(), listPlanModules(), recentChanges()])
    setModules(m); setUsers(u); setPlans(p); setLog(l); setLoading(false)
  }, [])
  useEffect(() => { void reload() }, [reload])

  const openUser = users.find(u => u.id === openId) ?? null
  useEffect(() => {
    if (!openUser || !modules.length) { setResolved({}); return }
    let live = true
    void resolvedFor(openUser.id, modules).then(r => { if (live) setResolved(r) })
    return () => { live = false }
  }, [openUser, modules])

  const planNames = useMemo(() => {
    const set = new Set([...plans.map(p => p.plan), ...users.map(u => u.plan)])
    return [...set].sort()
  }, [plans, users])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return users.filter(u => {
      const matchQ = !needle || u.email.toLowerCase().includes(needle) || (u.full_name ?? '').toLowerCase().includes(needle)
      const matchP = planFilter === 'all' || u.plan === planFilter
      return matchQ && matchP
    })
  }, [users, q, planFilter])

  // stats
  const total    = users.length
  const paying   = users.filter(u => u.plan !== 'free' && u.status === 'active').length
  const free     = users.filter(u => u.plan === 'free' || u.status === 'none').length
  const recent   = users.filter(u => isRecent(u.created_at)).length
  const excepted = users.filter(u => Object.keys(u.overrides).length > 0).length

  async function flip(user: AdminUser, m: ModuleRow, v: 'inherit' | 'on' | 'off') {
    const enabled = v === 'inherit' ? null : v === 'on'
    const note = enabled === null ? undefined
      : window.prompt(`Reason for turning ${m.label} ${v} for ${user.email}?`) ?? undefined
    const err = await setOverride(user.id, m.id, enabled, note)
    if (err) return notify(`Could not change — ${err}`)
    notify(v === 'inherit' ? `${m.label} follows the ${user.plan} plan for ${user.email}` : `${m.label} is ${v} for ${user.email}`)
    await reload()
  }

  async function flipPlan(plan: string, m: ModuleRow, on: boolean) {
    const err = await setPlanModule(plan, m.id, on)
    if (err) return notify(`Could not change — ${err}`)
    notify(`${plan} ${on ? 'now includes' : 'no longer includes'} ${m.label}`)
    await reload()
  }

  const label   = (id: string) => modules.find(m => m.id === id)?.label ?? id
  const emailOf = (id: string) => users.find(u => u.id === id)?.email ?? id.slice(0, 8)

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94A3B8', fontSize: 13, padding: 8 }}>
      <span style={{ width: 14, height: 14, border: '2px solid #E2E8F0', borderTopColor: '#6366F1', borderRadius: 99, display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
      Loading data…
    </div>
  )

  // ── Dashboard ─────────────────────────────────────────────────────────────
  if (section === 'dashboard') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Stat label="Total users"    value={total}    sub="all time" />
        <Stat label="Paying"         value={paying}   sub="active subscriptions" accent="#6366F1" />
        <Stat label="Free tier"      value={free}     sub="no subscription" />
        <Stat label="New this month" value={recent}   sub="joined ≤ 30 days ago" accent="#10B981" />
        <Stat label="Exceptions"     value={excepted} sub="with module overrides" accent="#F59E0B" />
      </div>

      {/* Plan breakdown */}
      <div style={CARD}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9' }}>
          <div style={EYEBROW}>Plan distribution</div>
        </div>
        <div style={{ padding: '4px 0' }}>
          {planNames.map(plan => {
            const count = users.filter(u => u.plan === plan).length
            const pct   = total ? Math.round((count / total) * 100) : 0
            const { bg, color } = planColor(plan)
            return (
              <div key={plan} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px' }}>
                <span style={{ width: 70, fontSize: 12, fontWeight: 600, color, background: bg, borderRadius: 99, padding: '2px 8px', textAlign: 'center' }}>{plan}</span>
                <div style={{ flex: 1, height: 6, background: '#F1F5F9', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.4s' }} />
                </div>
                <span style={{ fontSize: 12, color: '#64748B', width: 60, textAlign: 'right' }}>{count} user{count !== 1 ? 's' : ''} · {pct}%</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Recent signups */}
      <div style={CARD}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9' }}>
          <div style={EYEBROW}>Recent signups</div>
        </div>
        {[...users].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8).map(u => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ width: 32, height: 32, borderRadius: 99, background: avatar(u.email), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{initials(u)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.full_name || u.email}</div>
              {u.full_name && <div style={{ fontSize: 11.5, color: '#94A3B8' }}>{u.email}</div>}
            </div>
            <Badge text={u.plan} />
            <span style={{ fontSize: 12, color: '#94A3B8', whiteSpace: 'nowrap' }}>{fmt(u.created_at)}</span>
          </div>
        ))}
        {!users.length && <p style={{ padding: '14px 18px', fontSize: 13, color: '#94A3B8', margin: 0 }}>No users yet.</p>}
      </div>
    </div>
  )

  // ── Users ─────────────────────────────────────────────────────────────────
  if (section === 'users') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Search + filter */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or email…"
          style={{ flex: 1, maxWidth: 320, padding: '8px 11px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', fontSize: 13, color: '#0F172A', fontFamily: 'inherit', outline: 'none' }} />
        <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
          style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', fontSize: 13, color: '#0F172A', fontFamily: 'inherit', cursor: 'pointer' }}>
          <option value="all">All plans</option>
          {planNames.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#94A3B8' }}>{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div style={CARD}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={TH}>User</th>
              <th style={TH}>Plan</th>
              <th style={TH}>Status</th>
              <th style={TH}>Joined</th>
              <th style={TH}>Exceptions</th>
              <th style={{ ...TH, width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => {
              const expanded = openId === u.id
              const excCount = Object.keys(u.overrides).length
              return (
                <>
                  <tr key={u.id}
                    onClick={() => setOpenId(expanded ? null : u.id)}
                    style={{ cursor: 'pointer', background: expanded ? '#F8FAFC' : '#fff' }}>
                    <td style={TD}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 99, background: avatar(u.email), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                          {initials(u)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: '#0F172A', lineHeight: 1.3 }}>{u.full_name || u.email}</div>
                          {u.full_name && <div style={{ fontSize: 11.5, color: '#94A3B8' }}>{u.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={TD}><Badge text={u.plan} /></td>
                    <td style={TD}><StatusBadge text={u.status} /></td>
                    <td style={{ ...TD, fontSize: 12, color: '#64748B' }}>
                      {fmt(u.created_at)}
                      {isRecent(u.created_at) && <span style={{ marginLeft: 6, background: '#D1FAE5', color: '#065F46', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99 }}>NEW</span>}
                    </td>
                    <td style={TD}>
                      {excCount > 0
                        ? <span style={{ fontSize: 12, fontWeight: 600, color: '#F59E0B' }}>{excCount} override{excCount > 1 ? 's' : ''}</span>
                        : <span style={{ fontSize: 12, color: '#CBD5E1' }}>—</span>}
                    </td>
                    <td style={{ ...TD, textAlign: 'center', color: '#94A3B8' }}>
                      {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </td>
                  </tr>

                  {expanded && (
                    <tr key={`${u.id}-detail`}>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <div style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0', padding: '16px 20px' }}>
                          <div style={EYEBROW}>MODULE ACCESS — {u.email}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                            {modules.map(m => {
                              const has = u.overrides[m.id]
                              const state: 'inherit' | 'on' | 'off' = has === undefined ? 'inherit' : has ? 'on' : 'off'
                              const byPlan = plans.some(p => p.plan === u.plan && p.module_id === m.id)
                              const live = resolved[m.id]
                              return (
                                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#fff', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{m.label}</span>
                                    {live !== undefined && (
                                      live
                                        ? <CheckCircle2 size={13} color="#10B981" />
                                        : <AlertCircle size={13} color="#EF4444" />
                                    )}
                                    <span style={{ fontSize: 11.5, color: '#94A3B8' }}>
                                      {m.core ? 'core module' : byPlan ? `on ${u.plan} plan` : `not in ${u.plan} plan`}
                                      {u.notes[m.id] ? ` · "${u.notes[m.id]}"` : ''}
                                    </span>
                                  </div>
                                  <OverridePill value={state} disabled={m.core} onChange={v => { void flip(u, m, v) }} />
                                </div>
                              )
                            })}
                          </div>
                          <p style={{ margin: '10px 0 0', fontSize: 11.5, color: '#94A3B8' }}>
                            <strong>Plan</strong> = inherit from the plan. <strong>On</strong> / <strong>Off</strong> = permanent override — you'll be asked for a reason.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {!filtered.length && (
              <tr><td colSpan={6} style={{ padding: '24px 14px', textAlign: 'center', fontSize: 13, color: '#94A3B8' }}>No users match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )

  // ── Plans ──────────────────────────────────────────────────────────────────
  if (section === 'plans') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
        These are the module defaults per plan. A user-level override takes precedence.
      </p>
      <div style={CARD}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
            <thead>
              <tr>
                <th style={{ ...TH, width: '40%' }}>Module</th>
                {planNames.map(p => (
                  <th key={p} style={{ ...TH, textAlign: 'center' }}>
                    <Badge text={p} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map(m => (
                <tr key={m.id}>
                  <td style={TD}>
                    <span style={{ fontWeight: 600 }}>{m.label}</span>
                    {m.core && <span style={{ marginLeft: 6, fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>core</span>}
                  </td>
                  {planNames.map(p => {
                    const on = m.core || plans.some(r => r.plan === p && r.module_id === m.id)
                    return (
                      <td key={p} style={{ ...TD, textAlign: 'center' }}>
                        <button
                          disabled={m.core}
                          onClick={() => { void flipPlan(p, m, !on) }}
                          title={m.core ? 'Core — always on' : on ? 'Click to remove' : 'Click to add'}
                          style={{
                            padding: '4px 14px', borderRadius: 99, border: 'none', cursor: m.core ? 'default' : 'pointer',
                            fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                            background: on ? '#D1FAE5' : '#F1F5F9',
                            color: on ? '#065F46' : '#94A3B8',
                            opacity: m.core ? 0.6 : 1,
                          }}>
                          {m.core ? 'always' : on ? '✓ yes' : '— no'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )

  // ── Audit log ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
        Every active module override, newest first. An undone override leaves no row.
      </p>
      <div style={CARD}>
        {!log.length && (
          <p style={{ padding: '20px 18px', margin: 0, fontSize: 13, color: '#94A3B8' }}>
            No exceptions — every user follows their plan.
          </p>
        )}
        {log.map((r, i) => {
          const c = r.enabled ? { icon: <CheckCircle2 size={14} color="#10B981" />, pill: { bg: '#D1FAE5', color: '#065F46' } }
                               : { icon: <AlertCircle   size={14} color="#EF4444" />, pill: { bg: '#FEE2E2', color: '#991B1B' } }
          return (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 18px', borderBottom: '1px solid #F1F5F9', alignItems: 'flex-start' }}>
              <div style={{ paddingTop: 1 }}>{c.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#0F172A' }}>
                  <strong>{label(r.module_id)}</strong>
                  <span style={{ margin: '0 6px 0', ...c.pill, padding: '1px 7px', borderRadius: 99, fontSize: 11, fontWeight: 700, display: 'inline-block' }}>
                    {r.enabled ? 'granted' : 'revoked'}
                  </span>
                  {r.enabled ? 'for' : 'from'} {emailOf(r.user_id)}
                </div>
                <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 3 }}>
                  {fmt(r.set_at)}
                  {r.by ? ` · by ${emailOf(r.by)}` : ''}
                  {r.note ? ` · "${r.note}"` : ' · no reason recorded'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
