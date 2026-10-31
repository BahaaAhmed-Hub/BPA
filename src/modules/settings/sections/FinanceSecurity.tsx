import { useState, useEffect } from 'react'
import { biometricsAvailable, biometricName, deviceLabel, forgetPasskey, hashPassword, isLocked, loadLock, loadPasskey, markActive, registerPasskey, saveLock, RELOCK_CHOICES, type DevicePasskey, type LockConfig, type Relock } from '@/modules/finance/lock'
import { LockGate } from '@/modules/finance/FinanceLockScreen'
import { Block, FieldRow, Toggle } from '../ui'

// ─── Settings → Finance → Security ───────────────────────────────────────────
//
// The lock itself lives in `finance/lock.ts`; this is where it is turned on.
// Two rules shape the whole block:
//
//   * A password is required before the lock can be turned on. A passkey is
//     held by one device's secure element and cannot travel — turn the lock on
//     with only a fingerprint and the next device you sign in on has a locked
//     finance module and no way in.
//   * These controls are themselves behind the lock. Otherwise the lock is a
//     toggle anyone holding your open laptop can flip.

export function FinanceSecuritySection() {
  const [cfg, setCfg]         = useState<LockConfig>(loadLock)
  const [passkey, setPasskey] = useState<DevicePasskey | null>(loadPasskey)
  const [canBio, setCanBio]   = useState(false)
  const [open, setOpen]       = useState(() => !isLocked())
  const [pw1, setPw1]         = useState('')
  const [pw2, setPw2]         = useState('')
  const [editing, setEditing] = useState(false)
  const [note, setNote]       = useState<string | null>(null)
  const [err, setErr]         = useState<string | null>(null)

  useEffect(() => { void biometricsAvailable().then(setCanBio) }, [])

  function put(next: LockConfig) { setCfg(next); saveLock(next) }

  async function savePassword() {
    setErr(null); setNote(null)
    if (pw1.length < 6) { setErr('Six characters at least.'); return }
    if (pw1 !== pw2)    { setErr('The two do not match.'); return }
    put({ ...cfg, password: await hashPassword(pw1) })
    setPw1(''); setPw2(''); setEditing(false)
    setNote('Password saved.')
  }

  function toggleLock(on: boolean) {
    setErr(null); setNote(null)
    if (on && !cfg.password) { setEditing(true); setErr('Set a password first — it is the way in on a device with no fingerprint.'); return }
    // Being the one who just turned it on counts as having proved yourself.
    markActive()
    put({ ...cfg, enabled: on })
  }

  async function addPasskey() {
    setErr(null); setNote(null)
    try {
      let name = 'Finance'
      try { name = localStorage.getItem('professor-display-name') || name } catch { /* noop */ }
      setPasskey(await registerPasskey(name))
      setNote(`${deviceLabel()} can now unlock with ${biometricName()}.`)
    } catch (e) {
      const n = (e as { name?: string })?.name
      setErr(n === 'NotAllowedError'
        ? 'Cancelled, or it timed out.'
        : 'This browser would not register a passkey. The password still works.')
    }
  }

  const pill = {
    height: 30, padding: '0 12px', borderRadius: 'var(--sb-r-sm)', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
    background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)',
  } as const
  const solid = { ...pill, background: 'var(--sb-ink-1)', border: 'var(--sb-border-width) solid var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)' }
  const field = {
    height: 'var(--sb-h-pill)', width: 180, borderRadius: 'var(--sb-r-sm)', padding: '0 11px', boxSizing: 'border-box' as const,
    background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
    fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', outline: 'none',
  }

  return (
    <Block title="Security" sub="A lock on the finance screens — it stops the person at your open laptop, not somebody with your sign-in">
      {!open ? (
        <div style={{ maxWidth: 400, padding: '12px 0' }}>
          <LockGate
            compact
            onUnlocked={() => { markActive(); setOpen(true) }}
            title="Unlock to change these"
            note="The lock is on. Prove it is you before turning it off or changing the password."
          />
        </div>
      ) : (
        <>
          <FieldRow label="Lock the finance pages" sub={cfg.enabled ? 'On — a new tab opens locked' : 'Off — anyone at this browser can read them'}>
            <Toggle checked={cfg.enabled} onChange={toggleLock} />
          </FieldRow>

          <FieldRow label="Lock again" sub="Measured from the last thing you did anywhere in the app">
            <select
              value={String(cfg.relock)}
              onChange={e => put({ ...cfg, relock: (e.target.value === 'session' ? 'session' : Number(e.target.value)) as Relock })}
              style={{ ...field, width: 210, cursor: 'pointer' }}
            >
              {RELOCK_CHOICES.map(c => (
                <option key={String(c.value)} value={String(c.value)}>{c.label}</option>
              ))}
            </select>
          </FieldRow>

          <FieldRow
            label={`Unlock with ${biometricName()}`}
            sub={passkey
              ? `Registered on this ${passkey.label.toLowerCase()} on ${new Date(passkey.addedAt).toLocaleDateString()}`
              : canBio
                ? `Ask this ${deviceLabel().toLowerCase()} to check you, instead of typing`
                : 'This browser has no fingerprint, face or passcode unlock to offer'}
          >
            {passkey ? (
              <button style={pill} onClick={() => { forgetPasskey(); setPasskey(null); setNote('Removed. The password still works.') }}>
                Remove from this device
              </button>
            ) : (
              <button style={canBio ? solid : { ...pill, color: 'var(--sb-ink-3)', cursor: 'default' }}
                disabled={!canBio} onClick={() => void addPasskey()}>
                Set up on this device
              </button>
            )}
          </FieldRow>

          <FieldRow
            label="Password"
            sub={cfg.password ? 'Set. It works on every device you sign in on.' : 'Not set — needed before the lock can be turned on'}
          >
            {!editing
              ? <button style={cfg.password ? pill : solid} onClick={() => { setEditing(true); setErr(null); setNote(null) }}>
                  {cfg.password ? 'Change' : 'Set a password'}
                </button>
              : (
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <input type="password" autoComplete="new-password" placeholder="New password"
                    value={pw1} onChange={e => setPw1(e.target.value)} style={field} />
                  <input type="password" autoComplete="new-password" placeholder="Again"
                    value={pw2} onChange={e => setPw2(e.target.value)} style={field} />
                  <button style={solid} onClick={() => void savePassword()}>Save</button>
                  <button style={pill} onClick={() => { setEditing(false); setPw1(''); setPw2(''); setErr(null) }}>Cancel</button>
                </div>
              )}
          </FieldRow>

          {(err || note) && (
            <p className="sx-row" style={{ margin: 0, padding: '12px 0', fontSize: 'var(--sb-t-body-s)', lineHeight: 1.5, color: err ? 'var(--sb-negative)' : 'var(--sb-positive)' }}>
              {err ?? note}
            </p>
          )}

          <p className="sx-row" style={{ margin: 0, padding: '12px 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.55 }}>
            With this on, every finance screen — Today, Balances, Budget, Financials, Goals — asks
            who you are before it draws anything, and asks again after a stretch of doing nothing.
            The password is stored as a salted hash and never leaves your account. A passkey never
            leaves the device that made it — each device you use registers its own, and the password
            is what gets you in on one that has not.
          </p>
        </>
      )}
    </Block>
  )
}
