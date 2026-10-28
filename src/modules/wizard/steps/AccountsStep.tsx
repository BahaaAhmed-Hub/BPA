import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { COMPANY_COLOR_CHOICES } from '@/lib/palettes'
import { connectAdditionalGoogleAccount } from '@/lib/google'
import { loadAccounts } from '@/lib/multiAccount'
import { useAuthStore } from '@/store/authStore'
import { ICON } from '@/lib/type'
import type { AccountView } from '../state'
import type { StepCtx } from './types'

const COLORS = COMPANY_COLOR_CHOICES.slice(0, 8)

/**
 * Who you read mail as, and who you work for. The accounts are real Google
 * connections (the same sign-in Settings uses; it leaves the page and comes
 * back to this step), the companies are written when the step is left.
 */
export function AccountsStep({ w, set, dry, beforeOAuth }: StepCtx) {
  const email = useAuthStore(s => s.user?.email ?? '')
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [color, setColor] = useState(COLORS[0])

  // An account connected while this is open (or on the way back from Google) appears without a reload.
  useEffect(() => {
    const read = () => {
      const extra: AccountView[] = loadAccounts().filter(a => !a.isPrimary).map(a => ({ email: a.email, primary: false }))
      set({ accounts: [...(email ? [{ email, primary: true }] : []), ...extra] })
    }
    read()
    window.addEventListener('professor:accountsUpdated', read)
    return () => window.removeEventListener('professor:accountsUpdated', read)
  }, [email, set])

  async function addAccount() {
    if (dry) { setNote('Connecting an account is switched off in a test: it would leave this page and connect a real one.'); return }
    setNote('')
    beforeOAuth()
    try { await connectAdditionalGoogleAccount() } catch { setNote('Could not start the Google sign-in. Try again.') }
  }

  function addCompany() {
    const n = name.trim()
    if (!n) return
    set(p => ({ companies: [...p.companies, { id: crypto.randomUUID(), name: n, color, emailDomain: domain.trim().replace(/^@/, ''), accountId: '', isNew: true }] }))
    setName(''); setDomain(''); setColor(COLORS[(COLORS.indexOf(color) + 1) % COLORS.length]); setAdding(false)
  }

  return (
    <>
      <div>
        <span className="wz-lab">Accounts</span>
        <div className="wz-stack">
          {w.accounts.map(a => (
            <div key={a.email} className="wz-row">
              <span className="wz-dot" style={{ background: 'var(--sb-positive)' }} />
              <div className="grow"><div className="t1">{a.email}</div><div className="t2">{a.primary ? 'Primary · calendar and mail' : 'Connected · calendar and mail'}</div></div>
            </div>
          ))}
          <button type="button" className="wz-add" onClick={() => void addAccount()}><Plus size={ICON.md} aria-hidden />Add another Google account</button>
          {note && <p className="wz-note" role="status">{note}</p>}
        </div>
      </div>

      <div>
        <span className="wz-lab">Companies</span>
        <div className="wz-stack">
          {w.companies.map(c => (
            <div key={c.id} className="wz-row">
              <span className="wz-dot" style={{ background: c.color }} />
              <div className="grow"><div className="t1">{c.name}</div><div className="t2">{c.emailDomain ? `mail from @${c.emailDomain}` : 'no email domain'}</div></div>
              {c.isNew && (
                <button type="button" className="wz-back" style={{ minHeight: 32, padding: 4 }} aria-label={`Remove ${c.name}`}
                  onClick={() => set(p => ({ companies: p.companies.filter(x => x.id !== c.id) }))}><X size={ICON.sm} aria-hidden /></button>
              )}
            </div>
          ))}
          {adding ? (
            <div className="wz-stack">
              <input className="wz-field" aria-label="Company name" placeholder="Company name" value={name} maxLength={60} autoFocus
                onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCompany() }} />
              <input className="wz-field" aria-label="Email domain, optional" placeholder="Email domain, e.g. acme.com (optional)" value={domain}
                onChange={e => setDomain(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCompany() }} />
              <div className="wz-colors" role="group" aria-label="Color">
                {COLORS.map(c => (
                  <button key={c} type="button" className="wz-color" style={{ background: c }} aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />
                ))}
              </div>
              <button type="button" className="wz-btn2" aria-disabled={!name.trim() || undefined} onClick={addCompany}>Add this company</button>
            </div>
          ) : (
            <button type="button" className="wz-add" onClick={() => setAdding(true)}><Plus size={ICON.md} aria-hidden />Add a company</button>
          )}
          <p className="wz-note">A company gives its mail, tasks and events one color, everywhere.</p>
        </div>
      </div>
    </>
  )
}
