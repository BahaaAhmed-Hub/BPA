import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initAppearance } from './lib/themes'
import { bookingRequest } from './lib/booking'
import { PublicBooking } from './modules/booking/PublicBooking'

// The theme, the accent, the behavioural mode and the density are one set of
// values written once, before React renders, so there is no flash of a theme
// nobody chose. `initAppearance` also subscribes to the three things that can
// move them afterwards.
initAppearance()

// Say which build this is, once, where a browser console can be asked. The
// same string is in Settings for a device that has no console.
console.info(`BPA build ${__BUILD_SHA__} · ${__BUILD_AT__}`)
Object.assign(window, { __BPA_BUILD__: { sha: __BUILD_SHA__, at: __BUILD_AT__ } })

// ─── A stranger booking a time never mounts the app ─────────────────────────
//
// The branch is here rather than inside App, and that is the whole point:
// React runs every hook before the first `return`, so a check next to the
// sign-in gate would already have fired the auth listener, `hydrate()` and
// every store load — a pile of RLS-denied reads on behalf of somebody who has
// no account. `?book=` is the only deep link that survives a hard load, since
// there is no router and GitHub Pages has no SPA fallback.
const booking = bookingRequest()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {booking ? <PublicBooking {...booking} /> : <App />}
  </StrictMode>,
)
