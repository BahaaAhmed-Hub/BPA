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
import { loadDynamicCompanies, type DynamicCompany } from '@/types'
import { useCompanyFocus } from '@/lib/companyFocus'
import { useInkOnKeeping } from '@/lib/ink'

/** Up to two letters, the way every company chip in the app already shortens. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** **Two lozenges floating on the page's own ground.**
 *
 *  They *are* surfaces — that was the point of the design and taking it away
 *  made the rail disappear into the background rather than float on it. What
 *  had to go was the tinted box around the *module* (`--sb-cal-ground`),
 *  which is what left the menu stranded beside a slab. With one continuous
 *  ground behind everything, two white lozenges read as floating; against a
 *  box they read as the one thing left outside it.
 *
 *  `--sb-overlay`, not `--sb-card`: this is drawn over the page rather than
 *  being a card *on* it, and overlay is the one surface token that is opaque
 *  in every theme — Glass's card is a 5% wash that would leave the rail
 *  see-through against its own dark page.
 *
 *  Fully round ends (`borderRadius: 999`), so the shape is a lozenge rather
 *  than a rounded rectangle: at this width the two read quite differently. */
const PILL: React.CSSProperties = {
  background: 'var(--sb-overlay)',
  border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-ink-1) 7%, transparent)',
  borderRadius: 999,
  boxShadow: '0 2px 10px -4px rgba(25, 23, 18, .16), 0 10px 30px -18px rgba(25, 23, 18, .22)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 5,
  padding: '11px 9px',
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
        width: 42, height: 40, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // The active module is a solid dark square with its own corner — the
        // one thing in the rail that is a shape rather than a glyph.
        borderRadius: 13,
        border: 'none', cursor: 'pointer',
        background: active ? 'var(--sb-ink-1)' : 'transparent',
        color: active ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-2)',
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
  // **The disc carries the colour; the mark carries the letters.**
  //
  // Putting the company's colour in the *glyph* on a white disc was measured
  // and it failed its own purpose: `#3B82F6` on white is about 3.1:1, so
  // `inkOnKeeping` fell back to `--sb-ink-1` and Teradix's mark came out
  // `rgb(20,18,14)` — the same near-black as a company with no usable colour
  // at all. Two of three discs then looked identical, which is the one thing
  // a company tile must never do. A white disc is also a 5% wash in Glass,
  // where `--sb-card` is translucent, so there was barely a disc there.
  //
  // So the disc is a tint of the company's own colour mixed into
  // `--sb-overlay` (opaque in every theme), and the letters are the theme's
  // ink measured against that tint — the same pairing the app already uses
  // for `--sb-ink-4` on `--sb-accent-tint`. Identity in the ground, legibility
  // in the ink, and neither is asked to do the other's job.
  const keeping = useInkOnKeeping()
  const disc = `color-mix(in srgb, ${co.color} 20%, var(--sb-overlay))`
  const mark = keeping('var(--sb-ink-1)', disc, 4.5)
  return (
    <button
      onClick={onPick}
      title={chosen ? `Showing ${co.name} only — press again for everything` : `Show only ${co.name}`}
      aria-label={chosen ? `${co.name}, the only one shown. Press to show everything.` : `Show only ${co.name}`}
      aria-pressed={chosen}
      data-company-tile={co.id}
      style={{
        width: 40, height: 40, flexShrink: 0, padding: 0, cursor: 'pointer',
        // A logo is a circle, and the circle is a **light disc holding the
        // company's mark** rather than a solid block of its colour. A column
        // of saturated discs is five competing fills beside a column of quiet
        // glyphs; the rim and the ground are the same in every row, so what
        // differs between them is only the thing that identifies them.
        borderRadius: '50%',
        background: disc,
        color: mark,
        fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800,
        letterSpacing: '-0.01em',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // Chosen: the company's own colour as a ring, with a gap of the disc's
        // ground so it reads as a halo. This is the only thing on screen that
        // explains why the rest of the page has gone quiet.
        border: 'none',
        boxShadow: chosen
          ? `0 0 0 2px var(--sb-overlay), 0 0 0 4px ${co.color}`
          : `inset 0 0 0 1px color-mix(in srgb, ${co.color} 38%, transparent)`,
        transition: 'transform 0.12s',
        transform: chosen ? 'none' : 'scale(0.95)',
      }}>
      {initialsOf(co.name)}
    </button>
  )
}

// **The rail holds modules and companies, and nothing of yours.** The bell,
// the avatar and search sat at its foot for a while; they are *you*, not a
// place to go, and they belong in the content column's own top-right corner
// where every app of this shape puts them — which is also where the person
// asked for them back. So the rail takes no footer: a prop nothing passes is
// a second design still in the file.
export function SideRail({ items, activeModule, onPick }: {
  items: { id: string; label: string; icon: React.ReactNode }[]
  activeModule: string
  onPick: (id: string) => void
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
      // **Centred down the window**, not stacked from the top: two lozenges
      // of fixed height pinned to the top edge sit against the window's
      // corner, which is the one place nothing else is. Centred they read as
      // floating beside the page rather than hanging off it. `auto` margins
      // rather than `justify-content`, so a rail taller than the window
      // still scrolls to both ends instead of clipping its first group.
      flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 13, padding: '16px 14px', height: '100%', overflowY: 'auto',
    }}>
      <div style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 13 }}>
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
      </div>

      {companies.length > 0 && (
        <div data-company-rail style={{ ...PILL, gap: 8 }}>
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
                width: 40, height: 24, flexShrink: 0, marginTop: 1, cursor: 'pointer',
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
      </div>
    </nav>
  )
}
