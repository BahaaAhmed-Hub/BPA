import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { amIAdmin } from './lib/admin'
import AdminPanel from './modules/admin/AdminPanel'
import { initAppearance } from './lib/themes'

initAppearance()

type Phase = 'login' | 'checking' | 'panel' | 'denied'

// Admin auth uses a synthetic email derived from the username
function usernameToEmail(username: string) {
  return `${username.trim().toLowerCase()}@admin.local`
}

export default function AdminApp() {
  const [phase, setPhase] = useState<Phase>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [changingPw, setChangingPw] = useState(false)
  const [newPw, setNewPw]           = useState('')
  const [confirmPw, setConfirmPw]   = useState('')
  const [pwError, setPwError]       = useState('')
  const [pwSuccess, setPwSuccess]   = useState('')
  const [savingPw, setSavingPw]     = useState(false)

  // If already signed in as an admin, skip the login form
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setPhase('checking')
        amIAdmin().then(ok => setPhase(ok ? 'panel' : 'denied'))
      }
    })
  }, [])

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    const email = usernameToEmail(username)
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password })
    if (authErr) {
      setError('Invalid username or password')
      setSubmitting(false)
      return
    }
    setPhase('checking')
    const ok = await amIAdmin()
    if (!ok) {
      await supabase.auth.signOut()
      setPhase('denied')
    } else {
      setPhase('panel')
    }
    setSubmitting(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
    window.location.hash = '#admin'
    setPhase('login')
    setUsername('')
    setPassword('')
    setError('')
    setChangingPw(false)
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError('')
    setPwSuccess('')
    if (newPw !== confirmPw) { setPwError('Passwords do not match'); return }
    if (newPw.length < 6)   { setPwError('Password must be at least 6 characters'); return }
    setSavingPw(true)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setSavingPw(false)
    if (error) { setPwError(error.message); return }
    setPwSuccess('Password updated.')
    setNewPw('')
    setConfirmPw('')
    setTimeout(() => { setChangingPw(false); setPwSuccess('') }, 1500)
  }

  if (phase === 'checking') {
    return (
      <div style={centreStyle}>
        <p style={{ color: 'var(--sb-ink-3)', fontSize: 14 }}>Verifying…</p>
      </div>
    )
  }

  if (phase === 'denied') {
    return (
      <div style={centreStyle}>
        <p style={{ color: '#C62828', marginBottom: 16 }}>This account is not an admin.</p>
        <button onClick={() => setPhase('login')} style={btnStyle}>Try a different account</button>
      </div>
    )
  }

  if (phase === 'panel') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--sb-page)', padding: '24px 0' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 600, fontFamily: 'Outfit, system-ui, sans-serif', color: 'var(--sb-ink-1)' }}>
              Admin
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setChangingPw(v => !v); setPwError(''); setPwSuccess('') }}
                style={{ ...btnStyle, background: 'transparent', color: 'var(--sb-ink-3)', border: '1px solid var(--sb-border)' }}>
                Change password
              </button>
              <button onClick={signOut}
                style={{ ...btnStyle, background: 'transparent', color: 'var(--sb-ink-3)', border: '1px solid var(--sb-border)' }}>
                Sign out
              </button>
            </div>
          </div>

          {/* Inline password change */}
          {changingPw && (
            <form onSubmit={changePassword} style={{ ...cardStyle, marginBottom: 24, maxWidth: 380 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553', textTransform: 'uppercase', marginBottom: 16 }}>
                Change password
              </div>
              <label style={labelStyle}>New password</label>
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                required style={inputStyle} placeholder="••••••••" autoFocus />
              <label style={{ ...labelStyle, marginTop: 12 }}>Confirm password</label>
              <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                required style={inputStyle} placeholder="••••••••" />
              {pwError   && <p style={{ color: '#C62828', fontSize: 13, margin: '8px 0 0' }}>{pwError}</p>}
              {pwSuccess && <p style={{ color: '#0C8140', fontSize: 13, margin: '8px 0 0' }}>{pwSuccess}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button type="submit" disabled={savingPw} style={{ ...btnStyle, flex: 1 }}>
                  {savingPw ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setChangingPw(false)}
                  style={{ ...btnStyle, background: 'transparent', color: 'var(--sb-ink-3)', border: '1px solid var(--sb-border)', flex: 1 }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <AdminPanel />
        </div>
      </div>
    )
  }

  // Login form
  return (
    <div style={centreStyle}>
      <form onSubmit={signIn} style={cardStyle}>
        <h1 style={{ fontSize: 20, fontWeight: 600, fontFamily: 'Outfit, system-ui, sans-serif', margin: '0 0 24px', color: 'var(--sb-ink-1)' }}>
          Admin sign in
        </h1>

        <label style={labelStyle}>Username</label>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
          autoFocus
          autoComplete="username"
          style={inputStyle}
          placeholder="bahaa.ahmed"
        />

        <label style={{ ...labelStyle, marginTop: 14 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          style={inputStyle}
          placeholder="••••••••"
        />

        {error && (
          <p style={{ color: '#C62828', fontSize: 13, margin: '10px 0 0' }}>{error}</p>
        )}

        <button type="submit" disabled={submitting} style={{ ...btnStyle, marginTop: 20, width: '100%' }}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

const centreStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--sb-page)',
  padding: 24,
}

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E8E1CE',
  borderRadius: 14,
  padding: '32px 28px',
  width: '100%',
  maxWidth: 360,
  boxShadow: '0 1px 3px rgba(25,23,18,0.06)',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.06em',
  color: '#6C6553',
  textTransform: 'uppercase',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #E8E1CE',
  background: '#FAF7EC',
  fontSize: 14,
  color: '#191712',
  fontFamily: 'inherit',
  outline: 'none',
}

const btnStyle: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  border: 'none',
  background: '#191712',
  color: '#FFFFFF',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
}
