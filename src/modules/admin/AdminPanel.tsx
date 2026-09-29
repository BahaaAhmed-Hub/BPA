import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listModules, listPlanModules, listUsers, recentChanges, resolvedFor,
  setOverride, setPlanModule,
  adminCreateUser, adminUpdateUser, adminUpdateEmail, adminDeleteUser, adminResetPassword,
  type AdminUser, type ModuleRow, type Override, type PlanRow,
} from '@/lib/admin'
import { notify } from '@/lib/undo'
import type { AdminSection } from '../../AdminApp'
import {
  ChevronDown, ChevronRight, AlertCircle, CheckCircle2,
  Plus, Pencil, Trash2, KeyRound, RefreshCw, Copy, X,
} from 'lucide-react'

// ─── Shared design tokens ─────────────────────────────────────────────────────
const C = {
  card:   { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' } as React.CSSProperties,
  th:     { padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#64748B', textTransform: 'uppercase' as const, textAlign: 'left' as const, borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' },
  td:     { padding: '12px 14px', fontSize: 13, color: '#0F172A', borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' as const },
  eyebrow:{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: '#94A3B8', textTransform: 'uppercase' as const, marginBottom: 6 },
  label:  { display: 'block', fontSize: 11.5, fontWeight: 600, letterSpacing: '0.05em', color: '#475569', textTransform: 'uppercase' as const, marginBottom: 5 },
  input:  { display: 'block', width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px', borderRadius: 7, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: 13, color: '#0F172A', fontFamily: 'inherit', outline: 'none' },
  btn:    { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#6366F1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  ghost:  { padding: '7px 14px', borderRadius: 7, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
  danger: { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#FEE2E2', color: '#991B1B', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  icon:   { background: 'none', border: 'none', cursor: 'pointer', padding: 5, borderRadius: 6, display: 'flex', alignItems: 'center', color: '#94A3B8' } as React.CSSProperties,
}

// ─── Badges ───────────────────────────────────────────────────────────────────
const PLAN_PAL: Record<string, [string, string]> = {
  free: ['#F1F5F9','#475569'], starter: ['#DBEAFE','#1D4ED8'],
  pro: ['#EDE9FE','#5B21B6'], professional: ['#EDE9FE','#5B21B6'],
  business: ['#FEF3C7','#92400E'], enterprise: ['#FEF3C7','#92400E'],
}
const STATUS_PAL: Record<string, [string, string]> = {
  active: ['#D1FAE5','#065F46'], trialing: ['#DBEAFE','#1E40AF'],
  canceled: ['#FEE2E2','#991B1B'], cancelled: ['#FEE2E2','#991B1B'],
  past_due: ['#FEF3C7','#92400E'], none: ['#F1F5F9','#64748B'],
}
function planPal(p: string)   { return PLAN_PAL[p.toLowerCase()]   ?? ['#F1F5F9','#475569'] }
function statusPal(s: string) { return STATUS_PAL[s.toLowerCase()] ?? ['#F1F5F9','#64748B'] }
function pill(text: string, [bg, color]: [string, string]) {
  return <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:99, fontSize:11.5, fontWeight:600, background:bg, color }}>{text}</span>
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
const AV_COLORS = ['#6366F1','#8B5CF6','#EC4899','#F59E0B','#10B981','#3B82F6','#EF4444']
function avColor(email: string) { return AV_COLORS[(email.charCodeAt(0) + (email.charCodeAt(1) || 0)) % AV_COLORS.length] }
function initials(u: AdminUser) {
  if (u.full_name) { const p = u.full_name.trim().split(' '); return (p[0][0] + (p[1]?.[0] ?? '')).toUpperCase() }
  return u.email[0].toUpperCase()
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' })
}
function isRecent(iso: string) { return !!iso && Date.now() - new Date(iso).getTime() < 30*24*60*60*1000 }

// ─── Stat tile ────────────────────────────────────────────────────────────────
function Stat({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div style={{ ...C.card, padding:'18px 20px' }}>
      <div style={C.eyebrow}>{label}</div>
      <div style={{ fontSize:30, fontWeight:700, color: accent ?? '#0F172A', lineHeight:1, letterSpacing:'-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize:12, color:'#94A3B8', marginTop:5 }}>{sub}</div>}
    </div>
  )
}

// ─── Override pills ───────────────────────────────────────────────────────────
function OverridePill({ value, onChange, disabled }: { value:'inherit'|'on'|'off'; onChange:(v:'inherit'|'on'|'off')=>void; disabled?:boolean }) {
  const opts: { v:'inherit'|'on'|'off'; label:string }[] = [{ v:'inherit', label:'Plan' },{ v:'on', label:'On' },{ v:'off', label:'Off' }]
  return (
    <div style={{ display:'flex', background:'#F1F5F9', borderRadius:7, padding:2, opacity:disabled?0.4:1, pointerEvents:disabled?'none':undefined }}>
      {opts.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)}
          style={{ padding:'4px 9px', borderRadius:5, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:11.5, fontWeight:600,
            background: value===o.v?'#fff':'transparent',
            color: value===o.v?(o.v==='on'?'#10B981':o.v==='off'?'#EF4444':'#6366F1'):'#94A3B8',
            boxShadow: value===o.v?'0 1px 3px rgba(0,0,0,.08)':'none' }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─── Inline form row ──────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={C.label}>{label}</label>
      {children}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────
export default function AdminPanel({ section }: { section: AdminSection }) {
  const [modules,  setModules]  = useState<ModuleRow[]>([])
  const [users,    setUsers]    = useState<AdminUser[]>([])
  const [plans,    setPlans]    = useState<PlanRow[]>([])
  const [log,      setLog]      = useState<(Override & { by: string | null })[]>([])
  const [loading,  setLoading]  = useState(true)
  const [q,        setQ]        = useState('')
  const [planFilter, setPlanFilter] = useState('all')

  // Row state
  const [openId,   setOpenId]   = useState<string | null>(null)
  const [openTab,  setOpenTab]  = useState<'details'|'modules'>('details')
  const [resolved, setResolved] = useState<Record<string, boolean>>({})

  // Create form
  const [creating, setCreating] = useState(false)
  const [cEmail,   setCEmail]   = useState('')
  const [cName,    setCName]    = useState('')
  const [cPlan,    setCPlan]    = useState('free')
  const [cPw,      setCPw]      = useState('')
  const [cBusy,    setCBusy]    = useState(false)
  const [cErr,     setCErr]     = useState('')
  const [tempPw,   setTempPw]   = useState('')  // shown once after create

  // Edit fields (per open user)
  const [eName,    setEName]    = useState('')
  const [eEmail,   setEEmail]   = useState('')
  const [ePlan,    setEPlan]    = useState('')
  const [eStatus,  setEStatus]  = useState('')
  const [eBusy,    setEBusy]    = useState(false)
  const [eErr,     setEErr]     = useState('')

  // Reset password
  const [rpOpen,   setRpOpen]   = useState(false)
  const [rpPw,     setRpPw]     = useState('')
  const [rpBusy,   setRpBusy]   = useState(false)
  const [rpErr,    setRpErr]    = useState('')

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [delBusy,  setDelBusy]  = useState(false)

  const reload = useCallback(async () => {
    const [m, u, p, l] = await Promise.all([listModules(), listUsers(), listPlanModules(), recentChanges()])
    setModules(m); setUsers(u); setPlans(p); setLog(l); setLoading(false)
  }, [])
  useEffect(() => { void reload() }, [reload])

  const openUser = users.find(u => u.id === openId) ?? null
  const prevOpenId = useRef<string | null>(null)
  useEffect(() => {
    if (openId !== prevOpenId.current) {
      prevOpenId.current = openId
      if (openUser) {
        setEName(openUser.full_name ?? '')
        setEEmail(openUser.email)
        setEPlan(openUser.plan)
        setEStatus(openUser.status === 'none' ? 'active' : openUser.status)
        setEErr(''); setRpOpen(false); setRpPw(''); setRpErr('')
        setOpenTab('details')
      }
    }
  }, [openId, openUser])

  useEffect(() => {
    if (!openUser || !modules.length) { setResolved({}); return }
    let live = true
    void resolvedFor(openUser.id, modules).then(r => { if (live) setResolved(r) })
    return () => { live = false }
  }, [openUser, modules])

  const planNames = useMemo(() => {
    const s = new Set([...plans.map(p => p.plan), ...users.map(u => u.plan)])
    return [...s].sort()
  }, [plans, users])

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    return users.filter(u => {
      const mQ = !n || u.email.toLowerCase().includes(n) || (u.full_name ?? '').toLowerCase().includes(n)
      const mP = planFilter === 'all' || u.plan === planFilter
      return mQ && mP
    })
  }, [users, q, planFilter])

  // stats
  const total    = users.length
  const paying   = users.filter(u => u.plan !== 'free' && u.status === 'active').length
  const free     = users.filter(u => u.plan === 'free' || u.status === 'none').length
  const recent   = users.filter(u => isRecent(u.created_at)).length
  const excepted = users.filter(u => Object.keys(u.overrides).length > 0).length

  const label   = (id: string) => modules.find(m => m.id === id)?.label ?? id
  const emailOf = (id: string) => users.find(u => u.id === id)?.email ?? id.slice(0, 8)

  // ── CRUD handlers ──────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setCErr(''); setCBusy(true)
    const res = await adminCreateUser(cEmail, cName, cPlan, cPw || undefined)
    setCBusy(false)
    if (res.error) { setCErr(res.error); return }
    setTempPw(res.tempPassword ?? '')
    setCEmail(''); setCName(''); setCPlan('free'); setCPw('')
    await reload()
  }

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault()
    if (!openUser) return
    setEErr(''); setEBusy(true)
    if (eEmail !== openUser.email) {
      const err = await adminUpdateEmail(openUser.id, eEmail)
      if (err) { setEErr(err); setEBusy(false); return }
    }
    const err = await adminUpdateUser(openUser.id, { fullName: eName, plan: ePlan, status: eStatus })
    setEBusy(false)
    if (err) { setEErr(err); return }
    notify('User updated')
    await reload()
  }

  async function handleDelete() {
    if (!deleteId) return
    setDelBusy(true)
    const err = await adminDeleteUser(deleteId)
    setDelBusy(false)
    if (err) { notify(`Delete failed — ${err}`); return }
    notify('User deleted')
    if (openId === deleteId) setOpenId(null)
    setDeleteId(null)
    await reload()
  }

  async function handleResetPw(e: React.FormEvent) {
    e.preventDefault()
    if (!openUser || !rpPw) return
    setRpErr(''); setRpBusy(true)
    const err = await adminResetPassword(openUser.id, rpPw)
    setRpBusy(false)
    if (err) { setRpErr(err); return }
    notify('Password reset'); setRpPw(''); setRpOpen(false)
  }

  async function flip(user: AdminUser, m: ModuleRow, v: 'inherit'|'on'|'off') {
    const enabled = v === 'inherit' ? null : v === 'on'
    const note = enabled === null ? undefined : window.prompt(`Reason for turning ${m.label} ${v} for ${user.email}?`) ?? undefined
    const err = await setOverride(user.id, m.id, enabled, note)
    if (err) return notify(`Could not change — ${err}`)
    notify(v === 'inherit' ? `${m.label} follows the ${user.plan} plan` : `${m.label} is ${v} for ${user.email}`)
    await reload()
  }

  async function flipPlan(plan: string, m: ModuleRow, on: boolean) {
    const err = await setPlanModule(plan, m.id, on)
    if (err) return notify(`Could not change — ${err}`)
    notify(`${plan} ${on ? 'now includes' : 'no longer includes'} ${m.label}`)
    await reload()
  }

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', gap:8, color:'#94A3B8', fontSize:13, padding:8 }}>
      <RefreshCw size={14} style={{ animation:'spin 0.8s linear infinite' }} />
      Loading…
    </div>
  )

  // ── Dashboard ──────────────────────────────────────────────────────────────
  if (section === 'dashboard') return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px,1fr))', gap:12 }}>
        <Stat label="Total users"    value={total}    sub="all time" />
        <Stat label="Paying"         value={paying}   sub="active subs"      accent="#6366F1" />
        <Stat label="Free tier"      value={free}     sub="no subscription" />
        <Stat label="New this month" value={recent}   sub="≤ 30 days ago"    accent="#10B981" />
        <Stat label="Exceptions"     value={excepted} sub="module overrides" accent="#F59E0B" />
      </div>

      {/* Plan distribution */}
      <div style={C.card}>
        <div style={{ padding:'14px 18px', borderBottom:'1px solid #F1F5F9' }}><div style={C.eyebrow}>Plan distribution</div></div>
        {planNames.map(plan => {
          const count = users.filter(u => u.plan === plan).length
          const pct   = total ? Math.round((count / total) * 100) : 0
          const [bg, color] = planPal(plan)
          return (
            <div key={plan} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 18px' }}>
              <span style={{ width:80, fontSize:12, fontWeight:600, color, background:bg, borderRadius:99, padding:'2px 8px', textAlign:'center' }}>{plan}</span>
              <div style={{ flex:1, height:6, background:'#F1F5F9', borderRadius:99, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:99 }} />
              </div>
              <span style={{ fontSize:12, color:'#64748B', width:80, textAlign:'right' }}>{count} · {pct}%</span>
            </div>
          )
        })}
      </div>

      {/* Recent signups */}
      <div style={C.card}>
        <div style={{ padding:'14px 18px', borderBottom:'1px solid #F1F5F9' }}><div style={C.eyebrow}>Recent signups</div></div>
        {[...users].sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0, 8).map(u => (
          <div key={u.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 18px', borderBottom:'1px solid #F1F5F9' }}>
            <div style={{ width:32, height:32, borderRadius:99, background:avColor(u.email), display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#fff', flexShrink:0 }}>{initials(u)}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'#0F172A', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{u.full_name || u.email}</div>
              {u.full_name && <div style={{ fontSize:11.5, color:'#94A3B8' }}>{u.email}</div>}
            </div>
            {pill(u.plan, planPal(u.plan))}
            <span style={{ fontSize:12, color:'#94A3B8', whiteSpace:'nowrap' }}>{fmtDate(u.created_at)}</span>
          </div>
        ))}
        {!users.length && <p style={{ padding:'14px 18px', fontSize:13, color:'#94A3B8', margin:0 }}>No users yet.</p>}
      </div>
    </div>
  )

  // ── Users ──────────────────────────────────────────────────────────────────
  if (section === 'users') return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

      {/* Toolbar */}
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or email…"
          style={{ flex:1, minWidth:200, maxWidth:320, ...C.input }} />
        <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
          style={{ padding:'8px 10px', borderRadius:7, border:'1px solid #E2E8F0', background:'#fff', fontSize:13, color:'#0F172A', fontFamily:'inherit', cursor:'pointer' }}>
          <option value="all">All plans</option>
          {planNames.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span style={{ fontSize:12, color:'#94A3B8', marginRight:'auto' }}>{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
        <button onClick={() => { setCreating(v => !v); setTempPw(''); setCErr('') }}
          style={{ ...C.btn, display:'flex', alignItems:'center', gap:6 }}>
          <Plus size={14} />{creating ? 'Cancel' : 'Add user'}
        </button>
      </div>

      {/* Create form */}
      {creating && !tempPw && (
        <div style={{ ...C.card, overflow:'visible' }}>
          <div style={{ padding:'16px 18px', borderBottom:'1px solid #F1F5F9' }}>
            <div style={C.eyebrow}>New user</div>
          </div>
          <form onSubmit={handleCreate} style={{ padding:'16px 18px', display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <Field label="Email *"><input type="email" value={cEmail} onChange={e=>setCEmail(e.target.value)} required style={C.input} placeholder="user@example.com" /></Field>
              <Field label="Full name"><input type="text" value={cName} onChange={e=>setCName(e.target.value)} style={C.input} placeholder="Jane Smith" /></Field>
              <Field label="Plan">
                <select value={cPlan} onChange={e=>setCPlan(e.target.value)} style={{ ...C.input }}>
                  <option value="free">free</option>
                  {planNames.filter(p=>p!=='free').map(p=><option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Password (optional)"><input type="text" value={cPw} onChange={e=>setCPw(e.target.value)} style={C.input} placeholder="Leave blank to auto-generate" /></Field>
            </div>
            {cErr && <p style={{ color:'#EF4444', fontSize:12.5, margin:0 }}>{cErr}</p>}
            <div style={{ display:'flex', gap:8 }}>
              <button type="submit" disabled={cBusy} style={C.btn}>{cBusy ? 'Creating…' : 'Create user'}</button>
              <button type="button" onClick={() => { setCreating(false); setCErr('') }} style={C.ghost}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Temp-password reveal after create */}
      {creating && !!tempPw && (
        <div style={{ ...C.card, overflow:'visible' }}>
          <div style={{ padding:'16px 18px', display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <CheckCircle2 size={16} color="#10B981" />
              <span style={{ fontSize:14, fontWeight:600, color:'#0F172A' }}>User created</span>
            </div>
            <p style={{ margin:0, fontSize:13, color:'#475569' }}>Share this temporary password — it is shown <strong>once only</strong>.</p>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <code style={{ flex:1, padding:'8px 12px', background:'#F1F5F9', borderRadius:7, fontSize:14, fontFamily:'monospace', color:'#0F172A', border:'1px solid #E2E8F0' }}>{tempPw}</code>
              <button style={C.icon} title="Copy" onClick={() => { navigator.clipboard.writeText(tempPw); notify('Copied') }}><Copy size={15} /></button>
            </div>
            <button onClick={() => { setCreating(false); setTempPw('') }} style={{ ...C.btn, alignSelf:'start' }}>Done</button>
          </div>
        </div>
      )}

      {/* Delete confirmation banner */}
      {deleteId && (
        <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'14px 18px', display:'flex', alignItems:'center', gap:12 }}>
          <AlertCircle size={16} color="#EF4444" />
          <span style={{ flex:1, fontSize:13, color:'#991B1B' }}>
            Delete <strong>{users.find(u=>u.id===deleteId)?.email}</strong>? This removes their account and all data. Cannot be undone.
          </span>
          <button disabled={delBusy} onClick={handleDelete} style={C.danger}>{delBusy ? 'Deleting…' : 'Yes, delete'}</button>
          <button onClick={() => setDeleteId(null)} style={C.ghost}>Cancel</button>
        </div>
      )}

      {/* Users table */}
      <div style={C.card}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={C.th}>User</th>
              <th style={C.th}>Plan</th>
              <th style={C.th}>Status</th>
              <th style={C.th}>Joined</th>
              <th style={{ ...C.th, textAlign:'center' }}>Exceptions</th>
              <th style={{ ...C.th, width:80 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => {
              const expanded = openId === u.id
              const excCount = Object.keys(u.overrides).length
              const isDeleting = deleteId === u.id
              return [
                <tr key={u.id}
                  onClick={() => { if (!isDeleting) setOpenId(expanded ? null : u.id) }}
                  style={{ cursor:'pointer', background: expanded ? '#F8FAFC' : isDeleting ? '#FEF2F2' : '#fff' }}>
                  <td style={C.td}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:34, height:34, borderRadius:99, background:avColor(u.email), display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#fff', flexShrink:0 }}>{initials(u)}</div>
                      <div>
                        <div style={{ fontWeight:600, lineHeight:1.3 }}>{u.full_name || u.email}</div>
                        {u.full_name && <div style={{ fontSize:11.5, color:'#94A3B8' }}>{u.email}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={C.td}>{pill(u.plan, planPal(u.plan))}</td>
                  <td style={C.td}>{pill(u.status || 'none', statusPal(u.status))}</td>
                  <td style={{ ...C.td, fontSize:12, color:'#64748B' }}>
                    {fmtDate(u.created_at)}
                    {isRecent(u.created_at) && <span style={{ marginLeft:6, background:'#D1FAE5', color:'#065F46', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:99 }}>NEW</span>}
                  </td>
                  <td style={{ ...C.td, textAlign:'center' }}>
                    {excCount > 0
                      ? <span style={{ fontSize:12, fontWeight:600, color:'#F59E0B' }}>{excCount}</span>
                      : <span style={{ fontSize:12, color:'#CBD5E1' }}>—</span>}
                  </td>
                  <td style={{ ...C.td, textAlign:'right' }}>
                    <div style={{ display:'flex', justifyContent:'flex-end', gap:2 }} onClick={e => e.stopPropagation()}>
                      <button style={{ ...C.icon, color: expanded ? '#6366F1' : '#94A3B8' }}
                        onClick={() => setOpenId(expanded ? null : u.id)} title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button style={{ ...C.icon, color:'#EF4444' }}
                        onClick={() => setDeleteId(deleteId === u.id ? null : u.id)} title="Delete">
                        <Trash2 size={14} />
                      </button>
                      {expanded ? <ChevronDown size={14} color="#94A3B8" /> : <ChevronRight size={14} color="#94A3B8" />}
                    </div>
                  </td>
                </tr>,

                expanded && (
                  <tr key={`${u.id}-detail`}>
                    <td colSpan={6} style={{ padding:0 }}>
                      <div style={{ background:'#F8FAFC', borderTop:'1px solid #E2E8F0', padding:'16px 20px' }}>

                        {/* Tab switcher */}
                        <div style={{ display:'flex', gap:2, marginBottom:14, background:'#F1F5F9', borderRadius:8, padding:3, alignSelf:'start', width:'fit-content' }}>
                          {(['details','modules'] as const).map(t => (
                            <button key={t} onClick={() => setOpenTab(t)}
                              style={{ padding:'5px 14px', borderRadius:6, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:12.5, fontWeight:600,
                                background: openTab===t ? '#fff' : 'transparent',
                                color: openTab===t ? '#0F172A' : '#94A3B8',
                                boxShadow: openTab===t ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}>
                              {t === 'details' ? 'Details' : 'Modules'}
                            </button>
                          ))}
                        </div>

                        {/* Details tab */}
                        {openTab === 'details' && (
                          <div>
                            <form onSubmit={handleSaveDetails}>
                              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
                                <Field label="Full name"><input type="text" value={eName} onChange={e=>setEName(e.target.value)} style={C.input} /></Field>
                                <Field label="Email"><input type="email" value={eEmail} onChange={e=>setEEmail(e.target.value)} style={C.input} /></Field>
                                <Field label="Plan">
                                  <select value={ePlan} onChange={e=>setEPlan(e.target.value)} style={C.input}>
                                    <option value="free">free</option>
                                    {planNames.filter(p=>p!=='free').map(p=><option key={p} value={p}>{p}</option>)}
                                  </select>
                                </Field>
                                <Field label="Status">
                                  <select value={eStatus} onChange={e=>setEStatus(e.target.value)} style={C.input}>
                                    {['active','trialing','canceled','past_due'].map(s=><option key={s} value={s}>{s}</option>)}
                                  </select>
                                </Field>
                              </div>
                              {eErr && <p style={{ color:'#EF4444', fontSize:12.5, margin:'0 0 10px' }}>{eErr}</p>}
                              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                <button type="submit" disabled={eBusy} style={C.btn}>{eBusy ? 'Saving…' : 'Save changes'}</button>
                                <button type="button" onClick={() => setRpOpen(v => !v)} style={{ ...C.ghost, display:'flex', alignItems:'center', gap:6 }}>
                                  <KeyRound size={13} />Reset password
                                </button>
                              </div>
                            </form>

                            {/* Reset password inline */}
                            {rpOpen && (
                              <form onSubmit={handleResetPw} style={{ marginTop:14, padding:14, background:'#fff', borderRadius:8, border:'1px solid #E2E8F0', display:'flex', gap:10, alignItems:'flex-end' }}>
                                <div style={{ flex:1 }}>
                                  <label style={C.label}>New password</label>
                                  <input type="text" value={rpPw} onChange={e=>setRpPw(e.target.value)} required style={C.input} placeholder="min 6 characters" autoFocus />
                                  {rpErr && <p style={{ color:'#EF4444', fontSize:12, margin:'5px 0 0' }}>{rpErr}</p>}
                                </div>
                                <button type="submit" disabled={rpBusy} style={C.btn}>{rpBusy ? '…' : 'Set'}</button>
                                <button type="button" onClick={() => { setRpOpen(false); setRpPw(''); setRpErr('') }} style={C.ghost}><X size={14} /></button>
                              </form>
                            )}
                          </div>
                        )}

                        {/* Modules tab */}
                        {openTab === 'modules' && (
                          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                            {modules.map(m => {
                              const has = u.overrides[m.id]
                              const state: 'inherit'|'on'|'off' = has === undefined ? 'inherit' : has ? 'on' : 'off'
                              const byPlan = plans.some(p => p.plan === u.plan && p.module_id === m.id)
                              const live = resolved[m.id]
                              return (
                                <div key={m.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 12px', background:'#fff', borderRadius:8, border:'1px solid #E2E8F0' }}>
                                  <div style={{ flex:1, display:'flex', alignItems:'center', gap:8 }}>
                                    <span style={{ fontSize:13, fontWeight:600 }}>{m.label}</span>
                                    {live !== undefined && (live ? <CheckCircle2 size={13} color="#10B981" /> : <AlertCircle size={13} color="#EF4444" />)}
                                    <span style={{ fontSize:11.5, color:'#94A3B8' }}>
                                      {m.core ? 'core' : byPlan ? `on ${u.plan}` : `not in ${u.plan}`}
                                      {u.notes[m.id] ? ` · "${u.notes[m.id]}"` : ''}
                                    </span>
                                  </div>
                                  <OverridePill value={state} disabled={m.core} onChange={v => { void flip(u, m, v) }} />
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}
            {!filtered.length && (
              <tr><td colSpan={6} style={{ padding:'24px 14px', textAlign:'center', fontSize:13, color:'#94A3B8' }}>No users match your filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )

  // ── Plans ──────────────────────────────────────────────────────────────────
  if (section === 'plans') return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <p style={{ margin:0, fontSize:13, color:'#64748B' }}>Default module access per plan. User-level overrides always win.</p>
      <div style={C.card}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:480 }}>
            <thead>
              <tr>
                <th style={{ ...C.th, width:'40%' }}>Module</th>
                {planNames.map(p => <th key={p} style={{ ...C.th, textAlign:'center' }}>{pill(p, planPal(p))}</th>)}
              </tr>
            </thead>
            <tbody>
              {modules.map(m => (
                <tr key={m.id}>
                  <td style={C.td}>
                    <span style={{ fontWeight:600 }}>{m.label}</span>
                    {m.core && <span style={{ marginLeft:6, fontSize:11, color:'#94A3B8' }}>core</span>}
                  </td>
                  {planNames.map(p => {
                    const on = m.core || plans.some(r => r.plan === p && r.module_id === m.id)
                    return (
                      <td key={p} style={{ ...C.td, textAlign:'center' }}>
                        <button disabled={m.core} onClick={() => { void flipPlan(p, m, !on) }}
                          style={{ padding:'4px 14px', borderRadius:99, border:'none', cursor:m.core?'default':'pointer', fontFamily:'inherit', fontSize:12, fontWeight:600, background:on?'#D1FAE5':'#F1F5F9', color:on?'#065F46':'#94A3B8', opacity:m.core?0.6:1 }}>
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

  // ── Audit log ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <p style={{ margin:0, fontSize:13, color:'#64748B' }}>Every active module override, newest first. An undone override leaves no row.</p>
      <div style={C.card}>
        {!log.length && <p style={{ padding:'20px 18px', margin:0, fontSize:13, color:'#94A3B8' }}>No exceptions — everyone follows their plan.</p>}
        {log.map((r, i) => {
          const granted = r.enabled
          return (
            <div key={i} style={{ display:'flex', gap:12, padding:'12px 18px', borderBottom:'1px solid #F1F5F9', alignItems:'flex-start' }}>
              {granted ? <CheckCircle2 size={14} color="#10B981" style={{ marginTop:1 }} /> : <AlertCircle size={14} color="#EF4444" style={{ marginTop:1 }} />}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, color:'#0F172A' }}>
                  <strong>{label(r.module_id)}</strong>
                  <span style={{ margin:'0 6px', padding:'1px 7px', borderRadius:99, fontSize:11, fontWeight:700, display:'inline-block', background:granted?'#D1FAE5':'#FEE2E2', color:granted?'#065F46':'#991B1B' }}>
                    {granted ? 'granted' : 'revoked'}
                  </span>
                  {granted ? 'for' : 'from'} {emailOf(r.user_id)}
                </div>
                <div style={{ fontSize:11.5, color:'#94A3B8', marginTop:3 }}>
                  {fmtDate(r.set_at)}
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
