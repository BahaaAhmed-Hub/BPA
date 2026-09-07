import { useEffect, useRef, useState } from 'react'
import {
  Bold, Italic, Underline, Link2, List, Paperclip, Trash2, X, Send, ChevronDown,
} from 'lucide-react'
import { sendMail, escapeHtml, type MailAccount, type MailAttachment } from '@/lib/gmail'

// ─── Writing one ─────────────────────────────────────────────────────────────
//
// A reply, a reply to everyone, a forward and a new message are the same panel
// with different fields filled in — which is the only honest way to build it,
// because they are the same act. What differs is the answer to three questions:
// who it goes to, what it is called, and what is quoted underneath.
//
// The body is a contenteditable rather than a textarea, so bold, italic, a link
// and a list are possible and the quoted original keeps its shape. It is sent
// as HTML with a plain-text alternative derived from it, so a client that will
// not render HTML still gets the words.

export type ComposeMode = 'reply' | 'replyAll' | 'forward' | 'new'

export interface ComposeSeed {
  mode: ComposeMode
  account: MailAccount
  to: string
  cc?: string
  subject: string
  /** The original, quoted underneath what you write. */
  quoted?: string
  threadId?: string
  inReplyTo?: string
}

const C = {
  card: '#FFFFFF', field: '#FAF7EC', border: '#E8E1CE', hair: '#F0EBDC',
  ink: '#191712', muted: '#6C6553', ghost: '#9B9180', amber: '#F5D14E', red: '#C62828',
}

const LABEL: React.CSSProperties = {
  width: 46, flexShrink: 0, fontSize: 11.5, color: C.ghost, paddingTop: 7,
}
const INPUT: React.CSSProperties = {
  flex: 1, minWidth: 0, height: 30, padding: '0 9px', borderRadius: 7, boxSizing: 'border-box',
  background: C.field, border: `1px solid ${C.border}`,
  fontFamily: 'inherit', fontSize: 12.5, color: C.ink, outline: 'none',
}
const TOOL: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: 'transparent', border: 'none',
  color: C.muted, cursor: 'pointer', padding: 0,
}

const MODE_LABEL: Record<ComposeMode, string> = {
  reply: 'Reply', replyAll: 'Reply to everyone', forward: 'Forward', new: 'New message',
}

function readAsBase64(file: File): Promise<MailAttachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error(`Could not read ${file.name}`))
    r.onload = () => {
      const url = String(r.result)
      resolve({ name: file.name, mime: file.type || 'application/octet-stream', data: url.slice(url.indexOf(',') + 1) })
    }
    r.readAsDataURL(file)
  })
}

const fmtBytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`

export function Composer({ seed, accounts, onClose, onSent }: {
  seed: ComposeSeed
  /** Every mailbox, so the one it leaves from can be changed before sending. */
  accounts: MailAccount[]
  onClose: () => void
  onSent: () => void
}) {
  const [from, setFrom]       = useState(seed.account.email)
  const [to, setTo]           = useState(seed.to)
  const [cc, setCc]           = useState(seed.cc ?? '')
  const [bcc, setBcc]         = useState('')
  const [showCc, setShowCc]   = useState(!!seed.cc)
  const [showBcc, setShowBcc] = useState(false)
  const [subject, setSubject] = useState(seed.subject)
  const [files, setFiles]     = useState<{ file: File; att: MailAttachment }[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Start where the writing starts: above the quote, caret in place.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.innerHTML = `<div><br></div>${seed.quoted
      ? `<div style="color:#6C6553;border-left:2px solid #E8E1CE;padding-left:10px;margin-top:14px">${seed.quoted}</div>`
      : ''}`
    el.focus()
    const range = document.createRange()
    range.setStart(el.firstChild ?? el, 0)
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges(); sel?.addRange(range)
  }, [seed])

  function cmd(name: string, value?: string) {
    bodyRef.current?.focus()
    document.execCommand(name, false, value)
  }

  async function attach(list: FileList | null) {
    if (!list?.length) return
    setError(null)
    try {
      const added = await Promise.all([...list].map(async f => ({ file: f, att: await readAsBase64(f) })))
      setFiles(prev => [...prev, ...added])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.')
    }
  }

  async function send() {
    const html = bodyRef.current?.innerHTML ?? ''
    if (!to.trim()) { setError('Who is it going to?'); return }
    setSending(true); setError(null)
    try {
      await sendMail({
        account: accounts.find(a => a.email === from) ?? seed.account,
        to, cc: cc.trim() || undefined, bcc: bcc.trim() || undefined,
        subject: subject.trim() || '(no subject)',
        html,
        threadId: seed.mode === 'forward' ? undefined : seed.threadId,
        inReplyTo: seed.mode === 'forward' ? undefined : seed.inReplyTo,
        attachments: files.map(f => f.att),
      })
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google would not send it.')
    } finally {
      setSending(false)
    }
  }

  const total = files.reduce((n, f) => n + f.file.size, 0)

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: '0 6px 24px rgba(25,23,18,0.10)', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', maxHeight: '68vh',
    }}>
      {/* Which of the four this is, and a way out */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
        borderBottom: `1px solid ${C.hair}`, background: '#FCFAF4',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{MODE_LABEL[seed.mode]}</span>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} title="Discard" style={TOOL}><X size={14} /></button>
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7, overflowY: 'auto' }}>
        {/* From — a reply leaves from the mailbox it arrived in unless you say
            otherwise, which is the one thing a multi-account client must get
            right. */}
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={LABEL}>From</span>
          <span style={{ position: 'relative', display: 'flex', flex: 1, minWidth: 0 }}>
            <span style={{ ...INPUT, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{from}</span>
              <ChevronDown size={13} style={{ color: C.ghost, flexShrink: 0 }} />
            </span>
            <select value={from} onChange={e => setFrom(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
              {accounts.map(a => <option key={a.email} value={a.email}>{a.email}</option>)}
            </select>
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <span style={LABEL}>To</span>
          <input value={to} onChange={e => setTo(e.target.value)} placeholder="name@example.com" style={INPUT} />
          {!showCc  && <button onClick={() => setShowCc(true)}  style={{ ...TOOL, width: 'auto', padding: '0 7px', fontSize: 11.5, fontFamily: 'inherit' }}>Cc</button>}
          {!showBcc && <button onClick={() => setShowBcc(true)} style={{ ...TOOL, width: 'auto', padding: '0 7px', fontSize: 11.5, fontFamily: 'inherit' }}>Bcc</button>}
        </div>

        {showCc && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={LABEL}>Cc</span>
            <input value={cc} onChange={e => setCc(e.target.value)} style={INPUT} />
          </div>
        )}
        {showBcc && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={LABEL}>Bcc</span>
            <input value={bcc} onChange={e => setBcc(e.target.value)} style={INPUT} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <span style={LABEL}>Subject</span>
          <input value={subject} onChange={e => setSubject(e.target.value)} style={INPUT} />
        </div>

        {/* What the message says */}
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          onPaste={e => {
            // Paste words, not somebody else's stylesheet.
            e.preventDefault()
            const text = e.clipboardData.getData('text/plain')
            document.execCommand('insertHTML', false, escapeHtml(text).replace(/\n/g, '<br>'))
          }}
          style={{
            minHeight: 150, maxHeight: '32vh', overflowY: 'auto', marginTop: 3,
            padding: '10px 11px', borderRadius: 8, background: C.field,
            border: `1px solid ${C.border}`, outline: 'none',
            fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55, color: C.ink,
          }}
        />

        {files.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {files.map((f, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 8px',
                borderRadius: 999, background: C.field, border: `1px solid ${C.border}`,
                fontSize: 11, color: C.muted,
              }}>
                <Paperclip size={11} />
                {f.file.name} · {fmtBytes(f.file.size)}
                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                  title="Remove" style={{ ...TOOL, width: 14, height: 14, color: C.ghost }}>
                  <X size={11} />
                </button>
              </span>
            ))}
            {/* Google's own limit, and worth saying before the send fails. */}
            {total > 24 * 1024 * 1024 && (
              <span style={{ fontSize: 11, color: C.red, alignSelf: 'center' }}>
                Over 25 MB — Gmail will refuse it. Send a link instead.
              </span>
            )}
          </div>
        )}

        {error && <p style={{ margin: 0, fontSize: 12, color: C.red, lineHeight: 1.5 }}>{error}</p>}
      </div>

      {/* Send, and the handful of things worth doing to the words first */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '9px 12px',
        borderTop: `1px solid ${C.hair}`, background: '#FCFAF4',
      }}>
        <button onClick={() => void send()} disabled={sending}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 15px',
            borderRadius: 9, background: C.amber, border: '1px solid rgba(25,23,18,0.18)',
            color: C.ink, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
            cursor: sending ? 'default' : 'pointer', boxShadow: '0 2px 0 rgba(25,23,18,0.12)',
          }}>
          <Send size={13} /> {sending ? 'Sending…' : 'Send'}
        </button>
        <span style={{ width: 8 }} />
        <button onClick={() => cmd('bold')}      title="Bold"      style={TOOL}><Bold size={14} /></button>
        <button onClick={() => cmd('italic')}    title="Italic"    style={TOOL}><Italic size={14} /></button>
        <button onClick={() => cmd('underline')} title="Underline" style={TOOL}><Underline size={14} /></button>
        <button onClick={() => cmd('insertUnorderedList')} title="Bullets" style={TOOL}><List size={14} /></button>
        <button title="Add a link" style={TOOL}
          onClick={() => { const url = window.prompt('Link to'); if (url) cmd('createLink', url) }}>
          <Link2 size={14} />
        </button>
        <button onClick={() => fileRef.current?.click()} title="Attach a file" style={TOOL}>
          <Paperclip size={14} />
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={e => { void attach(e.target.files); e.target.value = '' }} />
        <span style={{ flex: 1 }} />
        <button onClick={onClose} title="Discard" style={{ ...TOOL, color: C.ghost }}><Trash2 size={14} /></button>
      </div>
    </div>
  )
}
