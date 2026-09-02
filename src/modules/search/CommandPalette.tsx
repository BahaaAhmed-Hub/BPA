// ─── Platform-wide search ────────────────────────────────────────────────────
// One field over everything the app knows: tasks, calendar, habits, finance and
// settings, plus the actions the query itself implies. Opens from the magnifier
// or ⌘K; arrows move, Enter opens, ⌘Enter captures the query as a task.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, CheckSquare, CalendarDays, Repeat, Wallet, Settings as SettingsIcon,
  Plus, CornerDownLeft,
} from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import { useHabitsStore } from '@/store/habitsStore'
import { useUIStore } from '@/store/uiStore'
import { loadVisibleCompanies } from '@/types'
import type { Task } from '@/types'

const INK = '#191712'
const MUTED = '#6C6553'
const GHOST = '#9B9180'
const FIELD = '#FAF7EC'

type Group = 'Tasks' | 'Calendar' | 'Habits' | 'Finance' | 'Settings' | 'Actions'

interface Hit {
  id: string
  group: Group
  title: string
  meta: string
  icon: typeof Search
  run: () => void
}

const CHIP: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 8px',
  borderRadius: 6, background: FIELD, border: '1px solid #E8E1CE',
  fontSize: 10.5, color: MUTED, fontFamily: 'inherit', flexShrink: 0,
}

/** Every settings page the palette can jump to, by the words you'd search for. */
const SETTINGS_TARGETS: { id: string; label: string; words: string }[] = [
  { id: 'profile',       label: 'Profile',              words: 'profile name timezone avatar you' },
  { id: 'billing',       label: 'Billing',              words: 'billing plan invoice payment card' },
  { id: 'accounts',      label: 'Accounts & companies', words: 'accounts companies google people team link' },
  { id: 'professor',     label: 'AI',                   words: 'ai model autonomy tone professor' },
  { id: 'schedule',      label: 'Schedule rules',       words: 'schedule focus meetings buffer quiet hours' },
  { id: 'blocking',      label: 'Integrations',         words: 'integrations notion asana trello calendar sync' },
  { id: 'tasks',         label: 'Tasks',                words: 'tasks statuses board columns types' },
  { id: 'habits',        label: 'Habits',               words: 'habits tracker picture emoji goal' },
  { id: 'automation',    label: 'Automation',           words: 'automation rules brief distribute archive' },
  { id: 'notifications', label: 'Notifications',        words: 'notifications push mail digest quiet' },
  { id: 'appearance',    label: 'Appearance',           words: 'appearance theme density text size motion' },
  { id: 'behavioral',    label: 'Behavioral OS',        words: 'behavioral rank score identity' },
  { id: 'companies',     label: 'Data & privacy',       words: 'data privacy export retention tokens' },
  { id: 'finance',       label: 'Finance',              words: 'finance envelopes figures dates currency' },
]

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const tasks = useTaskStore(s => s.tasks)
  const addTask = useTaskStore(s => s.addTask)
  const habits = useHabitsStore(s => s.habits)
  const setActiveModule = useUIStore(s => s.setActiveModule)
  const focusOn = useUIStore(s => s.focusOn)

  useEffect(() => {
    if (!open) return
    setQ('')
    setCursor(0)
    // Focus after the frame the dialog mounts in, or the caret lands nowhere
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  const query = q.trim().toLowerCase()

  const hits = useMemo<Hit[]>(() => {
    if (!query) return []
    const companies = loadVisibleCompanies()
    const match = (v: string) => v.toLowerCase().includes(query)
    const out: Hit[] = []

    // ── Tasks ────────────────────────────────────────────────────────────────
    const openFirst = (a: Task, b: Task) => Number(a.completed) - Number(b.completed)
    for (const t of [...tasks].sort(openFirst)) {
      if (out.filter(h => h.group === 'Tasks').length >= 6) break
      if (!match(t.title) && !match(t.description ?? '')) continue
      const co = companies.find(c => c.id === t.companyId)
      const age = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000)
      out.push({
        id: `task-${t.id}`,
        group: 'Tasks',
        title: t.title,
        meta: [
          co?.name,
          t.completed ? 'done' : `open ${age}d`,
          t.plannedTime ? `${t.plannedTime} block` : t.priority ?? undefined,
        ].filter(Boolean).join(' · '),
        icon: CheckSquare,
        // Not just the page — the task you picked, open in its panel.
        run: () => { focusOn({ module: 'tasks', id: t.id }); setActiveModule('tasks'); onClose() },
      })
    }

    // ── Calendar ─────────────────────────────────────────────────────────────
    for (const t of tasks) {
      if (out.filter(h => h.group === 'Calendar').length >= 3) break
      if (!t.plannedTime || !match(t.title)) continue
      out.push({
        id: `cal-${t.id}`,
        group: 'Calendar',
        title: t.title,
        meta: `${t.dueDate ?? 'today'} ${t.plannedTime} · proposed block`,
        icon: CalendarDays,
        run: () => { setActiveModule('calendar'); onClose() },
      })
    }

    // ── Habits ───────────────────────────────────────────────────────────────
    for (const h of habits) {
      if (out.filter(x => x.group === 'Habits').length >= 3) break
      if (!match(h.name)) continue
      out.push({
        id: `habit-${h.id}`,
        group: 'Habits',
        title: h.name,
        meta: `${h.frequency}${h.type === 'quantity' && h.goal ? ` · ${h.goal} ${h.unit ?? ''}`.trimEnd() : ''}`,
        icon: Repeat,
        run: () => { setActiveModule('habits'); onClose() },
      })
    }

    // ── Finance ──────────────────────────────────────────────────────────────
    if ('finance budget envelope spend money invoice'.includes(query)) {
      out.push({
        id: 'finance',
        group: 'Finance',
        title: 'Open Finance',
        meta: 'budgets, envelopes and transactions',
        icon: Wallet,
        run: () => { setActiveModule('finance'); onClose() },
      })
    }

    // ── Settings ─────────────────────────────────────────────────────────────
    for (const st of SETTINGS_TARGETS) {
      if (out.filter(x => x.group === 'Settings').length >= 3) break
      if (!match(st.label) && !st.words.includes(query)) continue
      out.push({
        id: `set-${st.id}`,
        group: 'Settings',
        title: st.label,
        meta: 'settings',
        icon: SettingsIcon,
        run: () => {
          try { localStorage.setItem('settings-active-section', st.id) } catch { /* private mode */ }
          setActiveModule('settings')
          onClose()
        },
      })
    }

    // ── Actions — what the query itself implies ───────────────────────────────
    const firstCompany = companies[0]
    out.push({
      id: 'act-task',
      group: 'Actions',
      title: `Create task “${q.trim()}”`,
      meta: firstCompany ? `in ${firstCompany.name}` : 'in the brain dump',
      icon: Plus,
      run: () => {
        addTask({
          title: q.trim(),
          quadrant: null,
          company: (firstCompany?.id ?? 'personal') as Task['company'],
          companyId: firstCompany?.id,
          status: 'open',
          completed: false,
        } as Omit<Task, 'id' | 'createdAt'>)
        setActiveModule('tasks')
        onClose()
      },
    })

    return out
  }, [query, q, tasks, habits, addTask, setActiveModule, onClose])

  // Keep the cursor inside the list as results change
  useEffect(() => { setCursor(c => Math.min(c, Math.max(0, hits.length - 1))) }, [hits.length])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(hits.length - 1, c + 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.metaKey || e.ctrlKey) { hits.find(h => h.group === 'Actions')?.run(); return }
        hits[cursor]?.run()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, hits, cursor, onClose])

  // Scroll the highlighted row into view when the arrows run past the fold
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  // Rows carry their group heading with them, so one flat list keeps the index
  const rows: { hit: Hit; idx: number; heading: Group | null }[] = []
  let lastGroup: Group | null = null
  hits.forEach((hit, idx) => {
    rows.push({ hit, idx, heading: hit.group === lastGroup ? null : hit.group })
    lastGroup = hit.group
  })

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(25,23,18,0.28)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '12vh 20px 20px',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 700, background: '#FFFFFF',
          border: '1px solid #E8E1CE', borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 40px 80px -30px rgba(25,23,18,.55)',
          display: 'flex', flexDirection: 'column', maxHeight: '72vh',
        }}>

        {/* Field */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '16px 18px' }}>
          <Search size={17} strokeWidth={2} style={{ color: MUTED, flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => { setQ(e.target.value); setCursor(0) }}
            placeholder="Search tasks, calendar, habits, finance and settings"
            style={{
              flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 17, color: INK, fontFamily: 'inherit', padding: 0, textAlign: 'left',
            }} />
          <span style={CHIP}>Everything</span>
          <span style={CHIP}>esc</span>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', borderTop: '1px solid #F0EBDC', padding: '8px 0' }}>
          {!query ? (
            <p style={{ margin: 0, padding: '18px 18px 22px', fontSize: 12.5, color: GHOST }}>
              Type to search across the platform.
            </p>
          ) : rows.length === 0 ? (
            <p style={{ margin: 0, padding: '18px 18px 22px', fontSize: 12.5, color: GHOST }}>
              Nothing matches “{q.trim()}”.
            </p>
          ) : rows.map(({ hit, idx, heading }) => {
            const on = idx === cursor
            const Icon = hit.icon
            return (
              <div key={hit.id}>
                {heading && (
                  <div style={{
                    padding: '10px 18px 5px', fontSize: 9.5, fontWeight: 800,
                    letterSpacing: '0.14em', color: GHOST, textTransform: 'uppercase',
                  }}>{heading}</div>
                )}
                <div
                  data-idx={idx}
                  onMouseEnter={() => setCursor(idx)}
                  onClick={hit.run}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 11, minWidth: 0,
                    margin: '0 8px', padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                    background: on ? FIELD : 'transparent',
                  }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: FIELD, border: '1px solid #E8E1CE', color: MUTED,
                  }}>
                    <Icon size={14} strokeWidth={1.9} />
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: INK, flexShrink: 0, maxWidth: '52%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hit.title}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: GHOST, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hit.meta}
                  </span>
                  {on && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: MUTED, flexShrink: 0 }}>
                      <CornerDownLeft size={11} /> open
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: '10px 18px',
          background: FIELD, borderTop: '1px solid #F0EBDC', fontSize: 11, color: GHOST,
        }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>⌘↵ add as task</span>
          <span style={{ flex: 1 }} />
          <span style={{ textAlign: 'right' }}>Searches tasks, calendar, habits, finance and settings</span>
        </div>
      </div>
    </div>
  )
}
