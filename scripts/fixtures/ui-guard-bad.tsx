// Fixture for `node scripts/ui-guard.mjs --self-test` — NOT part of the app
// (it lives outside src/ and tsconfig). One violation per rule; each is marked
// by the comment above it. `allow:` lines must come back clean.
export const Bad = () => (
  <div>
    {/* expect: type */}
    <span style={{ fontSize: 10.5 }}>small</span>
    {/* expect: ink */}
    <span style={{ color: 'var(--sb-ink-4)' }}>faint</span>
    {/* allow: ink */}
    <span style={{ color: 'var(--sb-ink-4)' /* ui-guard: ink-ok */ }}>placeholder</span>
    {/* expect: hex */}
    <span style={{ background: '#E74C3C' }}>red</span>
    {/* allow: hex */}
    <span style={{ background: '#7F77DD' /* ui-guard: user-colour */ }}>mine</span>
    {/* expect: emoji */}
    <p>On fire! 🔥</p>
    {/* expect: dialog */}
    <button onClick={() => window.confirm('Sure?')}>x</button>
    {/* expect: unfinished */}
    <p>Team seats (coming soon)</p>
    {/* expect: loading */}
    <p>Loading…</p>
  </div>
)

// expect: palette
const C = { ink: '#000' }

// expect: quadrant
const Q = [{ v: 'do', color: 'red' }]

// allow: emoji
const EMOJIS = ['🏃', '💪']

// expect: type
const t = { fontSize: tight ? 11.5 : 12.5 }
// allow: type
const r = { fontSize: size * 0.5 }
