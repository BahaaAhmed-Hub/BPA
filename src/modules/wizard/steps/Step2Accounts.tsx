import React, { useState, useEffect } from 'react'
import { loadAccounts } from '@/lib/multiAccount'
import { connectAdditionalGoogleAccount } from '@/lib/google'
import { useAuthStore } from '@/store/authStore'
import type { WizardData } from '../SetupWizard'
import type { ConnectedAccount } from '@/lib/multiAccount'

interface Props {
  data: WizardData
  onChange: (p: Partial<WizardData>) => void
  onBeforeOAuth?: () => void
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
      <path fill="var(--sb-negative)" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.07 17.74 9.5 24 9.5z"/>
      <path fill="var(--sb-info)" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="var(--sb-warning)" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="var(--sb-positive)" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-3.57-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
      <rect x="0" y="0" width="10" height="10" fill="var(--sb-negative)"/>
      <rect x="11" y="0" width="10" height="10" fill="var(--sb-positive)"/>
      <rect x="0" y="11" width="10" height="10" fill="var(--sb-info)"/>
      <rect x="11" y="11" width="10" height="10" fill="var(--sb-warning)"/>
    </svg>
  )
}

function AppleIcon() {
  return (
    <span style={{ fontSize: 'var(--sb-t-h2)', lineHeight: 1 }}>🍎</span>
  )
}

const providerTileStyle: React.CSSProperties = {
  width: 140,
  height: 80,
  background: 'var(--sb-card)',
  border: '1px solid var(--sb-border)',
  borderRadius: 'var(--sb-r-nav)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  cursor: 'pointer',
  transition: 'border-color 0.15s, transform 0.15s',
  position: 'relative',
}

export function Step2Accounts({ data: _data, onChange: _onChange, onBeforeOAuth }: Props) {
  const user = useAuthStore(s => s.user)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [connecting, setConnecting] = useState(false)

  function refreshAccounts() {
    setAccounts(loadAccounts())
  }

  useEffect(() => {
    refreshAccounts()
    window.addEventListener('professor:accountsUpdated', refreshAccounts)
    return () => window.removeEventListener('professor:accountsUpdated', refreshAccounts)
  }, [])

  const extraAccounts = accounts.filter(a => !a.isPrimary)

  async function handleAddGoogle() {
    if (connecting) return
    setConnecting(true)
    try {
      onBeforeOAuth?.()
      await connectAdditionalGoogleAccount()
      refreshAccounts()
    } catch (err) {
      console.warn('[Step2] connectAdditionalGoogleAccount error:', err)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <style>{`
        @keyframes step2-fadein {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .step2-google-tile:hover {
          border-color: var(--sb-accent) !important;
          transform: translateY(-1px);
        }
      `}</style>

      <div style={{ animation: 'step2-fadein 0.35s ease' }}>
        <h2 style={{ fontSize: 'var(--sb-t-h2)', fontWeight: 700, color: 'var(--sb-ink-1)', margin: 0 }}>
          Connect your accounts
        </h2>
        <p style={{ fontSize: 'var(--sb-t-label)', color: 'var(--sb-ink-3)', margin: '6px 0 0', lineHeight: 1.6 }}>
          Your primary Google account is already connected. Add more to manage multiple calendars and inboxes.
        </p>
      </div>

      {/* Primary account card */}
      <div style={{
        background: 'var(--sb-card)',
        border: '1px solid var(--sb-border)',
        borderLeft: '3px solid var(--sb-accent)',
        borderRadius: 'var(--sb-r-nav)',
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        {/* Avatar */}
        <div style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--sb-r-pill)',
          background: 'var(--sb-accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--sb-t-label)',
          fontWeight: 700,
          color: 'var(--sb-accent-ink)',
          flexShrink: 0,
        }}>
          {user?.name ? user.name[0].toUpperCase() : user?.email?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user?.name || user?.email || 'You'}
          </div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user?.email || ''}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <span style={{
            fontSize: 'var(--sb-t-micro)',
            fontWeight: 600,
            background: 'color-mix(in srgb, var(--sb-positive) 12.0%, transparent)',
            color: 'var(--sb-positive)',
            borderRadius: 'var(--sb-r-chip)',
            padding: '2px 7px',
            letterSpacing: '0.04em',
          }}>
            Primary · Connected
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-positive)' }}>✉ Mail</span>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-positive)' }}>📅 Calendar</span>
          </div>
        </div>
      </div>

      {/* Extra accounts */}
      {extraAccounts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Additional accounts
          </div>
          {extraAccounts.map(acct => (
            <div key={acct.id} style={{
              background: 'var(--sb-card)',
              border: '1px solid var(--sb-border)',
              borderRadius: 'var(--sb-r-nav)',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              {acct.avatarUrl ? (
                <img src={acct.avatarUrl} alt={acct.name} style={{ width: 32, height: 32, borderRadius: 'var(--sb-r-pill)', flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--sb-r-pill)',
                  background: 'var(--sb-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--sb-t-body)',
                  color: 'var(--sb-ink-3)',
                  flexShrink: 0,
                }}>
                  {acct.name?.[0]?.toUpperCase() ?? acct.email[0].toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {acct.name || acct.email}
                </div>
                <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {acct.email}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-positive)' }}>✉</span>
                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-positive)' }}>📅</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add more accounts */}
      <div>
        <div style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
          Add more accounts
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {/* Google tile */}
          <button
            className="step2-google-tile"
            onClick={handleAddGoogle}
            disabled={connecting}
            style={{ ...providerTileStyle, cursor: connecting ? 'wait' : 'pointer' }}
          >
            <GoogleIcon />
            <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', fontWeight: 500 }}>
              {connecting ? 'Connecting…' : 'Google'}
            </span>
          </button>

          {/* Outlook tile */}
          <div style={{ ...providerTileStyle, opacity: 0.6, cursor: 'not-allowed' }}>
            <MicrosoftIcon />
            <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', fontWeight: 500 }}>Outlook</span>
            <span style={{
              position: 'absolute',
              top: 6,
              right: 6,
              fontSize: 'var(--sb-t-micro)',
              fontWeight: 700,
              background: 'color-mix(in srgb, var(--sb-accent) 18.0%, transparent)',
              color: 'var(--sb-accent)',
              borderRadius: 'var(--sb-r-chip)',
              padding: '1px 5px',
              letterSpacing: '0.04em',
            }}>
              SOON
            </span>
          </div>

          {/* iCloud tile */}
          <div style={{ ...providerTileStyle, opacity: 0.6, cursor: 'not-allowed' }}>
            <AppleIcon />
            <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', fontWeight: 500 }}>iCloud</span>
            <span style={{
              position: 'absolute',
              top: 6,
              right: 6,
              fontSize: 'var(--sb-t-micro)',
              fontWeight: 700,
              background: 'color-mix(in srgb, var(--sb-accent) 18.0%, transparent)',
              color: 'var(--sb-accent)',
              borderRadius: 'var(--sb-r-chip)',
              padding: '1px 5px',
              letterSpacing: '0.04em',
            }}>
              SOON
            </span>
          </div>
        </div>
      </div>

      <p style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)', margin: 0, fontStyle: 'italic' }}>
        You can manage accounts anytime in Settings → Accounts.
      </p>
    </div>
  )
}
