import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import { askAssistant } from '@/lib/assistantBridge'
import { usePersona } from '@/lib/assistantPersona'
import { addressedTo } from '@/lib/callName'
import { isSpeaking, micBusy, recognitionLang, speechSupported, startListening, type Listening } from '@/lib/speech'

type State = 'off' | 'on' | 'tap' | 'denied'

/**
 * Listens for the assistant's name **while the app is on screen**, when the
 * person has switched that on. Not a wake word: a web page cannot listen with
 * the screen locked or the tab hidden, and this says so in Settings and shows,
 * the whole time it is listening, that it is.
 *
 * The microphone is shared with the panel's own mic button: this yields while
 * that is in use and takes it back after. It never acts on the assistant's own
 * voice, and it only ever reacts to speech that *starts* with the name.
 * Where the browser will not start listening without a tap (iPhone, iPad) the
 * pill becomes a button saying so, rather than a promise that is not being kept.
 */
export function NameListener() {
  const persona = usePersona()
  const [state, setState] = useState<State>('off')
  const [paused, setPaused] = useState(false)
  const ref = useRef<Listening | null>(null)
  const want = speechSupported() && persona.listen && !!persona.name && !paused

  const start = useCallback(() => {
    ref.current?.stop()
    ref.current = startListening({
      lang: recognitionLang(persona.lang), loop: true,
      onFinal: heard => {
        if (isSpeaking()) return
        const a = addressedTo(heard, persona.name, { voice: true })
        if (a.addressed) askAssistant({ text: a.rest, spoken: true })
      },
      onState: on => setState(s => (on ? 'on' : s === 'on' ? 'off' : s)),
      onError: e => setState(e === 'denied' ? 'denied' : 'tap'),
    })
  }, [persona.lang, persona.name])

  // Start when wanted, stop when not.
  useEffect(() => {
    if (!want) { ref.current?.stop(); ref.current = null; return }
    start()
    return () => { ref.current?.stop(); ref.current = null }
  }, [want, start])

  // Come back when the page does, and after the panel's mic has finished with the microphone.
  useEffect(() => {
    if (!want) return
    const back = () => { if (!document.hidden && !micBusy() && state !== 'tap' && state !== 'denied') start() }
    document.addEventListener('visibilitychange', back)
    const t = setInterval(back, 2000)
    return () => { document.removeEventListener('visibilitychange', back); clearInterval(t) }
  }, [want, state, start])

  if (!want) return null

  const base: React.CSSProperties = {
    position: 'fixed', left: 16, bottom: 16, zIndex: 147, display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 12px', borderRadius: 'var(--sb-r-pill)', fontSize: 'var(--sb-t-meta)',
    background: 'var(--sb-card)', color: 'var(--sb-ink-2)', border: 'var(--sb-border-width) solid var(--sb-border)',
    boxShadow: '0 2px 10px color-mix(in srgb, var(--sb-ink-1) 14%, transparent)',
  }
  if (state === 'denied') {
    return <div role="status" style={{ ...base, color: 'var(--sb-accent-deep)' }}><Mic size={14} aria-hidden /> The microphone is blocked, so {persona.name} cannot hear you. Allow it in your browser’s site settings.</div>
  }
  if (state === 'tap') {
    return (
      <button type="button" onClick={() => { setState('off'); start() }} style={{ ...base, cursor: 'pointer' }}>
        <Mic size={14} aria-hidden /> Tap to listen for {persona.name}
      </button>
    )
  }
  return (
    <div role="status" style={base}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: state === 'on' ? 'var(--sb-positive)' : 'var(--sb-ink-4)' }} />
      {state === 'on' ? `Listening for “${persona.name}”` : `Getting ready to listen for “${persona.name}”…`}
      <button type="button" onClick={() => setPaused(true)} aria-label={`Stop listening for ${persona.name}`}
        style={{ border: 'none', background: 'none', color: 'var(--sb-ink-3)', cursor: 'pointer', textDecoration: 'underline', fontSize: 'inherit', padding: 0 }}>Pause</button>
    </div>
  )
}
