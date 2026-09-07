
import { useState } from 'react'
import { Bell, Search, Settings, LogOut } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { signOut } from '@/lib/google'
import { ICON } from '@/lib/type'

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
          <button
            key={i}
            onClick={i === 2 ? () => setActiveModule('settings') : undefined}
            style={{
              width: 34,
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: '1px solid transparent',
              borderRadius: 'var(--sb-r-chip)',
              cursor: 'pointer',
              color: 'var(--sb-ink-3)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              // White at 5% on a white bar is nothing at all — this row of
              // controls had no hover state for as long as the bar has been
              // cream. The field colour is what a hovered control sits on.
              el.style.background = 'var(--sb-field)'
              el.style.borderColor = 'var(--sb-border)'
              el.style.color = 'var(--sb-ink-1)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'transparent'
              el.style.borderColor = 'transparent'
              el.style.color = 'var(--sb-ink-3)'
            }}
          >
            <Icon size={15} strokeWidth={1.8} />
          </button>
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
              <button
                onClick={() => { setMenuOpen(false); void signOut() }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'transparent', border: 'none', borderRadius: 'var(--sb-r-chip)', color: 'var(--sb-negative)', fontSize: 'var(--sb-t-body)', cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(224,82,82,0.08)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <LogOut size={ICON.lg} /> Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
