import { Check, ListPlus } from 'lucide-react'
import { Button } from '@/components/ui'
import { ICON } from '@/lib/type'
import { applyIdea, ideaKey, useIdeaMade, type IdeaSource } from './applyIdea'

/** "Make this a task" — becomes a receipt once it has been done. */
export function IdeaButton({ sourceId, text, source }: { sourceId: string; text: string; source: IdeaSource }) {
  const made = useIdeaMade(ideaKey(sourceId, text))
  return (
    <Button size="sm" variant="ghost" iconOnly disabled={made} aria-label={made ? 'Task made' : `Make a task: ${text.slice(0, 60)}`}
      title={made ? 'Task made — it is on your board' : 'Make this a task'} onClick={() => applyIdea(sourceId, text, source)}>
      {made ? <Check size={ICON.sm} color="var(--sb-positive)" /> : <ListPlus size={ICON.sm} />}
    </Button>
  )
}
