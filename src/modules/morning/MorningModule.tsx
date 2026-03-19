
import { TopBar } from '@/components/layout/TopBar'

export function MorningModule() {
  return (
    <div>
      <TopBar title="Morning Brief" subtitle="Your day, curated. Start with clarity." />
      <div style={{ padding: '40px 28px', textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            padding: '48px 64px',
            background: '#2A2218',
            border: '1px solid #3A3020',
            borderRadius: 16,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'rgba(196, 154, 60, 0.1)',
              border: '1px solid rgba(196, 154, 60, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 22 }}>🚧</span>
          </div>
          <div>
            <h2 style={{ margin: '0 0 6px', fontSize: 18, color: '#F0E8D8', fontFamily: "'Cabinet Grotesk', sans-serif" }}>
              Morning Brief
            </h2>
            <p style={{ margin: 0, fontSize: 13.5, color: '#8A7A60' }}>
              Coming soon — this module is under construction.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
