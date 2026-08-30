import { useState, useRef, useEffect, useCallback } from 'react'
import Anthropic from '@anthropic-ai/sdk'
import { Brain, X, Send, Loader2, ChevronDown, Wrench } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import { useAuthStore } from '@/store/authStore'
import { useHabitsStore } from '@/store/habitsStore'
import { ASSISTANT_TOOLS, executeTool, type ToolContext } from '@/lib/assistantTools'
import { loadAIConfig, type AIConfig } from '@/modules/settings/Settings'
import { loadAccounts } from '@/lib/multiAccount'
import { useBehavioralStore } from '@/store/behavioralStore'

// ─── Groq types (OpenAI-compatible) ──────────────────────────────────────────

interface GroqToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type GroqMessage =
  | { role: 'user';      content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: GroqToolCall[] }
  | { role: 'tool';      tool_call_id: string; content: string }

interface GroqResponse {
  choices: Array<{
    message: { role: 'assistant'; content: string | null; tool_calls?: GroqToolCall[] }
    finish_reason: string
  }>
  error?: { message?: string }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'error'
  content: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert Anthropic tool schemas to OpenAI/Groq function format. */
function toGroqTools(tools: Anthropic.Tool[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description ?? '', parameters: t.input_schema },
  }))
}

function providerLabel(cfg: AIConfig): string {
  if (cfg.provider === 'groq') {
    const short = cfg.groqModel.split('-').slice(0, 3).join('-')
    return `Groq · ${short}`
  }
  return 'Anthropic · Claude'
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(userName: string, today: string, samuraiMode = false): string {
  if (samuraiMode) {
    return `You are operating in Samurai Mode as a calm tactical advisor to ${userName}.

Today: ${today}

Behavioral directives:
- Speak with precision and economy. Never elaborate when brevity serves.
- Avoid enthusiasm, filler phrases, corporate language, and emojis.
- Address ${userName} by name sparingly — only when it adds weight.
- Reframe urgency without drama. Reframe achievement without praise.

Tone translations:
- Instead of "You still have 12 tasks left!" → "Three decisive objectives remain."
- Instead of "Great job!" → "Momentum is maintained."
- Instead of "Don't forget your meeting." → "Your next engagement begins in 20 minutes. Prepare."
- Instead of "Here are your emails" → "Incoming communications, reviewed."

You have tools to:
- List, search, reply to, send, and archive emails
- Get calendar events for any date range
- List, create, and complete tasks
- Search Google Drive files

Use tools immediately when action is required. Summarize results with minimal words. Ask one focused question when clarification is needed.`
  }

  return `You are Professor AI — ${userName}'s personal executive assistant with live access to their Gmail, task board, Google Calendar, and Google Drive.

Today's date: ${today}

You have tools to:
- List, search, reply to, send, and archive emails
- Get calendar events for any date range
- List, create, and complete tasks
- Search Google Drive files

Guidelines:
- Be concise and action-oriented. When asked to do something, use the right tool immediately — don't explain how.
- After using a tool, summarize findings clearly. Format lists with line breaks.
- If you need clarification before acting, ask one focused question.
- Refer to the user by first name only. Keep tone warm but professional.`
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: DisplayMessage }) {
  if (msg.role === 'tool') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 10px', borderRadius: 20, fontSize: 11,
          background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
          color: '#818CF8',
        }}>
          <Wrench size={10} style={{ animation: 'spin 1s linear infinite' }} />
          {msg.content}
        </span>
      </div>
    )
  }

  if (msg.role === 'error') {
    return (
      <div style={{ margin: '8px 12px' }}>
        <div style={{
          padding: '10px 12px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.55,
          background: 'rgba(224,82,82,0.1)', border: '1px solid rgba(224,82,82,0.2)',
          color: '#F87171',
        }}>
          {msg.content}
        </div>
      </div>
    )
  }

  const isUser = msg.role === 'user'

  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', margin: '6px 12px' }}>
      {!isUser && (
        <div style={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0, marginRight: 8, marginTop: 2,
          background: 'linear-gradient(135deg, #4F46E5 0%, #818CF8 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Brain size={13} color="white" />
        </div>
      )}
      <div style={{
        maxWidth: '80%', padding: '9px 12px',
        borderRadius: isUser ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
        background: isUser ? 'var(--color-accent, #4F46E5)' : 'var(--color-surface2, #131520)',
        border: isUser ? 'none' : '1px solid #E8E1CE',
        fontSize: 13, lineHeight: 1.6,
        color: isUser ? 'white' : '#191712',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {msg.content}
      </div>
    </div>
  )
}

function ThinkingDot() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', margin: '6px 12px', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg, #4F46E5 0%, #818CF8 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Brain size={13} color="white" />
      </div>
      <div style={{ display: 'flex', gap: 4, padding: '10px 14px', background: 'var(--color-surface2, #131520)', border: '1px solid #E8E1CE', borderRadius: '4px 14px 14px 14px' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#818CF8', animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
        ))}
      </div>
    </div>
  )
}

const SUGGESTIONS = [
  'What emails need my attention today?',
  'Which accounts do I have connected?',
  "What's on my calendar this week?",
  'Show me my open tasks',
]

// ─── Main panel ───────────────────────────────────────────────────────────────

interface AssistantPanelProps {
  open: boolean
  onClose: () => void
}

export function AssistantPanel({ open, onClose }: AssistantPanelProps) {
  const user          = useAuthStore(s => s.user)
  const tasks         = useTaskStore(s => s.tasks)
  const addTask       = useTaskStore(s => s.addTask)
  const updateTask    = useTaskStore(s => s.updateTask)
  const deleteTask    = useTaskStore(s => s.deleteTask)
  const habits        = useHabitsStore(s => s.habits)
  const samuraiActive = useBehavioralStore(s => s.enabled && s.mode === 'samurai')

  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([])
  const [anthropicMsgs, setAnthropicMsgs] = useState<Anthropic.MessageParam[]>([])
  const [groqMsgs,      setGroqMsgs]      = useState<GroqMessage[]>([])
  const [input,         setInput]          = useState('')
  const [thinking,      setThinking]       = useState(false)
  const lastProviderRef = useRef<string>('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayMessages, thinking])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200)
  }, [open])

  const accounts     = loadAccounts()
  const primaryEmail = user?.email ?? ''
  const ctx: ToolContext = { tasks, addTask, updateTask, deleteTask, accounts, primaryEmail, habits }

  // ── Anthropic agentic loop (streaming) ─────────────────────────────────────

  async function runAnthropic(trimmed: string, cfg: AIConfig, system: string, history: Anthropic.MessageParam[]) {
    const client = new Anthropic({ apiKey: cfg.anthropicKey, dangerouslyAllowBrowser: true })
    let msgs: Anthropic.MessageParam[] = [...history, { role: 'user', content: trimmed }]

    while (true) {
      // Stream text in real-time; collect final message for tool-use detection
      const streamId   = crypto.randomUUID()
      let   accumText  = ''

      const stream = client.messages.stream({
        model: 'claude-sonnet-4-6', max_tokens: 4096,
        system, tools: ASSISTANT_TOOLS, messages: msgs,
      })

      stream.on('text', chunk => {
        accumText += chunk
        setDisplayMessages(prev => {
          const exists = prev.some(m => m.id === streamId)
          return exists
            ? prev.map(m => m.id === streamId ? { ...m, content: accumText } : m)
            : [...prev, { id: streamId, role: 'assistant' as const, content: accumText }]
        })
      })

      const response = await stream.finalMessage()
      msgs = [...msgs, { role: 'assistant', content: response.content }]

      if (response.stop_reason !== 'tool_use') {
        setAnthropicMsgs(msgs)
        return
      }

      // Remove empty streaming placeholder before showing tool chips
      if (!accumText) setDisplayMessages(prev => prev.filter(m => m.id !== streamId))

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        setDisplayMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'tool', content: `Checking ${block.name.replace(/_/g, ' ')}…` }])
        try {
          const result = await executeTool(block.name, block.input as Record<string, unknown>, ctx)
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err instanceof Error ? err.message : String(err)}`, is_error: true })
        }
      }
      msgs = [...msgs, { role: 'user', content: toolResults }]
    }
  }

  // ── Groq agentic loop ───────────────────────────────────────────────────────

  async function runGroq(trimmed: string, cfg: AIConfig, system: string, history: GroqMessage[]) {
    let msgs: GroqMessage[] = [...history, { role: 'user', content: trimmed }]

    while (true) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.groqKey}` },
        body: JSON.stringify({
          model: cfg.groqModel, max_tokens: 4096,
          messages: [{ role: 'system', content: system }, ...msgs],
          tools: toGroqTools(ASSISTANT_TOOLS),
          tool_choice: 'auto',
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as GroqResponse
        throw new Error(err.error?.message ?? `Groq ${res.status}`)
      }

      const data  = await res.json() as GroqResponse
      const choice = data.choices[0]
      const msg    = choice.message

      msgs = [...msgs, { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }]

      if (choice.finish_reason !== 'tool_calls' || !msg.tool_calls?.length) {
        const text = msg.content?.trim() ?? ''
        setDisplayMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: text }])
        setGroqMsgs(msgs)
        return
      }

      const toolResults: GroqMessage[] = []
      for (const call of msg.tool_calls) {
        const toolName  = call.function.name
        const toolInput = JSON.parse(call.function.arguments) as Record<string, unknown>
        setDisplayMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'tool', content: `Checking ${toolName.replace(/_/g, ' ')}…` }])
        try {
          const result = await executeTool(toolName, toolInput, ctx)
          toolResults.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
        } catch (err) {
          toolResults.push({ role: 'tool', tool_call_id: call.id, content: `Error: ${err instanceof Error ? err.message : String(err)}` })
        }
      }
      msgs = [...msgs, ...toolResults]
    }
  }

  // ── Send handler ────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || thinking) return

    const cfg = loadAIConfig()

    // Validate key for selected provider
    if (cfg.provider === 'anthropic' && !cfg.anthropicKey) {
      setDisplayMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'error', content: 'No Anthropic API key set. Go to Settings → Professor AI.' }])
      return
    }
    if (cfg.provider === 'groq' && !cfg.groqKey) {
      setDisplayMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'error', content: 'No Groq API key set. Go to Settings → Professor AI.' }])
      return
    }

    // If provider switched since last message, reset that provider's history
    if (lastProviderRef.current && lastProviderRef.current !== cfg.provider) {
      setAnthropicMsgs([])
      setGroqMsgs([])
    }
    lastProviderRef.current = cfg.provider

    const today    = new Date().toISOString().slice(0, 10)
    const userName = user?.name?.split(' ')[0] ?? user?.email ?? 'there'
    const system   = buildSystemPrompt(userName, today, samuraiActive)

    setInput('')
    setThinking(true)
    setDisplayMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', content: trimmed }])

    try {
      if (cfg.provider === 'groq') {
        await runGroq(trimmed, cfg, system, groqMsgs)
      } else {
        await runAnthropic(trimmed, cfg, system, anthropicMsgs)
      }
    } catch (err) {
      const msg     = err instanceof Error ? err.message : String(err)
      const is401   = msg.includes('401') || msg.includes('authentication') || msg.includes('invalid_api_key')
      const friendly = is401
        ? `Invalid ${cfg.provider === 'groq' ? 'Groq' : 'Anthropic'} API key. Check Settings → Professor AI.`
        : `Error: ${msg}`
      setDisplayMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'error', content: friendly }])
    } finally {
      setThinking(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anthropicMsgs, groqMsgs, thinking, user, tasks])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(input) }
  }

  function clearConversation() {
    setDisplayMessages([])
    setAnthropicMsgs([])
    setGroqMsgs([])
  }

  const cfg   = loadAIConfig()
  const isEmpty = displayMessages.length === 0

  return (
    <>
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 390, zIndex: 150,
        display: 'flex', flexDirection: 'column',
        background: '#F7F4EA',
        borderLeft: '1px solid #E8E1CE',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        boxShadow: open ? '-8px 0 32px rgba(0,0,0,0.4)' : 'none',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px', borderBottom: '1px solid #E8E1CE', flexShrink: 0,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: 'linear-gradient(135deg, #4F46E5 0%, #818CF8 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 12px rgba(99,102,241,0.35)',
          }}>
            <Brain size={16} color="white" />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#191712' }}>Professor AI</p>
            <p style={{ margin: 0, fontSize: 10.5, color: '#818CF8' }}>{providerLabel(cfg)}</p>
          </div>
          {!isEmpty && (
            <button onClick={clearConversation}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 4, fontSize: 11 }}>
              Clear
            </button>
          )}
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 4, display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          {isEmpty ? (
            <div style={{ padding: '32px 20px', textAlign: 'center' }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px',
                background: 'linear-gradient(135deg, rgba(79,70,229,0.2) 0%, rgba(129,140,248,0.1) 100%)',
                border: '1px solid rgba(99,102,241,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Brain size={26} color="#818CF8" />
              </div>
              <p style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600, color: '#191712' }}>How can I help?</p>
              <p style={{ margin: '0 0 24px', fontSize: 12.5, color: '#6C6553', lineHeight: 1.5 }}>
                I can read your emails, check your calendar, manage tasks, and search Drive files.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => void sendMessage(s)}
                    style={{
                      padding: '9px 14px', borderRadius: 10, fontSize: 12.5, textAlign: 'left',
                      background: 'var(--color-surface2, #131520)', border: '1px solid #E8E1CE',
                      color: '#191712', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                    {s}
                    <ChevronDown size={13} style={{ transform: 'rotate(-90deg)', color: '#6C6553', flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {displayMessages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
              {thinking && displayMessages[displayMessages.length - 1]?.role !== 'assistant' && <ThinkingDot />}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div style={{ padding: '12px 14px 14px', borderTop: '1px solid #E8E1CE', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 8,
            background: 'var(--color-surface2, #131520)',
            border: '1px solid #E8E1CE',
            borderRadius: 12, padding: '10px 12px',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your emails, tasks, calendar…"
              disabled={thinking}
              rows={1}
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none', resize: 'none',
                color: '#191712', fontSize: 13, lineHeight: 1.5,
                maxHeight: 120, overflowY: 'auto', fontFamily: 'inherit',
              }}
              onInput={e => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 120) + 'px'
              }}
            />
            <button
              onClick={() => void sendMessage(input)}
              disabled={!input.trim() || thinking}
              style={{
                width: 32, height: 32, borderRadius: 9, border: 'none', cursor: 'pointer',
                background: !input.trim() || thinking ? 'rgba(99,102,241,0.2)' : 'linear-gradient(135deg, #4F46E5 0%, #818CF8 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                transition: 'background 0.15s',
                boxShadow: !input.trim() || thinking ? 'none' : '0 0 10px rgba(99,102,241,0.4)',
              }}>
              {thinking
                ? <Loader2 size={15} color="#818CF8" style={{ animation: 'spin 1s linear infinite' }} />
                : <Send size={14} color={!input.trim() ? '#818CF8' : 'white'} />
              }
            </button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 10, color: '#6C6553', textAlign: 'center' }}>
            Enter to send · Shift+Enter for new line · Actions are real
          </p>
        </div>
      </div>

      <style>{`
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  )
}

// ─── Floating toggle button ───────────────────────────────────────────────────

interface AssistantToggleProps { open: boolean; onClick: () => void }

export function AssistantToggle({ open, onClick }: AssistantToggleProps) {
  return (
    <button
      onClick={onClick}
      title={open ? 'Close Assistant' : 'Open Professor AI'}
      style={{
        position: 'fixed', bottom: 24, right: open ? 406 : 24,
        width: 48, height: 48, borderRadius: 14, border: 'none', cursor: 'pointer',
        background: open
          ? 'var(--color-surface2, #131520)'
          : 'linear-gradient(135deg, #4F46E5 0%, #818CF8 100%)',
        boxShadow: open
          ? '0 2px 12px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(99,102,241,0.3)'
          : '0 4px 20px rgba(79,70,229,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 148,
        transition: 'right 0.25s cubic-bezier(0.4,0,0.2,1), background 0.2s, box-shadow 0.2s',
      }}>
      {open ? <X size={20} color="#818CF8" /> : <Brain size={22} color="white" />}
    </button>
  )
}
