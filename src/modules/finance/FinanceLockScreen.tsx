import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import {
  biometricName, biometricsAvailable, checkPassword, deviceLabel, loadLock,
  loadPasskey, registerPasskey, verifyPasskey,
} from './lock'

// ─── The door ────────────────────────────────────────────────────────────────
//
// Two ways through and no third: the device, or the password. It says which
// ones this device has rather than offering a button that cannot work — a
// passkey belongs to one device, and this may not be that device.

function IconShield({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="var(--sb-accent-ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
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
  const [busy, setBusy] = useState<'bio' | 'pw' | 'enrol' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A passkey belongs to one device and never travels, so a second device has
  // none — which the screen used to *state* and leave you with. The offer to
  // set this one up belongs here, right after the password has proved who you
  // are, rather than buried in a settings page you would have to know about.
  const [offerEnrol, setOfferEnrol] = useState(false)
  const [canBio, setCanBio] = useState(false)
  useEffect(() => { void biometricsAvailable().then(setCanBio) }, [])
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
      if (await checkPassword(password, cfg)) {
        setPassword('')
        // Right answer. If this device could unlock by face or finger and has
        // never been asked, ask now — it is the one moment the offer makes
        // sense, and the alternative is typing the password here for ever.
        if (canBio && !passkey) setOfferEnrol(true)
        else onUnlocked()
      }
      else { setError('That is not the password.'); setPassword('') }
    } finally { setBusy(null); fieldRef.current?.focus() }
  }

  /** Register this device, from the tap that asked for it — WebAuthn needs the
   *  gesture, so this cannot be done for you after the fact. */
  async function enrolThisDevice() {
    setError(null); setBusy('enrol')
    try {
      let name = 'Finance'
      try { name = localStorage.getItem('professor-display-name') || name } catch { /* noop */ }
      await registerPasskey(name)
      onUnlocked()
    } catch (e) {
      // The password already proved who you are, so a refused passkey is a
      // disappointment rather than a reason to keep you out.
      const n = (e as { name?: string })?.name
      setError(n === 'NotAllowedError'
        ? 'Cancelled — opening the finances anyway.'
        : `${deviceLabel()} would not register one (${n ?? 'no reason given'}). Opening the finances anyway.`)
      window.setTimeout(onUnlocked, 1400)
    } finally { setBusy(null) }
  }

  const enrolBody = (
    <div style={{
      width: compact ? '100%' : 380, maxWidth: '100%',
      background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
      padding: compact ? '18px 20px 20px' : '30px 30px 26px',
    }}>
      <h2 style={{
        margin: 0, fontFamily: 'var(--sb-font-num)',
        fontSize: compact ? 17 : 23, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)',
      }}>Use {biometricName()} on this {deviceLabel().replace(/^This /, '')}?</h2>
      <p style={{ margin: '7px 0 18px', fontSize: 'var(--sb-t-body-s)', lineHeight: 1.55, color: 'var(--sb-ink-3)' }}>
        A passkey lives on one device and cannot travel, so the one on your
        other browser does not work here. This sets one up for this one — the
        password keeps working either way.
      </p>
      {error && (
        <p style={{ margin: '0 0 12px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{error}</p>
      )}
      <Button variant="primary" onClick={enrolThisDevice} disabled={busy !== null} style={{ width: '100%', marginBottom: 10 }}>
        <IconFingerprint color="var(--sb-ink-on-dark)" />
        {busy === 'enrol' ? 'Waiting for you…' : 'Set it up'}
      </Button>
      <Button variant="ghost" onClick={onUnlocked} disabled={busy !== null} style={{ width: '100%' }}>
        Not now
      </Button>
    </div>
  )

  const body = offerEnrol ? enrolBody : (
    <div style={{
      width: compact ? '100%' : 380, maxWidth: '100%',
      background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
      padding: compact ? '18px 20px 20px' : '30px 30px 26px',
      boxShadow: compact ? 'none' : '0 1px 3px color-mix(in srgb, var(--sb-ink-1) 6.0%, transparent)',
    }}>
      {!compact && (
        <div style={{
          width: 54, height: 54, borderRadius: 'var(--sb-r-card)', background: 'var(--sb-accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        }}>
          <IconShield />
        </div>
      )}
      <h2 style={{
        margin: 0, fontFamily: 'var(--sb-font-num)',
        fontSize: compact ? 17 : 23, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)',
      }}>
        {title ?? 'Your finances are locked'}
      </h2>
      <p style={{ margin: '7px 0 18px', fontSize: 'var(--sb-t-body-s)', lineHeight: 1.55, color: 'var(--sb-ink-3)' }}>
        {note ?? (passkey
          ? `Confirm it is you with ${biometricName()}, or type your password.`
          : 'Type your password to open them. This device has no fingerprint or face unlock set up for the finances.')}
      </p>

      {passkey && (
        <Button variant="primary" onClick={useBiometrics} disabled={busy !== null} style={{ width: '100%', marginBottom: 12 }}>
          <IconFingerprint color="var(--sb-ink-on-dark)" />
          {busy === 'bio' ? 'Waiting for you…' : `Unlock with ${biometricName()}`}
        </Button>
      )}

      {cfg.password && (
        <form onSubmit={usePassword}>
          {passkey && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--sb-hairline)' }} />
              <span style={{ fontSize: 'var(--sb-t-micro)', letterSpacing: '0.1em', color: 'var(--sb-ink-4)', fontWeight: 600 }}>OR</span>
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
              width: '100%', height: 42, borderRadius: 'var(--sb-r-nav)', boxSizing: 'border-box',
              padding: '0 13px', background: 'var(--sb-field)',
              border: `var(--sb-border-width) solid ${error ? 'var(--sb-negative)' : 'var(--sb-border)'}`,
              fontFamily: 'inherit', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={busy !== null || !password}
            style={{
              width: '100%', height: 42, borderRadius: 'var(--sb-r-nav)', marginTop: 10,
              background: password ? 'var(--sb-accent)' : 'var(--sb-field)',
              border: `var(--sb-border-width) solid ${password ? 'color-mix(in srgb, var(--sb-ink-1) 18.0%, transparent)' : 'var(--sb-border)'}`,
              color: password ? 'var(--sb-accent-ink)' : 'var(--sb-ink-4)',
              cursor: password && !busy ? 'pointer' : 'default',
              fontFamily: 'inherit', fontSize: 'var(--sb-t-label)', fontWeight: 600,
            }}>
            {busy === 'pw' ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      )}

      {!cfg.password && !passkey && (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)', lineHeight: 1.5 }}>
          The lock is on but nothing was set to open it. Turn it off in
          Settings → Finance → Security.
        </p>
      )}

      {error && (
        <p style={{ margin: '11px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)', lineHeight: 1.5 }}>{error}</p>
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
