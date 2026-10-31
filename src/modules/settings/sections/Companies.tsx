import { useState, useEffect, useRef } from 'react'
import { C_COLORS } from '@/lib/palettes'
import { EmptyState } from '@/components/ui'
import { Plus, Trash2, ChevronDown, ChevronUp, X, Eye, EyeOff } from 'lucide-react'
import { type ConnectedAccount } from '@/lib/multiAccount'
import { saveCompaniesToDB, type CompanyRow as DbSyncCompanyRow } from '@/lib/dbSync'
import { ICON } from '@/lib/type'
import { alpha } from '@/lib/alpha'
import { CompanyMark } from '@/components/CompanyMark'
import { inputStyle, selectStyle } from '@/lib/fields'
import { logoFromFile, imageFrom, LOGO_ACCEPT } from '@/lib/companyLogo'
import { type CompanyRow, type CompanyUser, saveCompanies } from '../model'
import { Toggle, FieldRow, GhostPill } from '../ui'

// ─── CHUNK 4: Companies + Habits sections ────────────────────────────────────

/**
 *  The company's logo, where the company is edited.
 *
 *  It is **the rail's own tile** (`CompanyMark`) rather than a second drawing
 *  of one, so what you set here is the thing you press over there — and the
 *  circle you are looking at while you choose a file is the circle the choice
 *  produces.
 *
 *  - **The tile is the control.** A separate "Upload" button beside a preview
 *    makes the preview furniture; pressing the mark is the gesture, and a drop
 *    or a paste on it does the same thing, because a logo is usually already
 *    on the clipboard.
 *  - **Remove is a word, in the caption's slot** — never a ✕ pinned to the
 *    corner of the picture. That arrangement put the destructive control where
 *    the eye goes and left Close as a hairline glyph, which is the mistake the
 *    habit record made and had to undo.
 *  - **A refusal is said out loud, next to the control.** `logoFromFile`
 *    throws sentences — "that file is not an image", "that image is 61KB even
 *    shrunk to 128px" — and a picker that drops them is indistinguishable from
 *    one that is not wired up.
 */
function CompanyLogoPicker({ co, onPick }: {
  co: CompanyRow
  onPick: (logoUrl: string | undefined) => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [why, setWhy]   = useState<string | null>(null)
  const [over, setOver] = useState(false)

  async function take(f: File | null) {
    if (!f) return
    setBusy(true); setWhy(null)
    try {
      onPick(await logoFromFile(f))
    } catch (e) {
      setWhy(e instanceof Error ? e.message : 'That image could not be used')
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0, width: 46 }}>
      <button
        onClick={() => file.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); void take(imageFrom(e.dataTransfer)) }}
        onPaste={e => { const f = imageFrom(e.clipboardData); if (f) { e.preventDefault(); void take(f) } }}
        title={co.logoUrl ? `Change ${co.name}'s logo — or drop one here` : `Add a logo for ${co.name} — drop or paste one here`}
        aria-label={co.logoUrl ? `Change the logo for ${co.name}` : `Add a logo for ${co.name}`}
        data-logo-pick={co.id}
        style={{
          width: 38, height: 38, padding: 0, borderRadius: '50%', cursor: 'pointer',
          background: 'transparent', border: 'none', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: busy ? 0.5 : 1,
          boxShadow: over
            ? `0 0 0 2px var(--sb-page), 0 0 0 4px ${co.color}`
            : `0 0 0 1px color-mix(in srgb, ${co.color} 38%, transparent)`,
          transition: 'box-shadow 0.12s, opacity 0.12s',
        }}>
        <CompanyMark co={co} size={38} />
      </button>
      <input
        ref={file} type="file" accept={LOGO_ACCEPT} hidden
        aria-label={`Logo image for ${co.name}`}
        onChange={e => void take(e.target.files?.[0] ?? null)} />
      {co.logoUrl ? (
        <button
          onClick={() => { setWhy(null); onPick(undefined) }}
          data-logo-remove={co.id}
          aria-label={`Remove the logo for ${co.name}`}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)',
          }}>
          Remove
        </button>
      ) : (
        <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Logo</span>
      )}
      {why && (
        <span data-logo-why style={{
          position: 'absolute', marginTop: 54, maxWidth: 240, zIndex: 3,
          fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative)', lineHeight: 1.3,
          background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)',
          borderRadius: 'var(--sb-r-sm)', padding: '5px 8px', boxShadow: 'var(--sb-shadow-hover)',
        }}>{why}</span>
      )}
    </div>
  )
}

function CompanyCard({
  co, accounts, onUpdate, onDelete,
}: {
  co: CompanyRow
  accounts: ConnectedAccount[]
  onUpdate: (patch: Partial<CompanyRow>) => void
  onDelete: () => void
}) {
  const [usersOpen, setUsersOpen]     = useState(false)
  const [colorOpen, setColorOpen]     = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft]     = useState(co.name)
  const [editingDomain, setEditingDomain] = useState(false)
  const [domainDraft, setDomainDraft] = useState(co.emailDomain)
  const [newUserName, setNewUserName]   = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [userDrafts, setUserDrafts] = useState<Record<string, { name: string; email: string }>>({})
  const colorRef = useRef<HTMLDivElement>(null)

  const users: CompanyUser[] = co.users ?? []

  useEffect(() => {
    if (!colorOpen) return
    function handler(e: MouseEvent) {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setColorOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [colorOpen])

  function saveName() {
    const v = nameDraft.trim(); if (v) onUpdate({ name: v }); else setNameDraft(co.name)
    setEditingName(false)
  }
  function saveDomain() { onUpdate({ emailDomain: domainDraft.trim() }); setEditingDomain(false) }

  function addUser() {
    if (!newUserName.trim()) return
    onUpdate({ users: [...users, { id: crypto.randomUUID(), name: newUserName.trim(), email: newUserEmail.trim() || undefined }] })
    setNewUserName(''); setNewUserEmail('')
  }
  function removeUser(id: string) { onUpdate({ users: users.filter(u => u.id !== id) }) }

  function startEditUser(u: CompanyUser) {
    setEditingUserId(u.id)
    setUserDrafts(d => ({ ...d, [u.id]: { name: u.name, email: u.email ?? '' } }))
  }
  function saveUser(id: string) {
    const draft = userDrafts[id]; if (!draft) return
    onUpdate({ users: users.map(u => u.id === id ? { ...u, name: draft.name.trim() || u.name, email: draft.email.trim() || undefined } : u) })
    setEditingUserId(null)
  }

  const tinp: React.CSSProperties = {
    background: 'transparent', border: 'none', borderBottom: 'var(--sb-border-width) solid var(--sb-info)',
    outline: 'none', color: 'var(--sb-ink-1)', fontFamily: 'inherit', padding: '0 2px',
  }

  return (
    // A company is a row of the Block card, not a bordered box of its own; its members
    // open as a second row directly beneath (`sx-row` drops the last rule).
    <>
      {/* Company header */}
      <div className="sx-row" style={{
        display: 'flex', alignItems: 'center', gap: '10px 12px', flexWrap: 'wrap', padding: '14px 0', position: 'relative',
        borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
        opacity: co.hidden ? 0.55 : 1, transition: 'opacity 0.15s',
      }}>

        {/* The logo — the rail's own tile, and the way to set it */}
        <CompanyLogoPicker co={co} onPick={logoUrl => onUpdate({ logoUrl })} />

        {/* Color circle → color picker. It stays beside the logo: the colour is
            still this company's identity on every 6px dot and chip in the app,
            and a dot cannot hold a mark. */}
        <div ref={colorRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setColorOpen(o => !o)}
            title="Change color"
            style={{
              width: 18, height: 18, borderRadius: 'var(--sb-r-pill)', background: co.color, cursor: 'pointer',
              border: `var(--sb-border-emphasis) solid ${alpha(co.color, 37.6)}`, flexShrink: 0,
            }}
          />
          {colorOpen && (
            <div style={{
              position: 'absolute', top: 24, left: 0, zIndex: 200,
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
              // Two rows of twelve rather than one row of seven: a wrapping
              // grid keeps the popover the width of a dozen swatches however
              // many the list grows to.
              padding: '8px 9px', display: 'grid', gridTemplateColumns: 'repeat(12, 16px)', gap: 6,
              boxShadow: 'var(--sb-shadow-hover)',
            }}>
              {C_COLORS.map(c => (
                <button key={c} onClick={() => { onUpdate({ color: c }); setColorOpen(false) }}
                  style={{
                    width: 16, height: 16, borderRadius: 'var(--sb-r-pill)', background: c,
                    border: 'none', cursor: 'pointer', flexShrink: 0,
                    boxShadow: co.color === c ? `0 0 0 2px var(--sb-card), 0 0 0 3.5px ${c}` : 'none',
                    transform: co.color === c ? 'scale(1.2)' : 'scale(1)',
                    transition: 'transform 0.1s ease',
                  }} />
              ))}
            </div>
          )}
        </div>

        {/* Name + domain stacked */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: '1 1 140px', minWidth: 0 }}>
          {editingName ? (
            <input autoFocus value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameDraft(co.name); setEditingName(false) } }}
              style={{ ...tinp, fontSize: 'var(--sb-t-label)', fontWeight: 600, width: 160 }}
            />
          ) : (
            <span onClick={() => setEditingName(true)} title="Click to rename"
              style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)', cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {co.name || 'Untitled'}
            </span>
          )}
          {editingDomain ? (
            <input autoFocus value={domainDraft}
              onChange={e => setDomainDraft(e.target.value)}
              onBlur={saveDomain}
              onKeyDown={e => { if (e.key === 'Enter') saveDomain(); if (e.key === 'Escape') { setDomainDraft(co.emailDomain); setEditingDomain(false) } }}
              placeholder="@domain.com"
              style={{ ...tinp, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', width: 140 }}
            />
          ) : (
            <span onClick={() => setEditingDomain(true)} title="Click to set domain"
              style={{ fontSize: 'var(--sb-t-meta)', color: co.emailDomain ? 'var(--sb-ink-3)' : 'var(--sb-border)', cursor: 'text' }}>
              {co.emailDomain || ''}
            </span>
          )}
        </div>

        {/* Linked Google account — always visible, since the link is the point */}
        <select
          value={co.accountId}
          onChange={e => onUpdate({ accountId: e.target.value })}
          title={co.accountId ? 'Linked Google account' : 'Not linked to a Google account'}
          style={{
            ...selectStyle, fontSize: 'var(--sb-t-meta)', padding: '3px 8px', maxWidth: 168, flexShrink: 0,
            borderColor: co.accountId ? 'var(--sb-positive-tint)' : 'var(--sb-border)',
            background: co.accountId ? 'color-mix(in srgb, var(--sb-positive) 8.0%, transparent)' : 'var(--sb-card)',
            color: co.accountId ? 'var(--sb-positive)' : 'var(--sb-ink-3)',
          }}>
          <option value="">{accounts.length > 0 ? 'Link an account…' : 'No accounts connected'}</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.isPrimary ? `${a.email} (this account)` : a.email}</option>)}
        </select>

        {/* Users expand toggle */}
        <button onClick={() => setUsersOpen(o => !o)} title={usersOpen ? 'Collapse members' : 'Expand members'} style={{
          display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
          padding: '2px 7px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)', cursor: 'pointer',
          background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)',
          color: 'var(--sb-ink-3)',
        }}>
          <span style={{ color: co.color, fontWeight: 600 }}>{users.length}</span>
          {usersOpen ? <ChevronUp size={ICON.sm} /> : <ChevronDown size={ICON.sm} />}
        </button>

        <Toggle checked={co.isActive} onChange={v => onUpdate({ isActive: v })} />

        {/* Hide from platform toggle */}
        <button
          onClick={() => onUpdate({ hidden: !co.hidden })}
          title={co.hidden ? 'Show in platform' : 'Hide from platform (tasks, calendar, dashboard…)'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 3,
            display: 'flex', alignItems: 'center',
            color: co.hidden ? 'var(--sb-accent)' : 'var(--sb-ink-3)',
          }}
        >
          {co.hidden ? <EyeOff size={ICON.sm} /> : <Eye size={ICON.sm} />}
        </button>

        <button onClick={onDelete}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 3, display: 'flex', alignItems: 'center' }}>
          <Trash2 size={ICON.sm} />
        </button>
      </div>

      {/* Users tree */}
      {usersOpen && (
        <div className="sx-row" style={{ borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)', padding: '0 0 12px 56px' }}>
          {users.length === 0 && (
            <EmptyState compact>No members yet</EmptyState>
          )}

          {users.map(u => {
            const isEditing = editingUserId === u.id
            const draft = userDrafts[u.id]
            return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
                <span style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: co.color, flexShrink: 0 }} />

                {isEditing ? (
                  <>
                    <input autoFocus value={draft?.name ?? u.name}
                      onChange={e => setUserDrafts(d => ({ ...d, [u.id]: { ...d[u.id], name: e.target.value } }))}
                      onBlur={() => saveUser(u.id)}
                      onKeyDown={e => { if (e.key === 'Enter') saveUser(u.id); if (e.key === 'Escape') setEditingUserId(null) }}
                      style={{ ...tinp, fontSize: 'var(--sb-t-body-s)', width: 120 }}
                    />
                    <input value={draft?.email ?? (u.email ?? '')}
                      onChange={e => setUserDrafts(d => ({ ...d, [u.id]: { ...d[u.id], email: e.target.value } }))}
                      onBlur={() => saveUser(u.id)}
                      onKeyDown={e => { if (e.key === 'Enter') saveUser(u.id); if (e.key === 'Escape') setEditingUserId(null) }}
                      placeholder="email"
                      style={{ ...tinp, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', flex: 1 }}
                    />
                  </>
                ) : (
                  <>
                    <span onClick={() => startEditUser(u)} style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', cursor: 'text', minWidth: 60 }}>{u.name}</span>
                    <span onClick={() => startEditUser(u)} style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', cursor: 'text', flex: 1 }}>
                      {u.email || <span style={{ color: 'var(--sb-border)' }}>+ email</span>}
                    </span>
                  </>
                )}

                <button onClick={() => removeUser(u.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <Trash2 size={ICON.sm} />
                </button>
              </div>
            )
          })}

          {/* Add user row */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <Plus size={ICON.sm} color="var(--sb-ink-3)" style={{ flexShrink: 0 }} />
            <input value={newUserName} onChange={e => setNewUserName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addUser() }}
              placeholder="Name"
              style={{ ...inputStyle, fontSize: 'var(--sb-t-meta)', padding: '3px 7px', width: 110 }} />
            <input value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addUser() }}
              placeholder="Email (optional)"
              style={{ ...inputStyle, fontSize: 'var(--sb-t-meta)', padding: '3px 7px', flex: 1 }} />
            <button onClick={addUser} disabled={!newUserName.trim()} style={{
              padding: '3px 10px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)', fontWeight: 500, cursor: 'pointer',
              background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 31.4%, transparent)',
              color: 'var(--sb-info)', opacity: newUserName.trim() ? 1 : 0.4,
            }}>Add</button>
          </div>
        </div>
      )}
    </>
  )
}

export function CompaniesSection({
  companies, setCompanies, accounts, primaryEmail,
}: {
  companies: CompanyRow[]
  setCompanies: (c: CompanyRow[]) => void
  accounts: ConnectedAccount[]
  primaryEmail: string
}) {
  // The account you signed in with is not in `professor-connected-accounts` —
  // that list is the *additional* ones — so it was missing from this picker
  // entirely, and a company living on your own Google account could not be
  // linked to it. It is offered here under the id `primary`, which everything
  // downstream already understands: no entry in the accounts list means the
  // primary token, which is exactly what writing to your own calendar needs.
  const linkable: ConnectedAccount[] = primaryEmail
    ? [{
        id: 'primary', email: primaryEmail, name: '', providerToken: '',
        scopes: [], connectedAt: '', isPrimary: true,
      }, ...accounts]
    : accounts
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(C_COLORS[0])
  const [newDomain, setNewDomain] = useState('')
  const [newAccountId, setNewAccountId] = useState('')

  function persistCompanies(next: CompanyRow[]) {
    setCompanies(next)
    saveCompanies(next)
    saveCompaniesToDB(next as unknown as DbSyncCompanyRow[]).catch(e => console.error('[persistCompanies]', e))
  }

  function addCompany() {
    if (!newName.trim()) return
    persistCompanies([...companies, {
      id: crypto.randomUUID(), name: newName.trim(),
      color: newColor, calendarId: '', emailDomain: newDomain.trim(),
      accountId: newAccountId, isActive: true, users: [],
    }])
    setNewName(''); setNewDomain(''); setAdding(false)
  }

  function updateCompany(id: string, patch: Partial<CompanyRow>) {
    persistCompanies(companies.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  function deleteCompany(id: string) {
    persistCompanies(companies.filter(c => c.id !== id))
  }

  return (
    <>
      {companies.map(co => (
        <CompanyCard key={co.id} co={co} accounts={linkable}
          onUpdate={patch => updateCompany(co.id, patch)}
          onDelete={() => deleteCompany(co.id)} />
      ))}

      {adding ? (
        <div className="sx-row" style={{ padding: '14px 0' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Company name"
              style={{ ...inputStyle, width: 160 }} autoFocus />
            <input value={newDomain} onChange={e => setNewDomain(e.target.value)} placeholder="@domain.com"
              style={{ ...inputStyle, width: 170 }} />
            {linkable.length > 0 && (
              <select value={newAccountId} onChange={e => setNewAccountId(e.target.value)} style={{ ...selectStyle, width: 180 }}>
                <option value="">No account</option>
                {linkable.map(a => <option key={a.id} value={a.id}>{a.isPrimary ? `${a.email} (this account)` : a.email}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {C_COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)}
                style={{ width: 22, height: 22, borderRadius: 'var(--sb-r-pill)', background: c, border: 'none', cursor: 'pointer', outline: newColor === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setAdding(false); setNewName('') }}
              style={{ padding: '6px 14px', borderRadius: 'var(--sb-r-chip)', background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer', display: 'flex', gap: 5, alignItems: 'center' }}>
              <X size={ICON.sm} /> Cancel
            </button>
            <button onClick={addCompany} disabled={!newName.trim()}
              style={{ padding: '6px 16px', borderRadius: 'var(--sb-r-chip)', background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.31)', color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, cursor: 'pointer', opacity: newName.trim() ? 1 : 0.4, display: 'flex', gap: 5, alignItems: 'center' }}>
              <Plus size={ICON.sm} /> Add Company
            </button>
          </div>
        </div>
      ) : (
        <FieldRow label="Add a company / context" sub="Another body of work, with its own colour, domain and Google account.">
          <GhostPill icon={Plus} onClick={() => setAdding(true)}>Add a company</GhostPill>
        </FieldRow>
      )}
    </>
  )
}
