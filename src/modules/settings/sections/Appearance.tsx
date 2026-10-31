import { useState } from 'react'
import { Check } from 'lucide-react'
import { ACCENTS, loadAccent, saveAccent } from '@/lib/accent'
import { useUIStore } from '@/store/uiStore'
import { THEMES, resolveThemeId, applyAppearance } from '@/lib/themes'
import { ICON, STROKE } from '@/lib/type'
import { type AppSettings } from '../model'
import { Block } from '../ui'

// NotificationsSection merged into NotificationsMatrixSection (Push/Mail/Digest per event)
// Legacy reminder fields (morning brief time, wind-down) are now in the AI / Schedule sections.

export function AppearanceSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const { setThemeId } = useUIStore()
  const [accent, setAccent] = useState(() => loadAccent())

  function pickTheme(id: string) {
    set({ theme: id })
    setThemeId(id)
    applyAppearance({ themeId: id })
  }

  function pickAccent(id: string) {
    setAccent(id)
    saveAccent(id)          // written and announced; lib/themes.ts applies it
  }

  return (
    <div>
      {/* ── Accent ───────────────────────────────────────────────────────────
          The one colour the whole app shares: every chip, bar, highlight and
          today-marker is drawn in it. It changes as you click. */}
      <Block title="Accent" sub="Every highlight in the app — chips, bars, the ring on today.">
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', padding: '12px 0' }}>
          {/* "None" is the default and it is not a colour: it means the theme's
              own accent, which is the one its surfaces and tints were built
              around. Picking one of the six overrides it everywhere. */}
          <button onClick={() => pickAccent('')} title="The theme's own accent"
            aria-pressed={accent === ''}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px 0 10px',
              borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', fontFamily: 'inherit',
              background: accent === '' ? 'var(--sb-card)' : 'var(--sb-field)',
              border: `var(--sb-border-width) solid ${accent === '' ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
              boxShadow: accent === '' ? 'var(--sb-shadow-control)' : 'none',
              color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', fontWeight: accent === '' ? 600 : 500,
            }}>
            <span style={{
              width: 18, height: 18, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
              background: 'var(--sb-accent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-ink-1) 12.0%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {accent === '' && <Check size={ICON.sm} strokeWidth={STROKE.active} color="var(--sb-accent-ink)" />}
            </span>
            Theme's own
          </button>
          {ACCENTS.map(a => {
            const on = accent === a.id
            return (
              <button key={a.id} onClick={() => pickAccent(a.id)} title={a.name}
                aria-pressed={on}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px 0 10px',
                  borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', fontFamily: 'inherit',
                  background: on ? 'var(--sb-card)' : 'var(--sb-field)',
                  border: `var(--sb-border-width) solid ${on ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
                  boxShadow: on ? '0 1px 3px color-mix(in srgb, var(--sb-ink-1) 16.0%, transparent)' : 'none',
                  color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', fontWeight: on ? 600 : 500,
                }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
                  background: a.hex, border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-ink-1) 12.0%, transparent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {on && <Check size={ICON.sm} strokeWidth={STROKE.active} color="var(--sb-ink-1)" />}
                </span>
                {a.name}
              </button>
            )
          })}
        </div>
      </Block>

      {/* ── Theme ────────────────────────────────────────────────────────────
          Each tile is the theme itself: its page behind, its card on top, its
          ink as the two lines of text a card actually holds, and its accent as
          the mark on it — drawn from the same tokens the app will be drawn
          from, so what you see is what you get rather than an artist's
          impression of it. The name is set in the theme's own display face,
          which is the other half of what changes. */}
      <Block title="Theme" sub="Surfaces, ink, accent and typeface, for the whole app.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, padding: '12px 0' }}>
          {THEMES.map(t => {
            const active = resolveThemeId(s.theme) === t.id
            const tk = t.tokens
            return (
              <button key={t.id} onClick={() => pickTheme(t.id)} aria-pressed={active}
                style={{
                  padding: 0, cursor: 'pointer', textAlign: 'left', overflow: 'hidden',
                  borderRadius: 'var(--sb-r-nav)', background: tk['--sb-page'],
                  border: `var(--sb-border-emphasis) solid ${active ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
                  boxShadow: active ? 'var(--sb-shadow-control)' : 'none',
                  fontFamily: 'inherit',
                }}>
                {/* The card, on the page, with what a card holds. */}
                <div style={{ padding: 11 }}>
                  <div style={{
                    background: tk['--sb-card'], border: `var(--sb-border-width) solid ${tk['--sb-border']}`,
                    borderRadius: 'var(--sb-r-chip)', padding: 9,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <span style={{ display: 'block', height: 6, width: '78%', borderRadius: 'var(--sb-r-pill)', background: tk['--sb-ink-1'] }} />
                      <span style={{ display: 'block', height: 5, width: '52%', borderRadius: 'var(--sb-r-pill)', background: tk['--sb-ink-3'] }} />
                    </div>
                    <span style={{
                      flexShrink: 0, height: 20, padding: '0 8px', borderRadius: 'var(--sb-r-pill)',
                      background: tk['--sb-accent'], color: tk['--sb-accent-ink'],
                      display: 'inline-flex', alignItems: 'center',
                      fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.08em',
                      fontFamily: tk['--sb-font-ui'],
                    }}>AA</span>
                  </div>
                </div>
                {/* The name, in the face the theme speaks in. */}
                <div style={{
                  padding: '0 12px 11px', display: 'flex', alignItems: 'center', gap: 6,
                  color: tk['--sb-ink-1'], fontFamily: tk['--sb-font-num'],
                  fontSize: 'var(--sb-t-body)', fontWeight: 600, letterSpacing: '-0.01em',
                }}>
                  {t.name}
                  {active && <Check size={ICON.sm} strokeWidth={STROKE.active} color={tk['--sb-ink-1']} />}
                </div>
              </button>
            )
          })}
        </div>
      </Block>
    </div>
  )
}
