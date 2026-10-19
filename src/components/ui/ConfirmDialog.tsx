import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { T } from '@/lib/type'
import { inputStyle } from '@/lib/fields'
import { attachAskHost, nextAsk, type AskRequest } from '@/lib/confirm'

// ─── ConfirmDialog — the app's own "are you sure" ────────────────────────────
// Mounted once (see App). Card surface, h3 title, body text, a danger button
// and a secondary one. Escape and the scrim cancel; **focus starts on the safe
// button**, so a stray Enter cancels rather than deletes. The typed variant
// focuses its field instead — that is the point of it.
export function ConfirmHost() {
  const [req, setReq] = useState<AskRequest | null>(null)
  const [text, setText] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => attachAskHost(r => { setReq(r); setText('') }), [])

  useEffect(() => {
    if (!req) return
    // After paint, so the element exists.
    const t = window.setTimeout(() => (req.kind === 'text' ? field.current : box.current?.querySelector<HTMLElement>('[data-confirm-safe]'))?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [req])

  if (!req) return null

  const finish = (answer: boolean | string | null) => {
    if (req.kind === 'confirm') req.resolve(answer === true)
    else req.resolve(typeof answer === 'string' ? answer : null)
    setReq(nextAsk()); setText('')
  }
  const cancel = () => finish(req.kind === 'confirm' ? false : null)
  const required = req.kind === 'text' && req.opts.required !== false
  const canSubmit = req.kind === 'confirm' || !required || text.trim().length > 0
  const submit = () => { if (canSubmit) finish(req.kind === 'confirm' ? true : text.trim()) }

  const { opts } = req
  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) cancel() }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); cancel() } }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'color-mix(in srgb, var(--sb-ink-1) 40%, transparent)', padding: 16,
      }}>
      <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby="sb-confirm-title" aria-describedby={opts.body ? 'sb-confirm-body' : undefined}
        style={{
          width: 'min(420px, 100%)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
          borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-hover)', padding: 20,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
        <div id="sb-confirm-title" style={{ ...T.h3, color: 'var(--sb-ink-1)' }}>{opts.title}</div>
        {opts.body && <div id="sb-confirm-body" style={{ ...T.body, color: 'var(--sb-ink-2)', whiteSpace: 'pre-line' }}>{opts.body}</div>}
        {req.kind === 'text' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...T.meta, color: 'var(--sb-ink-3)' }}>{req.opts.label}</span>
            <input ref={field} value={text} type={req.opts.type ?? 'text'} placeholder={req.opts.placeholder}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
              style={inputStyle} />
          </label>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <Button data-confirm-safe variant="secondary" onClick={cancel}>{(req.kind === 'confirm' && req.opts.cancelLabel) || 'Cancel'}</Button>
          <Button variant={req.kind === 'confirm' && req.opts.danger === false ? 'primary' : req.kind === 'confirm' ? 'danger' : 'primary'}
            disabled={!canSubmit} onClick={submit}>
            {opts.confirmLabel ?? (req.kind === 'confirm' ? 'Confirm' : 'Save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
