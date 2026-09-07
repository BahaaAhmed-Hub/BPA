import { useState } from 'react'
import { COMPANY_COLOR_CHOICES } from '@/lib/palettes'
import { Button } from '@/components/ui'
import { loadAccounts } from '@/lib/multiAccount'
import { X } from 'lucide-react'
import { ICON } from '@/lib/type'


interface CompanyDraft {
  id: string; name: string; color: string; emailDomain: string; accountId: string
}

interface Props {
  data: { companies: CompanyDraft[] }
  onChange: (p: { companies: CompanyDraft[] }) => void
}

const inp: React.CSSProperties = {
  background: 'var(--sb-page)',
  border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-chip)', padding: '8px 12px',
  color: 'var(--sb-ink-1)',
  fontSize: 'var(--sb-t-body)', outline: 'none', width: '100%', boxSizing: 'border-box',
}

export function Step3Companies({ data, onChange }: Props) {
  const accounts = loadAccounts()
  const [adding, setAdding] = useState(false)
  const [name, setName]     = useState('')
  const [color, setColor]   = useState(COMPANY_COLOR_CHOICES[0])
  const [domain, setDomain] = useState('')
  const [accountId, setAccountId] = useState('')

  function addCompany() {
    if (!name.trim()) return
    onChange({ companies: [...data.companies, { id: crypto.randomUUID(), name: name.trim(), color, emailDomain: domain.trim(), accountId }] })
    setName(''); setColor(COMPANY_COLOR_CHOICES[0]); setDomain(''); setAccountId(''); setAdding(false)
  }

  function remove(id: string) {
    onChange({ companies: data.companies.filter(c => c.id !== id) })
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-h2)', fontWeight: 800, color: 'var(--sb-ink-1)' }}>
        Your companies &amp; clients
      </h2>
      <p style={{ margin: '0 0 24px', fontSize: 'var(--sb-t-label)', color: 'var(--sb-ink-3)', lineHeight: 1.6 }}>
        Add the organizations you work with. Each can be linked to a connected account.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {data.companies.map(co => {
          const acc = accounts.find(a => a.email === co.accountId)
          return (
            <div key={co.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderRadius: 'var(--sb-r-nav)',
              background: 'var(--sb-card)',
              border: 'var(--sb-border-width) solid var(--sb-border)',
            }}>
              <div style={{ width: 14, height: 14, borderRadius: 'var(--sb-r-pill)', background: co.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{co.name}</span>
                {co.emailDomain && <span style={{ marginLeft: 8, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>{co.emailDomain}</span>}
              </div>
              {acc && (
                <span style={{ fontSize: 'var(--sb-t-meta)', padding: '2px 8px', borderRadius: 'var(--sb-r-card)', background: 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)', color: 'var(--sb-info)', flexShrink: 0 }}>
                  {acc.email.split('@')[0]}
                </span>
              )}
              <button onClick={() => remove(co.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-4)', padding: 4, display: 'flex' }}>
                <X size={ICON.sm} />
              </button>
            </div>
          )
        })}
      </div>

      {adding ? (
        <div style={{ padding: '16px', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Company name" style={inp} onKeyDown={e => e.key === 'Enter' && addCompany()} autoFocus />
            <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="e.g. acme.com" style={{ ...inp, width: 160 }} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {COMPANY_COLOR_CHOICES.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{
                width: 22, height: 22, borderRadius: 'var(--sb-r-pill)', background: c, border: 'none', cursor: 'pointer',
                outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: 2,
                transform: color === c ? 'scale(1.2)' : 'scale(1)', transition: 'transform 0.1s',
              }} />
            ))}
          </div>
          {accounts.length > 0 && (
            <select value={accountId} onChange={e => setAccountId(e.target.value)} style={{ ...inp, marginBottom: 12 }}>
              <option value="">No account linked</option>
              {accounts.map(a => <option key={a.email} value={a.email}>{a.email}</option>)}
            </select>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="accent" onClick={addCompany}>
              Add
            </Button>
            <button onClick={() => setAdding(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-4)', fontSize: 'var(--sb-t-label)' }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 'var(--sb-r-chip)',
          background: 'transparent', border: '1px dashed var(--sb-border)',
          color: 'var(--sb-ink-4)', fontSize: 'var(--sb-t-body)', cursor: 'pointer',
          width: '100%', justifyContent: 'center',
        }}>
          + Add company
        </button>
      )}

      <p style={{ margin: '16px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', fontStyle: 'italic' }}>
        You can add more companies anytime in Settings.
      </p>
    </div>
  )
}
