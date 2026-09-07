import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { getTheme, applyThemeVars, DEFAULT_THEME_ID } from './lib/themes'
import { applyAccent, applyCompact } from './lib/accent'

// Apply the persisted theme before React renders to prevent any flash of wrong colors.
// Zustand's persist stores state as { state: { ... }, version: 0 } in localStorage.
try {
  const raw = localStorage.getItem('professor-ui')
  const themeId = raw ? (JSON.parse(raw)?.state?.themeId ?? DEFAULT_THEME_ID) : DEFAULT_THEME_ID
  applyThemeVars(getTheme(themeId))
} catch { /* ignore parse errors */ }

// The accent and the density, before the first paint for the same reason.
applyAccent()
applyCompact()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
