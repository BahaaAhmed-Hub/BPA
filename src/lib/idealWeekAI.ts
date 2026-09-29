// ─── Ideal Week AI — the calendar planning assistant ─────────────────────────
//
// This is the same "Professor" AI voice but scoped to calendar planning.
// It reads the same AI config as the rest of the platform, maintains persistent
// conversation history, and returns structured actions alongside natural language.

import { ProfessorError } from './professor'
import type { IdealBlock, IdealGoal, IdealRule, IdealWeekAction, IdealChatMsg } from './idealWeekStore'
import { DAY_LABELS } from './idealWeekStore'

const SYSTEM = `You are The Professor — a premium AI executive productivity assistant embedded in a productivity platform. You are now acting as the user's personal calendar planning assistant, helping them design their ideal week template.

You have access to their current ideal week blocks, goals, and scheduling rules. When the user speaks naturally, translate their intent into calendar actions AND a friendly, specific response.

RESPONSE FORMAT:
Write your conversational response first (1-3 sentences, specific and helpful).
If you need to create or modify anything, append an [ACTIONS] block:

[ACTIONS]
[{"type":"add_block","day":0,"startHour":9,"endHour":11,"title":"Deep Work","category":"Focus","color":"#5B8DEF","blockType":"hard"}]
[/ACTIONS]

RULES:
- Day numbers: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday
- Always be specific — "block mornings for deep work" means Mon-Fri 9-11am, create 5 blocks
- blockType "hard" = never yields to other events; "soft" = can move with user approval
- Never vague. If the user says "I want focus time", ask morning or afternoon, how long, every day or specific days? Then create the blocks
- When adding goals, include reasonable targetHoursWeek based on what the user said
- Category colors: Focus=#5B8DEF, Health=#0C8140, Learning=#9B59B6, Admin=#E67E22, Client=#E74C3C, Personal=#27AE60, Creative=#F39C12, Team=#2980B9, Other=#7F8C8D

ACTION TYPES:
add_block: {type, day:0-6, startHour:0-23, endHour:1-24, title, category, color, blockType:"hard"|"soft"}
remove_block: {type, id, title}
add_goal: {type, title, category, color, targetHoursWeek, horizon:"weekly"|"monthly"|"longer", deadline?}
add_rule: {type, title, description, ruleType:"no-meetings"|"category-budget"|"time-preference"|"yield", config:{days?,startHour?,endHour?,category?,maxHoursWeek?}}
clear_canvas: {type}

The user's platform also has tasks, habits, and finance. You know about all of it and can reference it. Your memory persists across conversations — when the user says "remember" or "always", create a rule. Be their calendar assistant, not a search engine.`

function getAIConfig() {
  try {
    const raw = localStorage.getItem('professor-ai-config')
    const s = raw ? JSON.parse(raw) as Partial<{provider:string;anthropicKey:string;groqKey:string;groqModel:string}> : {}
    return {
      provider:     s.provider ?? 'anthropic',
      anthropicKey: s.anthropicKey ?? (import.meta.env.VITE_ANTHROPIC_API_KEY as string) ?? '',
      groqKey:      s.groqKey ?? '',
      groqModel:    s.groqModel ?? 'llama-3.3-70b-versatile',
    }
  } catch {
    return { provider:'anthropic', anthropicKey:(import.meta.env.VITE_ANTHROPIC_API_KEY as string)??'', groqKey:'', groqModel:'llama-3.3-70b-versatile' }
  }
}

function buildContext(blocks: IdealBlock[], goals: IdealGoal[], rules: IdealRule[]): string {
  const bs = blocks.length
    ? blocks.map(b => `  ${DAY_LABELS[b.day]} ${b.startHour}:00–${b.endHour}:00 "${b.title}" [${b.category}] (${b.blockType}) id:${b.id}`).join('\n')
    : '  (empty — no blocks yet)'
  const gs = goals.length
    ? goals.map(g => `  "${g.title}" ${g.targetHoursWeek}h/week [${g.category}] ${g.horizon}${g.deadline ? ' deadline:'+g.deadline : ''} id:${g.id}`).join('\n')
    : '  (none)'
  const rs = rules.length
    ? rules.map(r => `  "${r.title}" [${r.ruleType}] ${r.enabled ? 'ON' : 'OFF'} — ${r.description} id:${r.id}`).join('\n')
    : '  (none)'
  return `CURRENT IDEAL WEEK BLOCKS:\n${bs}\n\nGOALS:\n${gs}\n\nRULES:\n${rs}`
}

function parseResponse(raw: string): { text: string; actions: IdealWeekAction[] } {
  const match = raw.match(/\[ACTIONS\]\s*([\s\S]*?)\s*\[\/ACTIONS\]/)
  const text   = raw.replace(/\[ACTIONS\][\s\S]*?\[\/ACTIONS\]/, '').trim()
  if (!match) return { text, actions: [] }
  try {
    return { text, actions: JSON.parse(match[1].trim()) as IdealWeekAction[] }
  } catch {
    return { text, actions: [] }
  }
}

export async function chatIdealWeek(
  history: IdealChatMsg[],
  userMessage: string,
  context: { blocks: IdealBlock[]; goals: IdealGoal[]; rules: IdealRule[] },
): Promise<{ text: string; actions: IdealWeekAction[] }> {
  const cfg = getAIConfig()
  const system = SYSTEM + '\n\n' + buildContext(context.blocks, context.goals, context.rules)

  // last 12 messages for context (6 turns)
  const msgs = [
    ...history.slice(-12).map(m => ({ role: m.role as 'user'|'assistant', content: m.content })),
    { role: 'user' as const, content: userMessage },
  ]

  if (cfg.provider === 'groq' && cfg.groqKey) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.groqKey}` },
      body: JSON.stringify({ model: cfg.groqModel, max_tokens: 1200, messages: [{ role:'system',content:system }, ...msgs] }),
    })
    if (!res.ok) {
      const t = await res.text()
      throw new ProfessorError(`Groq ${res.status}: ${t}`, 'api_error')
    }
    const d = await res.json() as { choices: { message: { content: string } }[] }
    return parseResponse(d.choices[0]?.message?.content ?? '')
  }

  if (!cfg.anthropicKey) throw new ProfessorError('No API key — go to Settings → AI', 'config_error')
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: cfg.anthropicKey, dangerouslyAllowBrowser: true })
  const resp = await client.messages.create({ model:'claude-sonnet-4-6', max_tokens:1200, system, messages: msgs })
  const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : ''
  return parseResponse(raw)
}
