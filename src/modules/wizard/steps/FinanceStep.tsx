import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { moduleIsOff } from '@/lib/entitlements'
import { loadLock } from '@/modules/finance/lock'
import { ICON } from '@/lib/type'
import { Switch } from '../ui'
import type { WizardState } from '../state'
import type { StepCtx } from './types'

export const MIN_PASSWORD = 6

/** Why Continue is off here: the lock is on and there is nothing yet to lock it with. */
export function financeBlocker(w: WizardState): string | null {
  const l = loadLock()
  if (moduleIsOff('finance') || (l.enabled && l.password)) return null
  if (w.finance.lock && w.finance.password.length < MIN_PASSWORD) return `Choose a password of at least ${MIN_PASSWORD} characters, or turn the lock off.`
  return null
}

/**
 * Finance is the one part of the app only you can read. This step is only the
 * lock: a password asked each time you open it. The lock itself, and a
 * fingerprint or face unlock on a device, live in Settings → Finance.
 */
export function FinanceStep({ w, set }: StepCtx) {
  const [show, setShow] = useState(false)
  const off = moduleIsOff('finance')
  const l = loadLock()
  const already = l.enabled && !!l.password

  if (off) return <p className="wz-note">Finance is not on your plan, so there is nothing to set up here. When it is, it opens locked only if you turn that on in Settings.</p>
  if (already) return <p className="wz-note">Your finance pages are already locked with a password. You can change it in Settings, under Finance.</p>

  return (
    <>
      <div className="wz-row">
        <div className="grow"><div className="t1">Lock the finance pages</div><div className="t2">Asked for your password each time you open Finance.</div></div>
        <Switch on={w.finance.lock} label="Lock the finance pages" onChange={v => set(p => ({ finance: { ...p.finance, lock: v } }))} />
      </div>
      {w.finance.lock && (
        <div>
          <label htmlFor="wz-pass" className="wz-lab">Password</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="wz-pass" className="wz-field" type={show ? 'text' : 'password'} value={w.finance.password} autoComplete="new-password" spellCheck={false}
              placeholder={`At least ${MIN_PASSWORD} characters`} onChange={e => set(p => ({ finance: { ...p.finance, password: e.target.value } }))} />
            <button type="button" className="wz-btn2" style={{ width: 46, padding: 0 }} aria-label={show ? 'Hide the password' : 'Show the password'} onClick={() => setShow(v => !v)}>
              {show ? <EyeOff size={ICON.md} aria-hidden /> : <Eye size={ICON.md} aria-hidden />}
            </button>
          </div>
          <p className="wz-note" style={{ marginTop: 8 }}>It works on every device you sign in on. It cannot be recovered, so choose one you will keep.</p>
        </div>
      )}
      <ul className="wz-note wz-ul">
        <li>Only your account can read your ledger. Plans and admins cannot.</li>
        <li>It never moves money, only records what you enter.</li>
      </ul>
    </>
  )
}
