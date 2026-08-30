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
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.07 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-3.57-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
      <rect x="0" y="0" width="10" height="10" fill="#F25022"/>
      <rect x="11" y="0" width="10" height="10" fill="#7FBA00"/>
      <rect x="0" y="11" width="10" height="10" fill="#00A4EF"/>
      <rect x="11" y="11" width="10" height="10" fill="#FFB900"/>
    </svg>
  )
}

function AppleIcon() {
  return (
    <span style={{ fontSize: 20, lineHeight: 1 }}>🍎</span>
  )
}

const providerTileStyle: React.CSSProperties = {
  width: 140,
  height: 80,
  background: '#FFFFFF',
  border: '1px solid #E8E1CE',
  borderRadius: 10,
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
          border-color: #F5D14E !important;
          transform: translateY(-1px);
        }
      `}</style>

      <div style={{ animation: 'step2-fadein 0.35s ease' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
          Connect your accounts
        </h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-dim)', margin: '6px 0 0', lineHeight: 1.6 }}>
          Your primary Google account is already connected. Add more to manage multiple calendars and inboxes.
        </p>
      </div>

      {/* Primary account card */}
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E8E1CE',
        borderLeft: '3px solid #F5D14E',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        {/* Avatar */}
        <div style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: '#F5D14E',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
        }}>
          {user?.name ? user.name[0].toUpperCase() : user?.email?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user?.name || user?.email || 'You'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user?.email || ''}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            background: 'rgba(52,211,153,0.12)',
            color: '#34D399',
            borderRadius: 4,
            padding: '2px 7px',
            letterSpacing: '0.04em',
          }}>
            Primary · Connected
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#34D399' }}>✉ Mail</span>
            <span style={{ fontSize: 11, color: '#34D399' }}>📅 Calendar</span>
          </div>
        </div>
      </div>

      {/* Extra accounts */}
      {extraAccounts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Additional accounts
          </div>
          {extraAccounts.map(acct => (
            <div key={acct.id} style={{
              background: '#FFFFFF',
              border: '1px solid #E8E1CE',
              borderRadius: 10,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              {acct.avatarUrl ? (
                <img src={acct.avatarUrl} alt={acct.name} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: '#E8E1CE',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  color: 'var(--color-text-dim)',
                  flexShrink: 0,
                }}>
                  {acct.name?.[0]?.toUpperCase() ?? acct.email[0].toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {acct.name || acct.email}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {acct.email}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: '#34D399' }}>✉</span>
                <span style={{ fontSize: 11, color: '#34D399' }}>📅</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add more accounts */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
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
            <span style={{ fontSize: 12, color: 'var(--color-text-dim)', fontWeight: 500 }}>
              {connecting ? 'Connecting…' : 'Google'}
            </span>
          </button>

          {/* Outlook tile */}
          <div style={{ ...providerTileStyle, opacity: 0.6, cursor: 'not-allowed' }}>
            <MicrosoftIcon />
            <span style={{ fontSize: 12, color: 'var(--color-text-dim)', fontWeight: 500 }}>Outlook</span>
            <span style={{
              position: 'absolute',
              top: 6,
              right: 6,
              fontSize: 9,
              fontWeight: 700,
              background: 'rgba(251,191,36,0.18)',
              color: '#FBBF24',
              borderRadius: 4,
              padding: '1px 5px',
              letterSpacing: '0.04em',
            }}>
              SOON
            </span>
          </div>

          {/* iCloud tile */}
          <div style={{ ...providerTileStyle, opacity: 0.6, cursor: 'not-allowed' }}>
            <AppleIcon />
            <span style={{ fontSize: 12, color: 'var(--color-text-dim)', fontWeight: 500 }}>iCloud</span>
            <span style={{
              position: 'absolute',
              top: 6,
              right: 6,
              fontSize: 9,
              fontWeight: 700,
              background: 'rgba(251,191,36,0.18)',
              color: '#FBBF24',
              borderRadius: 4,
              padding: '1px 5px',
              letterSpacing: '0.04em',
            }}>
              SOON
            </span>
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0, fontStyle: 'italic' }}>
        You can manage accounts anytime in Settings → Accounts.
      </p>
    </div>
  )
}
