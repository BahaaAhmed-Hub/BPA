// ─── What every box in the outcome window shares ─────────────────────────────
//
// One shell for every kind, so the five boxes open, close and read the same,
// and the small pieces they all draw — a pill, a field, a caption — are one
// definition rather than five copies that drift.

import { ChevronDown, ChevronUp } from 'lucide-react'
import { ICON } from '@/lib/type'

/** The meeting this is about. Only what the question needs. */
export interface OutcomeEvent {
  id: string
  title: string
  /** "Tue 7 Oct · 14:00 – 15:00", for the header. */
  when?: string
  calendarId?: string
  htmlLink?: string
  /** The day it was on, YYYY-MM-DD — what an expense or a habit day is filed under. */
  date?: string
  /** The event's own description — what "Read my notes" reads first. */
  notes?: string
}


export const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const fromYmd = (s: string) => new Date(`${s}T12:00:00`)


export const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'


export const EYEBROW: React.CSSProperties = {
  margin: 0, fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em',
  color: 'var(--sb-ink-3)', textTransform: 'uppercase',
}

export const FIELD: React.CSSProperties = {
  background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-sm)', color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)',
  padding: '0 12px', height: 44, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}

/** A pill-shaped control. `on` is the chosen one in a row of choices. */
export function chip(on = false, dashed = false): React.CSSProperties {
  return {
    height: 36, padding: '0 12px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', fontWeight: 600,
    background: on ? 'var(--sb-ink-1)' : dashed ? 'transparent' : 'var(--sb-card)',
    color: on ? 'var(--sb-card)' : 'var(--sb-ink-2)',
    border: on ? 'none' : `var(--sb-border-width) ${dashed ? 'dashed' : 'solid'} var(--sb-border)`,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  }
}


// ─── A box ───────────────────────────────────────────────────────────────────
//
// One shell for every kind, so the five boxes open, close and read the same.
// Open, it takes the kind's own colour on its border and header; closed, it is
// a line saying what is in it.

export function OutcomeBox({ id, icon, title, summary, open, onToggle, tint, children }: {
  id: string
  icon: React.ReactNode
  title: string
  summary: string
  open: boolean
  onToggle: () => void
  /** The kind's colour — the border when open, the icon tile always. */
  tint: string
  children: React.ReactNode
}) {
  return (
    <section
      data-outcome-box={id}
      data-open={open ? '1' : '0'}
      style={{
        flexShrink: 0, overflow: 'hidden', background: 'var(--sb-card)',
        borderRadius: 'var(--sb-r-card)',
        border: open ? `1.5px solid ${tint}` : 'var(--sb-border-width) solid var(--sb-border)',
      }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${title}: ${summary}`}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 60,
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', border: 'none',
          background: open ? `color-mix(in srgb, ${tint} 7%, var(--sb-card))` : 'var(--sb-card)',
          color: 'var(--sb-ink-1)',
        }}>
        <span style={{
          width: 34, height: 34, borderRadius: 'var(--sb-r-nav)', flexShrink: 0,
          background: `color-mix(in srgb, ${tint} 14%, var(--sb-card))`, color: tint,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 'var(--sb-t-body)', fontWeight: 700 }}>{title}</span>
          <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{summary}</span>
        </span>
        {open ? <ChevronUp size={ICON.md} color="var(--sb-ink-3)" /> : <ChevronDown size={ICON.md} color="var(--sb-ink-3)" />}
      </button>
      {open && <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>}
    </section>
  )
}

