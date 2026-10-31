import { useState } from 'react'
import { Block, DRow, Toggle } from '../ui'

// ─── Shopping List settings block (inside FinanceSection) ────────────────────

export function ShoppingSettingsBlock() {
  const [enabled, setEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('shopping-settings') ?? '{}').enabled === true } catch { return false }
  })
  const [priceFreq, setPriceFreq] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem('shopping-settings') ?? '{}').priceWatchFrequency ?? 'off' } catch { return 'off' }
  })
  const [markCal, setMarkCal] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('shopping-settings') ?? '{}').markCalendarDoneOnPurchase ?? false } catch { return false }
  })
  const [markTask, setMarkTask] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('shopping-settings') ?? '{}').markTaskDoneOnPurchase ?? false } catch { return false }
  })
  const [lastRefreshed] = useState<string | undefined>(() => {
    try { return JSON.parse(localStorage.getItem('shopping-settings') ?? '{}').lastAutoRefreshed } catch { return undefined }
  })

  function save(patch: Record<string, unknown>) {
    try {
      const existing = JSON.parse(localStorage.getItem('shopping-settings') ?? '{}')
      const next = { ...existing, ...patch }
      localStorage.setItem('shopping-settings', JSON.stringify(next))
      // Notify other windows/FinanceModule
      window.dispatchEvent(new StorageEvent('storage', { key: 'shopping-settings', newValue: JSON.stringify(next) }))
    } catch { /* noop */ }
  }

  const FREQ_LABELS: Record<string, string> = {
    off: 'Off', '6h': 'Every 6 hours', '12h': 'Every 12 hours', '24h': 'Once a day', '7d': 'Once a week',
  }

  return (
    <Block title="Shopping list" sub="A list that follows your finance lock, with prices watched from your stores">
      <DRow label="Enable shopping list" sub="Adds Shopping to the main menu, behind the same finance lock">
        <Toggle checked={enabled} onChange={(v: boolean) => { setEnabled(v); save({ enabled: v }) }} />
      </DRow>

      {enabled && (
        <>
          <DRow label="Check prices automatically" sub={lastRefreshed
            ? `How often the app looks up prices from your stores · last refresh ${new Date(lastRefreshed).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
            : 'How often the app looks up prices from your stores'}>
            <select
              value={priceFreq}
              onChange={e => {
                setPriceFreq(e.target.value)
                save({ priceWatchFrequency: e.target.value })
                // Call the Edge Function to configure the cron schedule
                void (async () => {
                  const { supabase } = await import('@/lib/supabase')
                  const { data: { user } } = await supabase.auth.getUser()
                  if (!user) return
                  await supabase.functions.invoke('shopping-price-watch', {
                    body: { action: 'set_cron', frequency: e.target.value },
                  }).catch(() => null)
                })()
              }}
              style={{
                fontSize: 'var(--sb-t-body-s)', padding: '4px 8px', borderRadius: 'var(--sb-r-chip)',
                border: 'var(--sb-border-width) solid var(--sb-border)',
                background: 'var(--sb-field)', color: 'var(--sb-ink-1)',
              }}
            >
              {Object.entries(FREQ_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </DRow>

          <DRow label="Mark calendar events done on purchase" sub="When you mark an item purchased, its linked calendar event is updated">
            <Toggle checked={markCal} onChange={(v: boolean) => { setMarkCal(v); save({ markCalendarDoneOnPurchase: v }) }} />
          </DRow>

          <DRow label="Complete linked tasks on purchase" last sub="When you mark an item purchased, its linked task is completed and logged">
            <Toggle checked={markTask} onChange={(v: boolean) => { setMarkTask(v); save({ markTaskDoneOnPurchase: v }) }} />
          </DRow>
        </>
      )}
    </Block>
  )
}
