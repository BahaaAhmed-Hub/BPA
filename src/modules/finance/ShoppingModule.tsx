import { ShoppingScreen } from './screens/ShoppingScreen'
import { LockGate } from './FinanceLockScreen'
import { useFinanceLock } from './useFinanceLock'
import { useFillsTheWindow } from '@/lib/fillsTheWindow'

// Shopping has its own place in the main menu, but its lists are priced and it
// answers to the finance lock exactly as the ledger does: locked, you get the
// door, not the lists. Unlocking either one unlocks the other (see
// `useFinanceLock`), because it is one lock.
export function ShoppingModule() {
  const { locked, unlock } = useFinanceLock()
  // Measured, not `height: 100%` — the same reason as FinanceModule: the module's
  // wrapper has no height of its own, so a percentage is ignored.
  const { ref, height } = useFillsTheWindow(360)
  if (locked) return <LockGate onUnlocked={unlock} />
  return (
    <div ref={ref} data-shopping-module style={{ display: 'flex', flexDirection: 'column', height: height ?? '100%', overflow: 'hidden', background: 'var(--sb-page)' }}>
      <ShoppingScreen />
    </div>
  )
}
