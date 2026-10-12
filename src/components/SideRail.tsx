// ─── The rail — the main menu, and the company you are looking at ───────────
//
// Two floating pills down the left edge: the modules, then the companies you
// are part of. They are deliberately **two** objects rather than one list with
// a rule between them, because they answer different questions — *what am I
// looking at* and *whose is it* — and the second changes what the first shows
// without changing which one is open.
//
// Why it moved off the top: seven labelled pills, a search box, a bell and an
// avatar never fitted one row, which is why the old header already collapsed
// its labels under 1000px and still had them covered by the search box on the
// way down. A column has as much room as the window is tall, and the width it
// costs is the width labels were costing anyway.
//
// - **The active module is a solid dark pill**, not the accent. That is the
//   Sunlit Bento rule the nav already followed and the mock draws the same
//   thing: an accent-filled nav item competes with every accent on the page
//   that actually means something.
// - **A company tile is its colour and its initials.** There is no logo on a
//   company — `DynamicCompany` carries `name`, `color`, a domain, an account
//   and a calendar, and nothing else — so drawing one would mean inventing it.
//   The colour is already that company's identity on every chip, dot and
//   calendar in the app, so the tile is the same identity at a bigger size.
// - **The chosen tile is ringed, never merely tinted.** It is the only thing
//   on screen saying why three-quarters of the page has gone quiet, so it has
//   to read as *on* from across the room. Pressing it again clears the lens,
//   and `All` is there as the plain way out.
// - **It is drawn even with one company, and never when there are none.** A
//   rail of one tile is a filter you can see; a rail of none is furniture.

import { useEffect, useRef, useState } from 'react'
import { Bell as _Bell } from 'lucide-react'
import { loadDynamicCompanies, type DynamicCompany } from '@/types'
import { useCompanyFocus } from '@/lib/companyFocus'
import { inkOn } from '@/lib/ink'

void _Bell

/** Up to two letters, the way every company chip in the app already shortens. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** **The rail has no surface of its own.** It was two white cards with a
 *  border and a frame shadow, which made the menu a thing sitting *on* the
 *  app rather than part of it — and beside a module that no longer draws its
 *  own slab, the only boxed objects left on screen would have been the nav.
 *  Everything shares one ground: the icons, the active pill and the company
 *  circles float on it, and the two groups are separated by the gap between
 *  them rather than by two frames. */
const PILL: React.CSSProperties = {
  background: 'transparent',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '2px 0',
}

function RailButton({ active, label, onClick, children }: {
  active?: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      style={{
        width: 44, height: 42, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--sb-r-nav)',
        border: 'none', cursor: 'pointer',
        background: active ? 'var(--sb-ink-1)' : 'transparent',
        color: active ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
        transition: 'background 0.12s, color 0.12s',
      }}>
      {children}
    </button>
  )
}

/** One company, as a tile. */
function CompanyTile({ co, chosen, onPick }: {
  co: DynamicCompany
  chosen: boolean
  onPick: () => void
}) {
  // The fill is the company's own colour, so the ink on it is measured rather
  // than declared — a dozen hues cannot share one fixed foreground.
  const ink = inkOn(co.color)
  return (
    <button
      onClick={onPick}
      title={chosen ? `Showing ${co.name} only — press again for everything` : `Show only ${co.name}`}
      aria-label={chosen ? `${co.name}, the only one shown. Press to show everything.` : `Show only ${co.name}`}
      aria-pressed={chosen}
      data-company-tile={co.id}
      style={{
        width: 42, height: 42, flexShrink: 0, padding: 0, cursor: 'pointer',
        // A logo is a circle. A rounded square beside a column of round
        // glyphs reads as a different kind of object; these are faces of a
        // sort, and a face is round here as it is in every avatar in the app.
        borderRadius: '50%',
        background: co.color,
        color: ink,
        fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: 700,
        letterSpacing: '0.02em',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // Ringed, not tinted: this is the only thing on screen that explains
        // why the rest of the page has gone quiet. The ring is drawn *outside*
        // the circle with a gap of the page's own colour, so it reads as a
        // halo rather than eating into the colour that identifies the company.
        border: 'none',
        boxShadow: chosen
          ? '0 0 0 2px var(--sb-page), 0 0 0 4px var(--sb-accent-deep)'
          : 'inset 0 0 0 1px color-mix(in srgb, var(--sb-ink-1) 10%, transparent)',
        transition: 'transform 0.12s',
        transform: chosen ? 'none' : 'scale(0.9)',
      }}>
      {initialsOf(co.name)}
    </button>
  )
}

export function SideRail({ items, activeModule, onPick, footer }: {
  items: { id: string; label: string; icon: React.ReactNode }[]
  activeModule: string
  onPick: (id: string) => void
  /** The bell and the avatar menu, which belong to *you* rather than to a
   *  module — kept at the foot of the rail, where the mock puts its own
   *  settings and help. Passed in so the rail owns no account state. */
  footer?: React.ReactNode
}) {
  const [lens, setLens] = useCompanyFocus()
  const [companies, setCompanies] = useState<DynamicCompany[]>(() =>
    loadDynamicCompanies().filter(c => !c.hidden))

  // Companies are edited in Settings and arrive from the server on load, so
  // the rail listens rather than reading once at mount.
  useEffect(() => {
    const read = () => setCompanies(loadDynamicCompanies().filter(c => !c.hidden))
    window.addEventListener('professor:companiesUpdated', read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener('professor:companiesUpdated', read)
      window.removeEventListener('storage', read)
    }
  }, [])

  // A lens pointing at a company that is gone (deleted, or hidden in Settings)
  // would dim the whole app with no tile to press to get out of it.
  const railRef = useRef(setLens)
  railRef.current = setLens
  useEffect(() => {
    if (lens && !companies.some(c => c.id === lens)) railRef.current(null)
  }, [lens, companies])

  return (
    <nav aria-label="Main" data-side-rail style={{
      flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 14, padding: '14px 12px', height: '100%', overflowY: 'auto',
    }}>
      <div style={PILL}>
        {items.map(item => (
          <RailButton
            key={item.id}
            active={activeModule === item.id}
            label={item.label}
            onClick={() => onPick(item.id)}>
            {item.icon}
          </RailButton>
        ))}
        {footer && (
          <>
            <span aria-hidden style={{
              width: 22, height: 0, margin: '4px 0',
              borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
            }} />
            {footer}
          </>
        )}
      </div>

      {companies.length > 0 && (
        <div data-company-rail style={{ ...PILL, gap: 9, padding: '4px 0' }}>
          {companies.map(co => (
            <CompanyTile
              key={co.id}
              co={co}
              chosen={lens === co.id}
              onPick={() => setLens(lens === co.id ? null : co.id)} />
          ))}
          {/* The plain way out. Drawn only while a lens is on: a permanent
              "All" beside nothing is a control for a state you are in. */}
          {lens && (
            <button
              onClick={() => setLens(null)}
              title="Show everything again"
              aria-label="Show everything again"
              style={{
                width: 42, height: 26, flexShrink: 0, marginTop: 2, cursor: 'pointer',
                borderRadius: 'var(--sb-r-pill)', border: 'none',
                background: 'color-mix(in srgb, var(--sb-ink-1) 8%, transparent)', color: 'var(--sb-ink-2)',
                fontFamily: 'inherit', fontSize: 'var(--sb-t-micro)', fontWeight: 700,
                letterSpacing: '0.06em',
              }}>
              ALL
            </button>
          )}
        </div>
      )}
    </nav>
  )
}
