
import { Bell, Search, Settings } from 'lucide-react'

interface TopBarProps {
  title: string
  subtitle?: string
}

export function TopBar({ title, subtitle }: TopBarProps) {
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
        background: '#2A2218',
        borderBottom: '1px solid #3A3020',
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
            color: '#F0E8D8',
            letterSpacing: '-0.3px',
            lineHeight: 1,
            fontFamily: "'Cabinet Grotesk', sans-serif",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p style={{ margin: 0, fontSize: 12, color: '#8A7A60', marginTop: 2 }}>
            {subtitle}
          </p>
        )}
      </div>

      {/* Date */}
      <span style={{ fontSize: 12, color: '#8A7A60', letterSpacing: '0.2px' }}>
        {dateStr}
      </span>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4 }}>
        {[Search, Bell, Settings].map((Icon, i) => (
          <button
            key={i}
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
              color: '#8A7A60',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'rgba(255,255,255,0.05)'
              el.style.borderColor = '#3A3020'
              el.style.color = '#F0E8D8'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'transparent'
              el.style.borderColor = 'transparent'
              el.style.color = '#8A7A60'
            }}
          >
            <Icon size={15} strokeWidth={1.8} />
          </button>
        ))}
      </div>

      {/* Avatar */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'rgba(196, 154, 60, 0.2)',
          border: '1.5px solid #C49A3C',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: '#C49A3C' }}>P</span>
      </div>
    </header>
  )
}
