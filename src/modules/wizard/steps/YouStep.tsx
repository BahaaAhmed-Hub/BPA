import { THEMES, applyAppearance } from '@/lib/themes'
import type { StepCtx } from './types'

/** Your name, and the look the app wears. Both show on the laptop at once. */
export function YouStep({ w, set }: StepCtx) {
  return (
    <>
      <div>
        <label htmlFor="wz-name" className="wz-lab">What should we call you</label>
        <input id="wz-name" className="wz-field" value={w.name} maxLength={60} autoComplete="given-name" placeholder="Your name"
          onChange={e => set({ name: e.target.value })} />
      </div>
      <div>
        <span className="wz-lab" id="wz-look">Look</span>
        <div className="wz-chips" role="group" aria-labelledby="wz-look">
          {THEMES.map(t => (
            <button key={t.id} type="button" className="wz-theme" aria-pressed={w.themeId === t.id}
              // Applied to the page at once so the laptop and everything around it wear it; it is only SAVED when the step is left.
              onClick={() => { applyAppearance({ themeId: t.id }); set({ themeId: t.id }) }}>
              <i style={{ background: t.tokens['--sb-page'], borderColor: t.tokens['--sb-accent'] }} />
              {t.name}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
