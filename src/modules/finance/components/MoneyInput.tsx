import { useRef, useState, type CSSProperties } from 'react'
import type React from 'react'
import { groupWhileTyping, group, ungroup } from '../format'

/** A money field that carries its thousands separators as you type. It holds
 *  the text rather than the number, so a half-typed "1,2" survives until the
 *  field is left, and it puts the caret back where it was — reformatting on
 *  every keystroke otherwise throws it to the end of the line. */
export function MoneyInput({ value, onChange, onCommit, style, placeholder, autoFocus, decimals, id, min, onKeyDown }: {
  value: number
  onChange: (n: number) => void
  onCommit?: (n: number) => void
  style?: CSSProperties
  placeholder?: string
  autoFocus?: boolean
  /** Fixed decimal places. Left off, a whole number shows none and a fraction
   *  shows two, so "600" does not become "600.00" the moment the field is left. */
  decimals?: number
  id?: string
  min?: number
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState<string | null>(null)

  const places = decimals ?? (Number.isInteger(value) ? 0 : 2)
  const shown = typed ?? (value === 0 ? '' : group(value, places))

  return (
    <input
      id={id}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={shown}
      onChange={e => {
        const el = e.currentTarget
        const { text, caret } = groupWhileTyping(el.value, el.selectionStart ?? el.value.length)
        setTyped(text)
        const n = ungroup(text)
        onChange(min !== undefined ? Math.max(min, n) : n)
        requestAnimationFrame(() => {
          if (ref.current && ref.current === document.activeElement) {
            ref.current.setSelectionRange(caret, caret)
          }
        })
      }}
      onKeyDown={onKeyDown}
      onBlur={() => { setTyped(null); onCommit?.(value) }}
      style={style}
    />
  )
}
