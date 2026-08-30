import { useState } from 'react'
import { loadAccounts } from '@/lib/multiAccount'
import { X } from 'lucide-react'

const COLORS = [
  '#7F77DD','#60A5FA','#1D9E75','#E05252','#F97316',
  '#A855F7','#EC4899','#FBBF24','#22D3EE','#6366F1','#10B981','#EF4444',
]

interface CompanyDraft {
  id: string; name: string; color: string; emailDomain: string; accountId: string
}

interface Props {
  data: { companies: CompanyDraft[] }
  onChange: (p: { companies: CompanyDraft[] }) => void
}

const inp: React.CSSProperties = {
  background: 'var(--color-bg,#F7F4EA)',
  border: '1px solid #E8E1CE',
  borderRadius: 7, padding: '8px 12px',
  color: 'var(--color-text,#E8EAF6)',
  fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
}

export function Step3Companies({ data, onChange }: Props) {
  const accounts = loadAccounts()
  const [adding, setAdding] = useState(false)
  const [name, setName]     = useState('')
  const [color, setColor]   = useState(COLORS[0])
  const [domain, setDomain] = useState('')
  const [accountId, setAccountId] = useState('')

  function addCompany() {
    if (!name.trim()) return
    onChange({ companies: [...data.companies, { id: crypto.randomUUID(), name: name.trim(), color, emailDomain: domain.trim(), accountId }] })
    setName(''); setColor(COLORS[0]); setDomain(''); setAccountId(''); setAdding(false)
  }

  function remove(id: string) {
    onChange({ companies: data.companies.filter(c => c.id !== id) })
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: 'var(--color-text,#E8EAF6)' }}>
        Your companies &amp; clients
      </h2>
      <p style={{ margin: '0 0 24px', fontSize: 13.5, color: 'var(--color-text-dim,#94A3B8)', lineHeight: 1.6 }}>
        Add the organizations you work with. Each can be linked to a connected account.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {data.companies.map(co => {
          const acc = accounts.find(a => a.email === co.accountId)
          return (
            <div key={co.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderRadius: 10,
              background: 'var(--color-surface,#FFFFFF)',
              border: '1px solid #E8E1CE',
            }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: co.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text,#E8EAF6)' }}>{co.name}</span>
                {co.emailDomain && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-muted,#6B7280)' }}>{co.emailDomain}</span>}
              </div>
              {acc && (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(127,119,221,0.12)', color: '#9B94E8', flexShrink: 0 }}>
                  {acc.email.split('@')[0]}
                </span>
              )}
              <button onClick={() => remove(co.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted,#6B7280)', padding: 4, display: 'flex' }}>
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>

      {adding ? (
        <div style={{ padding: '16px', borderRadius: 10, background: 'var(--color-surface,#FFFFFF)', border: '1px solid #E8E1CE', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Company name" style={inp} onKeyDown={e => e.key === 'Enter' && addCompany()} autoFocus />
            <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="e.g. acme.com" style={{ ...inp, width: 160 }} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{
                width: 22, height: 22, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
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
            <button onClick={addCompany} style={{ padding: '8px 18px', borderRadius: 8, background: '#F5D14E', color: '#191712', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
              Add
            </button>
            <button onClick={() => setAdding(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted,#6B7280)', fontSize: 13 }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8,
          background: 'transparent', border: '1px dashed #E8E1CE',
          color: 'var(--color-text-muted,#6B7280)', fontSize: 13, cursor: 'pointer',
          width: '100%', justifyContent: 'center',
        }}>
          + Add company
        </button>
      )}

      <p style={{ margin: '16px 0 0', fontSize: 11.5, color: 'var(--color-text-muted,#6B7280)', fontStyle: 'italic' }}>
        You can add more companies anytime in Settings.
      </p>
    </div>
  )
}
