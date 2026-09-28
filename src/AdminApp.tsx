import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { amIAdmin } from './lib/admin'
import AdminPanel from './modules/admin/AdminPanel'
import { initAppearance } from './lib/themes'

initAppearance()

type Phase = 'login' | 'checking' | 'panel' | 'denied'

export default function AdminApp() {
  const [phase, setPhase] = useState<Phase>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [submitting, setSubmitting] = useState(false)

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
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password })
    if (authErr) {
      setError(authErr.message)
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
    setEmail('')
    setPassword('')
    setError('')
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <span style={{ fontSize: 18, fontWeight: 600, fontFamily: 'Outfit, system-ui, sans-serif', color: 'var(--sb-ink-1)' }}>
              Admin
            </span>
            <button onClick={signOut} style={{ ...btnStyle, background: 'transparent', color: 'var(--sb-ink-3)', border: '1px solid var(--sb-border)' }}>
              Sign out
            </button>
          </div>
          <AdminPanel />
        </div>
      </div>
    )
  }

  return (
    <div style={centreStyle}>
      <form onSubmit={signIn} style={cardStyle}>
        <h1 style={{ fontSize: 20, fontWeight: 600, fontFamily: 'Outfit, system-ui, sans-serif', margin: '0 0 24px', color: 'var(--sb-ink-1)' }}>
          Admin sign in
        </h1>

        <label style={labelStyle}>Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoFocus
          style={inputStyle}
          placeholder="admin@example.com"
        />

        <label style={{ ...labelStyle, marginTop: 14 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
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
