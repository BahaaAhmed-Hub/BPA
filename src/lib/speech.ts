// ─── Talking to the assistant, and being talked back to ──────────────────────
// A thin layer over the browser's Web Speech API, written around what iPhone
// and iPad Safari will and will not do:
//
//   · **It cannot listen in the background or with the screen locked.** There is
//     no wake word on the web. What can be done is listening *while the app is on
//     screen* (opt-in), plus push-to-talk, plus a Siri Shortcut for the hands-free
//     case with the app shut. This file never pretends otherwise.
//   · **Starting needs a tap** the first time per page load; a permission prompt
//     follows. If a start is refused without one, the caller is told (`blocked`)
//     so it can draw "tap to listen" instead of looking broken.
//   · **A session ends by itself** — on silence, after about a minute, or when the
//     tab loses focus. Continuous listening is therefore a restart loop, with a
//     back-off, that stops the moment the page is hidden and never restarts after
//     a refusal.
//   · **Speaking back must be unlocked by a tap** (`unlockSpeech`), and the
//     recogniser must not hear the assistant's own voice, so listening yields
//     while it is speaking (`isSpeaking`).
//   · **Where the audio goes is the platform's business**: Safari uses Apple's
//     speech service, Chrome Google's. Settings says so before the switch is on.
//
// The decisions that can be tested without a microphone are pure and exported
// (`speechText`, `backoffMs`, `recognitionLang`).

interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SRInstance {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void; stop(): void; abort(): void
}
type SRCtor = new () => SRInstance

function ctor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const speechSupported = (): boolean => typeof window !== 'undefined' && ctor() !== null
export const speakSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window

/** The language to listen in: what the person chose, else the browser's own, else English. */
export function recognitionLang(pref: string, browser = typeof navigator !== 'undefined' ? navigator.language : ''): string {
  const t = (pref || browser || 'en-US').trim()
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(t) ? t : 'en-US'
}

/** Waits between restarts of a listening loop: quick at first, never hammering, capped. */
export function backoffMs(failures: number): number {
  return Math.min(5000, 400 * 2 ** Math.max(0, failures))
}

/** What is worth reading aloud from an answer: no markup, no code, no addresses, and not a wall of it. */
export function speechText(markdown: string, max = 480): string {
  let t = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/[*_~>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  t = stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '')
  return t + (/[.!?]$/.test(t) ? '' : '…')
}

// ── speaking ────────────────────────────────────────────────────────────────

let speaking = false
let spokeAt = 0
/** True while the assistant is talking, and for a moment after — so it does not hear itself. */
export const isSpeaking = (): boolean => speaking || Date.now() - spokeAt < 700

/** Call from a tap: iOS refuses `speak()` until the page has spoken once from a gesture. */
export function unlockSpeech(): void {
  if (!speakSupported()) return
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u) } catch { /* nothing to unlock */ }
}

export function speak(markdown: string, lang: string): void {
  if (!speakSupported()) return
  const text = speechText(markdown)
  if (!text) return
  stopSpeaking()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  u.onstart = () => { speaking = true }
  const done = () => { speaking = false; spokeAt = Date.now() }
  u.onend = done; u.onerror = done
  window.speechSynthesis.speak(u)
}

export function stopSpeaking(): void {
  if (!speakSupported()) return
  try { window.speechSynthesis.cancel() } catch { /* nothing */ }
  speaking = false; spokeAt = Date.now()
}

// ── listening ───────────────────────────────────────────────────────────────

export type ListenError = 'denied' | 'blocked' | 'unsupported' | 'failed'

export interface ListenOptions {
  lang: string
  /** Keep going across pauses: listen, and restart when the platform ends the session. */
  loop: boolean
  /** Words as they are heard, before they are final. */
  onInterim?: (text: string) => void
  /** A finished phrase. */
  onFinal: (text: string) => void
  /** The session actually started / ended — for the indicator. */
  onState?: (on: boolean) => void
  onError?: (e: ListenError) => void
}

export interface Listening { stop(): void }

// One microphone, one session: starting another ends the first.
let current: { stop(): void } | null = null

/** Is the microphone in use by anyone on this page? Whoever wants it next should wait rather than take it. */
export const micBusy = (): boolean => current !== null

export function startListening(o: ListenOptions): Listening | null {
  const C = ctor()
  if (!C) { o.onError?.('unsupported'); return null }
  current?.stop()

  let stopped = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let rec: SRInstance | null = null
  let sawSpeech = false
  const onVis = () => { if (document.hidden) handle.stop() }
  const cleanup = () => {
    document.removeEventListener('visibilitychange', onVis)
    if (current === handle) current = null
  }

  const begin = () => {
    if (stopped) return
    if (typeof document !== 'undefined' && document.hidden) { stopped = true; cleanup(); o.onState?.(false); return }
    rec = new C()
    rec.lang = o.lang; rec.continuous = o.loop; rec.interimResults = true; rec.maxAlternatives = 1
    sawSpeech = false
    rec.onresult = e => {
      sawSpeech = true; failures = 0
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const t = r[0]?.transcript ?? ''
        if (r.isFinal) { if (t.trim()) o.onFinal(t.trim()) } else interim += t
      }
      if (interim) o.onInterim?.(interim.trim())
    }
    rec.onerror = ev => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        stopped = true; cleanup()
        // Without a tap this is the platform declining to start, not the person declining the microphone.
        o.onError?.(ev.error === 'service-not-allowed' ? 'blocked' : 'denied')
      } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') failures++
    }
    rec.onend = () => {
      o.onState?.(false)
      if (stopped || !o.loop) { stopped = true; cleanup(); return }
      if (!sawSpeech) failures++
      if (failures >= 6) { stopped = true; cleanup(); o.onError?.('failed'); return }
      timer = setTimeout(begin, backoffMs(failures))
    }
    try { rec.start(); o.onState?.(true) } catch { failures++; if (failures >= 6) { stopped = true; cleanup(); o.onError?.('failed') } else timer = setTimeout(begin, backoffMs(failures)) }
  }

  const handle = {
    stop() {
      if (stopped && !rec) return
      stopped = true
      if (timer) clearTimeout(timer)
      cleanup()
      // A session we ended must not report later (its `end` arrives after a newer session has begun, and would switch the indicator off).
      if (rec) { rec.onresult = null; rec.onerror = null; rec.onend = null }
      try { rec?.abort() } catch { /* already over */ }
      o.onState?.(false)
    },
  }
  document.addEventListener('visibilitychange', onVis)
  current = handle
  begin()
  return handle
}
