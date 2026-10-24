import { useState, useEffect } from 'react'
import { Segmented } from '@/components/ui'
import { Eye, EyeOff } from 'lucide-react'
import { lastPushError, type PushResult } from '@/lib/prefSync'
import { useHeldText } from '@/lib/useHeldText'
import { cleanName, loadPersona, NAME_MAX, savePersona, usePersona, type Persona } from '@/lib/assistantPersona'
import { speechSupported } from '@/lib/speech'
import { AssistantAvatar } from '@/modules/assistant/AssistantAvatar'
import { notify } from '@/lib/undo'
import { ICON } from '@/lib/type'
import { inputStyle, selectStyle } from '@/lib/fields'
import { type AIConfig, type AppSettings, cleanKey, loadAIConfig, misplacedAnthropicKey, saveAIConfig, setAIPushListener } from '../model'
import { FieldRow, Toggle } from '../ui'
import { PILL_BASE, pillSelectStyle } from '../pillStyles'
import { ModelPicker } from './ModelPicker'

// ─── CHUNK 6: Professor AI + Notifications + Appearance sections ──────────────

/** What the person calls the assistant. Saved as they type (held briefly), and shared with every device and bot. */
function AssistantNameRow() {
  const persona = usePersona()
  const { text, onChange, onBlur } = useHeldText(persona.name, v => savePersona({ ...loadPersona(), name: v }))
  const bad = text.trim() !== '' && cleanName(text) === ''
  return (
    <FieldRow label="Its name" sub="Type it or say it to get its attention">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AssistantAvatar size={44} radius="50%" name={persona.name} />
          <input value={text} maxLength={NAME_MAX} aria-label="Your assistant’s name" placeholder="Give it a name"
            onChange={e => onChange(e.target.value)} onBlur={onBlur}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{ ...inputStyle, width: 190 }} />
        </div>
        <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: bad ? 'var(--sb-accent-deep)' : 'var(--sb-ink-3)', lineHeight: 1.4 }}>
          {bad ? 'A name can use letters, numbers, spaces, hyphens and apostrophes.' : 'Shown on the assistant, and used by the Telegram bot and Siri too.'}
        </p>
      </div>
    </FieldRow>
  )
}

const SPEECH_LANGS = ['en-US', 'en-GB', 'ar-EG', 'ar-SA', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'pt-BR', 'tr-TR', 'ru-RU', 'hi-IN', 'ja-JP', 'zh-CN']
const langName = (tag: string): string => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag } catch { return tag } }

/** How it listens, and whether it talks back. Honest about what a browser can and cannot do. */
function AssistantVoiceRows() {
  const persona = usePersona()
  const can = speechSupported()
  const set = (patch: Partial<Persona>) => savePersona({ ...loadPersona(), ...patch })
  return (
    <>
      <FieldRow label="Listen for its name" sub="While the app is open on screen">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, maxWidth: 380 }}>
          <Toggle checked={persona.listen && can} onChange={(v: boolean) => { if (can) set({ listen: v }) }} />
          <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: can ? 'var(--sb-ink-3)' : 'var(--sb-accent-deep)', lineHeight: 1.45 }}>
            {can
              ? 'A web page cannot listen with the screen locked or the tab hidden, and on iPhone and iPad you may need to tap once each time. For hands-free with the app closed, use the Siri Shortcut below. Your browser or phone’s speech service hears the audio while this is on.'
              : 'This browser cannot listen. On iPhone and iPad, Safari can; elsewhere, Chrome and Edge can.'}
          </p>
        </div>
      </FieldRow>
      <FieldRow label="Speak answers" sub="When you spoke the question">
        <Toggle checked={persona.speak} onChange={(v: boolean) => set({ speak: v })} />
      </FieldRow>
      <FieldRow label="Speech language" sub="What it listens for and speaks in">
        <select value={persona.lang} onChange={e => set({ lang: e.target.value })} aria-label="Speech language" style={{ ...pillSelectStyle }}>
          <option value="">Same as this browser</option>
          {SPEECH_LANGS.map(t => <option key={t} value={t}>{langName(t)}</option>)}
        </select>
      </FieldRow>
    </>
  )
}

export function ProfessorSection() {
  const [ai, setAIRaw] = useState<AIConfig>(loadAIConfig)
  const [showKey, setShowKey] = useState(false)
  // 'held' is the 700ms between the last keystroke and the push, and it is
  // worth drawing: it is the window in which somebody refreshes and concludes
  // nothing was saved.
  const [keySync, setKeySync] = useState<'idle' | 'held' | PushResult>('idle')
  useEffect(() => {
    setAIPushListener(r => setKeySync(r))
    return () => { setAIPushListener(null) }
  }, [])
  const [autonomy, setAutonomy] = useState<'suggest' | 'draft' | 'act'>('suggest')
  const [mailDrafts, setMailDrafts] = useState(true)
  const [matrixSuggest, setMatrixSuggest] = useState(true)
  const [autoBuild, setAutoBuild] = useState(false)
  const [learnEdits, setLearnEdits] = useState(true)

  function setAI(patch: Partial<AIConfig>) {
    const next = { ...ai, ...patch }
    setAIRaw(next)
    setKeySync('held')
    saveAIConfig(next)
  }

  const activeKey = ai.provider === 'groq' ? ai.groqKey : ai.anthropicKey
  const keyLabel  = ai.provider === 'groq' ? 'Groq API key' : 'Anthropic API key'
  const keyHint   = ai.provider === 'groq' ? 'Free at console.groq.com' : 'console.anthropic.com (paid)'

  return (
    <div>
      {/* ── Name ── */}
      <AssistantNameRow />
      <AssistantVoiceRows />

      {/* ── Model ── */}
      <FieldRow label="Model" sub="Handles the brief, drafts and matrix suggestions">
        <Segmented
          size="sm"
          aria-label="Model"
          value={ai.provider}
          onChange={v => setAI({ provider: v as AIConfig['provider'] })}
          options={[
            // These are PROVIDERS, not models, and the label has to say so:
            // the value decides which key field the box below edits. The old
            // labels read "Sonnet 4.5 / Opus 4.1 / Haiku", so choosing a
            // better-sounding Claude picked **Groq** — and the Anthropic key
            // you then typed was saved as `groqKey`, where the bots (which
            // read `anthropicKey` and nothing else) could never see it. The
            // field still showed it back to you, because it was showing
            // `groqKey`. `haiku` was not in `AIConfig['provider']` at all and
            // only survived the `as` cast on this very handler.
            { value: 'anthropic', label: 'Claude' },
            { value: 'groq',      label: 'Groq' },
          ]}
        />
      </FieldRow>

      {/* An Anthropic key typed into the Groq box reaches nothing — say so
          where it happened, and offer the one move that fixes it. */}
      {misplacedAnthropicKey(ai) && (
        <div style={{
          background: 'var(--sb-negative-tint)', border: 'var(--sb-border-width) solid var(--sb-negative)',
          borderRadius: 'var(--sb-r-nav)', padding: '10px 12px', marginBottom: 10,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', flex: 1, minWidth: 220 }}>
            An Anthropic key (<code>sk-ant-…</code>) is saved in the <b>Groq</b> field, where
            nothing reads it — the app and the bots only ever read the Anthropic one.
          </span>
          <button
            onClick={() => {
              const key = misplacedAnthropicKey(ai)
              setAI({ provider: 'anthropic', anthropicKey: key, groqKey: '' })
              notify('Moved your Anthropic key into the Anthropic field')
            }}
            style={{ ...PILL_BASE, borderColor: 'var(--sb-negative)', color: 'var(--sb-negative)', cursor: 'pointer', flexShrink: 0 }}>
            Move it to Anthropic
          </button>
        </div>
      )}

      {/* ── API key ── */}
      <FieldRow label={keyLabel} sub={keyHint}>
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <input type={showKey ? 'text' : 'password'} value={activeKey}
            // **Not a login.** A password-typed box is offered to the browser's
            // password manager, which autofills the key it remembered on page
            // load — firing this handler with the OLD key, saving it, and
            // pushing it over the new one ("Saved" appearing on a refresh with
            // nothing pasted). Autofill is not focused; typing and pasting are.
            autoComplete="new-password" name="api-key-not-a-login" spellCheck={false}
            data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other"
            onChange={e => {
              if (document.activeElement !== e.target) return
              setAI(ai.provider === 'groq' ? { groqKey: cleanKey(e.target.value) } : { anthropicKey: cleanKey(e.target.value) })
            }}
            placeholder={ai.provider === 'groq' ? 'gsk_...' : 'sk-ant-...'}
            style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: 'var(--sb-t-meta)' }} />
          <button onClick={() => setShowKey(v => !v)} style={{ background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '4px 8px', cursor: 'pointer', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-meta)', flexShrink: 0 }}>
            {showKey ? <EyeOff size={ICON.sm} /> : <Eye size={ICON.sm} />}
          </button>
        </div>
      </FieldRow>
      {keySync !== 'idle' && (
        <p data-key-sync={keySync} style={{
          margin: '-6px 0 2px', textAlign: 'right', fontSize: 'var(--sb-t-meta)',
          color: keySync === 'failed' ? 'var(--sb-negative)'
               : keySync === 'saved'  ? 'var(--sb-positive-deep)' : 'var(--sb-ink-4)',
        }}>
          {keySync === 'held'    && 'Saving…'}
          {keySync === 'saved'   && 'Saved — on this browser and on your account'}
          {keySync === 'nothing' && 'Already saved'}
          {keySync === 'failed'  && `Saved here, but it could not reach your account${lastPushError ? ` (${lastPushError})` : ''} — it will not follow you to another device or the bots yet`}
        </p>
      )}

      <ModelPicker ai={ai} setAI={setAI} />

      <div style={{ height: 6, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)', marginTop: 12, marginBottom: 12 }} />

      {/* ── Autonomy ── */}
      <FieldRow label="Autonomy" sub="How far the assistant may act before asking you">
        <Segmented
          size="sm"
          aria-label="Autonomy"
          value={autonomy}
          onChange={setAutonomy}
          options={[
            { value: 'suggest' as const, label: 'Suggest' },
            { value: 'draft'   as const, label: 'Draft & hold' },
            { value: 'act'     as const, label: 'Act' },
          ]}
        />
      </FieldRow>

      {/* ── Behaviour toggles ── */}
      <FieldRow label="Write mail drafts" sub="Prepares a reply for every thread that needs one">
        <Toggle checked={mailDrafts} onChange={setMailDrafts} />
      </FieldRow>
      <FieldRow label="Suggest matrix placement" sub="Reads task attributes and fills the missing ones">
        <Toggle checked={matrixSuggest} onChange={setMatrixSuggest} />
      </FieldRow>
      <FieldRow label="Auto-build the day" sub="Turns the brief into calendar blocks without confirmation">
        <Toggle checked={autoBuild} onChange={setAutoBuild} />
      </FieldRow>
      <FieldRow label="Learn from my edits" sub="Every correction tunes future drafts and placements">
        <Toggle checked={learnEdits} onChange={setLearnEdits} />
      </FieldRow>
    </div>
  )
}

/** 11B splits out the half of the AI card that is about voice and standing
 *  instructions, so neither half has to be squeezed into one column. */
export function AIVoiceSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const [toneOfVoice, setToneOfVoice] = useState('Direct, no filler')

  return (
    <div>
      <FieldRow label="Tone of voice" sub="Applies to drafts, the brief and the review">
        <select value={toneOfVoice} onChange={e => setToneOfVoice(e.target.value)} style={{ ...selectStyle, minWidth: 160 }}>
          {['Direct, no filler', 'Warm and encouraging', 'Formal', 'Casual'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </FieldRow>

      <div style={{ height: 6, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)', marginTop: 12, marginBottom: 12 }} />
      <FieldRow label="Proactive" sub="Offers advice unprompted">
        <Toggle checked={s.proactive} onChange={v => set({ proactive: v })} />
      </FieldRow>
      <FieldRow label="Morning brief time">
        <input type="time" value={s.briefTime} onChange={e => set({ briefTime: e.target.value })} style={{ ...inputStyle, width: 118 }} />
      </FieldRow>
      <FieldRow label="Custom instructions" sub="Personality & priorities">
        <textarea value={s.customInstructions} onChange={e => set({ customInstructions: e.target.value })}
          rows={3} placeholder="e.g. Always be concise. Prioritise Teradix work…"
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, width: '100%' }} />
      </FieldRow>

      <p style={{ margin: '14px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Your mail and tasks are never used to train the model.</p>
    </div>
  )
}
