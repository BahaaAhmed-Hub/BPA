import { useState } from 'react'
import { Button } from '@/components/ui'
import { TODOIST_CONFIGURED, openTodoistAuth, fetchTodoistTasks } from '@/lib/todoistOAuth'
import type { TodoistTask } from '@/lib/todoistOAuth'

interface TodoistTaskItem { id: string; content: string; due?: string; priority: number }

interface Props {
  data: { todoistToken: string; importedTasks: TodoistTaskItem[]; selectedTaskIds: Set<string> }
  onChange: (p: { todoistToken?: string; importedTasks?: TodoistTaskItem[]; selectedTaskIds?: Set<string> }) => void
}

const PRIORITY_COLORS: Record<number, string> = { 4: 'var(--sb-negative)', 3: '#F97316', 2: '#60A5FA', 1: 'transparent' }

export function Step5Tasks({ data, onChange }: Props) {
  const [connecting, setConnecting] = useState(false)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [manualToken, setManualToken] = useState('')

  async function handleConnect() {
    setConnecting(true); setError(null)
    try {
      const token = await openTodoistAuth()
      await loadTasks(token)
    } catch (e: unknown) {
      if (e instanceof Error && e.message !== 'Closed') setError('Connection failed. Try again.')
    } finally { setConnecting(false) }
  }

  async function loadTasks(token: string) {
    setLoading(true); setError(null)
    try {
      const tasks: TodoistTask[] = await fetchTodoistTasks(token)
      const items: TodoistTaskItem[] = tasks.slice(0, 100).map(t => ({
        id: t.id, content: t.content, due: t.due?.date, priority: t.priority,
      }))
      onChange({ todoistToken: token, importedTasks: items, selectedTaskIds: new Set(items.map(t => t.id)) })
    } catch { setError('Failed to fetch tasks. Check your token.') }
    finally { setLoading(false) }
  }

  function toggleTask(id: string) {
    const s = new Set(data.selectedTaskIds)
    s.has(id) ? s.delete(id) : s.add(id)
    onChange({ selectedTaskIds: s })
  }

  function selectAll() { onChange({ selectedTaskIds: new Set(data.importedTasks.map(t => t.id)) }) }
  function deselectAll() { onChange({ selectedTaskIds: new Set() }) }

  const hasTasks = data.importedTasks.length > 0

  return (
    <div>
      <h2 style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-h2)', fontWeight: 800, color: 'var(--sb-ink-1)' }}>
        Import your tasks
      </h2>
      <p style={{ margin: '0 0 24px', fontSize: 'var(--sb-t-label)', color: 'var(--sb-ink-3)', lineHeight: 1.6 }}>
        Pull in existing tasks. All imports land in your Inbox for you to prioritize.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: hasTasks ? 24 : 0 }}>
        {/* Todoist tile */}
        <div style={{ flex: 1, padding: 20, borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-card)', border: '1px solid var(--sb-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--sb-r-chip)', background: '#DB4035', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 'var(--sb-t-h2)' }}>✓</div>
            <div>
              <div style={{ fontSize: 'var(--sb-t-label)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>Todoist</div>
              <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>Task manager</div>
            </div>
          </div>

          {!TODOIST_CONFIGURED && !data.todoistToken && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ padding: '8px 12px', borderRadius: 'var(--sb-r-chip)', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', marginBottom: 10 }}>
                <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: '#FBBF24' }}>
                  Set <code style={{ fontFamily: 'monospace' }}>VITE_TODOIST_CLIENT_ID</code> in .env to enable OAuth.
                </p>
              </div>
              <input
                value={manualToken}
                onChange={e => setManualToken(e.target.value)}
                placeholder="Paste API token to test..."
                style={{ background: 'var(--sb-page)', border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '8px 12px', color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', outline: 'none', width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
              />
              <Button variant="primary" onClick={() => manualToken.trim() && loadTasks(manualToken.trim())} disabled={!manualToken.trim() || loading} style={{ width: '100%' }}>
                {loading ? 'Loading…' : 'Load tasks →'}
              </Button>
            </div>
          )}

          {TODOIST_CONFIGURED && !data.todoistToken && !loading && (
            <button onClick={handleConnect} disabled={connecting} style={{ width: '100%', padding: '10px', borderRadius: 'var(--sb-r-chip)', background: '#DB4035', color: '#fff', fontSize: 'var(--sb-t-label)', fontWeight: 600, border: 'none', cursor: 'pointer', opacity: connecting ? 0.7 : 1 }}>
              {connecting ? 'Connecting…' : 'Connect Todoist'}
            </button>
          )}

          {loading && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--sb-ink-4)', fontSize: 'var(--sb-t-body)' }}>
              <div style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginRight: 8 }}>⟳</div>
              Fetching tasks…
            </div>
          )}

          {data.todoistToken && !loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 'var(--sb-r-pill)', background: '#1D9E75' }} />
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: '#1D9E75', fontWeight: 500 }}>Connected · {data.importedTasks.length} tasks found</span>
            </div>
          )}

          {error && <p style={{ margin: '8px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{error}</p>}
        </div>

        {/* Trello tile */}
        <div style={{ flex: 1, padding: 20, borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-card)', border: '1px solid var(--sb-border)', opacity: 0.6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--sb-r-chip)', background: '#0052CC', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 'var(--sb-t-h3)' }}>T</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 'var(--sb-t-label)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>Trello</span>
                <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, padding: '2px 7px', borderRadius: 'var(--sb-r-card)', background: 'rgba(251,191,36,0.12)', color: '#FBBF24', border: '1px solid rgba(251,191,36,0.25)' }}>Coming Soon</span>
              </div>
              <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>Project boards</div>
            </div>
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 'var(--sb-r-chip)', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)' }}>
            Trello integration is coming soon. Stay tuned!
          </div>
        </div>
      </div>

      {/* Task preview */}
      {hasTasks && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
              {data.importedTasks.length} tasks found — select which to import:
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={selectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-accent)', fontSize: 'var(--sb-t-body-s)' }}>Select all</button>
              <button onClick={deselectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-4)', fontSize: 'var(--sb-t-body-s)' }}>Deselect all</button>
            </div>
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 4 }}>
            {data.importedTasks.map(t => (
              <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-card)', border: '1px solid var(--sb-border)', cursor: 'pointer' }}>
                <input type="checkbox" checked={data.selectedTaskIds.has(t.id)} onChange={() => toggleTask(t.id)} style={{ accentColor: 'var(--sb-accent)', width: 14, height: 14, flexShrink: 0 }} />
                {t.priority > 1 && <div style={{ width: 8, height: 8, borderRadius: 'var(--sb-r-pill)', background: PRIORITY_COLORS[t.priority], flexShrink: 0 }} />}
                <span style={{ flex: 1, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.content}</span>
                {t.due && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', flexShrink: 0 }}>{t.due}</span>}
              </label>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
            {data.selectedTaskIds.size} task{data.selectedTaskIds.size !== 1 ? 's' : ''} will be imported to your Inbox, tagged as "todoist".
          </p>
        </div>
      )}

      <p style={{ margin: '16px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', fontStyle: 'italic' }}>
        You can skip this step and import tasks manually later.
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
