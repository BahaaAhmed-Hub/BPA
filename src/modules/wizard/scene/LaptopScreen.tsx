import type { ReactNode } from 'react'

/**
 * The laptop's screen in the photograph: a 560 x 336 picture of the app,
 * scaled to fit whatever size the photo is drawn at. An SVG `foreignObject`
 * does the scaling, which a CSS transform cannot do from a percentage box
 * without knowing its pixel width. The app's theme tokens reach inside it, so
 * the screen wears the look the person has just chosen.
 */
export function LaptopScreen({ module, rail, children }: { module: string; rail: number; children: ReactNode }) {
  return (
    <div className="wz-scr" data-wz-screen={module}>
      <svg viewBox="0 0 560 336" preserveAspectRatio="none" aria-hidden="true">
        <foreignObject x="0" y="0" width="560" height="336">
          <div className="wz-mac">
            <div className="wz-mac-bar">
              <i /><i /><i />
              <b>Professor · {module}</b>
              <span className="wz-live">LIVE<i /></span>
            </div>
            <div className="wz-mac-body">
              <div className="wz-mac-rail">
                {[0, 1, 2, 3, 4].map(i => <i key={i} data-on={i === rail ? '' : undefined} />)}
              </div>
              <div className="wz-mac-main">{children}</div>
            </div>
          </div>
        </foreignObject>
      </svg>
      <span className="wz-glare" />
    </div>
  )
}
