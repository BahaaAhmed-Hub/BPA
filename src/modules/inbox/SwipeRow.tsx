// ─── A mail row you can swipe ────────────────────────────────────────────────
//
// Two gestures, the way every mail app has taught people to expect them:
//
//   swipe right →   mark it read, or unread if it already is. It fires on
//                   release and the row springs back — there is nothing left
//                   on screen to tidy up afterwards.
//   swipe left  ←   pull the row aside and leave Archive and Delete standing
//                   behind it. It stays open until you pick one, swipe it
//                   back, or touch anything else.
//
// Four things this has to get right, all of which are easy to get wrong:
//
// - **Vertical scrolling must survive.** The list is scrolled with the same
//   finger that swipes, so the gesture's axis is decided once, after the first
//   few pixels, and never revisited: past the slop, whichever of dx and dy is
//   larger wins the whole gesture. `touch-action: pan-y` leaves the browser
//   free to scroll until we claim the pointer.
//
// - **A swipe must not also be a click.** A drag that ends anywhere but where
//   it started still fires `click` on the row underneath, which would open the
//   message you were trying to archive. `moved` is checked in a capturing
//   handler and swallows it — the same guard the Financials table needs.
//
// - **Only one row is open at a time.** Two rows pulled aside is two sets of
//   buttons and no way to tell which the next tap belongs to, so opening one
//   closes the other. The parent owns which, since a row cannot know.
//
// - **Pointer events, not touch events.** This app is used on an iPad and on a
//   laptop, and `touchstart` never fires for a mouse. It is the same choice the
//   Financials and goals drags made.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, Trash2, MailOpen, Mail } from 'lucide-react'

/** How far before the gesture commits to an axis. Under this it is a tap. */
const SLOP = 8
/** How far right you have to go for the read gesture to fire on release. */
const READ_AT = 68
/** Each button behind the row. Two of them is how far the row travels. */
const BTN_W = 76
const OPEN_W = BTN_W * 2

export interface SwipeRowProps {
  children: React.ReactNode
  /** True when the message is already read, so the gesture says "unread". */
  isRead: boolean
  onRead: () => void
  onArchive: () => void
  onDelete: () => void
  /** Which row the list currently has open, and how to change it. */
  openId: string | null
  id: string
  setOpenId: (id: string | null) => void
  /** Swiping is off where the actions make no sense — the Bin, say. */
  disabled?: boolean
}

export function SwipeRow({
  children, isRead, onRead, onArchive, onDelete, openId, id, setOpenId, disabled,
}: SwipeRowProps) {
  const open = openId === id
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const axis = useRef<'none' | 'x' | 'y'>('none')
  const moved = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  const actions = useRef<HTMLDivElement>(null)

  // The row rests where the list says it should: pulled aside while it is the
  // open one, flat otherwise. A row closed from outside animates back.
  useEffect(() => { if (!dragging) setDx(open ? -OPEN_W : 0) }, [open, dragging])

  const down = useCallback((e: React.PointerEvent) => {
    if (disabled || e.pointerType === 'mouse' && e.button !== 0) return
    start.current = { x: e.clientX, y: e.clientY }
    axis.current = 'none'
    moved.current = false
  }, [disabled])

  const move = useCallback((e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    const ddx = e.clientX - s.x
    const ddy = e.clientY - s.y

    if (axis.current === 'none') {
      if (Math.abs(ddx) < SLOP && Math.abs(ddy) < SLOP) return
      // Decided once, and not revisited: a gesture that changes its mind
      // mid-stroke is one that steals the scroll you were already doing.
      axis.current = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y'
      if (axis.current === 'y') { start.current = null; return }
      box.current?.setPointerCapture(e.pointerId)
      setDragging(true)
    }

    moved.current = true
    const base = open ? -OPEN_W : 0
    let next = base + ddx
    // Rightward past flat is the read gesture and needs no more room than the
    // threshold; leftward stops at the buttons, with a little give so the row
    // feels held rather than stuck.
    next = Math.max(-OPEN_W - 16, Math.min(READ_AT + 24, next))
    setDx(next)
  }, [open])

  const up = useCallback(() => {
    const s = start.current
    start.current = null
    if (axis.current !== 'x') { setDragging(false); return }
    setDragging(false)
    if (!s) return

    if (dx >= READ_AT) {
      // Fires on release, and the row springs back — a read message has
      // nothing left to show behind it.
      setOpenId(null)
      setDx(0)
      onRead()
      return
    }
    // Past halfway into the buttons keeps them; anything less closes.
    setOpenId(dx <= -OPEN_W / 2 ? id : null)
  }, [dx, id, onRead, setOpenId])

  // A drag ends as a click on whatever is underneath — a mouse pressed and
  // released at different points still fires one — which would open the message
  // you were trying to archive. Caught on the way down, so the row never sees it.
  //
  // The gesture's own click and a real tap have to be told apart, and `moved` is
  // what does it. Treating both as "close the open row" meant the click that
  // *ended* the opening swipe immediately shut it again: the row sprang open and
  // flat in one gesture, which read as the swipe simply not working.
  const swallow = useCallback((e: React.MouseEvent) => {
    if (moved.current) {
      // The tail of a swipe. It has already decided what the row does.
      e.preventDefault()
      e.stopPropagation()
      moved.current = false
      return
    }
    // A tap on Archive or Delete is the whole point of having opened the row.
    // Closing on it here would stop the click in the capture phase, before the
    // button it was aimed at ever saw it — the buttons would appear, and then
    // do nothing at all.
    if (actions.current?.contains(e.target as Node)) return

    // Any other tap while the buttons are showing means "put it back".
    if (open) {
      e.preventDefault()
      e.stopPropagation()
      setOpenId(null)
    }
  }, [open, setOpenId])

  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setOpenId(null)
    fn()
  }

  // What is showing behind the row, on whichever side it has been pulled from.
  const rightward = dx > 0
  const armed = dx >= READ_AT

  return (
    <div ref={box} style={{ position: 'relative', overflow: 'hidden', touchAction: 'pan-y' }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onClickCapture={swallow}>

      {/* The read gesture's own ground, revealed from the left as you pull. */}
      {rightward && (
        <div aria-hidden style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 7,
          paddingLeft: 18, background: armed ? 'var(--sb-info)' : 'color-mix(in srgb, var(--sb-info) 22%, transparent)',
          color: armed ? 'var(--sb-ink-on-fill)' : 'var(--sb-info)',
          fontSize: 'var(--sb-t-body-s)', fontWeight: 600, transition: 'background 120ms',
        }}>
          {isRead ? <Mail size={16} /> : <MailOpen size={16} />}
          {isRead ? 'Mark unread' : 'Mark read'}
        </div>
      )}

      {/* Archive and Delete, standing behind the row on the right. */}
      {!rightward && dx < 0 && (
        <div ref={actions} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, display: 'flex' }}>
          <button onClick={act(onArchive)} title="Archive"
            style={{
              width: BTN_W, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: 'var(--sb-ink-3)', color: 'var(--sb-ink-on-dark)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 3, fontSize: 'var(--sb-t-micro)', fontWeight: 600,
            }}>
            <Archive size={17} /> Archive
          </button>
          <button onClick={act(onDelete)} title="Move it to the Bin"
            style={{
              width: BTN_W, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: 'var(--sb-negative)', color: 'var(--sb-ink-on-fill)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 3, fontSize: 'var(--sb-t-micro)', fontWeight: 600,
            }}>
            <Trash2 size={17} /> Delete
          </button>
        </div>
      )}

      <div style={{
        transform: `translateX(${dx}px)`,
        // Follows the finger while it is down; springs when it is not.
        transition: dragging ? 'none' : 'transform 180ms cubic-bezier(.2,.8,.3,1)',
        background: 'var(--sb-card)', position: 'relative',
      }}>
        {children}
      </div>
    </div>
  )
}
