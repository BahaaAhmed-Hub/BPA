import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, Trash2, X as XIcon, Reply, ReplyAll, Forward, MailOpen, ExternalLink,
  RefreshCw, ChevronDown, ChevronRight, Paperclip,
} from 'lucide-react'
import { Button } from '@/components/ui'
import { ICON, STROKE } from '@/lib/type'
import {
  getThread, header, extractHtmlBody, extractBody, escapeHtml,
  type MailAccount, type GmailMessage,
} from '@/lib/gmail'

// ─── Reading a thread, beside the list ───────────────────────────────────────
//
//  Clicking a row in the smart view used to throw you into the *other* view,
//  with the thread id handed to a list that indexes by message id — so it
//  switched the whole screen and then selected nothing. The one thing every
//  mail client on earth does, and this one could not: show you the message.
//
//  It is a docked column, not a modal. The list is what you came from and what
//  you go back to, and a sheet over the middle of it hides the queue you are
//  working down. Same decision the calendar composer and the task panel made.
//
//  Three things it is careful about:
//  - **The whole thread, newest open.** A reply quotes what it answers, so
//    opening every message would show the same paragraph five times; the
//    newest is expanded and the rest are one line each until asked for.
//  - **The body is an iframe**, sandboxed, because a message is somebody
//    else's HTML and it is not allowed near this page's styles or its scripts.
//  - **Nothing here sends.** Reply, reply-all and forward hand over to the
//    composer, which is the one place in the module that puts mail on the wire.

export interface ReaderTarget {
  threadId: string
  account: MailAccount
  subject: string
}

/** What a reader action asks the module to do. The panel itself owns no state
 *  beyond what it is showing — archiving is the list's business, and a panel
 *  that archived on its own would leave the row behind it. */
export interface ReaderActions {
  onClose: () => void
  onReply: (to: string, subject: string, threadId: string, quoted: string, messageId?: string) => void
  onReplyAll: (to: string, cc: string, subject: string, threadId: string, quoted: string, messageId?: string) => void
  onForward: (subject: string, quoted: string) => void
  onArchive: () => void
  onDelete: () => void
  onUnread: () => void
}

interface Shown {
  id: string
  from: string
  fromName: string
  to: string
  cc: string
  date: string
  html: string | null
  text: string
  attachments: string[]
}

function addressOf(v: string): string {
  const m = /<([^>]+)>/.exec(v)
  return (m ? m[1] : v).trim().toLowerCase()
}
function nameOf(v: string): string {
  const n = v.replace(/<[^>]*>/, '').replace(/["']/g, '').trim()
  return n || addressOf(v).split('@')[0] || 'Unknown'
}

function attachmentsOf(msg: GmailMessage): string[] {
  const out: string[] = []
  const walk = (part: { filename?: string; parts?: unknown[] } | undefined) => {
    if (!part) return
    if (part.filename) out.push(part.filename)
    for (const p of (part.parts ?? []) as { filename?: string; parts?: unknown[] }[]) walk(p)
  }
  walk(msg.payload as unknown as { filename?: string; parts?: unknown[] })
  return out.filter(Boolean)
}

export function SmartReader({
  target, width, className, actions,
}: {
  target: ReaderTarget
  /** The panel's width, so the list beside it keeps a sensible one too. It is
   *  an inline style because it is a number this component is given — the
   *  class beside it is what a media query needs to override it, since an
   *  inline style beats any stylesheet rule. */
  width: number
  className?: string
  actions: ReaderActions
}) {
  const [messages, setMessages] = useState<Shown[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => {
    // No "have I already run for this key" ref here. StrictMode mounts the
    // effect, tears it down and mounts it again: the first run would claim the
    // key and then be cancelled by its own cleanup, and the second would see
    // the key taken and never fetch — so the panel sat on "Opening…" for ever.
    // `live` is the whole of what is needed; a second fetch in development is
    // cheaper than a panel that never opens.
    setMessages(null); setError('')
    let live = true
    void (async () => {
      try {
        const th = await getThread(target.threadId, target.account)
        if (!live) return
        const rows: Shown[] = (th.messages ?? []).map(m => ({
          id: m.id,
          from: header(m.payload?.headers ?? [], 'From'),
          fromName: nameOf(header(m.payload?.headers ?? [], 'From')),
          to: header(m.payload?.headers ?? [], 'To'),
          cc: header(m.payload?.headers ?? [], 'Cc'),
          date: header(m.payload?.headers ?? [], 'Date'),
          html: extractHtmlBody(m),
          text: extractBody(m),
          attachments: attachmentsOf(m),
        }))
        setMessages(rows)
        // The newest is the one you came to read; the rest quote it.
        setOpen(new Set(rows.slice(-1).map(r => r.id)))
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'The thread could not be opened')
      }
    })()
    return () => { live = false }
  }, [target.threadId, target.account])

  const newest = messages?.[messages.length - 1]
  const quoted = useMemo(() => {
    if (!newest) return ''
    return `\n\nOn ${newest.date}, ${newest.fromName} wrote:\n` +
      newest.text.split('\n').map(l => `> ${l}`).join('\n')
  }, [newest])

  const replySubject = /^re:/i.test(target.subject) ? target.subject : `Re: ${target.subject}`

  return (
    <aside className={className} style={{
      width, flexShrink: 0, alignSelf: 'start',
      position: 'sticky', top: 0,
      maxHeight: 'calc(100vh - 150px)',
      display: 'flex', flexDirection: 'column',
      background: 'var(--sb-card)',
      border: 'var(--sb-border-width) solid var(--sb-border)',
      borderRadius: 'var(--sb-r-nav)', overflow: 'hidden',
    }}>
      {/* ── The header: what it is, and what you can do to it ───────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '13px 14px',
        borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0, fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-body)',
            fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)', lineHeight: 1.35,
          }}>{target.subject}</p>
          <p style={{ margin: '3px 0 0', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
            {target.account.email}
            {messages && messages.length > 1 && <> · {messages.length} messages</>}
          </p>
        </div>
        <Button size="sm" variant="ghost" iconOnly onClick={actions.onClose} title="Close">
          <XIcon size={ICON.sm} strokeWidth={STROKE.rest} />
        </Button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        padding: '9px 14px', background: 'var(--sb-field)',
        borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
      }}>
        <Button size="sm" disabled={!newest}
          onClick={() => newest && actions.onReply(addressOf(newest.from), replySubject, target.threadId, quoted, newest.id)}>
          <Reply size={ICON.sm} strokeWidth={STROKE.rest} /> Reply
        </Button>
        <Button size="sm" variant="ghost" disabled={!newest} title="Reply to everyone on it"
          onClick={() => newest && actions.onReplyAll(
            addressOf(newest.from), [newest.to, newest.cc].filter(Boolean).join(', '),
            replySubject, target.threadId, quoted, newest.id)}>
          <ReplyAll size={ICON.sm} strokeWidth={STROKE.rest} /> All
        </Button>
        <Button size="sm" variant="ghost" disabled={!newest}
          onClick={() => actions.onForward(
            /^fwd?:/i.test(target.subject) ? target.subject : `Fwd: ${target.subject}`, quoted)}>
          <Forward size={ICON.sm} strokeWidth={STROKE.rest} /> Forward
        </Button>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" iconOnly onClick={actions.onUnread}
          title="Mark unread in Gmail">
          <MailOpen size={ICON.sm} strokeWidth={STROKE.rest} />
        </Button>
        <Button size="sm" variant="ghost" iconOnly onClick={actions.onArchive}
          title="Archive — out of the inbox in Gmail">
          <Archive size={ICON.sm} strokeWidth={STROKE.rest} />
        </Button>
        <Button size="sm" variant="ghost" iconOnly onClick={actions.onDelete}
          title="Move it to the Bin in Gmail">
          <Trash2 size={ICON.sm} strokeWidth={STROKE.rest} />
        </Button>
        <a href={`https://mail.google.com/mail/u/${encodeURIComponent(target.account.email)}/#all/${target.threadId}`}
          target="_blank" rel="noreferrer" title="Open in Gmail"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 'var(--sb-r-chip)', color: 'var(--sb-ink-3)',
          }}>
          <ExternalLink size={ICON.sm} strokeWidth={STROKE.rest} />
        </a>
      </div>

      {/* ── The messages ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {error ? (
          <p style={{ margin: 0, padding: '22px 16px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>
            {error}
          </p>
        ) : !messages ? (
          <p style={{
            margin: 0, padding: '22px 16px', display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)',
          }}>
            <RefreshCw size={ICON.sm} style={{ animation: 'spin 1s linear infinite' }} /> Opening…
          </p>
        ) : messages.map((m, i) => {
          const shown = open.has(m.id)
          return (
            <div key={m.id} style={{
              borderBottom: i < messages.length - 1 ? 'var(--sb-border-width) solid var(--sb-hairline)' : 'none',
            }}>
              <button
                onClick={() => setOpen(prev => {
                  const n = new Set(prev)
                  n.has(m.id) ? n.delete(m.id) : n.add(m.id)
                  return n
                })}
                aria-expanded={shown}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                  padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                {shown
                  ? <ChevronDown size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: 'var(--sb-ink-4)' }} />
                  : <ChevronRight size={ICON.sm} strokeWidth={STROKE.rest} style={{ flexShrink: 0, color: 'var(--sb-ink-4)' }} />}
                <span style={{
                  fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '45%',
                }}>{m.fromName}</span>
                {!shown && (
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{m.text.replace(/\s+/g, ' ').slice(0, 120)}</span>
                )}
                <span style={{ flex: shown ? 1 : undefined }} />
                <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', flexShrink: 0 }}>
                  {m.date ? new Date(m.date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </button>

              {shown && (
                <div style={{ padding: '0 14px 14px' }}>
                  <p style={{
                    margin: '0 0 8px', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)',
                    lineHeight: 1.5, wordBreak: 'break-word',
                  }}>
                    {addressOf(m.from)}{m.to && <> → {m.to}</>}{m.cc && <> · cc {m.cc}</>}
                  </p>
                  {m.attachments.length > 0 && (
                    <p style={{
                      margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                      fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)',
                    }}>
                      <Paperclip size={11} strokeWidth={STROKE.rest} />
                      {m.attachments.join(', ')}
                    </p>
                  )}
                  <Body html={m.html} text={m.text} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

/** A message is somebody else's HTML. It is drawn in a sandboxed frame with no
 *  scripts and no same-origin access, so it cannot reach this page's styles,
 *  its storage or its session — and the frame is sized to its own content, so
 *  the panel scrolls once rather than twice. */
function Body({ html, text }: { html: string | null; text: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(180)

  const doc = useMemo(() => {
    const body = html ?? `<pre style="white-space:pre-wrap;font:inherit;margin:0">${escapeHtml(text)}</pre>`
    return `<!doctype html><html><head><meta charset="utf-8">
      <base target="_blank">
      <style>
        html,body{margin:0;padding:0;background:transparent;
          font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#191712;
          word-wrap:break-word;overflow-wrap:anywhere}
        img{max-width:100%;height:auto}
        table{max-width:100%}
        a{color:#0B63C5}
        blockquote{margin:0 0 0 10px;padding-left:10px;border-left:2px solid #E8E1CE;color:#6C6553}
      </style></head><body>${body}</body></html>`
  }, [html, text])

  useEffect(() => {
    const frame = ref.current
    if (!frame) return
    const measure = () => {
      const h = frame.contentDocument?.body?.scrollHeight
      if (h && h > 0) setHeight(Math.min(h + 16, 2400))
    }
    frame.addEventListener('load', measure)
    // Pictures land after the document does and change its height with them.
    const t = window.setInterval(measure, 400)
    const stop = window.setTimeout(() => window.clearInterval(t), 4000)
    return () => {
      frame.removeEventListener('load', measure)
      window.clearInterval(t); window.clearTimeout(stop)
    }
  }, [doc])

  return (
    <iframe
      ref={ref}
      srcDoc={doc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      title="Message"
      style={{ width: '100%', height, border: 'none', display: 'block', background: 'transparent' }}
    />
  )
}
