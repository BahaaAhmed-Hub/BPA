/**
 *  A native date, month or time input styled by putting it at `opacity: 0`
 *  over a label that draws the value.
 *
 *  A click on that label focuses the input and does **nothing else**: the
 *  browser only opens the calendar from the little indicator, which is exactly
 *  the part made invisible. So a pill that plainly looks like a date picker
 *  reads as a dead control — the value never changes because the picker never
 *  opens. A `<select>` under the same treatment is fine, since a click on one
 *  opens it natively; only the temporal inputs need this.
 *
 *  `showPicker()` is what opens it from a real gesture. It throws where the
 *  browser will not allow it (no user activation, an input that is not
 *  rendered), and the focus below is the fallback for that case — a focused
 *  field can still be typed into, which is better than nothing happening.
 */
export function openPicker(e: React.MouseEvent<HTMLElement>): void {
  const host = e.currentTarget as HTMLElement
  const input = host.matches('input') ? host as HTMLInputElement : host.querySelector('input')
  if (!input) return
  // The label's own click would forward to the input and re-enter here.
  e.preventDefault()
  try { (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.() }
  catch { /* not allowed here — the focus below is the fallback */ }
  input.focus()
}
