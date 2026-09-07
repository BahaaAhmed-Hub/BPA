import { CopyCheck } from 'lucide-react'
import { duplicateNote, type DuplicateScope } from '../duplicates'
import { STROKE } from '@/lib/type'

/** The one way this module says "check this one". Amber, never red: it is a
 *  question, not a verdict. */
export function DuplicateMark({ scope, size = 13 }: { scope?: DuplicateScope; size?: number }) {
  if (!scope) return null
  return (
    <span
      title={duplicateNote(scope)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, borderRadius: 'var(--sb-r-pill)', padding: 2,
        background: scope === 'day' ? 'var(--sb-accent-tint)' : 'transparent',
        color: scope === 'day' ? 'var(--sb-accent-deep)' : 'var(--sb-warning)',
      }}>
      <CopyCheck size={size} strokeWidth={STROKE.rest} />
    </span>
  )
}
