import type { ReactNode } from 'react'

const PHOTO = `${import.meta.env.BASE_URL}wizard/desk.jpg`

/** Dust in the light, as percent of the stage: left, top, delay, duration. */
const MOTES: Array<[number, number, number, number]> = [[70, 62, 0, 11], [78, 70, 2.4, 13], [86, 64, 5, 11], [92, 72, 7.5, 14], [96, 60, 9, 12]]

/**
 * The morning: one photograph with a little life on it — steam from the cup,
 * the window's light breathing, dust drifting up through it. Transform and
 * opacity only, so nothing repaints. (A video was tried: the canvas this was
 * designed in would not play one. The app could, but a still photograph that
 * moves in CSS is one asset of 71 KB and works everywhere.)
 */
export function Desk({ children }: { children: ReactNode }) {
  return (
    <div className="wz-stage" style={{ backgroundImage: `url(${PHOTO})` }} aria-hidden="true">
      <div className="wz-sun" />
      {MOTES.map(([l, t, d, dur], i) => (
        <span key={i} className="wz-mote" style={{ left: `${l}%`, top: `${t}%`, animationDelay: `${d}s`, animationDuration: `${dur}s` }} />
      ))}
      <span className="wz-steam" />
      <span className="wz-steam" style={{ animationDelay: '2.7s', left: '36.6%', width: '4.4%' }} />
      <span className="wz-steam" style={{ animationDelay: '5.3s', left: '34.4%', width: '4.8%' }} />
      {children}
    </div>
  )
}
