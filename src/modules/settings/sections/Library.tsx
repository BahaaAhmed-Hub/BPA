import { useState } from 'react'
import { pushSharedPrefs } from '@/lib/prefSync'
import { loadLibrarySettings, saveLibrarySettings } from '@/modules/library/libraryPrefs'
import { useLibraryStore } from '@/modules/library/libraryStore'
import { FieldRow, Toggle } from '../ui'

// ─── Behavioral OS Section ────────────────────────────────────────────────────

export function LibrarySection() {
  const [enabled, setEnabled] = useState(() => loadLibrarySettings().enabled)
  const [dailyQuote, setDailyQuote] = useState(() => loadLibrarySettings().dailyQuote !== false)
  const missing = useLibraryStore(s => s.missing)

  function flip(v: boolean) {
    setEnabled(v)
    saveLibrarySettings({ ...loadLibrarySettings(), enabled: v })
    // Pushed now rather than on the five-minute timer: switching it off on the
    // laptop and opening the iPad a minute later should not still show it.
    void pushSharedPrefs()
  }

  function flipQuote(v: boolean) {
    setDailyQuote(v)
    // Absent means on, so only "off" is written: the stored settings stay as small as the person's choices.
    const next = { ...loadLibrarySettings() }
    if (v) delete next.dailyQuote
    else next.dailyQuote = false
    saveLibrarySettings(next)
    void pushSharedPrefs()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FieldRow label="Show the Library" sub="Your books, quotes, reading plans and listening — a shelf in the top menu. Off hides it and stops it loading; nothing is deleted.">
        <Toggle checked={enabled} onChange={flip} />
      </FieldRow>
      {enabled && (
        <FieldRow label="A quote on Today" sub="One of your saved quotes, a different one each day. Nothing is shown if you have none yet.">
          <Toggle checked={dailyQuote} onChange={flipQuote} />
        </FieldRow>
      )}
      {missing && (
        <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-accent-deep)' }}>
          The Library's tables are not on this account yet — migration <code>20260025_library.sql</code> has not run.
        </div>
      )}
    </div>
  )
}
