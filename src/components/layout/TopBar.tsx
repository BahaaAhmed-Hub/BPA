
import { useState } from 'react'
import { Button } from '@/components/ui'
import { Bell, Search, Settings, LogOut } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { signOut } from '@/lib/google'
import { ICON, STROKE } from '@/lib/type'

interface TopBarProps {
  title: string
  subtitle?: string
}

export function TopBar({ title, subtitle }: TopBarProps) {
  const setActiveModule = useUIStore(s => s.setActiveModule)
  const user = useAuthStore(s => s.user)
  const [menuOpen, setMenuOpen] = useState(false)
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <header
      style={{
        height: 64,
        background: 'var(--sb-card)',
        borderBottom: '1px solid var(--sb-border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: 16,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      {/* Title */}
      <div style={{ flex: 1 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--sb-t-h2)',
            fontWeight: 700,
            color: 'var(--sb-ink-1)',
            letterSpacing: '-0.3px',
            lineHeight: 1,
            fontFamily: 'var(--sb-font-num)',
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', marginTop: 2 }}>
            {subtitle}
          </p>
        )}
      </div>

      {/* Date */}
      <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', letterSpacing: '0.2px' }}>
        {dateStr}
      </span>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4 }}>
        {[Search, Bell, Settings].map((Icon, i) => (
          <Button
            key={i}
            variant="ghost"
            iconOnly
            onClick={i === 2 ? () => setActiveModule('settings') : undefined}
          >
            <Icon size={ICON.lg} strokeWidth={STROKE.rest} />
          </Button>
        ))}
      </div>

      {/* Avatar + sign out */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setMenuOpen(o => !o)}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.name ?? ''} style={{ width: 32, height: 32, borderRadius: 'var(--sb-r-pill)', border: 'var(--sb-border-emphasis) solid var(--sb-accent)', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: 32, height: 32, borderRadius: 'var(--sb-r-pill)', background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-emphasis) solid var(--sb-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
                {user?.name?.[0]?.toUpperCase() ?? 'P'}
              </span>
            </div>
          )}
        </button>

        {menuOpen && (
          <>
            <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div style={{ position: 'absolute', right: 0, top: 40, zIndex: 50, background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-card)', padding: 8, minWidth: 200, boxShadow: 'var(--sb-shadow-menu)' }}>
              <div style={{ padding: '8px 12px 10px', borderBottom: '1px solid var(--sb-border)', marginBottom: 6 }}>
                <p style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{user?.name ?? 'User'}</p>
                <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{user?.email}</p>
              </div>
              <Button
                variant="danger"
                block
                onClick={() => { setMenuOpen(false); void signOut() }}
                style={{ justifyContent: 'flex-start', borderRadius: 'var(--sb-r-chip)' }}
              >
                <LogOut size={ICON.lg} /> Sign out
              </Button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
