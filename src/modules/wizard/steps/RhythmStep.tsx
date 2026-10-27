import { loadQuietHours } from '@/lib/notifications'
import { clock } from '../state'
import type { StepCtx } from './types'

/**
 * Your working hours, and when the app goes quiet. Three sliders; the laptop
 * redraws the day as they move. They map onto the schedule rules Settings
 * already has: deep work opens the day and meetings start an hour later.
 */
export function RhythmStep({ w, set }: StepCtx) {
  const { start, stop, quiet } = w.rhythm
  const quietEnd = loadQuietHours().end
  const put = (patch: Partial<typeof w.rhythm>) => set(p => ({ rhythm: { ...p.rhythm, ...patch } }))
  return (
    <>
      <div className="wz-stack" style={{ gap: 12 }}>
        <div>
          <div className="wz-between"><label className="wz-lab" htmlFor="wz-start">Start work</label><b>{clock(start)}</b></div>
          <input id="wz-start" className="wz-range" type="range" min={5} max={11} step={0.5} value={start} aria-valuetext={clock(start)}
            onChange={e => { const v = Number(e.target.value); put({ start: Math.min(v, stop - 3) }) }} />
        </div>
        <div>
          <div className="wz-between"><label className="wz-lab" htmlFor="wz-stop">Stop work</label><b>{clock(stop)}</b></div>
          <input id="wz-stop" className="wz-range" type="range" min={14} max={21} step={0.5} value={stop} aria-valuetext={clock(stop)}
            onChange={e => { const v = Number(e.target.value); put({ stop: Math.max(v, start + 3), quiet: Math.max(quiet, v) }) }} />
        </div>
        <div>
          <div className="wz-between"><label className="wz-lab" htmlFor="wz-quiet">Quiet from</label><b>{clock(quiet % 24)}</b></div>
          <input id="wz-quiet" className="wz-range" type="range" min={20} max={24} step={0.5} value={quiet} aria-valuetext={clock(quiet % 24)}
            onChange={e => { const v = Number(e.target.value); put({ quiet: Math.max(v, stop) }) }} />
        </div>
      </div>
      <p className="wz-note">Deep work opens at {clock(start)} and meetings start from {clock(start + 1)}. Nothing is sent to you during quiet hours, until {quietEnd}.</p>
    </>
  )
}
