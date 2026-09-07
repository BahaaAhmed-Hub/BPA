import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initAppearance } from './lib/themes'

// The theme, the accent, the behavioural mode and the density are one set of
// values written once, before React renders, so there is no flash of a theme
// nobody chose. `initAppearance` also subscribes to the three things that can
// move them afterwards.
initAppearance()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
