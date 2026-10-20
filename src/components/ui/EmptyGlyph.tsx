import type { LucideIcon } from 'lucide-react'
import { STROKE } from '@/lib/type'

/** The mark above an empty state: a 24px line icon in an ink-3 circle. */
export function EmptyGlyph({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div aria-hidden style={{
      width: 56, height: 56, borderRadius: 'var(--sb-r-pill)', margin: '0 auto 12px',
      background: 'var(--sb-field)', color: 'var(--sb-ink-3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon size={24} strokeWidth={STROKE.rest} />
    </div>
  )
}
