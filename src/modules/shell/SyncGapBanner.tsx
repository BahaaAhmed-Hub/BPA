// ─── When the database cannot hold what it is being sent ─────────────────────
// A write that falls back to the columns that existed before a migration
// succeeds. Nothing errored, so nothing was said — and a habit's picture, or a
// task's notes, simply never appeared on the next device. This says it.

import { useEffect, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { getSyncGaps, onSyncGapsChanged, MIGRATION_FOR, type SyncGap } from '@/lib/syncStatus'
import { T } from '@/lib/type'
import { supabaseProjectRef } from '@/lib/supabase'

export function SyncGapBanner() {
  const [gaps, setGaps] = useState<SyncGap[]>(getSyncGaps)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => onSyncGapsChanged(() => setGaps(getSyncGaps())), [])

  if (dismissed || gaps.length === 0) return null

  const missing = gaps.filter(g => g.kind === 'columns')
  const stale   = gaps.filter(g => g.kind === 'cache')
  const failing = gaps.filter(g => g.kind === 'error')

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      margin: '0 22px 10px', padding: '11px 14px', borderRadius: 11,
      background: 'rgba(245,209,78,0.20)', border: '1px solid rgba(245,209,78,0.65)',
    }}>
      <AlertCircle size={15} color="#8A6D0B" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {missing.length > 0 && (
          <p style={{ ...T.body, margin: 0, color: '#3D3926' }}>
            {missing.map(g => g.entity).join(' and ')} are saving, but not everything about them —
            the database is missing columns, so pictures, notes and attachments stay on this device.
            Run {missing.map(g => MIGRATION_FOR[g.entity]).join(' and ')} in Supabase.
          </p>
        )}
        {stale.length > 0 && (
          <p style={{ ...T.body, margin: missing.length ? '6px 0 0' : 0, color: '#3D3926' }}>
            Supabase will not store everything about {stale.map(g => g.entity).join(' and ')} —
            pictures, notes and attachments are staying on this device. It reports a missing column
            and a not-yet-reloaded one the same way, so it is one of three things: the migration has
            not run, it ran against a different project, or the schema cache is stale. This build
            talks to project <strong>{supabaseProjectRef}</strong> — check the SQL editor is open on
            that one, then run <code style={{ ...T.small, background: 'rgba(25,23,18,0.06)', padding: '1px 5px', borderRadius: 4 }}>
            notify pgrst, 'reload schema';</code>
          </p>
        )}
        {failing.length > 0 && (
          <p style={{ ...T.body, margin: missing.length ? '6px 0 0' : 0, color: '#3D3926' }}>
            {failing.map(g => `${g.entity}: ${g.detail ?? 'sync failed'}`).join(' · ')}
          </p>
        )}
      </div>
      <button onClick={() => setDismissed(true)} title="Hide until next time"
        style={{
          width: 26, height: 26, borderRadius: 7, flexShrink: 0, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', color: '#8A6D0B', cursor: 'pointer',
        }}>
        <X size={14} />
      </button>
    </div>
  )
}
