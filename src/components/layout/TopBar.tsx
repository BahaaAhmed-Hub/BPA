
import { useState } from 'react'
import { Bell, Search, Settings, LogOut } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { signOut } from '@/lib/google'

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
        background: '#161929',
        borderBottom: '1px solid #252A3E',
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
            fontSize: 18,
            fontWeight: 700,
            color: '#E8EAF6',
            letterSpacing: '-0.3px',
            lineHeight: 1,
            fontFamily: "'Cabinet Grotesk', sans-serif",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p style={{ margin: 0, fontSize: 12, color: '#FFFFFF', marginTop: 2 }}>
            {subtitle}
          </p>
        )}
      </div>

      {/* Date */}
      <span style={{ fontSize: 12, color: '#FFFFFF', letterSpacing: '0.2px' }}>
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
              borderRadius: 7,
              cursor: 'pointer',
              color: '#FFFFFF',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'rgba(255,255,255,0.05)'
              el.style.borderColor = '#252A3E'
              el.style.color = '#E8EAF6'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'transparent'
              el.style.borderColor = 'transparent'
              el.style.color = '#FFFFFF'
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
            <img src={user.avatarUrl} alt={user.name ?? ''} style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid #1E40AF', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(30,64,175,0.2)', border: '1.5px solid #1E40AF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1E40AF' }}>
                {user?.name?.[0]?.toUpperCase() ?? 'P'}
              </span>
            </div>
          )}
        </button>

        {menuOpen && (
          <>
            <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div style={{ position: 'absolute', right: 0, top: 40, zIndex: 50, background: '#161929', border: '1px solid #252A3E', borderRadius: 10, padding: 8, minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
              <div style={{ padding: '8px 12px 10px', borderBottom: '1px solid #252A3E', marginBottom: 6 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#E8EAF6' }}>{user?.name ?? 'User'}</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#FFFFFF' }}>{user?.email}</p>
              </div>
              <button
                onClick={() => { setMenuOpen(false); void signOut() }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'transparent', border: 'none', borderRadius: 7, color: '#E05252', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(224,82,82,0.08)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
