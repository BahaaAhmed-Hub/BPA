import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** A bookcase never looks half-built: even one book stands in a case with room for more. */
export const MIN_BAYS = 3

/**
 * The width the case has inside its uprights, kept current as the window or an
 * iPad turns. Rows are packed from this, so it is measured, never assumed.
 */
export function useCaseWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

/** One shelf: what stands on it, and the board it stands on. */
export function Bay({ children, minHeight = 190 }: { children?: ReactNode; minHeight?: number }) {
  return (
    <div className="lib-bay">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: '0 20px', minHeight }}>{children}</div>
      <div className="lib-board" />
    </div>
  )
}

/** The frame — uprights, a top rail and a plinth — round however many bays it holds. */
export function Bookcase({ children, label, caseRef }: { children: ReactNode; label?: string; caseRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div className="lib-case">
      <div ref={caseRef} role={label ? 'group' : undefined} aria-label={label}>{children}</div>
    </div>
  )
}
