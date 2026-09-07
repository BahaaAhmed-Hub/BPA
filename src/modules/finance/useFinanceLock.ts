import { useCallback, useEffect, useState } from 'react'
import { isLocked, loadLock, markActive, type LockConfig } from './lock'

/** How often to re-ask "has it been idle long enough?", and how often a moving
 *  pointer is allowed to say "still here". Cheap either way. */
const TICK_MS = 15_000
const TOUCH_MS = 30_000

/**
 *  Is the finance module open, and if not, what would open it.
 *
 *  Idle is measured from the last thing you did anywhere in the app, not the
 *  last thing you did on a finance screen — reading mail for ten minutes with
 *  the ledger behind it is still you at the keyboard.
 */
export function useFinanceLock() {
  const [config, setConfig] = useState<LockConfig>(loadLock)
  const [locked, setLocked] = useState(() => isLocked())

  // The config can change from Settings, from another tab, or from prefSync
  // filling it in on the way back from the server.
  useEffect(() => {
    const reread = () => {
      const next = loadLock()
      setConfig(next)
      setLocked(isLocked(next))
    }
    window.addEventListener('finance:lockChanged', reread)
    window.addEventListener('storage', reread)
    const timer = window.setInterval(reread, TICK_MS)
    return () => {
      window.removeEventListener('finance:lockChanged', reread)
      window.removeEventListener('storage', reread)
      window.clearInterval(timer)
    }
  }, [])

  // While it is open, say so — otherwise the idle clock runs while you read.
  useEffect(() => {
    if (locked || !config.enabled) return
    let last = 0
    const touch = () => {
      const now = Date.now()
      if (now - last < TOUCH_MS) return
      last = now
      markActive()
    }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'focus']
    events.forEach(e => window.addEventListener(e, touch, { passive: true }))
    return () => events.forEach(e => window.removeEventListener(e, touch))
  }, [locked, config.enabled])

  const unlock = useCallback(() => { markActive(); setLocked(false) }, [])
  const relock = useCallback(() => { setLocked(true) }, [])

  return { locked: config.enabled && locked, config, unlock, relock }
}
