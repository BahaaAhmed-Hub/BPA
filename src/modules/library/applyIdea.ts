// ─── "Apply this idea" — a line from a book becomes a task ───────────────────
// A suggestion that stays on the Explain card is a good intention; the thing it
// was for is a to-do the person will actually see. Used for an Explain
// suggestion and for a note of your own.
//
// **Placed, not dumped.** Asking for it is deciding about it, so it goes through
// `placementForNew` like every task made on purpose (New task, a column's
// + Add) — a task filed under the brain dump is the gesture being ignored.
// **No `links` entry**: the task detail panel draws every link as a URL, and a
// book is not one; where it came from is the description's first line.
// **Once is once.** A made idea is remembered against its source, so the button
// says "Task made" instead of inviting a second copy (the mail row's receipt).
import { useSyncExternalStore } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { placementForNew } from '@/modules/tasks/BrainDumpRail'
import { notify } from '@/lib/undo'

const KEY = 'library-idea-tasks'
const EVENT = 'library:ideaTasks'

const read = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] } catch { return [] } }
let cache = read()
const subscribe = (cb: () => void) => {
  const on = () => { cache = read(); cb() }
  window.addEventListener(EVENT, on); window.addEventListener('storage', on)
  return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on) }
}

/** What identifies a made idea: where it came from and the words. Editing the
 *  words makes it a different idea, which is the right answer. */
export const ideaKey = (sourceId: string, title: string): string => `${sourceId}|${title.trim()}`

export function useIdeaMade(key: string): boolean {
  return useSyncExternalStore(subscribe, () => cache.includes(key), () => false)
}

export interface IdeaSource { bookTitle: string; place?: string | null; quote?: string | null }

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/** The task a line of text makes — pure, so the shape can be tested. */
export function ideaTask(text: string, src: IdeaSource) {
  const first = text.trim().split('\n')[0] ?? ''
  const rest = text.trim().split('\n').slice(1).join('\n').trim()
  const from = `From “${src.bookTitle}”${src.place ? ` · ${src.place}` : ''}`
  return {
    title: clip(first, 140),
    description: [from, src.quote ? `“${clip(src.quote.trim(), 300)}”` : '', rest].filter(Boolean).join('\n\n'),
    quadrant: placementForNew({}),
    company: 'personal' as const,
    status: 'open' as const,
    completed: false,
  }
}

/** Makes the task and remembers it. Returns false when it was already made. */
export function applyIdea(sourceId: string, text: string, src: IdeaSource): boolean {
  const key = ideaKey(sourceId, text)
  if (!text.trim() || cache.includes(key)) return false
  useTaskStore.getState().addTask(ideaTask(text, src))
  try { localStorage.setItem(KEY, JSON.stringify([...cache, key].slice(-500))) } catch { /* private window: it can be made twice, not lost */ }
  cache = read()
  window.dispatchEvent(new Event(EVENT))
  notify(`Task added: ${clip(text.trim().split('\n')[0], 60)}`)
  return true
}
