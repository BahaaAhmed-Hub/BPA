import { CopyCheck } from 'lucide-react'
import { duplicateNote, type DuplicateScope } from '../duplicates'

/** The one way this module says "check this one". Amber, never red: it is a
 *  question, not a verdict. */
export function DuplicateMark({ scope, size = 13 }: { scope?: DuplicateScope; size?: number }) {
  if (!scope) return null
  return (
    <span
      title={duplicateNote(scope)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, borderRadius: 999, padding: 2,
        background: scope === 'day' ? '#FBEBC8' : 'transparent',
        color: scope === 'day' ? '#8A6D0B' : '#C0A24E',
      }}>
      <CopyCheck size={size} strokeWidth={2} />
    </span>
  )
}
