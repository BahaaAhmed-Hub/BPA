import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { amIAdmin } from './lib/admin'
import AdminPanel from './modules/admin/AdminPanel'
import { initAppearance } from './lib/themes'
import {
  LayoutDashboard, Users, CreditCard, ScrollText,
  KeyRound, LogOut, ShieldCheck, X,
} from 'lucide-react'

initAppearance()

type Phase = 'login' | 'checking' | 'panel' | 'denied'
export type AdminSection = 'dashboard' | 'users' | 'plans' | 'audit'

function usernameToEmail(u: string) { return `${u.trim().toLowerCase()}@admin.local` }

const NAV: { key: AdminSection; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'users',     label: 'Users' },
  { key: 'plans',     label: 'Plans' },
  { key: 'audit',     label: 'Audit log' },
]

// ─── Icons beside nav labels ─────────────────────────────────────────────────
const NAV_ICONS: Record<AdminSection, React.ReactNode> = {
  dashboard: <LayoutDashboard size={15} />,
  users:     <Users size={15} />,
  plans:     <CreditCard size={15} />,
  audit:     <ScrollText size={15} />,
}

export default function AdminApp() {
  const [phase, setPhase]       = useState<Phase>('login')
  const [section, setSection]   = useState<AdminSection>('dashboard')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginErr, setLoginErr] = useState('')
  const [busy, setBusy]         = useState(false)
  const [pwOpen, setPwOpen]     = useState(false)
  const [newPw, setNewPw]       = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwErr, setPwErr]       = useState('')
  const [pwOk, setPwOk]         = useState('')
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setPhase('checking')
        amIAdmin().then(ok => setPhase(ok ? 'panel' : 'denied'))
      }
    })
  }, [])

  async function signIn(e: React.FormEvent) {
    e.preventDefault(); setLoginErr(''); setBusy(true)
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password })
    if (authErr) { setLoginErr('Invalid username or password'); setBusy(false); return }
    setPhase('checking')
    const ok = await amIAdmin()
    if (!ok) { await supabase.auth.signOut(); setPhase('denied') } else { setPhase('panel') }
    setBusy(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
    window.location.hash = '#admin'
    setPhase('login'); setUsername(''); setPassword(''); setLoginErr('')
    setSection('dashboard'); setPwOpen(false)
  }

  async function changePw(e: React.FormEvent) {
    e.preventDefault(); setPwErr(''); setPwOk('')
    if (newPw !== confirmPw)  { setPwErr('Passwords do not match'); return }
    if (newPw.length < 6)     { setPwErr('At least 6 characters required'); return }
    setSavingPw(true)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setSavingPw(false)
    if (error) { setPwErr(error.message); return }
    setPwOk('Password updated.'); setNewPw(''); setConfirmPw('')
    setTimeout(() => { setPwOpen(false); setPwOk('') }, 1600)
  }

  // ── Checking / denied splash ────────────────────────────────────────────────
  if (phase === 'checking') return <Splash text="Verifying…" />
  if (phase === 'denied') return (
    <Splash text="This account is not an admin.">
      <button onClick={() => setPhase('login')} style={loginBtn}>Try a different account</button>
    </Splash>
  )

  // ── Main panel ──────────────────────────────────────────────────────────────
  if (phase === 'panel') return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: '"Inter", system-ui, sans-serif', background: '#F1F5F9' }}>

      {/* Sidebar */}
      <aside style={{
        width: 228, minWidth: 228, background: '#0F172A',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        {/* Brand */}
        <div style={{ padding: '18px 14px 14px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <ShieldCheck size={17} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#F8FAFC', letterSpacing: '-0.01em' }}>BPA Admin</div>
              <div style={{ fontSize: 10.5, color: '#475569', marginTop: 1 }}>Control Panel</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '10px 8px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(item => {
            const active = section === item.key
            return (
              <button key={item.key} onClick={() => { setSection(item.key); setPwOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  background: active ? '#1E293B' : 'transparent',
                  color: active ? '#F1F5F9' : '#64748B',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 600 : 400,
                  textAlign: 'left', width: '100%',
                  borderLeft: active ? '2px solid #6366F1' : '2px solid transparent',
                }}>
                {NAV_ICONS[item.key]}
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* Bottom */}
        <div style={{ padding: 8, borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <button onClick={() => { setPwOpen(v => !v); setPwErr(''); setPwOk('') }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', background: pwOpen ? '#1E293B' : 'transparent', color: '#64748B', fontFamily: 'inherit', fontSize: 13, textAlign: 'left', width: '100%' }}>
            <KeyRound size={15} />
            Change password
          </button>
          <button onClick={signOut}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'transparent', color: '#EF4444', fontFamily: 'inherit', fontSize: 13, textAlign: 'left', width: '100%' }}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Topbar */}
        <div style={{ height: 52, background: '#fff', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', padding: '0 24px', position: 'sticky', top: 0, zIndex: 10, gap: 8 }}>
          {pwOpen
            ? <><KeyRound size={15} color="#6366F1" /><span style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>Change password</span></>
            : <><span style={{ color: '#6366F1' }}>{NAV_ICONS[section]}</span><span style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{NAV.find(n => n.key === section)?.label}</span></>
          }
        </div>

        <div style={{ flex: 1, padding: 24 }}>
          {pwOpen ? (
            <div style={{ maxWidth: 400 }}>
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>Change admin password</span>
                  <button onClick={() => setPwOpen(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94A3B8', padding: 2 }}><X size={16} /></button>
                </div>
                <form onSubmit={changePw}>
                  <label style={fieldLabel}>New password</label>
                  <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required style={fieldInput} placeholder="••••••••" autoFocus />
                  <label style={{ ...fieldLabel, marginTop: 12 }}>Confirm password</label>
                  <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required style={fieldInput} placeholder="••••••••" />
                  {pwErr && <p style={{ color: '#EF4444', fontSize: 12.5, margin: '8px 0 0' }}>{pwErr}</p>}
                  {pwOk  && <p style={{ color: '#10B981', fontSize: 12.5, margin: '8px 0 0' }}>{pwOk}</p>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button type="submit" disabled={savingPw} style={primaryBtn}>{savingPw ? 'Saving…' : 'Save password'}</button>
                    <button type="button" onClick={() => setPwOpen(false)} style={ghostBtn}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <AdminPanel section={section} />
          )}
        </div>
      </div>
    </div>
  )

  // ── Login ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0F172A', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <ShieldCheck size={26} color="#fff" />
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#F8FAFC', letterSpacing: '-0.02em' }}>Admin sign in</h1>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: '#475569' }}>BPA Control Panel</p>
        </div>

        <form onSubmit={signIn} style={{ background: '#1E293B', borderRadius: 14, padding: 24, border: '1px solid #334155' }}>
          <label style={loginLabel}>Username</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} required autoFocus autoComplete="username"
            style={loginInput} placeholder="bahaa.ahmed" />
          <label style={{ ...loginLabel, marginTop: 14 }}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password"
            style={loginInput} placeholder="••••••••" />
          {loginErr && <p style={{ color: '#EF4444', fontSize: 12.5, margin: '10px 0 0' }}>{loginErr}</p>}
          <button type="submit" disabled={busy} style={{ ...loginBtn, width: '100%', marginTop: 18 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Splash({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0F172A', gap: 16 }}>
      <p style={{ color: '#64748B', fontSize: 14, margin: 0 }}>{text}</p>
      {children}
    </div>
  )
}

// ── Shared style tokens ───────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20,
}
const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 11.5, fontWeight: 600, letterSpacing: '0.05em',
  color: '#475569', textTransform: 'uppercase', marginBottom: 5,
}
const fieldInput: React.CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box', padding: '9px 11px',
  borderRadius: 7, border: '1px solid #E2E8F0', background: '#F8FAFC',
  fontSize: 13.5, color: '#0F172A', fontFamily: 'inherit', outline: 'none',
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 7, border: 'none', background: '#6366F1',
  color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
const ghostBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 7, border: '1px solid #E2E8F0', background: '#fff',
  color: '#475569', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}
const loginLabel: React.CSSProperties = {
  display: 'block', fontSize: 11.5, fontWeight: 600, letterSpacing: '0.05em',
  color: '#64748B', textTransform: 'uppercase', marginBottom: 5,
}
const loginInput: React.CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box', padding: '9px 11px',
  borderRadius: 7, border: '1px solid #334155', background: '#0F172A',
  fontSize: 13.5, color: '#F8FAFC', fontFamily: 'inherit', outline: 'none',
}
const loginBtn: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 7, border: 'none', background: '#6366F1',
  color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
