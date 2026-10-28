import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { ModelMark } from '@/modules/assistant/ModelBadge'
import { CLAUDE_MODELS, GROQ_MODELS } from '@/lib/modelInfo'
import { checkKey } from '@/lib/aiKeyCheck'
import { cleanKey } from '@/modules/settings/model'
import { ICON } from '@/lib/type'
import type { WizardState } from '../state'
import type { StepCtx } from './types'

type Provider = WizardState['ai']['provider']
const PROVIDERS: { id: Provider; name: string; sub: string; mark: 'claude' | 'groq'; prefix: string; hint: string; ph: string }[] = [
  { id: 'anthropic', name: 'Claude', sub: 'Anthropic', mark: 'claude', prefix: 'sk-ant', hint: 'console.anthropic.com', ph: 'sk-ant-...' },
  { id: 'groq',      name: 'Groq',   sub: 'Free tier', mark: 'groq',   prefix: 'gsk_',   hint: 'console.groq.com, free', ph: 'gsk_...' },
]

const keyOf = (ai: WizardState['ai']) => (ai.provider === 'groq' ? ai.groqKey : ai.anthropicKey)

/** Why Continue is off — said under the button, in words. Also read by the shell. */
export function aiBlocker(w: WizardState): string | null {
  const k = keyOf(w.ai)
  if (!k) return 'Paste a key to continue, or skip this for now.'
  if (stray(w.ai)) return 'That key belongs to the other provider. Switch to it, or skip this for now.'
  if (k.length < 8) return 'That key looks too short. Check it, or skip this for now.'
  if (w.ai.check === 'testing') return 'Checking the key…'
  if (w.ai.check === 'failed') return 'That key did not work. Fix it and test again, or skip this for now.'
  return null
}

/** A key from the other provider in this box: named, offered a fix, never moved without being asked. */
function stray(ai: WizardState['ai']): Provider | null {
  const k = keyOf(ai)
  if (k.length < 4) return null
  const other = PROVIDERS.find(p => p.id !== ai.provider)!
  return k.startsWith(other.prefix) ? other.id : null
}

/**
 * Which assistant, which model, and the key it runs on. The key is the
 * person's own: it is saved to their account and never to the app. "Test key"
 * makes one real one-token request, so "works" means works.
 */
export function AiStep({ w, set }: StepCtx) {
  const [show, setShow] = useState(false)
  const ai = w.ai
  const p = PROVIDERS.find(x => x.id === ai.provider)!
  const key = keyOf(ai)
  const models = ai.provider === 'groq' ? GROQ_MODELS : CLAUDE_MODELS
  const model = ai.provider === 'groq' ? ai.groqModel : ai.anthropicModel
  const wrong = stray(ai)

  const edit = (patch: Partial<WizardState['ai']>) => set(prev => ({ ai: { ...prev.ai, ...patch } }))

  async function test() {
    if (!key) return
    if (key.length < 8) { edit({ check: 'short', note: 'That key looks too short.' }); return }
    edit({ check: 'testing', note: '' })
    const tested = { provider: ai.provider, key, model }
    const v = await checkKey(ai.provider, key, model)
    // The answer belongs to the key, model and provider that were asked about: if any
    // changed while the request was out, it says nothing about what is in the box now.
    set(prev => {
      const a = prev.ai
      const now = { provider: a.provider, key: keyOf(a), model: a.provider === 'groq' ? a.groqModel : a.anthropicModel }
      if (a.check !== 'testing' && a.check !== 'idle') return {}
      if (now.provider !== tested.provider || now.key !== tested.key || now.model !== tested.model) return {}
      return { ai: { ...a, ...(v.ok ? { check: 'ok' as const, note: '' } : { check: v.why === 'network' ? 'idle' as const : 'failed' as const, note: v.detail }) } }
    })
  }

  function moveStray() {
    if (!wrong) return
    // The key goes where its own prefix says, the provider follows, the wrong box is emptied.
    edit(wrong === 'groq'
      ? { provider: 'groq', groqKey: ai.anthropicKey, anthropicKey: '', check: 'idle', note: '' }
      : { provider: 'anthropic', anthropicKey: ai.groqKey, groqKey: '', check: 'idle', note: '' })
  }

  return (
    <>
      <div>
        <span className="wz-lab" id="wz-prov">Provider</span>
        <div className="wz-seg" data-cols="2" role="group" aria-labelledby="wz-prov">
          {PROVIDERS.map(x => (
            <button key={x.id} type="button" className="wz-opt" aria-pressed={ai.provider === x.id}
              onClick={() => edit({ provider: x.id, check: 'idle', note: '' })}>
              <span className="wz-logo"><ModelMark kind={x.mark} size={20} /></span>
              <span><b>{x.name}</b><small>{x.sub}</small></span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="wz-model" className="wz-lab">Model</label>
        <p className="wz-note" style={{ marginBottom: 6 }}>Used in the app and the assistant panel. Telegram and Siri answer with their own model.</p>
        <div className="wz-select">
          <select id="wz-model" value={model}
            onChange={e => edit(ai.provider === 'groq' ? { groqModel: e.target.value, check: 'idle', note: '' } : { anthropicModel: e.target.value, check: 'idle', note: '' })}>
            {models.map(m => <option key={m.id} value={m.id}>{m.label} · {m.note}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="wz-key" className="wz-lab">{p.id === 'groq' ? 'Groq API key' : 'Anthropic API key'}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Not a login: a password box is offered to the browser's password manager, which would paste an old key in. */}
          <input id="wz-key" className="wz-field" type={show ? 'text' : 'password'} value={key} placeholder={p.ph} spellCheck={false}
            autoComplete="new-password" name="api-key-not-a-login" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other"
            style={{ fontFamily: 'var(--sb-font-mono)' }}
            onChange={e => edit(ai.provider === 'groq' ? { groqKey: cleanKey(e.target.value), check: 'idle', note: '' } : { anthropicKey: cleanKey(e.target.value), check: 'idle', note: '' })} />
          <button type="button" className="wz-btn2" style={{ width: 46, padding: 0 }} aria-label={show ? 'Hide the key' : 'Show the key'} onClick={() => setShow(v => !v)}>
            {show ? <EyeOff size={ICON.md} aria-hidden /> : <Eye size={ICON.md} aria-hidden />}
          </button>
        </div>
        {wrong && (
          <p className="wz-note" data-warn="" style={{ marginTop: 8 }}>
            That looks like a {wrong === 'groq' ? 'Groq' : 'Claude'} key. It would be saved under the wrong provider.{' '}
            <button type="button" className="wz-link-plain" onClick={moveStray}>Switch to {wrong === 'groq' ? 'Groq' : 'Claude'}</button>
          </p>
        )}
        <p className="wz-note" style={{ marginTop: 8 }}>Get one at <b>{p.hint}</b>. It is saved to your account, never to the app.</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="wz-btn2" aria-disabled={!key || ai.check === 'testing' || !!wrong || undefined} onClick={() => { if (!wrong && ai.check !== 'testing') void test() }}>
          {ai.check === 'testing' ? 'Checking…' : 'Test key'}
        </button>
        {ai.check === 'ok' && <span className="wz-ok" role="status">Key works.</span>}
        {(ai.check === 'failed' || ai.check === 'short' || (ai.check === 'idle' && ai.note)) && <span className="wz-bad" role="alert">{ai.note}</span>}
      </div>
    </>
  )
}
