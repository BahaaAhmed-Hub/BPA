import { Settings } from './Settings'

export function SettingsModule() {
  return (
    // No bottom padding: Settings fills the window exactly and scrolls inside
    // its own panel, so any spare pixels here would make the whole page scroll.
    <div>
      <Settings />
    </div>
  )
}
