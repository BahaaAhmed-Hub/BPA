import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AdminApp from './AdminApp'
import './index.css'
import { initAppearance } from './lib/themes'

// The theme, the accent, the behavioural mode and the density are one set of
// values written once, before React renders, so there is no flash of a theme
// nobody chose. `initAppearance` also subscribes to the three things that can
// move them afterwards.
initAppearance()

// Say which build this is, once, where a browser console can be asked. The
// same string is in Settings for a device that has no console.
console.info(`BPA build ${__BUILD_SHA__} · ${__BUILD_AT__}`)
Object.assign(window, { __BPA_BUILD__: { sha: __BUILD_SHA__, at: __BUILD_AT__ } })

// Admin panel is at /#admin — hash-based so no server-side routing config needed on GitHub Pages
const isAdminRoute = window.location.hash === '#admin'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdminRoute ? <AdminApp /> : <App />}
  </StrictMode>,
)
