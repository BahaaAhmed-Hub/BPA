// ─── When the database cannot hold what it is being sent ─────────────────────
// A write that falls back to the columns that existed before a migration
// succeeds. Nothing errored, so nothing was said — and a habit's picture, or a
// task's notes, simply never appeared on the next device. This says it.

import { useEffect, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { getSyncGaps, onSyncGapsChanged, MIGRATION_FOR, type SyncGap } from '@/lib/syncStatus'
import { T, ICON } from '@/lib/type'
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
      margin: '0 22px 10px', padding: '11px 14px', borderRadius: 'var(--sb-r-nav)',
      background: 'rgba(var(--sb-accent-rgb),0.20)', border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.65)',
    }}>
      <AlertCircle size={ICON.md} color="var(--sb-accent-deep)" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {missing.length > 0 && (
          <p style={{ ...T.body, margin: 0, color: 'var(--sb-ink-2)' }}>
            {missing.map(g => g.entity).join(' and ')} are saving, but not everything about them —
            the database is missing columns, so pictures, notes and attachments stay on this device.
            Run {missing.map(g => MIGRATION_FOR[g.entity]).join(' and ')} in Supabase.
          </p>
        )}
        {stale.length > 0 && (
          <p style={{ ...T.body, margin: missing.length ? '6px 0 0' : 0, color: 'var(--sb-ink-2)' }}>
            Supabase will not store everything about {stale.map(g => g.entity).join(' and ')} —
            pictures, notes and attachments are staying on this device. It reports a missing column
            and a not-yet-reloaded one the same way, so it is one of three things: the migration has
            not run, it ran against a different project, or the schema cache is stale. This build
            talks to project <strong>{supabaseProjectRef}</strong> — check the SQL editor is open on
            that one, then run <code style={{ ...T.meta, background: 'color-mix(in srgb, var(--sb-ink-1) 6.0%, transparent)', padding: '1px 5px', borderRadius: 'var(--sb-r-chip)' }}>
            notify pgrst, 'reload schema';</code>
          </p>
        )}
        {failing.length > 0 && (
          <p style={{ ...T.body, margin: missing.length ? '6px 0 0' : 0, color: 'var(--sb-ink-2)' }}>
            {failing.map(g => `${g.entity}: ${g.detail ?? 'sync failed'}`).join(' · ')}
          </p>
        )}
      </div>
      <button onClick={() => setDismissed(true)} title="Hide until next time"
        style={{
          width: 26, height: 26, borderRadius: 'var(--sb-r-chip)', flexShrink: 0, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', color: 'var(--sb-accent-deep)', cursor: 'pointer',
        }}>
        <X size={ICON.sm} />
      </button>
    </div>
  )
}
