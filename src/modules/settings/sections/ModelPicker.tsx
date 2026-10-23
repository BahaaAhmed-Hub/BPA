import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ICON } from '@/lib/type'
import { inputStyle } from '@/lib/fields'
import { ASSISTANT_CLAUDE_MODEL, describeModel } from '@/lib/modelInfo'
import { fallbackOrder, listModels, probeGroq, type ModelOption } from '@/lib/modelCatalog'
import { useAuthStore } from '@/store/authStore'
import { fetchMonthUsage } from '@/lib/assistantChatApi'
import { amountText, formatTokens, groupByModel, priceFor, summarise, type ModelUsage } from '@/lib/aiUsage'
import { type AIConfig } from '../model'
import { FieldRow } from '../ui'
import { PILL_BASE } from '../pillStyles'

type ListState = { kind: 'idle' | 'loading' | 'ok' } | { kind: 'error'; message: string }
type Check = { kind: 'idle' | 'checking' | 'works' } | { kind: 'bad'; message: string } | { kind: 'unsure'; message: string }

/**
 * Which model answers. The list is the PROVIDER's, asked with the person's own key: a model that was retired, or that
 * this account is not given, simply is not offered — which is what a hard-coded list could not know ("The model
 * `llama-3.3-70b-versatile` does not exist or you do not have access to it"). The box also takes any id typed in,
 * because a newer model than this app has heard of is a reason to type, not a reason to be stuck.
 *
 * On Groq the chosen model is also **tried** (one token, free): "listed" is not "allowed", and the difference is the
 * very error this exists for. Anthropic's is not tried — that would be a paid request on every keystroke.
 */
export function ModelPicker({ ai, setAI }: { ai: AIConfig; setAI: (p: Partial<AIConfig>) => void }) {
  const groq = ai.provider === 'groq'
  const key = groq ? ai.groqKey : ai.anthropicKey
  const value = groq ? ai.groqModel : ai.claudeModel
  const effective = groq ? ai.groqModel : (ai.claudeModel.trim() || ASSISTANT_CLAUDE_MODEL)

  const [options, setOptions] = useState<ModelOption[]>([])
  const [list, setList] = useState<ListState>({ kind: 'idle' })
  const [check, setCheck] = useState<Check>({ kind: 'idle' })
  const [again, setAgain] = useState(0)

  // What this key can use. Held briefly, because the key box above saves as you type.
  useEffect(() => {
    setOptions([])
    if (!key) { setList({ kind: 'idle' }); return }
    let dead = false
    setList({ kind: 'loading' })
    const t = setTimeout(() => {
      listModels(ai.provider, key).then(
        o => { if (!dead) { setOptions(o); setList({ kind: 'ok' }) } },
        e => { if (!dead) setList({ kind: 'error', message: e instanceof Error ? e.message : String(e) }) },
      )
    }, 600)
    return () => { dead = true; clearTimeout(t) }
  }, [ai.provider, key, again])

  // Does it actually work with this key? (Groq only.)
  useEffect(() => {
    if (!groq || !key || !ai.groqModel.trim()) { setCheck({ kind: 'idle' }); return }
    let dead = false
    setCheck({ kind: 'checking' })
    const t = setTimeout(() => {
      probeGroq(key, ai.groqModel.trim()).then(p => {
        if (dead) return
        if (p.ok) setCheck({ kind: 'works' })
        else if (p.missing) setCheck({ kind: 'bad', message: p.message })
        else setCheck({ kind: 'unsure', message: p.message })
      })
    }, 700)
    return () => { dead = true; clearTimeout(t) }
  }, [groq, key, ai.groqModel, again])

  const suggestion = useMemo(() => {
    if (check.kind !== 'bad' || !options.length) return null
    return fallbackOrder(options.map(o => o.id), ai.groqModel)[0] ?? null
  }, [check, options, ai.groqModel])

  const set = (v: string) => setAI(groq ? { groqModel: v.trim() } : { claudeModel: v.trim() })
  const label = describeModel(ai.provider, effective).label

  let status: { text: string; tone: 'ok' | 'bad' | 'muted' } = { text: '', tone: 'muted' }
  if (!key) status = { text: `Add your ${groq ? 'Groq' : 'Anthropic'} key above to see the models it can use.`, tone: 'muted' }
  else if (check.kind === 'bad') status = { text: `Your key cannot use this model — ${check.message}`, tone: 'bad' }
  else if (check.kind === 'checking') status = { text: 'Checking this model with your key…', tone: 'muted' }
  else if (check.kind === 'works') status = { text: `${label} works with your key.`, tone: 'ok' }
  else if (check.kind === 'unsure') status = { text: `Could not check it right now (${check.message}).`, tone: 'muted' }
  else if (list.kind === 'loading') status = { text: 'Asking for the models your key can use…', tone: 'muted' }
  else if (list.kind === 'error') status = { text: `Could not load the list (${list.message}). You can still type a model id.`, tone: 'bad' }
  else if (list.kind === 'ok') status = { text: `${options.length} model${options.length === 1 ? '' : 's'} available to your key.`, tone: 'muted' }

  return (
    <>
      <FieldRow label="Which model" sub={groq ? 'Chosen from what your Groq key can use' : 'Empty uses the app’s default'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, width: '100%' }}>
            <input
              value={value} list={`ai-models-${ai.provider}`} aria-label="Model" spellCheck={false}
              autoComplete="off" autoCapitalize="off" data-lpignore="true" data-1p-ignore="true"
              placeholder={groq ? 'llama-3.3-70b-versatile' : `${ASSISTANT_CLAUDE_MODEL} (default)`}
              onChange={e => set(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: 'var(--sb-t-meta)' }} />
            <datalist id={`ai-models-${ai.provider}`}>
              {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </datalist>
            <button type="button" onClick={() => setAgain(n => n + 1)} aria-label="Refresh the list of models" title="Refresh the list"
              disabled={!key}
              style={{ background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '4px 8px', cursor: key ? 'pointer' : 'default', color: 'var(--sb-ink-3)', flexShrink: 0 }}>
              <RefreshCw size={ICON.sm} />
            </button>
          </div>
          {status.text && (
            <p role="status" data-model-status={check.kind === 'idle' ? list.kind : check.kind} style={{
              margin: 0, fontSize: 'var(--sb-t-meta)', lineHeight: 1.45,
              color: status.tone === 'bad' ? 'var(--sb-negative)' : status.tone === 'ok' ? 'var(--sb-positive-deep)' : 'var(--sb-ink-3)',
            }}>{status.text}</p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {suggestion && (
              <button type="button" data-model-suggestion={suggestion} onClick={() => set(suggestion)}
                style={{ ...PILL_BASE, borderColor: 'var(--sb-negative)', color: 'var(--sb-negative)', cursor: 'pointer' }}>
                Use {describeModel('groq', suggestion).label} instead
              </button>
            )}
            {!groq && ai.claudeModel.trim() && (
              <button type="button" onClick={() => set('')} style={{ ...PILL_BASE, cursor: 'pointer' }}>Use the default</button>
            )}
          </div>
        </div>
      </FieldRow>

      <PriceRow ai={ai} setAI={setAI} model={effective} />
      <MonthUsageRow ai={ai} />
    </>
  )
}

/** The rate behind the counter's amount. The built-in figure is a list-price estimate for a few model families; the
 *  person's own rate (from their billing page) replaces it for that model, and a model with no known price stays
 *  tokens-only until they set one. */
function PriceRow({ ai, setAI, model }: { ai: AIConfig; setAI: (p: Partial<AIConfig>) => void; model: string }) {
  const known = priceFor(model, ai.prices)
  const own = ai.prices?.[model]
  const est = known?.source === 'estimate' ? known.price : null
  const put = (k: 'in' | 'out', raw: string) => {
    const next = { ...(ai.prices ?? {}) }
    const cur = next[model] ?? { in: NaN, out: NaN }
    const n = raw.trim() === '' ? NaN : Number(raw)
    const merged = { ...cur, [k]: n }
    if (Number.isNaN(merged.in) && Number.isNaN(merged.out)) delete next[model]
    else next[model] = merged
    setAI({ prices: next })
  }
  const box = (k: 'in' | 'out', label: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
      {label}
      <input type="number" inputMode="decimal" min={0} step="0.01" aria-label={`Price per million ${label.toLowerCase()} tokens, US dollars`}
        value={own && Number.isFinite(own[k]) ? own[k] : ''} placeholder={est ? String(est[k]) : 'not known'}
        onChange={e => put(k, e.target.value)}
        style={{ ...inputStyle, width: 92, fontVariantNumeric: 'tabular-nums' }} />
    </label>
  )
  return (
    <FieldRow label="Price" sub="US$ per million tokens, for the amount beside the model name">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>{box('in', 'In')}{box('out', 'Out')}</div>
        <p data-price-note={known ? known.source : 'none'} style={{ margin: 0, fontSize: 'var(--sb-t-meta)', lineHeight: 1.45, color: 'var(--sb-ink-3)' }}>
          {known?.source === 'yours' ? 'Using your rate for this model. Clear both boxes to go back to the estimate.'
            : known ? 'Showing a list-price estimate. Enter the rate on your billing page to make the amount yours.'
            : 'No price is known for this model, so only tokens are counted. Enter its rate to see an amount.'}
        </p>
      </div>
    </FieldRow>
  )
}

/** What the assistant has used since the first of the month, summed from the rows it keeps — so it includes every
 *  device. It is the assistant's chat only: the morning brief, mail drafts and the other AI features draw on the same
 *  key but are not counted here, and the provider's own page is the only total for the key as a whole. */
function MonthUsageRow({ ai }: { ai: AIConfig }) {
  const uid = useAuthStore(s => s.user?.id)
  const [list, setList] = useState<ModelUsage[] | null | undefined>(undefined)   // undefined: loading, null: could not read
  const [again, setAgain] = useState(0)
  useEffect(() => {
    if (!uid) { setList(null); return }
    let dead = false
    setList(undefined)
    void fetchMonthUsage(uid).then(l => { if (!dead) setList(l) })
    return () => { dead = true }
  }, [uid, again])
  const sum = list ? summarise(list, ai.prices) : null
  const lines = list ? groupByModel(list).sort((a, b) => (b.input + b.output) - (a.input + a.output)).slice(0, 4) : []
  return (
    <FieldRow label="Used this month" sub="The assistant’s chat, on all your devices">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span data-month-usage={sum ? sum.total : list === null ? 'unreadable' : 'loading'} style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {list === undefined ? 'Reading…'
              : sum === null ? 'Could not read the usage just now.'
              : sum.total === 0 ? 'Nothing recorded yet this month.'
              : `${formatTokens(sum.total)} tokens${sum.usd !== null ? ` · ${amountText(sum)}` : ''}`}
          </span>
          <button type="button" onClick={() => setAgain(n => n + 1)} aria-label="Refresh this month’s usage" title="Refresh"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 2, display: 'flex' }}>
            <RefreshCw size={ICON.sm} />
          </button>
        </div>
        {lines.map(l => {
          const one = summarise([l], ai.prices)
          return (
            <span key={`${l.provider}|${l.model}`} data-month-line={l.model} style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums' }}>
              {describeModel(l.provider, l.model).label} · {formatTokens(one.total)} tokens{one.usd !== null ? ` · ${amountText(one)}` : ''}
            </span>
          )
        })}
        <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
          Tokens are exact (the provider reports them). Amounts are estimates unless you set your own rate above. This does not include the brief, mail drafts or other AI features, and neither provider lets an app read your balance — their billing page is the total for the key.
        </span>
      </div>
    </FieldRow>
  )
}
