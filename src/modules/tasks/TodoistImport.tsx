import { useState } from 'react'
import { Button } from '@/components/ui'
import { useTaskStore } from '@/store/taskStore'
import { TODOIST_CONFIGURED, openTodoistAuth, fetchTodoistTasks } from '@/lib/todoistOAuth'

interface Item { id: string; content: string; due?: string }

const DISMISSED = 'tasks-todoist-prompt-dismissed'
const seen = () => { try { return localStorage.getItem(DISMISSED) === '1' } catch { return false } }

/**
 * The Tasks screen's first-run prompt: bring tasks across from Todoist. It
 * replaces the setup wizard's import step. Drawn only when this build can reach
 * Todoist (`TODOIST_CONFIGURED`), only while the board is empty, and until it is
 * dismissed — a tile for a service that is not there would only be noise.
 */
export function TodoistImport({ empty }: { empty: boolean }) {
  const addTask = useTaskStore(s => s.addTask)
  const [gone, setGone] = useState(seen)
  const [items, setItems] = useState<Item[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!TODOIST_CONFIGURED || !empty || gone) return null

  function dismiss() {
    try { localStorage.setItem(DISMISSED, '1') } catch { /* private window */ }
    setGone(true)
  }
  async function connect() {
    setBusy(true); setError(null)
    try {
      const token = await openTodoistAuth()
      const tasks = await fetchTodoistTasks(token)
      const next = tasks.slice(0, 100).map(t => ({ id: t.id, content: t.content, due: t.due?.date }))
      setItems(next); setPicked(new Set(next.map(t => t.id)))
    } catch (e) {
      if (!(e instanceof Error && e.message === 'Closed')) setError('Could not reach Todoist. Try again.')
    } finally { setBusy(false) }
  }
  function toggle(id: string) {
    setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function importPicked() {
    for (const t of items) {
      if (picked.has(t.id)) addTask({ title: t.content, quadrant: null, company: 'personal', status: 'open', completed: false, source: 'todoist' } as Parameters<typeof addTask>[0])
    }
    dismiss()
  }

  return (
    <div data-todoist-import style={{ margin: '0 28px 12px', padding: '14px 16px', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--sb-t-label)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>Bring your tasks from Todoist</div>
          <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>They land in your Inbox for you to prioritise.</div>
        </div>
        {items.length === 0 && <Button variant="primary" disabled={busy} onClick={() => void connect()}>{busy ? 'Connecting…' : 'Connect Todoist'}</Button>}
        <button type="button" onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)' }}>Not now</button>
      </div>
      {error && <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{error}</div>}
      {items.length > 0 && (
        <>
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {items.map(t => (
              <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-field)', cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} style={{ accentColor: 'var(--sb-accent)' }} />
                <span style={{ flex: 1, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.content}</span>
                {t.due && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{t.due}</span>}
              </label>
            ))}
          </div>
          <div><Button variant="primary" disabled={picked.size === 0} onClick={importPicked}>Import {picked.size} task{picked.size === 1 ? '' : 's'}</Button></div>
        </>
      )}
    </div>
  )
}
