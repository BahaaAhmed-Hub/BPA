import type { CSSProperties } from 'react'

// ─── Skeleton ────────────────────────────────────────
// What a place looks like while its content is on its way: a bar in the field
// colour that breathes. It replaces the plain word "Loading…", which says the
// app is busy and nothing about what is coming. `data-skeleton` is the hook the
// render check reads. The pulse and its reduced-motion stop are CSS
// (`.sb-skeleton` in index.css), so nothing here animates in script.

export interface SkeletonProps {
  w?: number | string
  h?: number | string
  radius?: number | string
  style?: CSSProperties
  /** What is loading, for a screen reader. */
  label?: string
}

export function Skeleton({ w = '100%', h = 12, radius, style, label = 'Loading' }: SkeletonProps) {
  return (
    <span
      className="sb-skeleton"
      data-skeleton=""
      role="status"
      aria-label={label}
      style={{ display: 'block', width: w, height: h, ...(radius !== undefined ? { borderRadius: radius } : {}), ...style }}
    />
  )
}

/** A short paragraph's worth of bars, the last one shorter. */
export function SkeletonLines({ lines = 3, gap = 8, h = 12, label }: { lines?: number; gap?: number; h?: number; label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }} aria-busy="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} h={h} w={i === lines - 1 && lines > 1 ? '60%' : '100%'} label={i === 0 ? label : undefined} />
      ))}
    </div>
  )
}
