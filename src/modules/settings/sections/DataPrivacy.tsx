import { useState } from 'react'
import { Trash2, HardDrive } from 'lucide-react'
import { ICON } from '@/lib/type'
import { Toggle, Block, DRow } from '../ui'

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
      {/* Data export */}
      <Block title="Export" sub="Download a copy of all your data — tasks, habits, companies, finance envelopes & settings.">
        <DRow label="Export all data" sub="One file, yours to keep" last>
          <button onClick={handleExport} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--sb-r-chip)',
            background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
            fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-1)', cursor: 'pointer',
          }}>
            <HardDrive size={ICON.sm} />
            {exportStatus === 'exporting' ? 'Preparing…' : exportStatus === 'done' ? 'Downloaded ✓' : 'Export all data'}
          </button>
        </DRow>
      </Block>

      {/* Privacy controls */}
      <Block title="Privacy" sub="What leaves this device to help improve Professor.">
        {[
          { label: 'Share usage analytics',  sub: 'Helps improve Professor', key: 'analytics' },
          { label: 'Crash reporting',         sub: 'Automatic error reports',  key: 'crash' },
        ].map((item, i, arr) => {
          const [on, setOn] = useState(true)
          return (
            <DRow key={item.key} label={item.label} sub={item.sub} last={i === arr.length - 1}>
              <Toggle checked={on} onChange={setOn} />
            </DRow>
          )
        })}
      </Block>

      {/* Account deletion — a danger block: the same card, outlined in red */}
      <section style={{ marginBottom: 28 }}>
        <div style={{ margin: '0 0 10px 2px' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-negative-deep)' }}>Danger zone</h3>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>Things that cannot be taken back.</p>
        </div>
        <div style={{
          background: 'var(--sb-card)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 30%, transparent)',
          borderRadius: 'var(--sb-r-card)', padding: '8px 20px', boxShadow: 'var(--sb-shadow-control)', minWidth: 0,
        }}>
          <DRow label="Delete account" sub="Permanently delete your account and all associated data. This cannot be undone." last>
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
          </DRow>
        </div>
      </section>
    </div>
  )
}
