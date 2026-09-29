// ─── Ideal Week Designer ──────────────────────────────────────────────────────
//
// A full-screen overlay that lets the user draw their ideal weekly template.
// Primary input: the visual canvas (pointer/touch drag to create blocks).
// Secondary input: AI chat sidebar — natural language → structured actions.
// Also: live stats, goals, rules, and variance analysis.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X, MessageSquare, BarChart2, Target, Settings2, GitCompare, Plus, Trash2, Check, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import {
  type IdealBlock, type IdealGoal, type IdealRule, type IdealChatMsg, type IdealVariance,
  type IdealWeekAction,
  CATEGORY_COLORS, CATEGORY_LIST, DAY_LABELS, hourLabel, hoursPerCategory, goalHoursBlocked,
  nanoid,
  loadBlocks, saveBlocks, loadGoals, saveGoals, loadRules, saveRules,
  loadChatHistory, saveChatHistory,
} from '../../lib/idealWeekStore'
import { chatIdealWeek } from '../../lib/idealWeekAI'
import type { GCalEvent } from '../../lib/googleCalendar'

// ─── Layout constants ──────────────────────────────────────────────────────────

const HOURS_START = 6   // 6 AM
const HOURS_END   = 22  // 10 PM
const HOUR_HEIGHT = 48  // px per hour
const DAY_WIDTH_MIN = 72

// ─── Sub-types ────────────────────────────────────────────────────────────────

interface DrawState {
  day: number
  startHour: number
  currentHour: number
}

interface Props {
  onClose: () => void
  realEvents?: GCalEvent[]   // from the connected calendar for variance analysis
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function IdealWeekModal({ onClose, realEvents = [] }: Props) {
  // ── State ────────────────────────────────────────────────────────────────────
  const [blocks, setBlocksState] = useState<IdealBlock[]>(loadBlocks)
  const [goals,  setGoalsState]  = useState<IdealGoal[]>(loadGoals)
  const [rules,  setRulesState]  = useState<IdealRule[]>(loadRules)
  const [chat,   setChatState]   = useState<IdealChatMsg[]>(() => {
    const h = loadChatHistory()
    if (h.length) return h
    return [{
      id: nanoid(), role: 'assistant',
      content: 'Tell me about your ideal week 😊  I can help you design your perfect weekly schedule — just describe what matters most to you, or start drawing blocks on the canvas.',
      applied: true, ts: new Date().toISOString(),
    }]
  })

  const [panel,       setPanel]       = useState<'chat' | 'stats' | 'goals' | 'rules' | 'variance'>('chat')
  const [chatInput,   setChatInput]   = useState('')
  const [aiLoading,   setAiLoading]   = useState(false)
  const [aiError,     setAiError]     = useState('')
  const [drawing,     setDrawing]     = useState<DrawState | null>(null)
  const [selected,    setSelected]    = useState<string | null>(null)
  const [editBlock,   setEditBlock]   = useState<IdealBlock | null>(null)
  const [pendingInit, setPendingInit] = useState(blocks.length === 0)

  const chatEndRef  = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLTextAreaElement>(null)

  // ── Persistence helpers ───────────────────────────────────────────────────────
  function setBlocks(fn: (prev: IdealBlock[]) => IdealBlock[]) {
    setBlocksState(prev => { const next = fn(prev); saveBlocks(next); return next })
  }
  function setGoals(fn: (prev: IdealGoal[]) => IdealGoal[]) {
    setGoalsState(prev => { const next = fn(prev); saveGoals(next); return next })
  }
  function setRules(fn: (prev: IdealRule[]) => IdealRule[]) {
    setRulesState(prev => { const next = fn(prev); saveRules(next); return next })
  }
  function setChat(fn: (prev: IdealChatMsg[]) => IdealChatMsg[]) {
    setChatState(prev => { const next = fn(prev); saveChatHistory(next); return next })
  }

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat])

  // ── Apply AI actions ──────────────────────────────────────────────────────────
  const applyActions = useCallback((actions: IdealWeekAction[]) => {
    for (const a of actions) {
      if (a.type === 'add_block') {
        setBlocks(prev => [...prev, { id: nanoid(), day: a.day, startHour: a.startHour, endHour: a.endHour, title: a.title, category: a.category, color: a.color ?? CATEGORY_COLORS[a.category] ?? '#7F8C8D', blockType: a.blockType }])
      } else if (a.type === 'remove_block') {
        setBlocks(prev => prev.filter(b => b.id !== a.id))
      } else if (a.type === 'add_goal') {
        setGoals(prev => [...prev, { id: nanoid(), title: a.title, category: a.category, color: a.color ?? CATEGORY_COLORS[a.category] ?? '#7F8C8D', targetHoursWeek: a.targetHoursWeek, horizon: a.horizon, deadline: a.deadline, enabled: true }])
      } else if (a.type === 'add_rule') {
        setRules(prev => [...prev, { id: nanoid(), title: a.title, description: a.description, ruleType: a.ruleType, config: a.config, enabled: true, createdFrom: 'ai-chat', createdAt: new Date().toISOString(), triggerCount: 0 }])
      } else if (a.type === 'clear_canvas') {
        setBlocks(() => [])
      }
    }
  }, [])

  // ── Send chat ──────────────────────────────────────────────────────────────────
  async function sendChat(text?: string) {
    const msg = (text ?? chatInput).trim()
    if (!msg || aiLoading) return
    setChatInput('')
    setAiError('')
    const userMsg: IdealChatMsg = { id: nanoid(), role: 'user', content: msg, applied: true, ts: new Date().toISOString() }
    setChat(prev => [...prev, userMsg])
    setAiLoading(true)
    try {
      const result = await chatIdealWeek(chat, msg, { blocks, goals, rules })
      const asstMsg: IdealChatMsg = { id: nanoid(), role: 'assistant', content: result.text, actions: result.actions, applied: false, ts: new Date().toISOString() }
      setChat(prev => [...prev, asstMsg])
      if (result.actions.length) {
        applyActions(result.actions)
        setChat(prev => prev.map(m => m.id === asstMsg.id ? { ...m, applied: true } : m))
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiLoading(false)
    }
  }

  // ── Canvas: pointer draw ───────────────────────────────────────────────────────
  function hourAtY(y: number): number {
    const h = Math.floor(y / HOUR_HEIGHT) + HOURS_START
    return Math.max(HOURS_START, Math.min(HOURS_END - 1, h))
  }

  function onCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>, day: number) {
    if (selected) { setSelected(null); setEditBlock(null); return }
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const h = hourAtY(e.clientY - rect.top)
    setDrawing({ day, startHour: h, currentHour: h })
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    e.stopPropagation()
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drawing) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const h = hourAtY(e.clientY - rect.top)
    setDrawing(prev => prev ? { ...prev, currentHour: h } : null)
  }

  function onCanvasPointerUp() {
    if (!drawing) return
    const { day, startHour, currentHour } = drawing
    const s = Math.min(startHour, currentHour)
    const e = Math.max(startHour, currentHour) + 1
    if (e > s) {
      const cat = 'Focus'
      const block: IdealBlock = { id: nanoid(), day, startHour: s, endHour: e, title: 'New block', category: cat, color: CATEGORY_COLORS[cat], blockType: 'soft' }
      setBlocks(prev => [...prev, block])
      setEditBlock(block)
      setSelected(block.id)
    }
    setDrawing(null)
  }

  // ── Variance ───────────────────────────────────────────────────────────────────
  const variance = computeVariance(blocks, realEvents)

  // ─── Init choice (blank vs load) ──────────────────────────────────────────────
  async function loadCurrentCalendar() {
    const msg = `I want to start with my current calendar as a base. Here are the events I have this week: ${realEvents.slice(0, 20).map(ev => `"${ev.summary}" on ${new Date(ev.start.dateTime ?? ev.start.date ?? '').toLocaleDateString()}`).join(', ') || 'no events found'}. Please analyze these and suggest an ideal week template based on my existing patterns.`
    setPendingInit(false)
    setPanel('chat')
    await sendChat(msg)
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────────
  const catHours = hoursPerCategory(blocks)
  const totalHours = Object.values(catHours).reduce((s, v) => s + v, 0)
  const workdayHours = (HOURS_END - HOURS_START) * 5
  const weekCapacity = (HOURS_END - HOURS_START) * 7

  // ─── JSX ──────────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'var(--sb-scrim)',
        display: 'flex', alignItems: 'stretch',
        backdropFilter: 'blur(6px)',
      }}
      onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Main container */}
      <div style={{
        margin: 'auto',
        width: 'min(98vw, 1280px)', height: 'min(96vh, 880px)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--sb-overlay)',
        border: '1px solid var(--sb-border)',
        borderRadius: 24, overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.24)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
          borderBottom: '1px solid var(--sb-hairline)', flexShrink: 0,
          background: 'var(--sb-overlay)',
        }}>
          <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 17, fontWeight: 700, color: 'var(--sb-ink-1)', flex: 1 }}>
            Ideal Week
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--sb-ink-3)', fontWeight: 500 }}>
            {blocks.length} block{blocks.length !== 1 ? 's' : ''} · {totalHours}h
          </span>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 999, border: '1px solid var(--sb-border)', background: 'var(--sb-field)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sb-ink-2)' }}
          ><X size={15} /></button>
        </div>

        {/* Body: canvas (left) + sidebar (right) */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── CANVAS AREA ──────────────────────────────────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--sb-hairline)' }}>
            {/* Day headers */}
            <div style={{ display: 'flex', paddingLeft: 40, flexShrink: 0, borderBottom: '1px solid var(--sb-hairline)' }}>
              {DAY_LABELS.map((d, i) => (
                <div key={i} style={{ flex: 1, minWidth: DAY_WIDTH_MIN, padding: '8px 4px', textAlign: 'center', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--sb-ink-3)' }}>{d}</div>
              ))}
            </div>

            {/* Grid */}
            <div style={{ flex: 1, overflowY: 'auto', position: 'relative', display: 'flex' }}>
              {/* Hour labels */}
              <div style={{ width: 40, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                {Array.from({ length: HOURS_END - HOURS_START }, (_, i) => (
                  <div key={i} style={{ height: HOUR_HEIGHT, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 6, paddingTop: 2, flexShrink: 0 }}>
                    <span style={{ fontSize: 9.5, color: 'var(--sb-ink-4)', lineHeight: 1 }}>{hourLabel(i + HOURS_START)}</span>
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {DAY_LABELS.map((_, day) => (
                <DayColumn
                  key={day}
                  day={day}
                  blocks={blocks.filter(b => b.day === day)}
                  drawing={drawing?.day === day ? drawing : null}
                  selected={selected}
                  hoursStart={HOURS_START}
                  hoursEnd={HOURS_END}
                  hourHeight={HOUR_HEIGHT}
                  onPointerDown={e => onCanvasPointerDown(e, day)}
                  onPointerMove={onCanvasPointerMove}
                  onPointerUp={onCanvasPointerUp}
                  onBlockClick={(id) => {
                    const b = blocks.find(x => x.id === id)
                    if (b) { setSelected(id); setEditBlock(b) }
                  }}
                  onBlockDelete={(id) => {
                    setBlocks(prev => prev.filter(b => b.id !== id))
                    if (selected === id) { setSelected(null); setEditBlock(null) }
                  }}
                />
              ))}
            </div>
          </div>

          {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
          <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--sb-overlay)', overflow: 'hidden' }}>

            {/* Sidebar nav */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--sb-hairline)', flexShrink: 0, overflowX: 'auto' }}>
              {([
                ['chat',     MessageSquare,  'Chat'],
                ['stats',    BarChart2,      'Stats'],
                ['goals',    Target,         'Goals'],
                ['rules',    Settings2,      'Rules'],
                ['variance', GitCompare,     'Variance'],
              ] as const).map(([id, Icon, label]) => (
                <button
                  key={id}
                  onClick={() => setPanel(id)}
                  style={{
                    flex: 1, minWidth: 52, padding: '10px 4px 8px', border: 'none', cursor: 'pointer', background: 'transparent',
                    borderBottom: panel === id ? '2px solid var(--sb-ink-1)' : '2px solid transparent',
                    color: panel === id ? 'var(--sb-ink-1)' : 'var(--sb-ink-3)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, transition: 'color 0.15s',
                  }}
                >
                  <Icon size={14} strokeWidth={2} />
                  <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
                </button>
              ))}
            </div>

            {/* Panel content */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

              {/* ── INIT PROMPT (blank vs load) ──────────────────────────────── */}
              {pendingInit && panel === 'chat' && (
                <div style={{ padding: 16, borderBottom: '1px solid var(--sb-hairline)', background: 'var(--sb-field)', flexShrink: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sb-ink-1)', marginBottom: 8 }}>Start with…</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setPendingInit(false)}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--sb-border)', background: 'var(--sb-card)', fontSize: 12, fontWeight: 600, color: 'var(--sb-ink-1)', cursor: 'pointer' }}
                    >Blank canvas</button>
                    <button
                      onClick={loadCurrentCalendar}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: 'none', background: 'var(--sb-ink-1)', fontSize: 12, fontWeight: 600, color: 'var(--sb-ink-on-dark)', cursor: 'pointer' }}
                    >Load my calendar</button>
                  </div>
                </div>
              )}

              {/* ── CHAT ─────────────────────────────────────────────────────── */}
              {panel === 'chat' && (
                <ChatPanel
                  messages={chat}
                  loading={aiLoading}
                  error={aiError}
                  input={chatInput}
                  inputRef={inputRef}
                  chatEndRef={chatEndRef}
                  onChange={setChatInput}
                  onSend={() => sendChat()}
                />
              )}

              {/* ── STATS ────────────────────────────────────────────────────── */}
              {panel === 'stats' && (
                <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <StatBanner totalHours={totalHours} workdayHours={workdayHours} weekCapacity={weekCapacity} />
                  {CATEGORY_LIST.map(cat => {
                    const h = catHours[cat] ?? 0
                    if (!h) return null
                    return (
                      <div key={cat}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sb-ink-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORY_COLORS[cat], display: 'inline-block' }} />
                            {cat}
                          </span>
                          <span style={{ fontSize: 11.5, color: 'var(--sb-ink-3)' }}>{h}h / week</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: 'var(--sb-field)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 3, background: CATEGORY_COLORS[cat], width: `${Math.min(100, (h / weekCapacity) * 100)}%`, transition: 'width 0.3s' }} />
                        </div>
                      </div>
                    )
                  })}
                  {Object.values(catHours).every(h => !h) && (
                    <div style={{ fontSize: 12.5, color: 'var(--sb-ink-3)', textAlign: 'center', marginTop: 32 }}>Draw blocks on the canvas to see stats</div>
                  )}
                </div>
              )}

              {/* ── GOALS ────────────────────────────────────────────────────── */}
              {panel === 'goals' && (
                <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {goals.map(g => (
                    <GoalCard key={g.id} goal={g} blocks={blocks}
                      onDelete={() => setGoals(prev => prev.filter(x => x.id !== g.id))}
                      onToggle={() => setGoals(prev => prev.map(x => x.id === g.id ? { ...x, enabled: !x.enabled } : x))} />
                  ))}
                  {!goals.length && (
                    <div style={{ fontSize: 12.5, color: 'var(--sb-ink-3)', textAlign: 'center', marginTop: 32 }}>
                      Tell the AI "I want to exercise 5h a week" to create goals
                    </div>
                  )}
                </div>
              )}

              {/* ── RULES ────────────────────────────────────────────────────── */}
              {panel === 'rules' && (
                <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {rules.map(r => (
                    <RuleCard key={r.id} rule={r}
                      onDelete={() => setRules(prev => prev.filter(x => x.id !== r.id))}
                      onToggle={() => setRules(prev => prev.map(x => x.id === r.id ? { ...x, enabled: !x.enabled } : x))} />
                  ))}
                  {!rules.length && (
                    <div style={{ fontSize: 12.5, color: 'var(--sb-ink-3)', textAlign: 'center', marginTop: 32 }}>
                      Tell the AI "no meetings on Friday mornings" to create rules
                    </div>
                  )}
                </div>
              )}

              {/* ── VARIANCE ─────────────────────────────────────────────────── */}
              {panel === 'variance' && (
                <VariancePanel variance={variance} onApply={(id) => {
                  // mark applied — variance is derived, nothing to write back
                  void id
                }} />
              )}
            </div>
          </div>
        </div>

        {/* Block edit drawer */}
        {editBlock && (
          <BlockEditor
            block={editBlock}
            onChange={b => {
              setEditBlock(b)
              setBlocks(prev => prev.map(x => x.id === b.id ? b : x))
            }}
            onDelete={() => {
              setBlocks(prev => prev.filter(x => x.id !== editBlock.id))
              setEditBlock(null); setSelected(null)
            }}
            onClose={() => { setEditBlock(null); setSelected(null) }}
          />
        )}
      </div>
    </div>
  )
}

// ─── DayColumn ────────────────────────────────────────────────────────────────

function DayColumn({ day: _day, blocks, drawing, selected, hoursStart, hoursEnd, hourHeight, onPointerDown, onPointerMove, onPointerUp, onBlockClick, onBlockDelete }: {
  day: number
  blocks: IdealBlock[]
  drawing: DrawState | null
  selected: string | null
  hoursStart: number
  hoursEnd: number
  hourHeight: number
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: () => void
  onBlockClick: (id: string) => void
  onBlockDelete: (id: string) => void
}) {
  const totalH = (hoursEnd - hoursStart) * hourHeight
  return (
    <div
      style={{ flex: 1, minWidth: DAY_WIDTH_MIN, position: 'relative', height: totalH, cursor: 'crosshair', borderRight: '1px solid var(--sb-hairline)', userSelect: 'none', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Hour lines */}
      {Array.from({ length: hoursEnd - hoursStart }, (_, i) => (
        <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * hourHeight, height: 1, background: 'var(--sb-hairline)', pointerEvents: 'none' }} />
      ))}

      {/* Existing blocks */}
      {blocks.map(b => (
        <BlockChip
          key={b.id}
          block={b}
          hoursStart={hoursStart}
          hourHeight={hourHeight}
          isSelected={selected === b.id}
          onClick={e => { e.stopPropagation(); onBlockClick(b.id) }}
          onDelete={e => { e.stopPropagation(); onBlockDelete(b.id) }}
        />
      ))}

      {/* Ghost block while drawing */}
      {drawing && (
        <div style={{
          position: 'absolute', left: 2, right: 2,
          top: (Math.min(drawing.startHour, drawing.currentHour) - hoursStart) * hourHeight,
          height: (Math.abs(drawing.currentHour - drawing.startHour) + 1) * hourHeight,
          background: CATEGORY_COLORS['Focus'] + '44',
          border: `2px dashed ${CATEGORY_COLORS['Focus']}`,
          borderRadius: 8, pointerEvents: 'none',
        }} />
      )}
    </div>
  )
}

// ─── BlockChip ────────────────────────────────────────────────────────────────

function BlockChip({ block, hoursStart, hourHeight, isSelected, onClick, onDelete }: {
  block: IdealBlock; hoursStart: number; hourHeight: number; isSelected: boolean
  onClick: (e: React.PointerEvent) => void; onDelete: (e: React.PointerEvent) => void
}) {
  const top    = (block.startHour - hoursStart) * hourHeight
  const height = (block.endHour - block.startHour) * hourHeight
  return (
    <div
      onPointerDown={onClick}
      style={{
        position: 'absolute', left: 2, right: 2, top, height,
        background: block.color + (isSelected ? 'EE' : '99'),
        border: `2px solid ${block.color}`,
        borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
        padding: '4px 6px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        boxShadow: isSelected ? `0 0 0 2px ${block.color}` : 'none',
        transition: 'box-shadow 0.15s',
      }}
    >
      <div style={{ fontSize: Math.min(11, height / 2), fontWeight: 600, color: '#fff', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: height < 28 ? 'nowrap' : 'normal' }}>
        {block.title}
      </div>
      {height >= 40 && (
        <div style={{ fontSize: 9.5, color: '#ffffffCC', fontWeight: 500 }}>
          {block.blockType === 'hard' ? '🔒' : '·'} {block.category}
        </div>
      )}
      {isSelected && (
        <button
          onPointerDown={onDelete}
          style={{ position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 4, border: 'none', background: 'rgba(0,0,0,0.3)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
        ><X size={10} /></button>
      )}
    </div>
  )
}

// ─── BlockEditor ──────────────────────────────────────────────────────────────

function BlockEditor({ block, onChange, onDelete, onClose }: {
  block: IdealBlock; onChange: (b: IdealBlock) => void
  onDelete: () => void; onClose: () => void
}) {
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 340, padding: '12px 16px',
      background: 'var(--sb-overlay)', borderTop: '1px solid var(--sb-border)',
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', zIndex: 10,
    }}>
      <input
        value={block.title}
        onChange={e => onChange({ ...block, title: e.target.value })}
        style={{ flex: 1, minWidth: 120, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--sb-border)', background: 'var(--sb-field)', fontSize: 13, color: 'var(--sb-ink-1)', fontFamily: 'inherit' }}
      />
      <select
        value={block.category}
        onChange={e => onChange({ ...block, category: e.target.value, color: CATEGORY_COLORS[e.target.value] ?? block.color })}
        style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--sb-border)', background: 'var(--sb-field)', fontSize: 12.5, color: 'var(--sb-ink-1)', fontFamily: 'inherit' }}
      >
        {CATEGORY_LIST.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select
        value={block.blockType}
        onChange={e => onChange({ ...block, blockType: e.target.value as 'hard' | 'soft' })}
        style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--sb-border)', background: 'var(--sb-field)', fontSize: 12.5, color: 'var(--sb-ink-1)', fontFamily: 'inherit' }}
      >
        <option value="hard">Hard block (never yields)</option>
        <option value="soft">Soft block (can move)</option>
      </select>
      <button onClick={onDelete} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #C62828', background: 'transparent', color: '#C62828', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
      <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 999, border: '1px solid var(--sb-border)', background: 'var(--sb-field)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sb-ink-2)' }}>
        <X size={13} />
      </button>
    </div>
  )
}

// ─── ChatPanel ────────────────────────────────────────────────────────────────

function ChatPanel({ messages, loading, error, input, inputRef, chatEndRef, onChange, onSend }: {
  messages: IdealChatMsg[]; loading: boolean; error: string
  input: string; inputRef: React.RefObject<HTMLTextAreaElement | null>; chatEndRef: React.RefObject<HTMLDivElement | null>
  onChange: (v: string) => void; onSend: () => void
}) {
  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '85%', padding: '9px 12px', borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
              background: m.role === 'user' ? 'var(--sb-ink-1)' : 'var(--sb-card)',
              color: m.role === 'user' ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-1)',
              border: m.role === 'assistant' ? '1px solid var(--sb-border)' : 'none',
              fontSize: 12.5, lineHeight: 1.5,
            }}>
              {m.content}
              {m.actions && m.actions.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: m.role === 'user' ? 'rgba(255,255,255,0.6)' : 'var(--sb-ink-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Check size={10} /> {m.actions.length} action{m.actions.length !== 1 ? 's' : ''} applied
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ padding: '9px 12px', borderRadius: '14px 14px 14px 4px', background: 'var(--sb-card)', border: '1px solid var(--sb-border)', display: 'flex', gap: 5, alignItems: 'center' }}>
              {[0, 1, 2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--sb-ink-3)', animation: 'typing-dot 1.2s infinite', animationDelay: `${i * 0.2}s`, display: 'inline-block' }} />)}
            </div>
          </div>
        )}
        {error && <div style={{ fontSize: 11.5, color: 'var(--sb-negative)', padding: '6px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--sb-negative) 8%, var(--sb-card))' }}>{error}</div>}
        <div ref={chatEndRef} />
      </div>

      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--sb-hairline)', flexShrink: 0, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
          placeholder="Ask me anything about your ideal week…"
          rows={1}
          style={{
            flex: 1, resize: 'none', padding: '8px 10px', borderRadius: 10,
            border: '1px solid var(--sb-border)', background: 'var(--sb-field)',
            fontSize: 12.5, color: 'var(--sb-ink-1)', fontFamily: 'inherit', lineHeight: 1.4,
            maxHeight: 100, overflow: 'auto',
          }}
        />
        <button
          onClick={onSend}
          disabled={!input.trim() || loading}
          style={{
            width: 36, height: 36, borderRadius: 10, border: 'none', flexShrink: 0,
            background: input.trim() && !loading ? 'var(--sb-ink-1)' : 'var(--sb-field)',
            color: input.trim() && !loading ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-4)',
            cursor: input.trim() && !loading ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s',
          }}
        ><Sparkles size={15} /></button>
      </div>

      <style>{`
        @keyframes typing-dot {
          0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)}
        }
      `}</style>
    </>
  )
}

// ─── StatBanner ───────────────────────────────────────────────────────────────

function StatBanner({ totalHours, workdayHours, weekCapacity }: { totalHours: number; workdayHours: number; weekCapacity: number }) {
  const pct = Math.round((totalHours / weekCapacity) * 100)
  return (
    <div style={{ background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 16 }}>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'Outfit,sans-serif', color: 'var(--sb-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{totalHours}h</div>
        <div style={{ fontSize: 10.5, color: 'var(--sb-ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Scheduled</div>
      </div>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'Outfit,sans-serif', color: 'var(--sb-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{workdayHours - totalHours > 0 ? workdayHours - totalHours : 0}h</div>
        <div style={{ fontSize: 10.5, color: 'var(--sb-ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Free (M–F)</div>
      </div>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'Outfit,sans-serif', color: pct > 80 ? 'var(--sb-negative)' : 'var(--sb-positive)', fontVariantNumeric: 'tabular-nums' }}>{pct}%</div>
        <div style={{ fontSize: 10.5, color: 'var(--sb-ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Capacity</div>
      </div>
    </div>
  )
}

// ─── GoalCard ─────────────────────────────────────────────────────────────────

function GoalCard({ goal, blocks, onDelete, onToggle }: { goal: IdealGoal; blocks: IdealBlock[]; onDelete: () => void; onToggle: () => void }) {
  const blocked = goalHoursBlocked(goal.id, blocks)
  const pct = Math.min(100, Math.round((blocked / goal.targetHoursWeek) * 100))
  return (
    <div style={{ background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 12, padding: '11px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: goal.color, display: 'inline-block', flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--sb-ink-1)' }}>{goal.title}</span>
        <button onClick={onToggle} style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--sb-border)', background: goal.enabled ? 'var(--sb-ink-1)' : 'var(--sb-field)', color: goal.enabled ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
          <Check size={11} />
        </button>
        <button onClick={onDelete} style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--sb-border)', background: 'transparent', color: 'var(--sb-ink-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
          <Trash2 size={11} />
        </button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 11.5, color: 'var(--sb-ink-3)' }}>{blocked}h blocked of {goal.targetHoursWeek}h/week</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: pct >= 100 ? 'var(--sb-positive)' : 'var(--sb-ink-3)' }}>{pct}%</span>
      </div>
      <div style={{ height: 5, borderRadius: 2.5, background: 'var(--sb-field)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 2.5, background: pct >= 100 ? 'var(--sb-positive)' : goal.color, width: `${pct}%`, transition: 'width 0.3s' }} />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--sb-ink-4)', marginTop: 4, textTransform: 'capitalize' }}>{goal.horizon} · {goal.category}</div>
    </div>
  )
}

// ─── RuleCard ─────────────────────────────────────────────────────────────────

function RuleCard({ rule, onDelete, onToggle }: { rule: IdealRule; onDelete: () => void; onToggle: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ background: 'var(--sb-card)', border: '1px solid var(--sb-border)', borderRadius: 12, padding: '10px 14px', opacity: rule.enabled ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--sb-ink-1)' }}>{rule.title}</span>
        <button onClick={() => setOpen(v => !v)} style={{ width: 22, height: 22, border: 'none', background: 'transparent', color: 'var(--sb-ink-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <button onClick={onToggle} style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--sb-border)', background: rule.enabled ? 'var(--sb-ink-1)' : 'var(--sb-field)', color: rule.enabled ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
          <Check size={11} />
        </button>
        <button onClick={onDelete} style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--sb-border)', background: 'transparent', color: 'var(--sb-ink-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
          <Trash2 size={11} />
        </button>
      </div>
      {open && <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>{rule.description}</div>}
      <div style={{ fontSize: 10.5, color: 'var(--sb-ink-4)', marginTop: 6, textTransform: 'capitalize' }}>{rule.ruleType.replace('-', ' ')} · from {rule.createdFrom.replace('-', ' ')}</div>
    </div>
  )
}

// ─── VariancePanel ────────────────────────────────────────────────────────────

function VariancePanel({ variance, onApply }: { variance: IdealVariance[]; onApply: (id: string) => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setChecked(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  if (!variance.length) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, flexDirection: 'column', gap: 10 }}>
      <Check size={28} style={{ color: 'var(--sb-positive)' }} />
      <div style={{ fontSize: 13, color: 'var(--sb-ink-2)', textAlign: 'center' }}>Your calendar matches your ideal week — no variances found.</div>
    </div>
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {variance.map(v => (
          <div key={v.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 12px', borderRadius: 10, background: 'var(--sb-card)', border: '1px solid var(--sb-border)' }}>
            <input type="checkbox" checked={checked.has(v.id)} onChange={() => toggle(v.id)} style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sb-ink-1)' }}>{v.idealTitle}</div>
              <div style={{ fontSize: 11, color: 'var(--sb-ink-3)', marginTop: 2 }}>{DAY_LABELS[v.day]} · {hourLabel(v.startHour)}–{hourLabel(v.endHour)}</div>
              <div style={{ fontSize: 11, color: 'var(--sb-ink-2)', marginTop: 3 }}>{v.action}</div>
            </div>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5, background: v.type === 'missing' ? 'color-mix(in srgb, var(--sb-negative) 12%, var(--sb-card))' : 'color-mix(in srgb, #E67E22 12%, var(--sb-card))', color: v.type === 'missing' ? 'var(--sb-negative)' : '#C56A00', flexShrink: 0 }}>{v.type}</span>
          </div>
        ))}
      </div>
      {checked.size > 0 && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--sb-hairline)', flexShrink: 0 }}>
          <button
            onClick={() => { checked.forEach(id => onApply(id)); setChecked(new Set()) }}
            style={{ width: '100%', padding: '9px', borderRadius: 10, border: 'none', background: 'var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
          ><Plus size={14} /> Apply {checked.size} selected action{checked.size !== 1 ? 's' : ''}</button>
        </div>
      )}
    </div>
  )
}

// ─── Variance computation ─────────────────────────────────────────────────────

function computeVariance(blocks: IdealBlock[], realEvents: GCalEvent[]): IdealVariance[] {
  if (!blocks.length || !realEvents.length) return []
  const out: IdealVariance[] = []
  const now = new Date()

  // Only look at the current week
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)) // Monday
  weekStart.setHours(0, 0, 0, 0)

  for (const b of blocks) {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + b.day)
    const dateStr = date.toISOString().slice(0, 10)

    // Check if there's a real event covering this block
    const blockStart = b.startHour * 60
    const blockEnd   = b.endHour   * 60

    const covering = realEvents.filter(ev => {
      const evDate = (ev.start.dateTime ?? ev.start.date ?? '').slice(0, 10)
      if (evDate !== dateStr) return false
      const st = ev.start.dateTime ? new Date(ev.start.dateTime) : null
      const en = ev.end.dateTime   ? new Date(ev.end.dateTime)   : null
      if (!st || !en) return false
      const sm = st.getHours() * 60 + st.getMinutes()
      const em = en.getHours() * 60 + en.getMinutes()
      return sm < blockEnd && em > blockStart
    })

    if (!covering.length) {
      out.push({ id: nanoid(), type: 'missing', day: b.day, dateStr, startHour: b.startHour, endHour: b.endHour, idealTitle: b.title, category: b.category, action: `Schedule "${b.title}" on ${DAY_LABELS[b.day]}`, applied: false })
    } else {
      const conflict = covering.find(ev => ev.summary !== b.title)
      if (conflict) {
        out.push({ id: nanoid(), type: 'conflict', day: b.day, dateStr, startHour: b.startHour, endHour: b.endHour, idealTitle: b.title, realTitle: conflict.summary, category: b.category, action: `"${conflict.summary}" overlaps your "${b.title}" block`, applied: false })
      }
    }
  }
  return out.slice(0, 30)
}
