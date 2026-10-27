import { Check, Minus } from 'lucide-react'
import { ICON } from '@/lib/type'
import { STEPS } from '../steps'
import type { StepCtx } from './types'

/** What was set up, in the words each step wrote, and what was left for later. Read from `saved`, so it can only say what was done. */
export function DoneStep({ w }: StepCtx) {
  return (
    <>
      <div>
        {STEPS.filter(s => s.id !== 'done').map(s => {
          const lines = w.saved[s.id]
          return (
            <div key={s.id} className="wz-sum">
              <i data-skipped={lines ? undefined : ''}>{lines ? <Check size={ICON.sm} aria-hidden /> : <Minus size={ICON.sm} aria-hidden />}</i>
              <div><b>{s.label}</b><small>{lines ? lines.join(' · ') : 'Skipped. Set it up whenever you like.'}</small></div>
            </div>
          )
        })}
      </div>
      <p className="wz-note">Everything here can be changed any time in Settings.</p>
    </>
  )
}
