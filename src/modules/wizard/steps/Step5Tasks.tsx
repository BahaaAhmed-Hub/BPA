import { useState } from 'react'
import { TODOIST_CONFIGURED, openTodoistAuth, fetchTodoistTasks } from '@/lib/todoistOAuth'
import type { TodoistTask } from '@/lib/todoistOAuth'

interface TodoistTaskItem { id: string; content: string; due?: string; priority: number }

interface Props {
  data: { todoistToken: string; importedTasks: TodoistTaskItem[]; selectedTaskIds: Set<string> }
  onChange: (p: { todoistToken?: string; importedTasks?: TodoistTaskItem[]; selectedTaskIds?: Set<string> }) => void
}

const PRIORITY_COLORS: Record<number, string> = { 4: '#E05252', 3: '#F97316', 2: '#60A5FA', 1: 'transparent' }

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
      <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: 'var(--color-text,#E8EAF6)' }}>
        Import your tasks
      </h2>
      <p style={{ margin: '0 0 24px', fontSize: 13.5, color: 'var(--color-text-dim,#94A3B8)', lineHeight: 1.6 }}>
        Pull in existing tasks. All imports land in your Inbox for you to prioritize.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: hasTasks ? 24 : 0 }}>
        {/* Todoist tile */}
        <div style={{ flex: 1, padding: 20, borderRadius: 12, background: 'var(--color-surface,#FFFFFF)', border: '1px solid #E8E1CE' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: '#DB4035', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 18 }}>✓</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text,#E8EAF6)' }}>Todoist</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted,#6B7280)' }}>Task manager</div>
            </div>
          </div>

          {!TODOIST_CONFIGURED && !data.todoistToken && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', marginBottom: 10 }}>
                <p style={{ margin: 0, fontSize: 11.5, color: '#FBBF24' }}>
                  Set <code style={{ fontFamily: 'monospace' }}>VITE_TODOIST_CLIENT_ID</code> in .env to enable OAuth.
                </p>
              </div>
              <input
                value={manualToken}
                onChange={e => setManualToken(e.target.value)}
                placeholder="Paste API token to test..."
                style={{ background: 'var(--color-bg,#F7F4EA)', border: '1px solid #E8E1CE', borderRadius: 7, padding: '8px 12px', color: 'var(--color-text,#E8EAF6)', fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
              />
              <button
                onClick={() => manualToken.trim() && loadTasks(manualToken.trim())}
                disabled={!manualToken.trim() || loading}
                style={{ width: '100%', padding: '8px', borderRadius: 8, background: '#F5D14E', color: '#191712', fontSize: 13, fontWeight: 600, border: 'none', cursor: !manualToken.trim() ? 'not-allowed' : 'pointer', opacity: !manualToken.trim() ? 0.5 : 1 }}
              >
                {loading ? 'Loading…' : 'Load tasks →'}
              </button>
            </div>
          )}

          {TODOIST_CONFIGURED && !data.todoistToken && !loading && (
            <button onClick={handleConnect} disabled={connecting} style={{ width: '100%', padding: '10px', borderRadius: 8, background: '#DB4035', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', opacity: connecting ? 0.7 : 1 }}>
              {connecting ? 'Connecting…' : 'Connect Todoist'}
            </button>
          )}

          {loading && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--color-text-muted,#6B7280)', fontSize: 13 }}>
              <div style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginRight: 8 }}>⟳</div>
              Fetching tasks…
            </div>
          )}

          {data.todoistToken && !loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#1D9E75' }} />
              <span style={{ fontSize: 12, color: '#1D9E75', fontWeight: 500 }}>Connected · {data.importedTasks.length} tasks found</span>
            </div>
          )}

          {error && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#E05252' }}>{error}</p>}
        </div>

        {/* Trello tile */}
        <div style={{ flex: 1, padding: 20, borderRadius: 12, background: 'var(--color-surface,#FFFFFF)', border: '1px solid #E8E1CE', opacity: 0.6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: '#0052CC', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 16 }}>T</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text,#E8EAF6)' }}>Trello</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(251,191,36,0.12)', color: '#FBBF24', border: '1px solid rgba(251,191,36,0.25)' }}>Coming Soon</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted,#6B7280)' }}>Project boards</div>
            </div>
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', fontSize: 12, color: 'var(--color-text-muted,#6B7280)' }}>
            Trello integration is coming soon. Stay tuned!
          </div>
        </div>
      </div>

      {/* Task preview */}
      {hasTasks && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text,#E8EAF6)' }}>
              {data.importedTasks.length} tasks found — select which to import:
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={selectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#F5D14E', fontSize: 12 }}>Select all</button>
              <button onClick={deselectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted,#6B7280)', fontSize: 12 }}>Deselect all</button>
            </div>
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 4 }}>
            {data.importedTasks.map(t => (
              <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--color-surface,#FFFFFF)', border: '1px solid #E8E1CE', cursor: 'pointer' }}>
                <input type="checkbox" checked={data.selectedTaskIds.has(t.id)} onChange={() => toggleTask(t.id)} style={{ accentColor: '#F5D14E', width: 14, height: 14, flexShrink: 0 }} />
                {t.priority > 1 && <div style={{ width: 8, height: 8, borderRadius: '50%', background: PRIORITY_COLORS[t.priority], flexShrink: 0 }} />}
                <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text,#E8EAF6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.content}</span>
                {t.due && <span style={{ fontSize: 11, color: 'var(--color-text-muted,#6B7280)', flexShrink: 0 }}>{t.due}</span>}
              </label>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--color-text-muted,#6B7280)' }}>
            {data.selectedTaskIds.size} task{data.selectedTaskIds.size !== 1 ? 's' : ''} will be imported to your Inbox, tagged as "todoist".
          </p>
        </div>
      )}

      <p style={{ margin: '16px 0 0', fontSize: 11.5, color: 'var(--color-text-muted,#6B7280)', fontStyle: 'italic' }}>
        You can skip this step and import tasks manually later.
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
