import { useCallback, useEffect, useRef, useState } from 'react'

/** A keystroke is not a request: words are held this long before they are
 *  written. The same figure the calendar composer and Shopping use. */
export const HOLD_MS = 700

/**
 * A text field that holds its words, then pushes them.
 *
 * - A value arriving from outside — another device, an undo — is taken only
 *   while nothing is half-typed, or it lands on the caret.
 * - Blur and Enter commit at once, and **so does unmounting**: closing the
 *   panel is not how you lose the sentence you just typed.
 */
export function useHeldText(value: string, push: (v: string) => void) {
  const [text, setText] = useState(value)
  const timer = useRef<number | null>(null)
  const dirty = useRef(false)
  const textRef = useRef(value)
  const pushRef = useRef(push)

  // Kept current after each render, not during it.
  useEffect(() => { pushRef.current = push; textRef.current = text })

  // Syncing from outside is the point of this effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!dirty.current) setText(value) }, [value])

  const commit = useCallback((v: string) => {
    dirty.current = false
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    pushRef.current(v)
  }, [])

  const onChange = useCallback((v: string) => {
    setText(v)
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => commit(v), HOLD_MS)
  }, [commit])

  const onBlur = useCallback(() => { if (dirty.current) commit(textRef.current) }, [commit])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (dirty.current) pushRef.current(textRef.current)
  }, [])

  return { text, onChange, onBlur }
}
