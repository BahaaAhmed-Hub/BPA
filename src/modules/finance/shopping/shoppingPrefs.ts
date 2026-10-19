import { useEffect, useState } from 'react'
import { moduleIsOff } from '@/lib/entitlements'

// Whether Shopping is in the main menu: Settings → Finance → Shopping must be on,
// and so must Finance itself — the lists are priced, they belong to the same
// plan and sit behind the same lock. (An unregistered module id is never "off"
// as far as the server is concerned, so the plan question is asked of Finance.)

export function shoppingEnabled(): boolean {
  try {
    const raw = localStorage.getItem('shopping-settings')
    if (!raw) return false
    return (JSON.parse(raw) as { enabled?: boolean }).enabled === true
  } catch { return false }
}

export const shoppingIsOff = (): boolean => moduleIsOff('finance') || !shoppingEnabled()

/** Re-render when the switch is flipped here (Settings dispatches a `storage`
 *  event for its own tab), in another tab, or the plan changes. */
export function useShoppingOff(): boolean {
  const [, bump] = useState(0)
  useEffect(() => {
    const on = () => bump(n => n + 1)
    window.addEventListener('storage', on)
    window.addEventListener('professor:modulesChanged', on)
    return () => { window.removeEventListener('storage', on); window.removeEventListener('professor:modulesChanged', on) }
  }, [])
  return shoppingIsOff()
}
