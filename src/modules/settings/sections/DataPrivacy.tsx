import { useState } from 'react'
import { Trash2, HardDrive } from 'lucide-react'
import { ICON } from '@/lib/type'
import { Toggle } from '../ui'

// ─── Data & Privacy Section (companies → data & privacy) ─────────────────────

export function DataPrivacySection({ onExport }: { onExport: () => void }) {
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'done'>('idle')

  // The one export. It used to wait 1.2s and download nothing, while the real
  // one sat in the page header — two buttons, one of them a prop.
  function handleExport() {
    setExportStatus('exporting')
    onExport()
    setExportStatus('done')
    setTimeout(() => setExportStatus('idle'), 3000)
  }

  return (
    <div>
      {/* Data export card */}
      <div style={{ marginBottom: 18 }}>
        <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Export</p>
        <div style={{ padding: '14px 16px', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
          <p style={{ margin: '0 0 10px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
            Download a copy of all your data — tasks, habits, companies, finance envelopes & settings.
          </p>
          <button onClick={handleExport} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--sb-r-chip)',
            background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
            fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-1)', cursor: 'pointer',
          }}>
            <HardDrive size={ICON.sm} />
            {exportStatus === 'exporting' ? 'Preparing…' : exportStatus === 'done' ? 'Downloaded ✓' : 'Export all data'}
          </button>
        </div>
      </div>

      {/* Privacy controls */}
      <div style={{ marginBottom: 18 }}>
        <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Privacy</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            { label: 'Share usage analytics',  sub: 'Helps improve Professor', key: 'analytics' },
            { label: 'Crash reporting',         sub: 'Automatic error reports',  key: 'crash' },
          ].map((item, i, arr) => {
            const [on, setOn] = useState(true)
            return (
              <div key={item.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 0',
                borderBottom: i < arr.length - 1 ? 'var(--sb-border-width) solid var(--sb-hairline)' : 'none',
              }}>
                <div>
                  <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', fontWeight: 500, color: 'var(--sb-ink-1)' }}>{item.label}</p>
                  <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{item.sub}</p>
                </div>
                <Toggle checked={on} onChange={setOn} />
              </div>
            )
          })}
        </div>
      </div>

      {/* Account deletion */}
      <div>
        <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-negative)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Danger zone</p>
        <div style={{ padding: '14px 16px', borderRadius: 'var(--sb-r-nav)', background: 'color-mix(in srgb, var(--sb-negative) 4.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 22.0%, transparent)' }}>
          <p style={{ margin: '0 0 10px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
            Permanently delete your account and all associated data. This cannot be undone.
          </p>
          <button style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--sb-r-chip)',
            background: 'color-mix(in srgb, var(--sb-negative) 8.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 30.0%, transparent)',
            // Evergreen's negative (#B4574A) on its own 8% tint reads 4.1:1
            // at 12.5px, which WCAG counts as normal text. The deep sibling
            // is what that pairing is for.
            fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-negative-deep)', cursor: 'pointer',
          }}>
            <Trash2 size={ICON.sm} /> Delete account
          </button>
        </div>
      </div>
    </div>
  )
}
