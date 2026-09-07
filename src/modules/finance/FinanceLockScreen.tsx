import { useEffect, useRef, useState } from 'react'
import {
  biometricName, checkPassword, loadLock, loadPasskey, verifyPasskey,
} from './lock'

// ─── The door ────────────────────────────────────────────────────────────────
//
// Two ways through and no third: the device, or the password. It says which
// ones this device has rather than offering a button that cannot work — a
// passkey belongs to one device, and this may not be that device.

function IconShield({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="var(--sb-ink-1)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.6l7.2 2.9v5.7c0 4.6-3 8.3-7.2 10.2-4.2-1.9-7.2-5.6-7.2-10.2V5.5z"/>
      <path d="M9.3 12.1l2 2 3.4-3.9"/>
    </svg>
  )
}

function IconFingerprint({ color = 'var(--sb-ink-1)' }: { color?: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 10.5v3.2a8 8 0 0 1-1.2 4.2"/>
      <path d="M8.9 8.6a4.2 4.2 0 0 1 6.4 3.6c0 2.4-.2 4.4-.8 6"/>
      <path d="M6 11.4a6.4 6.4 0 0 1 2-4.6"/>
      <path d="M12 3.4a8.6 8.6 0 0 1 8.4 8.8c0 1.4-.1 2.8-.4 4.1"/>
      <path d="M3.6 12.2A8.6 8.6 0 0 1 5 7.5"/>
      <path d="M7.6 19.6A9.6 9.6 0 0 0 9 16.5"/>
    </svg>
  )
}

export interface LockGateProps {
  onUnlocked: () => void
  /** A short form for a settings card rather than a whole page. */
  compact?: boolean
  title?: string
  note?: string
}

export function LockGate({ onUnlocked, compact = false, title, note }: LockGateProps) {
  const cfg = loadLock()
  const passkey = loadPasskey()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'bio' | 'pw' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fieldRef = useRef<HTMLInputElement>(null)

  // A device with a passkey should not have to reach for the keyboard; one
  // without should have the caret already in the field.
  useEffect(() => { if (!passkey) fieldRef.current?.focus() }, [passkey])

  async function useBiometrics() {
    setError(null); setBusy('bio')
    try {
      if (await verifyPasskey()) onUnlocked()
      else setError('That did not check out. Try again, or use your password.')
    } catch (e) {
      const name = (e as { name?: string })?.name
      setError(name === 'NotAllowedError'
        ? 'Cancelled, or it timed out.'
        : `${biometricName()} could not be used here. Use your password.`)
    } finally { setBusy(null) }
  }

  async function usePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setError(null); setBusy('pw')
    try {
      if (await checkPassword(password, cfg)) { setPassword(''); onUnlocked() }
      else { setError('That is not the password.'); setPassword('') }
    } finally { setBusy(null); fieldRef.current?.focus() }
  }

  const body = (
    <div style={{
      width: compact ? '100%' : 380, maxWidth: '100%',
      background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 16,
      padding: compact ? '18px 20px 20px' : '30px 30px 26px',
      boxShadow: compact ? 'none' : '0 1px 3px rgba(25,23,18,0.06)',
    }}>
      {!compact && (
        <div style={{
          width: 54, height: 54, borderRadius: 15, background: 'var(--sb-accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        }}>
          <IconShield />
        </div>
      )}
      <h2 style={{
        margin: 0, fontFamily: 'Outfit, system-ui, sans-serif',
        fontSize: compact ? 17 : 23, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)',
      }}>
        {title ?? 'Your finances are locked'}
      </h2>
      <p style={{ margin: '7px 0 18px', fontSize: 12.5, lineHeight: 1.55, color: 'var(--sb-ink-3)' }}>
        {note ?? (passkey
          ? `Confirm it is you with ${biometricName()}, or type your password.`
          : 'Type your password to open them. This device has no fingerprint or face unlock set up for the finances.')}
      </p>

      {passkey && (
        <button
          onClick={useBiometrics}
          disabled={busy !== null}
          style={{
            width: '100%', height: 42, borderRadius: 11, marginBottom: 12,
            background: 'var(--sb-ink-1)', border: '1px solid var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)',
            cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
            fontSize: 13.5, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
          <IconFingerprint color="var(--sb-ink-on-dark)" />
          {busy === 'bio' ? 'Waiting for you…' : `Unlock with ${biometricName()}`}
        </button>
      )}

      {cfg.password && (
        <form onSubmit={usePassword}>
          {passkey && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--sb-hairline)' }} />
              <span style={{ fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--sb-ink-4)', fontWeight: 600 }}>OR</span>
              <div style={{ flex: 1, height: 1, background: 'var(--sb-hairline)' }} />
            </div>
          )}
          <input
            ref={fieldRef}
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder="Password"
            onChange={e => { setPassword(e.target.value); setError(null) }}
            style={{
              width: '100%', height: 42, borderRadius: 11, boxSizing: 'border-box',
              padding: '0 13px', background: 'var(--sb-field)',
              border: `1px solid ${error ? 'var(--sb-negative)' : 'var(--sb-border)'}`,
              fontFamily: 'inherit', fontSize: 13.5, color: 'var(--sb-ink-1)', outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={busy !== null || !password}
            style={{
              width: '100%', height: 42, borderRadius: 11, marginTop: 10,
              background: password ? 'var(--sb-accent)' : 'var(--sb-field)',
              border: `1px solid ${password ? 'rgba(25,23,18,0.18)' : 'var(--sb-border)'}`,
              color: password ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
              cursor: password && !busy ? 'pointer' : 'default',
              fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
            }}>
            {busy === 'pw' ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      )}

      {!cfg.password && !passkey && (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--sb-negative)', lineHeight: 1.5 }}>
          The lock is on but nothing was set to open it. Turn it off in
          Settings → Finance → Security.
        </p>
      )}

      {error && (
        <p style={{ margin: '11px 0 0', fontSize: 12, color: 'var(--sb-negative)', lineHeight: 1.5 }}>{error}</p>
      )}
    </div>
  )

  if (compact) return body
  return (
    <div style={{
      height: '100%', background: 'var(--sb-page)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24, overflow: 'auto',
    }}>
      {body}
    </div>
  )
}
