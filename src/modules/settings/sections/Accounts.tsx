import { ProviderMark } from '@/components/ProviderMark'
import { isBusinessAccount, setBusinessAccount } from '@/lib/businessAccounts'
import { useState, useEffect, type ReactNode } from 'react'
import { Pill } from '@/components/ui'
import { Trash2, LogIn, LogOut, Building2, RefreshCw, Eye, EyeOff, Mail, HardDrive, CalendarDays, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { connectAdditionalGoogleAccount, signInWithGoogle, signOut as googleSignOut, disconnectGoogleAccount } from '@/lib/google'
import { readScopes, cachedScopes, scopesAreStale, forgetScopes } from '@/lib/googleScopes'
import { loadAccounts, removeAccount, getProviderTokenForAccount, setAccountScopes, loadHiddenAccounts, saveHiddenAccounts, loadAccountsFromServer, type ConnectedAccount, type ServerAccount } from '@/lib/multiAccount'
import { saveAccountsToDB } from '@/lib/dbSync'
import { ICON, STROKE } from '@/lib/type'
import { type CompanyRow, fetchGCals } from '../model'
import { CompaniesSection } from './Companies'

// ─── CHUNK 5: Connected Accounts (multi-Google) ───────────────────────────────

/**
 *  What one account can reach, as read off its own token.
 *
 *  `active` has three values, and the third is the point. `null` is "we have
 *  not been able to ask" — a different thing from "not granted", and drawn
 *  differently, because only one of them has a button that would help. The
 *  badge used to be fed a hard-coded list that never mentioned Drive, so it
 *  showed **Grant** for ever: the tap did send you round the whole OAuth loop,
 *  Drive was in the request, Google did grant it, and the badge then wrote the
 *  same three strings back and looked exactly as it had before.
 */
function IntegrationBadge({ icon, label, active, fresh = true, onGrant }: {
  icon: ReactNode; label: string; active: boolean | null
  /** Read off the token just now, rather than off the last record of one. */
  fresh?: boolean
  onGrant?: () => void
}) {
  const tone = active === true ? 'var(--sb-positive)' : active === null ? 'var(--sb-ink-4)' : 'var(--sb-info)'
  const wash = active === true ? 'color-mix(in srgb, var(--sb-positive) 10.0%, transparent)'
             : active === null ? 'var(--sb-field)'
             : 'color-mix(in srgb, var(--sb-info) 10.0%, transparent)'
  const edge = active === true ? 'color-mix(in srgb, var(--sb-positive) 30.0%, transparent)'
             : active === null ? 'var(--sb-border)'
             : 'color-mix(in srgb, var(--sb-info) 25.0%, transparent)'
  return (
    <span
      title={active === null
        ? `We could not read this account's token just now, so we cannot say whether ${label} is granted. Granting again always settles it.`
        : active
          ? (fresh ? `${label} access is on this account's token`
                   : `${label} was on this account's last recorded grant — we could not read the token just now`)
          : (fresh ? `${label} is not on this account's token`
                   : `${label} was not on this account's last recorded grant — we could not read the token just now`)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 7px', borderRadius: 'var(--sb-r-card)', fontSize: 'var(--sb-t-meta)', fontWeight: 500,
        background: wash, color: tone,
        // A dashed edge is the whole difference between "this token says so"
        // and "this is what it said last time we could ask".
        border: `var(--sb-border-width) ${fresh ? 'solid' : 'dashed'} ${edge}`,
      }}>
      {icon}{label}
      {active === null && <span style={{ opacity: 0.8 }}>?</span>}
      {active !== true && onGrant && (
        <button onClick={onGrant} style={{
          marginLeft: 3, background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--sb-ink-2)', fontSize: 'var(--sb-t-meta)', fontWeight: 600, padding: 0,
        }}>Grant</button>
      )}
    </span>
  )
}

function AccountsSection({
  accounts, setAccounts, primaryEmail, companies = [],
}: {
  accounts: ConnectedAccount[]
  setAccounts: (a: ConnectedAccount[]) => void
  primaryEmail: string
  /** Shown under each account so the link reads both ways. */
  companies?: CompanyRow[]
}) {
  const [adding, setAdding]         = useState(false)
  const [reconnecting, setRecon]    = useState<string | null>(null)
  const [calendars, setCalendars]   = useState<Record<string, string[]>>({})
  const [loadingCals, setLoading]   = useState<string | null>(null)
  const [needsReconnect, setNeedsReconnect] = useState<Set<string>>(new Set())
  const [hiddenAccts, setHiddenAccts] = useState<Set<string>>(loadHiddenAccounts)
  // DB account IDs from google_accounts — needed to call disconnectGoogleAccount
  const [serverAccounts, setServerAccounts] = useState<ServerAccount[]>([])

  useEffect(() => {
    loadAccountsFromServer().then(rows => { if (rows) setServerAccounts(rows) }).catch(() => {})
  }, [])

  function toggleAccountVisibility(email: string) {
    setHiddenAccts(prev => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email); else next.add(email)
      saveHiddenAccounts(next)
      window.dispatchEvent(new CustomEvent('professor:accountVisibilityChanged'))
      return next
    })
  }

  // Listen for cal:reconnect-required events dispatched by Cal Intel / tokenManager.
  // This is the only reliable signal that an account genuinely needs reconnection
  // (Edge Function returned reconnect_required). Local token age checks produce
  // false positives because the Edge Function auto-refreshes via google_refresh_token.
  useEffect(() => {
    const handler = (e: Event) => {
      const email = (e as CustomEvent<{ email: string }>).detail?.email
      if (email) setNeedsReconnect(prev => new Set([...prev, email]))
    }
    window.addEventListener('cal:reconnect-required', handler)
    return () => window.removeEventListener('cal:reconnect-required', handler)
  }, [])

  async function connectAdditional() {
    setAdding(true)
    try {
      await connectAdditionalGoogleAccount()
    } catch { setAdding(false) }
  }

  async function reconnectAccount(acc: ConnectedAccount) {
    setRecon(acc.id)
    // What we measured is about the grant we are replacing.
    forgetScopes(acc.email)
    try {
      await connectAdditionalGoogleAccount(acc.email)
    } catch { setRecon(null) }
  }

  async function loadCalendars(acc: ConnectedAccount) {
    setLoading(acc.id)
    // Use getProviderTokenForAccount to get a fresh token (auto-refreshes if stale)
    const token = acc.isPrimary
      ? (localStorage.getItem('google_provider_token') ?? acc.providerToken)
      : (await getProviderTokenForAccount(acc) ?? acc.providerToken)
    const cals = await fetchGCals(token)
    setCalendars(prev => ({ ...prev, [acc.id]: cals.map(c => c.summary) }))
    setLoading(null)
  }

  function removeAcc(id: string) {
    // Remove from localStorage immediately (optimistic)
    removeAccount(id)
    const updated = loadAccounts()
    setAccounts(updated)
    // Remove from DB via edge function (uses server account_id, looked up by email)
    const localAcc = loadAccounts().find(a => a.id === id) ?? accounts.find(a => a.id === id)
    const serverAcc = localAcc
      ? serverAccounts.find(s => s.email === localAcc.email)
      : undefined
    if (serverAcc) {
      void disconnectGoogleAccount(serverAcc.id)
        .then(() => setServerAccounts(prev => prev.filter(s => s.id !== serverAcc.id)))
    }
    saveAccountsToDB(updated).catch(console.warn)
  }

  // Primary account row (from Supabase session)
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''

  /**
   *  What each account's token actually carries, asked of Google rather than
   *  assumed. `undefined` while the question is out, `null` where it could not
   *  be answered — the badges draw those two differently, and only one of them
   *  offers a button.
   */
  const [grantsBy, setGrantsBy] = useState<Record<string, { scopes: string[]; live: boolean } | null>>({})
  useEffect(() => {
    let live = true
    const put = (email: string, v: { scopes: string[]; live: boolean } | null) => {
      if (live) setGrantsBy(g => ({ ...g, [email.toLowerCase()]: v }))
    }
    const ask = async () => {
      const targets: { email: string; token: string }[] = []
      if (primaryEmail) {
        // The copy in localStorage goes stale in about an hour, and a stale
        // token makes tokeninfo answer 400 — which read as "we cannot say" on
        // an account that had granted everything. The live session holds a
        // fresher one whenever there is one.
        const { data } = await supabase.auth.getSession()
        targets.push({ email: primaryEmail, token: data.session?.provider_token || primaryToken })
      }
      for (const a of accounts) {
        targets.push({ email: a.email, token: a.providerToken || (await getProviderTokenForAccount(a)) || '' })
      }
      for (const { email, token } of targets) {
        const known = cachedScopes(email)
        if (known && !scopesAreStale(email)) { put(email, { scopes: known, live: true }); continue }
        const sc = token ? await readScopes(email, token) : null
        if (!live) continue
        if (sc) { put(email, { scopes: sc, live: true }); setAccountScopes(email, sc); continue }
        // No live reading. Last measurement first, then what the server has on
        // record from the last one — both are records of a real consent, and
        // saying nothing about an account that plainly works is worse than
        // saying what it was last known to carry.
        const recorded = known
          ?? accounts.find(a => a.email.toLowerCase() === email.toLowerCase())?.scopes
          ?? serverAccounts.find(a => a.email.toLowerCase() === email.toLowerCase())?.scopes
          ?? null
        put(email, recorded && recorded.length ? { scopes: recorded, live: false } : null)
      }
    }
    void ask()
    return () => { live = false }
  }, [accounts, serverAccounts, primaryEmail, primaryToken])

  /** True / false / null — see IntegrationBadge. */
  const can = (email: string, part: string): boolean | null => {
    const hit = grantsBy[email.toLowerCase()]
    return hit == null ? null : hit.scopes.some(x => x.includes(part))
  }
  /** Whether that answer came from the token just now, or off a record. */
  const fresh = (email: string): boolean => !!grantsBy[email.toLowerCase()]?.live

  return (
    <div>

      {/* Primary account */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 'var(--sb-r-nav)', marginBottom: 10,
        background: 'var(--sb-field)',
        border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.19)',
      }}>
        <ProviderMark email={primaryEmail} />
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 500, color: 'var(--sb-ink-1)' }}>{primaryEmail || 'Primary Google Account'}</p>
          <div style={{ margin: '5px 0 0', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {/* These read `active` unconditionally — three badges that were
                green whatever the token carried. The primary account is the
                one you signed in with, but signing in is not consent to
                everything, and a stale grant is exactly what the row should
                say. */}
            <IntegrationBadge icon={<CalendarDays size={ICON.sm} />} label="Calendar" active={can(primaryEmail, 'calendar')} fresh={fresh(primaryEmail)}
              onGrant={() => { forgetScopes(primaryEmail); void signInWithGoogle() }} />
            <IntegrationBadge icon={<Mail size={ICON.sm} />} label="Gmail" active={can(primaryEmail, 'gmail')} fresh={fresh(primaryEmail)}
              onGrant={() => { forgetScopes(primaryEmail); void signInWithGoogle() }} />
            <IntegrationBadge icon={<HardDrive size={ICON.sm} />} label="Drive" active={can(primaryEmail, 'drive')} fresh={fresh(primaryEmail)}
              onGrant={() => { forgetScopes(primaryEmail); void signInWithGoogle() }} />
          </div>
        </div>
        <BusinessToggle email={primaryEmail} />
        {/* `--sb-positive-deep` on the 10% tint: the plain positive reads
            4.06:1 there at 10px, and every theme carries a deep sibling for
            exactly this pairing (Glass's is #22C55E on its own dark wash). */}
        <span style={{ fontSize: 'var(--sb-t-meta)', padding: '3px 10px', borderRadius: 'var(--sb-r-card)', background: 'color-mix(in srgb, var(--sb-positive) 10.0%, transparent)', color: 'var(--sb-positive-deep)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-positive) 20.0%, transparent)' }}>
          Active
        </span>
        {primaryToken && (
          <button onClick={() => loadCalendars({ id: 'primary', email: primaryEmail, name: '', providerToken: primaryToken, scopes: [], connectedAt: '', isPrimary: true })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--sb-t-meta)' }}
            title="Load calendars">
            <RefreshCw size={ICON.sm} style={{ animation: loadingCals === 'primary' ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        )}
        <button onClick={() => void googleSignOut()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-negative)', padding: 4, display: 'flex', alignItems: 'center' }}
          title="Sign out">
          <LogOut size={ICON.sm} />
        </button>
      </div>

      {/* Show primary calendars */}
      {calendars['primary'] && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
          <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Calendars in this account</p>
          {calendars['primary'].map(name => (
            <p key={name} style={{ margin: '3px 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>• {name}</p>
          ))}
        </div>
      )}

      {/* Additional connected accounts — show ALL stored accounts with delete */}
      {accounts.map(acc => {
        const isStale = needsReconnect.has(acc.email)
        const isRecon = reconnecting === acc.id
        return (
          <div key={acc.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', borderRadius: 'var(--sb-r-nav)', marginBottom: 8,
            background: 'var(--sb-field)',
            border: `var(--sb-border-width) solid ${isStale ? 'color-mix(in srgb, var(--sb-warning) 35.0%, transparent)' : 'var(--sb-border)'}`,
            opacity: hiddenAccts.has(acc.email) ? 0.5 : 1,
            transition: 'opacity 0.15s',
          }}>
            <ProviderMark email={acc.email} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <p style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 500, color: 'var(--sb-ink-1)' }}>{acc.email || acc.name}</p>
                <BusinessToggle email={acc.email} />
              </div>
              {(() => {
                const linked = companies.filter(c => c.accountId === acc.id)
                if (linked.length === 0) {
                  return <p style={{ margin: '3px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>No company uses this account yet</p>
                }
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '5px 0 0' }}>
                    {linked.map(c => (
                      <span key={c.id} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '2px 8px', borderRadius: 'var(--sb-r-pill)',
                        background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
                        fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)',
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: c.color }} />
                        {c.name}
                      </span>
                    ))}
                  </div>
                )
              })()}
              {isStale ? (
                <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-warning)', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={ICON.sm} strokeWidth={STROKE.rest} aria-hidden />Access lost — reconnect to restore</p>
              ) : (
                <div style={{ margin: '5px 0 0', display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <IntegrationBadge icon={<CalendarDays size={ICON.sm} />} label="Calendar" active={can(acc.email, 'calendar')} fresh={fresh(acc.email)}
                    onGrant={() => void reconnectAccount(acc)} />
                  <IntegrationBadge icon={<Mail size={ICON.sm} />} label="Gmail" active={can(acc.email, 'gmail')} fresh={fresh(acc.email)}
                    onGrant={() => void reconnectAccount(acc)} />
                  <IntegrationBadge icon={<HardDrive size={ICON.sm} />} label="Drive" active={can(acc.email, 'drive')} fresh={fresh(acc.email)}
                    onGrant={() => void reconnectAccount(acc)} />
                </div>
              )}
            </div>
            {isStale ? (
              <button
                onClick={() => void reconnectAccount(acc)}
                disabled={isRecon}
                style={{
                  padding: '4px 10px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)', fontWeight: 600, cursor: isRecon ? 'wait' : 'pointer',
                  background: 'color-mix(in srgb, var(--sb-warning) 12.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-warning) 40.0%, transparent)', color: 'var(--sb-warning)',
                  display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                }}
              >
                <RefreshCw size={ICON.sm} style={{ animation: isRecon ? 'spin 1s linear infinite' : 'none' }} />
                {isRecon ? 'Redirecting…' : 'Reconnect'}
              </button>
            ) : (
              <button onClick={() => void loadCalendars(acc)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 4, display: 'flex' }} title="Load calendars">
                <RefreshCw size={ICON.sm} style={{ animation: loadingCals === acc.id ? 'spin 1s linear infinite' : 'none' }} />
              </button>
            )}
            <button
              onClick={() => toggleAccountVisibility(acc.email)}
              title={hiddenAccts.has(acc.email) ? 'Show in Calendar' : 'Hide from Calendar'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', color: hiddenAccts.has(acc.email) ? 'var(--sb-ink-3)' : 'var(--sb-ink-3)' }}
            >
              {hiddenAccts.has(acc.email) ? <EyeOff size={ICON.sm} /> : <Eye size={ICON.sm} />}
            </button>
            <button onClick={() => removeAcc(acc.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-negative)', padding: 4, display: 'flex' }}>
              <Trash2 size={ICON.sm} />
            </button>
          </div>
        )
      })}

      {/* Show calendars for additional accounts */}
      {accounts.map(acc => calendars[acc.id] ? (
        <div key={`${acc.id}-cals`} style={{ marginBottom: 8, padding: '8px 14px', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
          <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>{acc.email} calendars</p>
          {calendars[acc.id].map(name => <p key={name} style={{ margin: '3px 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>• {name}</p>)}
        </div>
      ) : null)}

      {/* Add account button + Remove all */}
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button onClick={() => void connectAdditional()} disabled={adding}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 16px', borderRadius: 'var(--sb-r-sm)',
            background: 'var(--sb-field)',
            border: '1px dashed var(--sb-border)',
            color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body)', fontWeight: 500, cursor: 'pointer',
            opacity: adding ? 0.6 : 1,
          }}>
          <LogIn size={ICON.sm} />
          {adding ? 'Connecting…' : '+ Connect another Google account'}
        </button>

        {accounts.length > 0 && (
          <button
            onClick={() => {
              // Mirror individual Remove: call disconnectGoogleAccount for each
              // so OAuth tokens are cleaned up from the DB (same as Trash button).
              accounts.forEach(a => {
                removeAccount(a.id)
                const serverAcc = serverAccounts.find(s => s.email === a.email)
                if (serverAcc) {
                  void disconnectGoogleAccount(serverAcc.id)
                    .then(() => setServerAccounts(prev => prev.filter(s => s.id !== serverAcc.id)))
                }
              })
              const updated = loadAccounts()
              setAccounts(updated)
              saveAccountsToDB(updated).catch(console.warn)
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '12px 14px', borderRadius: 'var(--sb-r-sm)',
              background: 'color-mix(in srgb, var(--sb-negative) 6.0%, transparent)',
              border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 25.0%, transparent)',
              color: 'var(--sb-negative)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <Trash2 size={ICON.sm} />
            Remove all
          </button>
        )}
      </div>

      <p style={{ margin: '10px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.55 }}>
        Connected accounts grant Calendar, Gmail, and Drive access for aggregation and triage. Tokens are stored securely on the server — never in the browser. Re-authorize any account to upgrade its permissions.
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

/** Accounts and the companies that use them, in one place (previously two
 *  cards on two different pages, which hid the link between them). */
/** Work or personal, per mailbox.
 *
 *  The smart mail view's first filter is "is this business mail", and no header
 *  answers that — a personal Gmail and a company address look identical to a
 *  parser. So it is asked here, once, and kept against the address rather than
 *  the account id: the mailbox you signed in with has no id in
 *  `professor-connected-accounts`, and it is usually the one that matters most.
 */
function BusinessToggle({ email }: { email: string }) {
  const [on, setOn] = useState(() => isBusinessAccount(email))
  useEffect(() => { setOn(isBusinessAccount(email)) }, [email])
  if (!email) return null
  return (
    <Pill
      on={on}
      title={on
        ? 'Work: the smart view reads this mailbox for business threads'
        : 'Personal: only mail from a real organisation is read here'}
      onClick={() => { const v = !on; setOn(v); setBusinessAccount(email, v) }}
      style={{ flexShrink: 0 }}
    >
      {on ? 'Work' : 'Personal'}
    </Pill>
  )
}

export function AccountsAndCompaniesSection({
  companies, setCompanies, accounts, setAccounts, primaryEmail,
}: {
  companies: CompanyRow[]
  setCompanies: (c: CompanyRow[]) => void
  accounts: ConnectedAccount[]
  setAccounts: (a: ConnectedAccount[]) => void
  primaryEmail: string
}) {
  // AccountsSection renders the sign-in account separately from `accounts`
  const accountCount = accounts.length + (primaryEmail ? 1 : 0)
  const linkedIds = new Set(companies.map(c => c.accountId).filter(Boolean))
  const unlinked = companies.filter(c => !c.accountId).length
  const unusedAccounts = accounts.filter(a => !linkedIds.has(a.id)).length

  return (
    <div>
      {/* How the two halves relate, stated once at the top */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap',
        marginBottom: 12,
      }}>
        <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <span style={{ padding: '3px 9px', borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)' }}>
            {accountCount} account{accountCount === 1 ? '' : 's'}
          </span>
          <span style={{ padding: '3px 9px', borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)' }}>
            {companies.length} compan{companies.length === 1 ? 'y' : 'ies'}
          </span>
        </span>
      </div>

      {/* Accounts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <Mail size={ICON.sm} color="var(--sb-ink-3)" />
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>Google accounts</p>
        {unusedAccounts > 0 && (
          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            {unusedAccounts} not used by any company
          </span>
        )}
      </div>
      <AccountsSection accounts={accounts} setAccounts={setAccounts} primaryEmail={primaryEmail} companies={companies} />

      <div style={{ height: 1, background: 'var(--sb-hairline)', margin: '16px 0 14px' }} />

      {/* Companies */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <Building2 size={ICON.sm} color="var(--sb-ink-3)" />
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>Companies</p>
        {unlinked > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative)', fontWeight: 600 }}>
            {unlinked} not linked to an account
          </span>
        )}
      </div>
      <CompaniesSection companies={companies} setCompanies={setCompanies} accounts={accounts} primaryEmail={primaryEmail} />
    </div>
  )
}
