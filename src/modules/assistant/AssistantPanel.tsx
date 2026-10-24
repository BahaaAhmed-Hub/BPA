import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import Anthropic from '@anthropic-ai/sdk'
import { Mic, X, Send, Loader2, ChevronDown, Check, CircleAlert, Paperclip, FileText, Image as ImageIcon, X as CloseIcon } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import { useAuthStore } from '@/store/authStore'
import { useHabitsStore } from '@/store/habitsStore'
import { ASSISTANT_TOOLS, executeTool, type ToolContext } from '@/lib/assistantTools'
import { Button } from '@/components/ui'
import { approvalFor, DECLINED, type Approval } from '@/lib/assistantPolicy'
import {
  readAttachment, kindOf, toAnthropicContent, toGroqContent, unsupported, tooLarge, prettySize,
  type Attachment,
} from '@/lib/chatAttachments'
import { Markdown } from './Markdown'
import { loadAIConfig, maskKey, type AIConfig } from '@/modules/settings/Settings'
import { loadAccounts } from '@/lib/multiAccount'
import { useBehavioralStore } from '@/store/behavioralStore'
import { ICON } from '@/lib/type'
import { addressedTo } from '@/lib/callName'
import { recognitionLang, speak, speechSupported, startListening, stopSpeaking, unlockSpeech, type Listening, type ListenError } from '@/lib/speech'
import { cleanName, labelOf, loadPersona as loadPersonaNow, NAME_MAX, savePersona, usePersona } from '@/lib/assistantPersona'
import { AssistantAvatar } from './AssistantAvatar'
import { ModelBadge, type BadgeUsage } from './ModelBadge'
import { LimitsLine } from './LimitsLine'
import { ageWords, limitsFromRow, parseLimits, viewLimits, waitText, type Limits } from '@/lib/providerLimits'
import { counterText, estimateOutputTokens, groupByModel, summarise, usageFromRow, type ModelUsage } from '@/lib/aiUsage'
import { AI_CONFIG_EVENT, claudeModelOf, saveAIConfig } from '@/modules/settings/model'
import { ensureWorkingGroqModel, isBillingMessage, isModelMissingMessage } from '@/lib/modelCatalog'
import { notify } from '@/lib/undo'
import { clampWidth, loadChosenWidth, rightGap, saveWidth, widthFromDrag, DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH } from '@/lib/assistantWindow'
import { ASK_EVENT, takePendingAsk } from '@/lib/assistantBridge'
import {
  awaitingContinue, busyOf, chatIdFromUrl, claimable, deviceId, isStaleStreaming, loadDraft, rowsToBubbles, saveDraft, urlWithChat,
  type ChatRow,
} from '@/lib/assistantChatView'
import {
  archiveConversation, claimTool, createConversation, deleteMessageByClientId, fetchConversation, fetchLatestConversationId,
  fetchMessages, finishTool, insertUserMessage, markInterrupted, mergeRows, persistBubbles, refreshClaim, requestStep, subscribeMessages,
} from '@/lib/assistantChatApi'
import { alternating } from '../../../supabase/functions/_shared/assistantChat.ts'

// ─── Groq types (OpenAI-compatible) ──────────────────────────────────────────

interface GroqToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type GroqMessage =
  | { role: 'user';      content: unknown }
  | { role: 'assistant'; content: string | null; tool_calls?: GroqToolCall[] }
  | { role: 'tool';      tool_call_id: string; content: string }

interface GroqResponse {
  choices: Array<{
    message: { role: 'assistant'; content: string | null; tool_calls?: GroqToolCall[] }
    finish_reason: string
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'error'
  content: string
  /** What was sent alongside the words, so the thread shows it too. */
  files?: { name: string; kind: Attachment['kind'] }[]
  /** Tool chips only: which tool, and whether it is still going. The chip used
   *  to be a sentence with a wrench that spun for ever — it was never told the
   *  tool had come back, so it went on looking busy under a finished answer. */
  tool?: string
  state?: 'running' | 'done' | 'failed'
}

/** `list_habits` → "Reading habits…" while it runs, "Read habits" once it has.
 *  A raw tool name on screen is a log line; this is what it was doing. */
function toolLabel(name: string): { running: string; done: string } {
  const m = /^(list|get|search|find|read|check|show)_(.+)$/.exec(name)
  const w = /^(create|add|new|send|reply|log|set|update|complete|delete|remove|archive|mark|move)_(.+)$/.exec(name)
  const noun = (m?.[2] ?? w?.[2] ?? name).replace(/_/g, ' ')
  if (w) {
    const [run, done] = ({
      create: ['Creating', 'Created'], add: ['Adding', 'Added'], new: ['Creating', 'Created'],
      send: ['Sending', 'Sent'], reply: ['Replying to', 'Replied to'],
      delete: ['Removing', 'Removed'], remove: ['Removing', 'Removed'],
      archive: ['Archiving', 'Archived'],
    } as Record<string, [string, string]>)[w[1]] ?? ['Updating', 'Updated']
    return { running: `${run} ${noun}…`, done: `${done} ${noun}` }
  }
  return { running: `Reading ${noun}…`, done: `Read ${noun}` }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert Anthropic tool schemas to OpenAI/Groq function format. */
function toGroqTools(tools: Anthropic.Tool[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description ?? '', parameters: t.input_schema },
  }))
}

// ─── System prompt ────────────────────────────────────────────────────────────

/** How to write for THIS panel: ~390px wide, Markdown drawn properly (tables
 *  scroll sideways inside their own box, lists get bullets). Said once and
 *  shared by both tones, because the model otherwise picks its own style —
 *  which is how a day came back as ten stacked headers and a rule between
 *  every one. Telegram has its own prompt and its own, narrower dialect. */
const FORMAT_RULES = `
How to format answers (they are drawn as Markdown in a narrow side panel):
- Lead with the answer in one short line, then the detail. No greeting paragraph, no closing summary that repeats the list.
- A schedule or any list of 3+ items with 2+ attributes is a table: at most 4 short columns (for a day: Time | Event | Where, times as 09:30–12:00). Fewer than 3 items is a sentence or bullets, not a table.
- Tasks, emails and options are "-" bullets, one line each: **bold title** then a short qualifier. Group with a single "###" label at most once per section.
- Never use "---" separators or "#"/"##" headings. Never put a table inside a bullet. Bold only labels and key figures.
- Money: show the currency and keep thousands separators. Use a table to compare more than two figures.
- Habits: where list_habits gives a "picture", put ![name](picture) before the habit's name (in a table, in its first cell) instead of the emoji, copying the value exactly.
- Show an image only when a tool gave you its URL, as ![what it is](url). Never invent a URL. If a diagram would genuinely help, describe the structure in a short indented list instead.
- If a list is long, show the top items and say how many more there are.`

const APP_RULES = `
About the app and what you may do:
- You work for the person signed in, on their own data only — their mail, calendar, tasks, habits, finances, shopping and books. You cannot see or change anyone else's, and you never say or pretend that you can.
- For any question about the app itself ("how do I…", "where is…", "can it…", "what does … do") call app_guide first and answer from it. If it does not cover the question, say you are not sure; never invent a feature, a button or a screen.
- You can act in every module, not only read: use the tool for the job rather than telling the user to do it themselves. If the right tool does not exist yet, say so plainly and say where in the app they can do it.
- Anything other people will see (sending mail, replying, answering an invitation), anything that cannot be undone (deleting), and anything that changes money shows the user an approval card with the exact details before it runs. Call the tool directly when they have asked for it — the app asks them; do not also ask in chat. If they decline, it was not done: say so, and do not retry or work around it.
- Never reveal or ask for passwords, API keys or tokens. Settings that hold credentials are not yours to read or change.`

function buildSystemPrompt(userName: string, today: string, samuraiMode = false, assistantName = ''): string {
  const called = assistantName ? ` The user calls you ${assistantName}; answer to that name and, if asked who you are, say it.` : ''
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
- List, search, reply to, send, and archive emails, and answer invitations
- Read, create, edit and delete calendar events
- List, create, edit, complete and delete tasks
- List, create, edit and log habits
- Read and manage the user's Library: books, shelves, lists, quotes and reading progress
- Read and write the finance ledger and the shopping lists
- Search Google Drive files
- Explain how the app works (app_guide)
- Read images, PDFs and text files the user attaches to a message

Use tools immediately when action is required. Summarize results with minimal words. Ask one focused question when clarification is needed.
${FORMAT_RULES}
In this mode use no emoji at all.${APP_RULES}${called}`
  }

  return `You are ${assistantName || 'Professor AI'} — ${userName}'s personal executive assistant with live access to their Gmail, task board, Google Calendar, and Google Drive.

Today's date: ${today}

You have tools to:
- List, search, reply to, send, and archive emails, and answer invitations
- Read, create, edit and delete calendar events
- List, create, edit, complete and delete tasks
- List, create, edit and log habits
- Read and manage the user's Library: books, shelves, lists, quotes and reading progress
- Read and write the finance ledger and the shopping lists
- Search Google Drive files
- Explain how the app works (app_guide)

Files: the user can attach images, PDFs and text files to a message. Read what
they attach and answer from it — an invoice, a statement, a screenshot of a bill
— and use your tools to act on it when they ask, for instance recording what a
receipt says. Never claim you cannot see an attachment that is there.

On money:
- Start with finance_overview for anything about money — it answers most questions in one call.
- Every figure is already converted into the base currency. Report figures as they come back; do not do your own arithmetic on them unless asked.
- Record what the user says they spent, earned or moved. An entry with no payment date is owed, not paid.
- Never delete an entry, or change one, unless the user asked for that entry. Deleting takes confirm: true.
- If the finances are locked, say so and ask them to unlock Finance — do not work around it.
- A credit card is not money. Its balance is never cash, credit_on_cards_not_cash is
  never added to cash, and a card is never the answer to "what can I put towards this"
  or "where should the savings come from". Money leaving a card is borrowed until the
  card is paid.
- Reward points are not money either. Report them as points, say what they would be
  worth if redeemed when asked, and never add that figure to a balance, a total, a
  goal or a plan. Cash taken on a card earns none of them.

Guidelines:
- Be concise and action-oriented. When asked to do something, use the right tool immediately — don't explain how.
- After using a tool, summarize findings clearly.
- If you need clarification before acting, ask one focused question.
- Refer to the user by first name only. Keep tone warm but professional.
${FORMAT_RULES}
- Do not use emoji. Label sections with plain words.
${APP_RULES}${called}`
}

// ─── Message bubble ───────────────────────────────────────────────────────────

const NAME_IDEAS = ['Beau', 'Hadi', 'Ezra', 'Theo', 'Nour']

/** Asked once, the first time the panel is opened with nothing to say yet. Skipping is an answer too. */
function NamePrompt() {
  const [text, setText] = useState('')
  const name = cleanName(text)
  const save = (n: string) => { const c = cleanName(n); if (c) savePersona({ ...loadPersonaNow(), name: c, asked: true }) }
  return (
    <div style={{ margin: '0 0 22px' }}>
      <p style={{ margin: '0 0 4px', fontSize: 'var(--sb-t-h3)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>What would you like to call me?</p>
      <p style={{ margin: '0 0 12px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>I’ll answer to it — typed or spoken. You can change it any time in Settings → AI.</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <input value={text} maxLength={NAME_MAX} aria-label="A name for your assistant" placeholder="A name…" onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(text) }}
          style={{ width: 170, padding: '8px 10px', borderRadius: 'var(--sb-r-nav)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-field)', color: 'var(--sb-ink-1)', fontSize: 16 }} />
        <button type="button" disabled={!name} onClick={() => save(text)}
          style={{ padding: '8px 14px', borderRadius: 'var(--sb-r-nav)', border: 'none', background: 'var(--sb-accent)', color: 'var(--sb-accent-ink)', fontWeight: 600, cursor: name ? 'pointer' : 'default', opacity: name ? 1 : .5 }}>Save</button>
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        {NAME_IDEAS.map(n => (
          <button key={n} type="button" onClick={() => save(n)}
            style={{ padding: '4px 11px', borderRadius: 'var(--sb-r-pill)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', color: 'var(--sb-ink-2)', fontSize: 'var(--sb-t-meta)', cursor: 'pointer' }}>{n}</button>
        ))}
        <button type="button" onClick={() => savePersona({ ...loadPersonaNow(), asked: true })}
          style={{ padding: '4px 11px', border: 'none', background: 'none', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-meta)', cursor: 'pointer', textDecoration: 'underline' }}>Not now</button>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: DisplayMessage }) {
  const assistantName = usePersona().name
  if (msg.role === 'tool') {
    const state = msg.state ?? 'done'
    const label = msg.tool ? toolLabel(msg.tool) : { running: msg.content, done: msg.content }
    const failed = state === 'failed'
    const colour = failed ? 'var(--sb-negative-deep, var(--sb-negative))' : 'var(--sb-info)'
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
        <span className={state === 'running' ? 'ai-chip ai-chip-running' : 'ai-chip'} data-state={state} style={{
          position: 'relative', overflow: 'hidden',
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '4px 11px 4px 9px', borderRadius: 'var(--sb-r-pill)', fontSize: 'var(--sb-t-meta)',
          background: `color-mix(in srgb, ${failed ? 'var(--sb-negative)' : 'var(--sb-info)'} ${state === 'running' ? 10 : 6}%, transparent)`,
          border: `var(--sb-border-width) solid color-mix(in srgb, ${failed ? 'var(--sb-negative)' : 'var(--sb-info)'} ${state === 'running' ? 24 : 14}%, transparent)`,
          color: colour, opacity: state === 'running' ? 1 : 0.8,
          transition: 'opacity .25s ease, background .25s ease, border-color .25s ease',
        }}>
          {state === 'running' && (
            <svg className="ai-ring" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          {state === 'done'   && <Check size={13} strokeWidth={2.5} aria-hidden />}
          {failed             && <CircleAlert size={13} strokeWidth={2.25} aria-hidden />}
          <span role="status" aria-live="polite">{state === 'running' ? label.running : failed ? `${label.running.replace('…', '')} failed` : label.done}</span>
        </span>
      </div>
    )
  }

  if (msg.role === 'error') {
    return (
      <div style={{ margin: '8px 12px' }}>
        <div style={{
          padding: '10px 12px', borderRadius: 'var(--sb-r-nav)', fontSize: 'var(--sb-t-body-s)', lineHeight: 1.55,
          background: 'color-mix(in srgb, var(--sb-negative) 10.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 20.0%, transparent)',
          color: 'var(--sb-negative-tint)',
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
        <span style={{ marginRight: 8, marginTop: 2, flexShrink: 0 }}><AssistantAvatar size={28} radius="50%" name={assistantName} /></span>
      )}
      <div style={{
        // The assistant's bubble carries tables, so it takes the width; yours
        // is a sentence and stays a sentence.
        maxWidth: isUser ? '80%' : '92%', minWidth: 0, padding: '9px 12px',
        // Three corners on the card radius and one tucked in at the tail, so
        // the bubble points at whoever said it — and both move with the theme.
        borderRadius: isUser
          ? 'var(--sb-r-nav) var(--sb-r-nav) var(--sb-r-chip) var(--sb-r-nav)'
          : 'var(--sb-r-chip) var(--sb-r-nav) var(--sb-r-nav) var(--sb-r-nav)',
        background: isUser ? 'var(--sb-accent)' : 'var(--sb-field)',
        border: isUser ? 'none' : 'var(--sb-border-width) solid var(--sb-border)',
        fontSize: 'var(--sb-t-body)', lineHeight: 1.6,
        color: isUser ? 'var(--sb-accent-ink)' : 'var(--sb-ink-1)',
        ...(isUser ? { whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const } : {}),
      }}>
        {/* What went with the message. Without this the thread shows a question
            about a document nobody can see was ever handed over. */}
        {msg.files?.length ? (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: msg.content ? 6 : 0 }}>
            {msg.files.map(f => (
              <span key={f.name} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%',
                padding: '2px 8px', borderRadius: 'var(--sb-r-chip)',
                background: 'color-mix(in srgb, var(--sb-ink-1) 12%, transparent)',
                fontSize: 'var(--sb-t-meta)',
              }}>
                {f.kind === 'image' ? <ImageIcon size={12} /> : <FileText size={12} />}
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              </span>
            ))}
          </span>
        ) : null}
        {isUser ? msg.content : <Markdown text={msg.content} />}
      </div>
    </div>
  )
}

function ThinkingDot() {
  const assistantName = usePersona().name
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', margin: '6px 12px', alignItems: 'center', gap: 8 }}>
      <AssistantAvatar size={28} radius="50%" name={assistantName} />
      <div style={{ display: 'flex', gap: 4, padding: '10px 14px', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip) var(--sb-r-card) var(--sb-r-card) var(--sb-r-card)' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-info)', animation: `aiWave 1.3s ease-in-out ${i * 0.16}s infinite` }} />
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
  /** Collapsed to the button, but still here — the conversation is untouched. */
  minimised?: boolean
  onMinimise?: () => void
  /** A conversation found on load (URL or another device) has an answer on its way: bring the window up to show it. */
  onOpenRequest?: () => void
}

export function AssistantPanel({ open, onClose, minimised = false, onMinimise, onOpenRequest }: AssistantPanelProps) {
  const persona = usePersona()
  // ── The window: where it floats, how wide it is, and when it steps aside ───
  /** On screen. Collapsed (`minimised`) is faded out and kept mounted — the thread, the draft and an answer still arriving carry on. */
  const shown = open && !minimised
  const root = useRef<HTMLDivElement>(null)
  const [vw, setVw] = useState(() => window.innerWidth)
  /** What the person chose, bent to the screen only when drawn — so a narrow window never overwrites a wide choice. */
  const [chosenW, setChosenW] = useState(() => loadChosenWidth())
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ startX: number; startW: number; w: number } | null>(null)
  const winW = clampWidth(chosenW, vw)
  useEffect(() => {
    const on = () => setVw(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  // Anywhere else on any screen collapses it — not closes it. One listener, with a
  // 400ms guard: a touch screen replays a tap as a synthetic mousedown a moment after
  // pointerup, so whatever *opened* the window (the button, the search box, the name
  // listener) would otherwise collapse it in the same gesture. A ref holds the callback
  // so a re-render of the app does not re-arm the guard.
  const collapseRef = useRef(onMinimise)
  collapseRef.current = onMinimise
  useEffect(() => {
    if (!shown) return
    const openedAt = Date.now()
    const away = (e: PointerEvent) => {
      if (Date.now() - openedAt < 400) return
      const t = e.target as Element | null
      if (!t || !(t instanceof Element)) return
      if (root.current?.contains(t)) return
      if (t.closest('[data-assistant-fab]')) return          // the button decides for itself
      collapseRef.current?.()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !root.current?.contains(document.activeElement)) return
      collapseRef.current?.()
    }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc) }
  }, [shown])

  const gripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startW: winW, w: winW }
    setDragging(true)
  }
  const gripMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    d.w = widthFromDrag(d.startW, d.startX, e.clientX, window.innerWidth)
    setChosenW(d.w)
  }
  const gripUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d) saveWidth(d.w)                                   // the number the person saw, kept
  }
  const gripKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Anchored right, so ← widens and → narrows. Home resets to the default.
    const step = e.shiftKey ? 80 : 20
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = winW + step
    else if (e.key === 'ArrowRight') next = winW - step
    else if (e.key === 'Home') next = DEFAULT_WIDTH
    if (next === null) return
    e.preventDefault()
    const w = clampWidth(next, window.innerWidth)
    setChosenW(w); saveWidth(w)
  }
  // ── Voice: tap the mic, say it, hear it back ──────────────────────────────
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  const micRef = useRef<Listening | null>(null)
  /** The question in flight was spoken, so its answer is read aloud (if the person has that on). */
  const spokenRef = useRef(false)
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
  // A half-typed message survives a reload (and a dimmed iPad): it is kept per device, not per conversation.
  const [input,         setInput]          = useState(() => loadDraft())
  /** A turn this page is running itself (the in-browser path) or a request it has just handed to the server. */
  const [localThinking, setThinking]       = useState(false)
  // ── The conversation lives on the server (20260042/43, functions/assistant-chat) ──
  const [convId, setConvId] = useState<string | null>(null)
  const convRef = useRef<string | null>(null)
  const [rows, setRows] = useState<ChatRow[]>([])
  const rowsRef = useRef<ChatRow[]>([])
  const [tick, setTick] = useState(0) // re-reads the clock so an answer that stops arriving is seen to have stopped
  /** `unknown` until the function has answered once; `no` for the rest of this page's life if it cannot be used. */
  const serverMode = useRef<'unknown' | 'yes' | 'no'>('unknown')
  const serverFails = useRef(0)
  /** Set while a turn runs in the browser (a message with a file, or no function to call): the thread is drawn from state, not rows. */
  const legacyRef = useRef(false)
  const legacyStart = useRef<Set<string>>(new Set())
  const awaiting = useRef<{ after: number } | null>(null)
  const executing = useRef<Set<number>>(new Set())
  const interrupted = useRef<Set<number>>(new Set())
  const continueAsked = useRef<{ sig: string; at: number; n: number } | null>(null)
  const serverBusy = busyOf(rows, Date.now())
  /** What the in-browser path has used that is not yet on a row: shown at once, handed to `persistBubbles` with the turn,
   *  and dropped the moment the rows that now carry it are read back (so it is never counted twice). */
  const [legacyUsage, setLegacyUsage] = useState<Array<{ u: ModelUsage; persisted: boolean }>>([])
  const legacyUsageRef = useRef<Array<{ u: ModelUsage; persisted: boolean }>>([])
  /** The provider's own reading of the room left, from the last reply THIS page made itself (the server path's arrive on the rows).
   *  A browser can read a response header only if the provider's CORS rules expose it, so this may stay empty. */
  const [legacyLimits, setLegacyLimits] = useState<Limits | null>(null)
  const legacyLimitsRef = useRef<Limits | null>(null)
  const limitsPersistedAt = useRef(0)
  const noteLimits = (provider: 'anthropic' | 'groq', res: Response) => {
    const l = parseLimits(provider, n => res.headers.get(n))
    if (l) { legacyLimitsRef.current = l; setLegacyLimits(l) }
  }
  /** Characters of the in-browser answer being written, for the counter's live estimate. */
  const [liveChars, setLiveChars] = useState(0)
  const recordUsage = (u: ModelUsage) => { legacyUsageRef.current = [...legacyUsageRef.current, { u, persisted: false }]; setLegacyUsage(legacyUsageRef.current) }
  const thinking = localThinking || serverBusy
  // A screenshot of an invoice or a PDF statement is the fastest way to tell
  // the assistant something. Three ways in: the clip, a paste, a drop.
  const [attachments,   setAttachments]    = useState<Attachment[]>([])
  const [attachError,   setAttachError]    = useState<string | null>(null)
  const [dropping,      setDropping]       = useState(false)
  /** An action the assistant wants to take that needs the person's OK. It waits here, and runs only on a click. */
  const [approval, setApproval] = useState<(Approval & { resolve: (ok: boolean) => void }) | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const lastProviderRef = useRef<string>('')

  const addFiles = useCallback(async (files: File[]) => {
    const usable = files.filter(f => kindOf(f))
    const refused = files.filter(f => !kindOf(f))
    if (refused.length) setAttachError(`${refused.map(f => f.name).join(', ')} — images, PDFs and text files only.`)
    else if (usable.length) setAttachError(null)
    for (const f of usable) {
      try {
        const a = await readAttachment(f)
        // Each one lands as it is read; a big photo being scaled must not hold
        // up the small one behind it.
        setAttachments(prev => (prev.some(p => p.name === a.name && p.size === a.size) ? prev : [...prev, a]))
      } catch (e) {
        setAttachError(e instanceof Error ? e.message : 'That file could not be read.')
      }
    }
  }, [])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayMessages, thinking])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200)
  }, [open])

  // The box is as tall as its text, up to 120px — measured whenever the text changes and not only when a key is
  // pressed. It was an `onInput` handler, so clearing the box after Send (a state change, not an input event)
  // left a three-line height standing under an empty box.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [input, open])

  const accounts     = loadAccounts()
  const primaryEmail = user?.email ?? ''
  const ctx: ToolContext = { tasks, addTask, updateTask, deleteTask, accounts, primaryEmail, habits }

  /** A chip is told when its tool comes back. */
  function settleChip(id: string, state: 'done' | 'failed') {
    setDisplayMessages(prev => prev.map(m => (m.id === id ? { ...m, state } : m)))
  }

  /** Mirrors of render-time values for the effects below, which must not re-subscribe on every render. */
  const runToolRef = useRef(runTool)
  runToolRef.current = runTool
  const displayRef = useRef<DisplayMessage[]>([])
  displayRef.current = displayMessages
  const userIdRef = useRef<string | undefined>(undefined)
  userIdRef.current = user?.id
  const onOpenRequestRef = useRef(onOpenRequest)
  onOpenRequestRef.current = onOpenRequest

  /** Every tool call goes through here. A call that is outward, destructive or about money shows what it will do
   *  and waits for the person; only a click runs it, and a refusal is handed back to the model as a refusal. */
  async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    const need = approvalFor(name, input)
    if (need) {
      const ok = await new Promise<boolean>(resolve => setApproval({ ...need, resolve }))
      setApproval(null)
      if (!ok) return DECLINED
    }
    return executeTool(name, input, ctx)
  }


  // ── The conversation on the server: load it, follow it, run its tools, resume it ──────────────
  //
  // The thread is `assistant_messages`; this panel draws it. The model is called by the
  // `assistant-chat` function, which keeps writing the answer when this page is frozen or
  // reloaded (iPad Safari does both to a dimmed tab). Tools still run HERE — they read and
  // write the app's own stores and wait on an approval card — so the function parks each call
  // as a row, this page takes it (once; two open devices cannot both run `delete_task`), and
  // asks for the next step. If the server or its tables are not there, or the message carries
  // a file, the old in-browser loop below runs unchanged.

  const attach = useCallback((id: string, got: ChatRow[], opts?: { open?: boolean }) => {
    convRef.current = id; setConvId(id)
    rowsRef.current = got; setRows(got)
    try { history.replaceState(history.state, '', urlWithChat(location.href, id)) } catch { /* the address bar is a convenience */ }
    if (opts?.open && busyOf(got, Date.now())) onOpenRequestRef.current?.()
  }, [])
  const detach = useCallback(() => {
    convRef.current = null; setConvId(null)
    rowsRef.current = []; setRows([])
    try { history.replaceState(history.state, '', urlWithChat(location.href, null)) } catch { /* as above */ }
  }, [])
  const applyRows = useCallback((next: ChatRow[]) => { rowsRef.current = next; setRows(next) }, [])

  // On load: the conversation in the address, else the newest live one (that is how a second device finds the thread).
  useEffect(() => {
    const uid = user?.id
    if (!uid) return
    let dead = false
    void (async () => {
      let id = chatIdFromUrl(location.href)
      const fromUrl = !!id
      if (id) {
        const c = await fetchConversation(id)
        if (!c || c.archived) { id = null; try { history.replaceState(history.state, '', urlWithChat(location.href, null)) } catch { /* as above */ } }
      }
      if (!id) id = await fetchLatestConversationId(uid)
      if (!id || dead || convRef.current) return
      const got = await fetchMessages(id)
      if (!got || dead || convRef.current) return
      attach(id, got, { open: fromUrl })
    })()
    return () => { dead = true }
  }, [user?.id, attach])

  // Read the thread again — authoritative, so it replaces. Used when the page comes back and while an answer is on its way.
  const lastRefresh = useRef(0)
  const refreshLater = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refresh = useCallback(async (force = false): Promise<void> => {
    const now = Date.now()
    // visibilitychange, pageshow and focus arrive together: one read covers them — but a read still happens AFTER the
    // last of them, or whatever the later event was announcing would be dropped with it.
    if (!force && now - lastRefresh.current < 1000) {
      if (!refreshLater.current) refreshLater.current = setTimeout(() => { refreshLater.current = null; void refresh(true) }, 1000 - (now - lastRefresh.current) + 50)
      return
    }
    lastRefresh.current = now
    const uid = userIdRef.current
    if (!uid || legacyRef.current) return
    let id = convRef.current
    if (!id) { id = await fetchLatestConversationId(uid); if (!id || convRef.current) return }
    const got = await fetchMessages(id)
    if (!got || legacyRef.current) return
    if (!convRef.current) attach(id, got, { open: false })
    else if (convRef.current === id) applyRows(got)
  }, [attach, applyRows])

  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('pageshow', back)   // a tab restored from the back/forward cache never fires "load" again
    window.addEventListener('online', back)
    window.addEventListener('focus', back)
    return () => {
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('pageshow', back)
      window.removeEventListener('online', back)
      window.removeEventListener('focus', back)
    }
  }, [refresh])

  // Rows arrive by Realtime; while an answer is on its way a poll backs it up (a websocket does not survive a dimmed iPad).
  useEffect(() => {
    if (!convId) return
    return subscribeMessages(convId, got => applyRows(mergeRows(rowsRef.current, got)), gone => applyRows(rowsRef.current.filter(r => r.id !== gone)))
  }, [convId, applyRows])
  useEffect(() => {
    // `thinking`, not only a streaming row: right after Send the only row is the question, and a parked tool call
    // or the first word of the answer has to be found by somebody.
    if (!convId || !thinking) return
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void refresh(true) }, 2500)
    const tick = setInterval(() => setTick(t => t + 1), 5000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [convId, thinking, refresh])

  // An answer nobody is writing any more is over; say so on every device.
  useEffect(() => {
    for (const r of rows) {
      if (isStaleStreaming(r, Date.now()) && !interrupted.current.has(r.id)) { interrupted.current.add(r.id); void markInterrupted(r.id) }
    }
  }, [rows, tick])

  // The thread on screen is the rows (unless a turn is running in the browser, which draws itself).
  useEffect(() => {
    if (!convId || legacyRef.current) return
    setDisplayMessages(rowsToBubbles(rows, Date.now()) as DisplayMessage[])
  }, [rows, convId, tick])
  // Release the composer once the server's answer has begun to appear.
  useEffect(() => {
    const a = awaiting.current
    if (a && rows.some(r => r.id > a.after && r.role !== 'user')) { awaiting.current = null; setThinking(false) }
  }, [rows])

  /** What a model step needs from this page, which owns the system prompt, the tool list and the key. */
  const stepBody = (mode: 'turn' | 'continue', conversationId: string) => {
    const cfg = loadAIConfig()
    const today = new Date().toISOString().slice(0, 10)
    const userName = user?.name?.split(' ')[0] ?? user?.email ?? 'there'
    const groq = cfg.provider === 'groq'
    return {
      conversationId, mode, provider: groq ? 'groq' as const : 'anthropic' as const,
      model: groq ? cfg.groqModel : claudeModelOf(cfg),
      system: buildSystemPrompt(userName, today, samuraiActive, persona.name),
      tools: (groq ? toGroqTools(ASSISTANT_TOOLS) : ASSISTANT_TOOLS) as unknown[],
      key: (groq ? cfg.groqKey : cfg.anthropicKey) || undefined,
    }
  }
  const stepBodyRef = useRef(stepBody)
  stepBodyRef.current = stepBody

  // Run the tool calls the model asked for. A call is taken once (a conditional update is the claim), only by a page
  // that is in front of the person, and its approval card appears here as it always did.
  useEffect(() => {
    const id = convRef.current
    if (!id || document.visibilityState !== 'visible') return
    const todo = claimable(rows, Date.now(), deviceId()).filter(r => !executing.current.has(r.id))
    if (!todo.length) return
    for (const r of todo) executing.current.add(r.id)
    void (async () => {
      for (const r of todo) {
        const dev = deviceId()
        if (!(await claimTool(r.id, dev))) { executing.current.delete(r.id); continue }
        const beat = setInterval(() => void refreshClaim(r.id, dev), 30_000) // still deciding on the card: keep the claim
        let state: 'done' | 'failed' = 'done'
        let out = ''
        try { out = JSON.stringify(await runToolRef.current(r.tool ?? '', (r.tool_input ?? {}) as Record<string, unknown>)) ?? 'null' }
        catch (e) { state = 'failed'; out = `Error: ${e instanceof Error ? e.message : String(e)}` }
        clearInterval(beat)
        await finishTool(r.id, state, out)
        applyRows(mergeRows(rowsRef.current, [{ ...r, tool_state: state, tool_result: out, claimed_by: dev, updated_at: new Date().toISOString() }]))
      }
    })()
  }, [rows, applyRows])

  // Every tool of a step has come back and nothing has started after: ask for the next step. Whichever page sees it
  // first asks; a second ask finds the answer already streaming and is turned away by the server. This is also how a
  // page that was reloaded between the last tool and the next step finishes the job.
  useEffect(() => {
    const id = convRef.current
    if (!id || document.visibilityState !== 'visible') return
    const sig = awaitingContinue(rows)
    if (!sig) return
    const prev = continueAsked.current
    if (prev && prev.sig === sig && (Date.now() - prev.at < 30_000 || prev.n >= 3)) return
    continueAsked.current = { sig, at: Date.now(), n: prev && prev.sig === sig ? prev.n + 1 : 1 }
    void requestStep(stepBodyRef.current('continue', id))
  }, [rows])

  /** Hand a message to the server. False means "use the browser path": nothing is left behind. */
  async function sendViaServer(trimmed: string, cfg: AIConfig, clientId: string): Promise<boolean> {
    const uid = user?.id
    if (!uid || serverMode.current === 'no') return false
    const existing = convRef.current
    const id = existing ?? crypto.randomUUID()
    const failed = () => { if (++serverFails.current >= 2) serverMode.current = 'no' }
    if (!existing && !(await createConversation(id, uid, cfg.provider === 'groq' ? 'groq' : 'anthropic'))) { failed(); return false }
    if (!(await insertUserMessage({ conversationId: id, userId: uid, clientId, text: trimmed }))) {
      if (!existing) await archiveConversation(id)
      failed(); return false
    }
    const res = await requestStep(stepBodyRef.current('turn', id))
    if (res !== 'accepted') {
      await deleteMessageByClientId(id, clientId)
      if (!existing) await archiveConversation(id)
      if (res === 'unavailable') serverMode.current = 'no'
      return false
    }
    serverFails.current = 0
    serverMode.current = 'yes'
    const got = (await fetchMessages(id)) ?? []
    if (!existing) attach(id, got); else applyRows(got)
    awaiting.current = { after: Math.max(0, ...got.map(r => r.id)) }
    // If the answer never starts to show (a slow cold start), do not hold the box shut for ever.
    setTimeout(() => { if (awaiting.current) { awaiting.current = null; setThinking(false) } }, 30_000)
    return true
  }

  // A turn that ran in the browser is written to the server afterwards, so the thread still survives a reload.
  useEffect(() => {
    if (localThinking || !legacyRef.current) return
    legacyRef.current = false
    const uid = user?.id
    const fresh = displayMessages.filter(m => !legacyStart.current.has(m.id))
    if (!uid || !fresh.length) return
    // What this turn used, per model, to be written ONCE on the rows it produced.
    const mine = legacyUsageRef.current.filter(e => !e.persisted)
    let byModel = groupByModel(mine.map(e => e.u))
    // The newest reading rides on the first usage — or on a zero-token one of its own when the turn spent nothing (a refusal),
    // because "you are out" is exactly what the next device needs to know.
    const lim = legacyLimitsRef.current
    if (lim && lim.at > limitsPersistedAt.current) {
      if (byModel.length) byModel = [{ ...byModel[0], limits: lim }, ...byModel.slice(1)]
      else byModel = [{ provider: lim.provider, model: lim.provider === 'groq' ? loadAIConfig().groqModel : claudeModelOf(loadAIConfig()), input: 0, output: 0, cacheRead: 0, cacheWrite: 0, limits: lim }]
    }
    void (async () => {
      let id = convRef.current
      const isNew = !id
      if (!id) {
        id = crypto.randomUUID()
        if (!(await createConversation(id, uid, loadAIConfig().provider === 'groq' ? 'groq' : 'anthropic'))) return
      }
      const toWrite = fresh.map(m => ({
        clientId: m.role === 'tool' ? null : m.id, role: m.role, content: m.content,
        ...(m.role === 'tool' ? { tool: m.tool ?? m.content, toolUseId: m.id.replace(/^tool-/, ''), toolState: m.state } : {}),
        ...(m.files?.length ? { files: m.files } : {}),
      })) as Parameters<typeof persistBubbles>[2]
      // The first model's tokens ride on the turn's last answer; any further model, or a turn with no answer at all (an
      // error), gets an empty answer row of its own — the tokens were spent either way.
      const lastAnswer = toWrite.map(r => r.role).lastIndexOf('assistant')
      byModel.forEach((u, i) => {
        if (i === 0 && lastAnswer >= 0) toWrite[lastAnswer] = { ...toWrite[lastAnswer], usage: u }
        else toWrite.push({ clientId: null, role: 'assistant', content: '', usage: u })
      })
      const ok = await persistBubbles(id, uid, toWrite)
      if (!ok) return
      if (lim) limitsPersistedAt.current = Math.max(limitsPersistedAt.current, lim.at)
      // Written: never write them again, but keep showing them until the rows that now hold them are read back.
      legacyUsageRef.current = legacyUsageRef.current.map(e => mine.includes(e) ? { ...e, persisted: true } : e)
      setLegacyUsage(legacyUsageRef.current)
      const got = await fetchMessages(id)
      // Rows that did not come back mean the tables are not really there: keep drawing from state.
      if (!got || got.length < fresh.length) return
      legacyUsageRef.current = legacyUsageRef.current.filter(e => !e.persisted)
      setLegacyUsage(legacyUsageRef.current)
      if (isNew) attach(id, got); else applyRows(got)
    })()
  }, [localThinking]) // eslint-disable-line react-hooks/exhaustive-deps

  // What the model should remember when the in-browser path takes over a thread that was read from the server.
  function plainHistory(): { anthropic: Anthropic.MessageParam[]; groq: GroqMessage[] } {
    const turns = alternating(displayRef.current
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })))
    // The message about to be sent is the next user turn; a trailing one (its answer failed) would make two in a row.
    while (turns.length && turns[turns.length - 1].role === 'user') turns.pop()
    return { anthropic: turns.map(t => ({ role: t.role, content: t.content })), groq: turns.map(t => ({ role: t.role, content: t.content }) as GroqMessage) }
  }

  // ── Anthropic agentic loop (streaming) ─────────────────────────────────────

  async function runAnthropic(trimmed: string, cfg: AIConfig, system: string, history: Anthropic.MessageParam[], atts: Attachment[] = []) {
    // The SDK's own fetch, with a look at the headers on the way past (the provider's word on the room left).
    const tap = (async (input: RequestInfo | URL, init?: RequestInit) => { const r = await fetch(input, init); noteLimits('anthropic', r); return r }) as typeof fetch
    const client = new Anthropic({ apiKey: cfg.anthropicKey, dangerouslyAllowBrowser: true, fetch: tap })
    // A message with nothing attached stays a plain string — the block form is
    // only needed when there is something to put beside the words.
    const content = atts.length
      ? toAnthropicContent(trimmed, atts) as Anthropic.ContentBlockParam[]
      : trimmed
    let msgs: Anthropic.MessageParam[] = [...history, { role: 'user', content }]

    while (true) {
      // Stream text in real-time; collect final message for tool-use detection
      const streamId   = crypto.randomUUID()
      let   accumText  = ''

      const stream = client.messages.stream({
        model: claudeModelOf(cfg), max_tokens: 4096,
        system, tools: ASSISTANT_TOOLS, messages: msgs,
      })

      stream.on('text', chunk => {
        accumText += chunk
        setLiveChars(accumText.length)
        setDisplayMessages(prev => {
          const exists = prev.some(m => m.id === streamId)
          return exists
            ? prev.map(m => m.id === streamId ? { ...m, content: accumText } : m)
            : [...prev, { id: streamId, role: 'assistant' as const, content: accumText }]
        })
      })

      const response = await stream.finalMessage()
      // What the provider says this request used — the only exact number there is.
      const ru = response.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined
      setLiveChars(0)
      if (ru) recordUsage({ provider: 'anthropic', model: claudeModelOf(cfg), input: ru.input_tokens ?? 0, output: ru.output_tokens ?? 0, cacheRead: ru.cache_read_input_tokens ?? 0, cacheWrite: ru.cache_creation_input_tokens ?? 0 })
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
        const chip = `tool-${block.id}`
        setDisplayMessages(prev => [...prev, { id: chip, role: 'tool', content: block.name, tool: block.name, state: 'running' }])
        try {
          const result = await runTool(block.name, block.input as Record<string, unknown>)
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
          settleChip(chip, 'done')
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err instanceof Error ? err.message : String(err)}`, is_error: true })
          settleChip(chip, 'failed')
        }
      }
      msgs = [...msgs, { role: 'user', content: toolResults }]
    }
  }

  // ── Groq agentic loop ───────────────────────────────────────────────────────

  async function runGroq(trimmed: string, cfg: AIConfig, system: string, history: GroqMessage[], atts: Attachment[] = []) {
    let msgs: GroqMessage[] = [...history, { role: 'user', content: atts.length ? toGroqContent(trimmed, atts) : trimmed }]

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

      noteLimits('groq', res)
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as GroqResponse
        throw new Error(err.error?.message ?? `Groq ${res.status}`)
      }

      const data  = await res.json() as GroqResponse
      if (data.usage) recordUsage({ provider: 'groq', model: cfg.groqModel, input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0, cacheRead: 0, cacheWrite: 0 })
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
        const chip = `tool-${call.id}`
        setDisplayMessages(prev => [...prev, { id: chip, role: 'tool', content: toolName, tool: toolName, state: 'running' }])
        try {
          const result = await runTool(toolName, toolInput)
          toolResults.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
          settleChip(chip, 'done')
        } catch (err) {
          toolResults.push({ role: 'tool', tool_call_id: call.id, content: `Error: ${err instanceof Error ? err.message : String(err)}` })
          settleChip(chip, 'failed')
        }
      }
      msgs = [...msgs, ...toolResults]
    }
  }

  // ── Send handler ────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    // A file on its own is a message: "what is this?" is implied by dropping it.
    if ((!trimmed && attachments.length === 0) || thinking) return

    let cfg = loadAIConfig()
    stopSpeaking()

    // What this provider cannot take is said before the request, not after it
    // fails — and never by quietly dropping the thing you just attached.
    const cannot = unsupported(cfg.provider, attachments) ?? tooLarge(attachments)
    if (cannot) { setAttachError(cannot); return }

    // Validate key for selected provider
    if (cfg.provider === 'anthropic' && !cfg.anthropicKey) {
      setDisplayMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'error', content: 'No Anthropic API key set. Go to Settings → AI.' }])
      return
    }
    if (cfg.provider === 'groq' && !cfg.groqKey) {
      setDisplayMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'error', content: 'No Groq API key set. Go to Settings → AI.' }])
      return
    }

    // A Groq model the key cannot use ("does not exist or you do not have access to it") is found out here, once per
    // model, with a one-token request — and replaced by one that works, with the person told. Only a definite "that
    // model is not available" changes anything; being offline or rate-limited leaves the choice alone.
    if (cfg.provider === 'groq') {
      const healed = await ensureWorkingGroqModel(cfg.groqKey, cfg.groqModel)
      if (healed.switched) {
        const from = cfg.groqModel
        cfg = { ...cfg, groqModel: healed.model }
        saveAIConfig(cfg)
        notify(`Groq cannot use ${from} with your key, so I switched to ${healed.model}. Change it any time in Settings → AI.`)
      }
    }

    // If provider switched since last message, reset that provider's history
    if (lastProviderRef.current && lastProviderRef.current !== cfg.provider) {
      setAnthropicMsgs([])
      setGroqMsgs([])
    }
    lastProviderRef.current = cfg.provider

    const today    = new Date().toISOString().slice(0, 10)
    const userName = user?.name?.split(' ')[0] ?? user?.email ?? 'there'
    const system   = buildSystemPrompt(userName, today, samuraiActive, persona.name)

    const sending = attachments

    // The server answers it (and keeps answering if this page is frozen or reloaded). A message with a file stays in the
    // browser: the bytes are not sent through the function, so that turn is written to the thread afterwards instead.
    if (!sending.length && user?.id && serverMode.current !== 'no') {
      const clientId = crypto.randomUUID()
      setInput('')
      setAttachError(null)
      setThinking(true)
      setDisplayMessages(prev => [...prev, { id: clientId, role: 'user', content: trimmed }])
      if (await sendViaServer(trimmed, cfg, clientId)) return
      setDisplayMessages(prev => prev.filter(m => m.id !== clientId))
      setThinking(false)
    }

    legacyRef.current = true
    legacyStart.current = new Set(displayRef.current.map(m => m.id))
    const carried = plainHistory()
    setInput('')
    setAttachments([])
    setAttachError(null)
    setThinking(true)
    setDisplayMessages(prev => [...prev, {
      id: crypto.randomUUID(), role: 'user', content: trimmed,
      ...(sending.length ? { files: sending.map(a => ({ name: a.name, kind: a.kind })) } : {}),
    }])

    try {
      if (cfg.provider === 'groq') {
        await runGroq(trimmed, cfg, system, groqMsgs.length ? groqMsgs : carried.groq, sending)
      } else {
        await runAnthropic(trimmed, cfg, system, anthropicMsgs.length ? anthropicMsgs : carried.anthropic, sending)
      }
    } catch (err) {
      const msg     = err instanceof Error ? err.message : String(err)
      const is401   = msg.includes('401') || msg.includes('authentication') || msg.includes('invalid_api_key')
      const sent = cfg.provider === 'groq' ? cfg.groqKey : cfg.anthropicKey
      const label    = cfg.provider === 'groq' ? 'Groq' : 'Anthropic'
      const model    = cfg.provider === 'groq' ? cfg.groqModel : claudeModelOf(cfg)
      // Three different problems that all end in "it did not answer", with three different fixes — so three sentences.
      const friendly = is401
        ? `${label} refused the key that was sent: ${maskKey(sent)}. Check Settings → AI. It said: ${msg.slice(0, 200)}`
        : isBillingMessage(msg)
          ? `${label} says the account is out of credit or past its billing date. Top it up with ${label}, or choose another provider or model in Settings → AI. It said: ${msg.slice(0, 200)}`
          : /\b429\b|rate.?limit/i.test(msg)
            ? `${label} has used up its allowance for now${legacyLimitsRef.current?.retryAfter !== undefined ? ` — it opens again in ${waitText(legacyLimitsRef.current.retryAfter)}` : ' — wait a moment and ask again'}. If this keeps happening the limit is for the whole account, not this app. It said: ${msg.slice(0, 200)}`
          : isModelMissingMessage(msg)
            ? `${label} says your key cannot use the model “${model}”. Pick another in Settings → AI — the list there is what your key can use. It said: ${msg.slice(0, 200)}`
            : `Error: ${msg}`
      setDisplayMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'error', content: friendly }])
    } finally {
      setThinking(false)
      // Whatever ended the turn — an answer, an error, a refused key — nothing
      // may be left spinning under it.
      setDisplayMessages(prev => prev.some(m => m.state === 'running')
        ? prev.map(m => (m.state === 'running' ? { ...m, state: 'failed' as const } : m))
        : prev)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anthropicMsgs, groqMsgs, thinking, user, tasks, attachments])

  // A request parked by the search box (or the voice listener): taken when it arrives, and when the panel opens
  // after it. If an answer is still being written the question waits its turn rather than being lost.
  const sendRef = useRef(sendMessage)
  sendRef.current = sendMessage
  useEffect(() => {
    if (!open || thinking) return
    const take = () => {
      const r = takePendingAsk()
      if (!r) return
      if (r.spoken) spokenRef.current = true
      if (r.text) void sendRef.current(r.text)
      else if (r.spoken && speechSupported()) talkRef.current()
    }
    take()
    window.addEventListener(ASK_EVENT, take)
    return () => window.removeEventListener(ASK_EVENT, take)
  }, [open, thinking])

  const voiceError = (e: ListenError): string => ({
    denied: 'The microphone is switched off for this page. Allow it in your browser’s site settings to talk.',
    blocked: 'The browser would not start listening without a tap. Tap the microphone.',
    unsupported: 'This browser cannot listen. Typing works everywhere; on iPhone and iPad, Safari can.',
    failed: 'Listening kept stopping, so I gave up. Tap the microphone to try again.',
  }[e])

  const talk = useCallback(() => {
    unlockSpeech()
    stopSpeaking()
    micRef.current?.stop()
    setVoiceNote(null)
    micRef.current = startListening({
      lang: recognitionLang(persona.lang), loop: false,
      onInterim: setInterim,
      onFinal: heard => {
        // Said as "Beau, add milk", or just "add milk": either is a request. Only the name is "I'm here".
        const a = persona.name ? addressedTo(heard, persona.name, { voice: true }) : null
        const text = a?.addressed ? a.rest : heard
        if (!text) { setVoiceNote(`I’m listening${persona.name ? `, ${persona.name} here` : ''} — go ahead.`); setTimeout(() => talkRef.current(), 250); return }
        spokenRef.current = true
        setInterim('')
        void sendRef.current(text)
      },
      onState: on => { setListening(on); if (!on) setInterim('') },
      onError: e => setVoiceNote(voiceError(e)),
    })
  }, [persona.lang, persona.name])
  const talkRef = useRef(talk)
  talkRef.current = talk

  // Answer aloud when the question was spoken. Typed questions are answered in writing.
  useEffect(() => {
    if (thinking || !spokenRef.current) return
    const last = displayMessages[displayMessages.length - 1]
    if (last?.role !== 'assistant') return
    spokenRef.current = false
    if (persona.speak) speak(last.content, recognitionLang(persona.lang))
  }, [thinking, displayMessages, persona.speak, persona.lang])

  // Closing the panel ends the conversation's ears and voice.
  useEffect(() => { if (!open) { micRef.current?.stop(); stopSpeaking() } }, [open])
  useEffect(() => () => { micRef.current?.stop(); stopSpeaking() }, [])

  // A limit reading is a moment: the minute bucket refills by itself and the reading grows old. Keep it honest on screen.
  const anyReading = legacyLimits !== null || rows.some(r => r.usage != null)
  useEffect(() => {
    if (!anyReading || !shown) return
    const t = setInterval(() => setTick(n => n + 1), 10_000)
    return () => clearInterval(t)
  }, [anyReading, shown])

  // Settings → AI can change the model while this window is open (the same page, or another tab): redraw the header.
  const [, setCfgTick] = useState(0)
  useEffect(() => {
    const on = () => setCfgTick(n => n + 1)
    window.addEventListener(AI_CONFIG_EVENT, on)
    window.addEventListener('storage', on)
    return () => { window.removeEventListener(AI_CONFIG_EVENT, on); window.removeEventListener('storage', on) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => saveDraft(input), 250)
    return () => clearTimeout(t)
  }, [input])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(input) }
  }

  function clearConversation() {
    approval?.resolve(false)
    setAttachments([])
    setAttachError(null)
    setDisplayMessages([])
    setAnthropicMsgs([])
    setGroqMsgs([])
    // "Forget the conversation" archives it: out of sight on every device, kept on the server.
    const id = convRef.current
    if (id) void archiveConversation(id)
    awaiting.current = null
    legacyUsageRef.current = []; setLegacyUsage([]); setLiveChars(0)
    legacyLimitsRef.current = null; setLegacyLimits(null)
    detach()
  }

  const cfg   = loadAIConfig()
  // ── The usage counter beside the model name: what this conversation has used, exact where the provider said so ──
  const shownModel = cfg.provider === 'groq' ? cfg.groqModel : claudeModelOf(cfg)
  const spent: ModelUsage[] = [
    ...rows.map(r => usageFromRow(r.usage)).filter((u): u is ModelUsage => !!u),
    ...legacyUsage.map(e => e.u),
  ]
  // An answer still being written has no count yet (the provider reports it when the reply ends); estimate it from what
  // is on screen so the counter moves while it works, and mark the figure "~" until the real one replaces it.
  const writing = rows.find(r => r.status === 'streaming' && !isStaleStreaming(r, Date.now()))
  const liveOut = estimateOutputTokens(writing ? writing.content.length : liveChars)
  if (liveOut > 0) spent.push({ provider: cfg.provider === 'groq' ? 'groq' : 'anthropic', model: shownModel, input: 0, output: liveOut, cacheRead: 0, cacheWrite: 0 })
  const usageSummary = summarise(spent, cfg.prices)
  const counter: BadgeUsage = { ...counterText(usageSummary, liveOut > 0), live: liveOut > 0, tokens: usageSummary.total, usd: usageSummary.usd }
  // ── The provider's own word on the room left: the newest reading, from a row (any device) or this page's own reply ──
  const nowMs = Date.now()
  let rowLimits: Limits | null = null
  for (let i = rows.length - 1; i >= 0 && !rowLimits; i--) rowLimits = limitsFromRow((rows[i].usage as { limits?: unknown } | null | undefined)?.limits)
  const best = legacyLimits && (!rowLimits || legacyLimits.at > rowLimits.at) ? legacyLimits : rowLimits
  const limitsView = best && best.provider === (cfg.provider === 'groq' ? 'groq' : 'anthropic') ? viewLimits(best, nowMs) : null
  const isEmpty = displayMessages.length === 0

  return (
    <>
      <div ref={root} className="ai-window" data-assistant-window data-shown={shown ? 'true' : 'false'}
        role="region" aria-label={`${labelOf(persona)}, your assistant`} aria-hidden={!shown}
        // NOT role="dialog": it is not modal, and three modules ask `[role="dialog"]` whether a
        // dialog is open (Library Escape, the calendar's Delete key, the event composer's
        // dismissal). A window that is always mounted would answer yes for every one of them.
        style={{
          // A floating card above the button, not a column down the side: it
          // covers what it has to and no more, and the page behind stays visible.
          position: 'fixed', zIndex: 150,
          right: `calc(${rightGap(vw)}px + env(safe-area-inset-right))`,
          bottom: 'calc(24px + 72px + 14px + env(safe-area-inset-bottom))',
          width: winW, height: 'min(640px, calc(100dvh - 200px - env(safe-area-inset-bottom)))',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          // Opaque in every theme: it is drawn over the page, and a wash that is
          // legible only when a blur lands is how two panels once read as one.
          background: 'var(--sb-overlay)',
          border: 'var(--sb-border-width) solid var(--sb-border)',
          borderRadius: 'var(--sb-r-card)',
          boxShadow: 'var(--sb-shadow-frame)',
        }}>

        {/* The left edge is the handle: the right edge is fixed, so dragging it
            left widens the window. Keyboard and double-click work too. */}
        <div className="ai-resize" role="separator" aria-orientation="vertical" aria-label="Resize the assistant"
          aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={winW} tabIndex={shown ? 0 : -1}
          data-dragging={dragging ? 'true' : 'false'}
          onPointerDown={gripDown} onPointerMove={gripMove} onPointerUp={gripUp} onPointerCancel={gripUp}
          onKeyDown={gripKey}
          onDoubleClick={() => { const w = clampWidth(DEFAULT_WIDTH, window.innerWidth); setChosenW(w); saveWidth(w) }}
          title="Drag to resize · double-click to reset"
          style={{ position: 'absolute', left: 0, top: 16, bottom: 16, width: 12, zIndex: 3, cursor: 'ew-resize', touchAction: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
          <span aria-hidden className="ai-resize-grip"
            style={{ width: 4, height: 44, marginLeft: 2, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-ink-4)' }} />
        </div>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px', borderBottom: 'var(--sb-border-width) solid var(--sb-border)', flexShrink: 0,
        }}>
          <AssistantAvatar size={38} radius="50%" name={persona.name} />
          {/* minWidth 0: a flex child will not shrink below its content otherwise, and a long model id would push the buttons out. */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>{labelOf(persona)}</p>
            <ModelBadge provider={cfg.provider === 'groq' ? 'groq' : 'anthropic'} model={shownModel} usage={counter} />
            {limitsView && best && <LimitsLine view={limitsView} ageText={ageWords(nowMs - best.at)} />}
          </div>
          {!isEmpty && (
            <button onClick={clearConversation}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 4, fontSize: 'var(--sb-t-meta)' }}>
              Clear
            </button>
          )}
          {onMinimise && (
            <button onClick={onMinimise} title="Collapse — the conversation stays"
              aria-label="Collapse the assistant"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 4, display: 'flex' }}>
              <ChevronDown size={ICON.md} />
            </button>
          )}
          <button onClick={() => { clearConversation(); onClose() }} title="Close, and forget the conversation" aria-label="Close the assistant"

            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 4, display: 'flex' }}>
            <X size={ICON.md} />
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          {isEmpty ? (
            <div style={{ padding: '32px 20px', textAlign: 'center' }}>
              <div style={{ margin: '0 auto 14px', width: 88 }}><AssistantAvatar size={88} radius="50%" name={persona.name} /></div>
              {!persona.name && !persona.asked ? <NamePrompt /> : (
                <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-h3)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
                  {persona.name ? `I’m ${persona.name}. How can I help?` : 'How can I help?'}
                </p>
              )}
              <p style={{ margin: '0 0 24px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
                {persona.name ? `You can call me ${persona.name} any time. ` : ''}I can read your emails, check your calendar, manage tasks, and search Drive files.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => void sendMessage(s)}
                    style={{
                      padding: '9px 14px', borderRadius: 'var(--sb-r-nav)', fontSize: 'var(--sb-t-body-s)', textAlign: 'left',
                      background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
                      color: 'var(--sb-ink-1)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                    {s}
                    <ChevronDown size={ICON.sm} style={{ transform: 'rotate(-90deg)', color: 'var(--sb-ink-3)', flexShrink: 0 }} />
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
        <div
          onDragOver={e => { e.preventDefault(); setDropping(true) }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false) }}
          onDrop={e => { e.preventDefault(); setDropping(false); void addFiles([...e.dataTransfer.files]) }}
          style={{ padding: '8px 12px 10px', borderTop: 'var(--sb-border-width) solid var(--sb-border)', flexShrink: 0 }}>

          {approval && (
            <div role="group" aria-label="Approval needed" data-approval={approval.kind} style={{
              marginBottom: 8, padding: '10px 12px', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-field)',
              border: 'var(--sb-border-width) solid var(--sb-border)', display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{approval.title}</div>
              {approval.lines.length > 0 && (
                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', maxHeight: 120, overflowY: 'auto' }}>
                  {approval.lines.map(l => (
                    <div key={l.label} style={{ display: 'contents' }}>
                      <dt style={{ color: 'var(--sb-ink-3)', textTransform: 'capitalize' }}>{l.label}</dt>
                      <dd style={{ margin: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{l.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button size="sm" variant="secondary" onClick={() => approval.resolve(false)}>Not now</Button>
                <Button size="sm" variant="accent" onClick={() => approval.resolve(true)}>Approve</Button>
              </div>
            </div>
          )}

          {/* What is going with the message, and the way to take one back out. */}
          {attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {attachments.map(a => (
                <span key={a.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%',
                  padding: '4px 6px 4px 8px', borderRadius: 'var(--sb-r-chip)',
                  background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
                  fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)',
                }}>
                  {a.kind === 'image'
                    ? <ImageIcon size={ICON.sm} color="var(--sb-ink-3)" />
                    : <FileText size={ICON.sm} color="var(--sb-ink-3)" />}
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{a.name}</span>
                  <span style={{ color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums' }}>{prettySize(a.size)}</span>
                  <button
                    onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
                    title={`Take ${a.name} back out`}
                    style={{
                      width: 18, height: 18, padding: 0, borderRadius: 'var(--sb-r-pill)', border: 'none',
                      background: 'none', color: 'var(--sb-ink-3)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}><CloseIcon size={12} /></button>
                </span>
              ))}
            </div>
          )}

          {attachError && (
            <p style={{ margin: '0 0 8px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative)', lineHeight: 1.45 }}>
              {attachError}
            </p>
          )}

          {(listening || voiceNote) && (
            <p role="status" style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-meta)', color: voiceNote && !listening ? 'var(--sb-accent-deep)' : 'var(--sb-ink-3)' }}>
              {listening ? (interim ? `“${interim}”` : `Listening${persona.name ? ` — say what you need, ${persona.name} is here` : ''}…`) : voiceNote}
            </p>
          )}
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 4,
            background: 'var(--sb-field)',
            border: `var(--sb-border-width) solid ${dropping ? 'var(--sb-info)' : 'var(--sb-border)'}`,
            borderRadius: 'var(--sb-r-nav)', padding: '4px 4px 4px 6px',
            transition: 'border-color 0.15s',
          }}>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/*,application/pdf,text/*,.csv,.md,.json,.yaml,.yml,.log"
              hidden
              onChange={e => { void addFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={thinking}
              title="Attach an image, a PDF or a text file"
              style={{
                width: 28, height: 28, padding: 0, borderRadius: 'var(--sb-r-sm)', border: 'none',
                background: 'none', color: 'var(--sb-ink-3)', cursor: thinking ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}><Paperclip size={ICON.sm + 2} /></button>
            {speechSupported() && (
              <button
                type="button"
                onClick={() => { if (listening) micRef.current?.stop(); else talk() }}
                disabled={thinking}
                aria-pressed={listening}
                aria-label={listening ? 'Stop listening' : `Talk to ${persona.name || 'your assistant'}`}
                title={listening ? 'Stop listening' : `Talk to ${persona.name || 'your assistant'}`}
                style={{
                  width: 28, height: 28, padding: 0, borderRadius: 'var(--sb-r-pill)', border: 'none', flexShrink: 0,
                  background: listening ? 'var(--sb-accent)' : 'none', color: listening ? 'var(--sb-accent-ink)' : 'var(--sb-ink-3)',
                  cursor: thinking ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  animation: listening ? 'pulse 1.2s ease-in-out infinite' : undefined,
                }}><Mic size={ICON.sm + 2} /></button>
            )}
            {/* Never disabled: you can write the next message while an answer is on its way (Enter waits — `sendMessage` refuses while thinking). Disabling it also dropped focus, so every answer ended with a click back into the box. */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              // A screenshot goes straight from the clipboard into the message —
              // saving it to disk first to attach it is two steps nobody wants.
              onPaste={e => {
                const files = [...e.clipboardData.files]
                if (files.length) { e.preventDefault(); void addFiles(files) }
              }}
              placeholder={dropping ? 'Drop it here' : thinking ? 'Answering — you can write the next one…' : 'Ask, or drop a file in…'}
              rows={1}
              title="Enter to send · Shift+Enter for a new line · paste or drop a file in"
              style={{
                flex: 1, minWidth: 0, boxSizing: 'border-box', background: 'none', border: 'none', outline: 'none', resize: 'none',
                // One line is exactly as tall as the 28px send button beside it, so the icons, the text and the button share a centre.
                padding: '4px 4px', color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', lineHeight: '20px',
                maxHeight: 120, overflowY: 'auto', fontFamily: 'inherit', textAlign: 'left',
              }}
            />
            <button
              onClick={() => void sendMessage(input)}
              disabled={(!input.trim() && attachments.length === 0) || thinking}
              style={{
                width: 28, height: 28, borderRadius: 'var(--sb-r-sm)', border: 'none', cursor: 'pointer',
                background: (!input.trim() && attachments.length === 0) || thinking ? 'color-mix(in srgb, var(--sb-info) 20.0%, transparent)' : 'linear-gradient(135deg, var(--sb-info) 0%, color-mix(in srgb, var(--sb-info) 58%, var(--sb-ink-on-fill)) 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                transition: 'background 0.15s',
                boxShadow: (!input.trim() && attachments.length === 0) || thinking ? 'none' : '0 0 10px color-mix(in srgb, var(--sb-info) 40.0%, transparent)',
              }}>
              {thinking
                ? <Loader2 size={ICON.sm + 2} color="var(--sb-info)" style={{ animation: 'spin 1s linear infinite' }} />
                : <Send size={ICON.sm} color={!input.trim() && attachments.length === 0 ? 'var(--sb-info)' : 'var(--sb-ink-on-fill)'} />
              }
            </button>
          </div>
          {/* No line of shortcuts under the box: it came and went with focus, and a layout that changes when you press a button moves that button out from under the pointer before the click lands (the Approve button, the paperclip, the mic all lost clicks to it). The shortcuts are the box's tooltip. */}
        </div>
      </div>

      {/* Collapsed, the button is the whole way back — so it has to show an answer arriving,
          or a reply would land with no sign anything happened. */}
      {open && minimised && thinking && (
        <span aria-hidden style={{
          position: 'fixed', right: 'calc(30px + env(safe-area-inset-right))', bottom: 'calc(24px + 58px + env(safe-area-inset-bottom))',
          zIndex: 149, width: 12, height: 12, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-info)',
          border: '2px solid var(--sb-overlay)', animation: 'pulse 1.2s ease-in-out infinite', pointerEvents: 'none',
        }} />
      )}

      <style>{`
        @keyframes pulse { 0%,100% { opacity: .25 } 50% { opacity: 1 } }
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes aiChipSweep { from { transform: translateX(-100%) } to { transform: translateX(100%) } }
        @keyframes aiWave { 0%,60%,100% { transform: translateY(0) scale(.8); opacity: .45 } 30% { transform: translateY(-4px) scale(1); opacity: 1 } }
        .ai-ring { flex-shrink: 0; animation: spin .8s linear infinite }
        .ai-chip-running::after {
          content: ''; position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(100deg, transparent 20%, color-mix(in srgb, var(--sb-info) 18%, transparent) 50%, transparent 80%);
          animation: aiChipSweep 1.6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ai-ring { animation-duration: 2.4s }
          .ai-chip-running::after { animation: none }
        }
      `}</style>
    </>
  )
}

// ─── Floating toggle button ───────────────────────────────────────────────────

interface AssistantToggleProps { open: boolean; onClick: () => void }

export function AssistantToggle({ open, onClick }: AssistantToggleProps) {
  const persona = usePersona()
  const who = labelOf(persona).replace(/^Your assistant$/, 'your assistant')
  // `open` is "the window is on screen": pressing it then collapses the window
  // (the conversation stays); pressing it collapsed, or never opened, brings it up.
  const label = open ? `Collapse ${who}` : `Talk to ${who}`
  return (
    <button
      className="ai-fab" data-assistant-fab
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={open}
      style={{
        right: 'calc(24px + env(safe-area-inset-right))', bottom: 'calc(24px + env(safe-area-inset-bottom))',
        width: 72, height: 72, zIndex: 148,
      }}>
      {/* The cut-out portrait alone — no tile, no border, no fill — 72px, which is the
          48px it was drawn at, one and a half times over. */}
      <AssistantAvatar bare size={72} name={persona.name} />
    </button>
  )
}
