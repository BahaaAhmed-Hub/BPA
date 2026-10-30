import { useState, useEffect } from 'react'
import { EmptyState } from '@/components/ui'
import { Plus, X, MessageSquare } from 'lucide-react'
import { usePersona } from '@/lib/assistantPersona'
import { ICON, STROKE } from '@/lib/type'
import { listUserTokens, createUserToken, revokeUserToken, type UserToken } from '@/lib/userTokens'
import { getTelegramLinks, revokeTelegramLink, type TelegramLink } from '@/lib/telegramLink'
import { IntegrationHub, type HubNode } from './IntegrationHub'
import { MARKS } from '@/lib/integrationMarks'

// ─── Integrations Section (11D) ───────────────────────────────────────────────

export function IntegrationsSection() {
  // The Shortcut is named after the assistant, so "Hey Siri, <name>" is how you call it with the app shut.
  const siriName = usePersona().name || 'Ask Professor'
  const [tokens, setTokens] = useState<UserToken[]>([])
  const [creatingToken, setCreatingToken] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [revealedToken, setRevealedToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedSiri, setCopiedSiri] = useState(false)
  const [telegramLinks, setTelegramLinks] = useState<TelegramLink[]>([])
  const [siriToken, setSiriToken] = useState<string | null>(null)

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const siriBaseUrl  = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/professor-siri` : ''

  useEffect(() => {
    listUserTokens().then(setTokens)
    getTelegramLinks().then(setTelegramLinks)
  }, [])

  async function handleCreateToken() {
    if (!newLabel.trim()) return
    const tok = await createUserToken(newLabel.trim())
    if (!tok) return
    setTokens(prev => [tok, ...prev])
    setRevealedToken(tok.token)
    setCreatingToken(false)
    setNewLabel('')
    setCopied(false)
  }

  async function handleRevoke(id: string) {
    const ok = await revokeUserToken(id)
    if (ok) setTokens(prev => prev.filter(t => t.id !== id))
  }

  async function handleRevokeTelegram(chatId: string) {
    const ok = await revokeTelegramLink(chatId)
    if (ok) setTelegramLinks(prev => prev.filter(l => l.chat_id !== chatId))
  }

  function copyToken() {
    if (!revealedToken) return
    navigator.clipboard.writeText(revealedToken).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Connected means there is something to act as you: a linked chat for Telegram,
  // a token for Siri and the MCP server (which is what both of them present).
  const hubNodes: HubNode[] = [
    { id: 'telegram', label: 'Telegram', mark: MARKS.telegram, state: telegramLinks.length > 0 ? 'on' : 'off' },
    { id: 'siri',     label: 'Siri',     mark: MARKS.siri,     state: tokens.length > 0 ? 'on' : 'off' },
    { id: 'mcp',      label: 'MCP',      mark: MARKS.mcp,      state: tokens.length > 0 ? 'on' : 'off' },
    { id: 'notion',   label: 'Notion',   mark: MARKS.notion,   state: 'soon' },
    { id: 'asana',    label: 'Asana',    mark: MARKS.asana,    state: 'soon' },
    { id: 'trello',   label: 'Trello',   mark: MARKS.trello,   state: 'soon' },
    { id: 'notes',    label: 'Apple Notes', mark: MARKS.appleNotes, state: 'soon' },
  ]

  return (
    <div>
      <IntegrationHub nodes={hubNodes} />

      {/* ── CONNECTIONS — personal access tokens ─────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>Connections</p>
            <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
              Tokens let the MCP server, Siri Shortcuts, and Telegram act as you. Each is shown once — copy it before closing.
            </p>
          </div>
          <button onClick={() => { setCreatingToken(true); setRevealedToken(null) }} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 'var(--sb-r-chip)',
            background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
            fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-2)', cursor: 'pointer', flexShrink: 0,
          }}>
            <Plus size={ICON.sm} /> New token
          </button>
        </div>

        {/* Create form */}
        {creatingToken && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
            <input
              autoFocus
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreateToken(); if (e.key === 'Escape') setCreatingToken(false) }}
              placeholder="Label, e.g. Siri Shortcuts"
              style={{ flex: 1, fontSize: 'var(--sb-t-body-s)', padding: '7px 11px', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-field)', color: 'var(--sb-ink-1)', outline: 'none' }}
            />
            <button onClick={() => void handleCreateToken()} disabled={!newLabel.trim()} style={{
              padding: '7px 14px', borderRadius: 'var(--sb-r-chip)', border: 'none',
              background: newLabel.trim() ? 'var(--sb-ink-1)' : 'var(--sb-border)', color: newLabel.trim() ? 'var(--sb-page)' : 'var(--sb-ink-4)', // ui-guard: ink-ok
              fontSize: 'var(--sb-t-body-s)', fontWeight: 600, cursor: newLabel.trim() ? 'pointer' : 'not-allowed',
            }}>Generate</button>
            <button onClick={() => setCreatingToken(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: '4px', display: 'flex', alignItems: 'center' }}>
              <X size={ICON.sm} />
            </button>
          </div>
        )}

        {/* Revealed token (shown once) */}
        {revealedToken && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
            padding: '10px 13px', borderRadius: 'var(--sb-r-nav)',
            background: 'color-mix(in srgb, var(--sb-positive) 8%, transparent)',
            border: 'var(--sb-border-width) solid var(--sb-positive)',
          }}>
            <code style={{ flex: 1, fontSize: 'var(--sb-t-meta)', fontFamily: 'monospace', color: 'var(--sb-ink-1)', wordBreak: 'break-all', lineHeight: 1.5 }}>{revealedToken}</code>
            <button onClick={copyToken} style={{
              flexShrink: 0, padding: '5px 11px', borderRadius: 'var(--sb-r-chip)',
              background: copied ? 'color-mix(in srgb, var(--sb-positive) 14%, transparent)' : 'var(--sb-card)',
              border: 'var(--sb-border-width) solid var(--sb-border)',
              fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: copied ? 'var(--sb-positive)' : 'var(--sb-ink-2)', cursor: 'pointer',
            }}>{copied ? 'Copied' : 'Copy'}</button>
            <button onClick={() => setRevealedToken(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: '4px', display: 'flex', alignItems: 'center' }}>
              <X size={ICON.sm} />
            </button>
          </div>
        )}

        {/* Token list */}
        {tokens.length === 0 && !creatingToken && (
          <EmptyState compact>No tokens yet.</EmptyState>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {tokens.map((tok, i) => (
            <div key={tok.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 13px', borderRadius: 'var(--sb-r-nav)',
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
              borderBottom: i === tokens.length - 1 ? undefined : undefined,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{tok.label}</p>
                <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
                  Created {new Date(tok.created_at).toLocaleDateString()}
                  {tok.last_used_at ? ` · Last used ${new Date(tok.last_used_at).toLocaleDateString()}` : ' · Never used'}
                </p>
              </div>
              <code style={{ fontSize: 'var(--sb-t-meta)', fontFamily: 'monospace', color: 'var(--sb-ink-3)', flexShrink: 0 }}>prof_sk_…</code>
              <button onClick={() => void handleRevoke(tok.id)} style={{
                flexShrink: 0, padding: '4px 10px', borderRadius: 'var(--sb-r-chip)',
                background: 'none', border: 'var(--sb-border-width) solid var(--sb-border)',
                fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-negative)', cursor: 'pointer',
              }}>Revoke</button>
            </div>
          ))}
        </div>
      </div>

      {/* ── TELEGRAM ─────────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>Telegram</p>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
            Talk to Professor from Telegram — ask about tasks, habits and finances, or add things on the go.
          </p>
        </div>

        {/* Connected chats */}
        {telegramLinks.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 14 }}>
            {telegramLinks.map(link => (
              <div key={link.chat_id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '9px 13px', borderRadius: 'var(--sb-r-nav)',
                background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
              }}>
                <MessageSquare size={ICON.lg} strokeWidth={STROKE.rest} aria-hidden />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
                    Chat #{link.chat_id}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
                    Connected {new Date(link.linked_at).toLocaleDateString()}
                  </p>
                </div>
                <span style={{
                  fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.08em',
                  padding: '2px 7px', borderRadius: 'var(--sb-r-chip)',
                  background: 'color-mix(in srgb, var(--sb-positive) 10%, transparent)',
                  // 4.06:1 as `--sb-positive` on its own tint, at 10px. The
                  // deep sibling exists for this and reads 5.5.
                  color: 'var(--sb-positive-deep)', textTransform: 'uppercase',
                }}>Active</span>
                <button onClick={() => void handleRevokeTelegram(link.chat_id)} style={{
                  flexShrink: 0, padding: '4px 10px', borderRadius: 'var(--sb-r-chip)',
                  background: 'none', border: 'var(--sb-border-width) solid var(--sb-border)',
                  fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-negative)', cursor: 'pointer',
                }}>Disconnect</button>
              </div>
            ))}
          </div>
        ) : null}

        {/* Setup instructions */}
        <div style={{
          padding: '13px 15px', borderRadius: 'var(--sb-r-nav)',
          background: 'var(--sb-accent-tint)', border: 'var(--sb-border-width) solid var(--sb-border)',
          borderStyle: 'dashed',
        }}>
          <p style={{ margin: '0 0 8px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
            {telegramLinks.length === 0 ? 'Connect your Telegram' : 'Connect another device'}
          </p>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[
              'Generate a token above (label it "Telegram")',
              'Open Telegram and search for your Professor bot',
              <>Send: <code style={{ fontSize: 'var(--sb-t-meta)', fontFamily: 'monospace', background: 'var(--sb-card)', padding: '1px 5px', borderRadius: 4 }}>/connect prof_sk_…</code></>,
              'That\'s it — just talk to it naturally after that',
            ].map((step, i) => (
              <li key={i} style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', lineHeight: 1.45 }}>{step}</li>
            ))}
          </ol>
          <p style={{ margin: '10px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
            The bot can read and add tasks, log habits, and check your balance. Full AI responses when an Anthropic key is set in Supabase.
          </p>
        </div>
      </div>

      {/* ── SIRI SHORTCUTS ───────────────────────────────────────────────────── */}
      <div style={{ marginTop: 24, paddingTop: 20, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>Siri Shortcuts</p>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
            Say "Hey Siri, {siriName}" and talk to your AI naturally — add tasks, log habits, check your calendar, and more. This is the hands-free way, and the only one that works with the app closed or the screen locked.
          </p>
        </div>

        {/* Token picker */}
        <div style={{ marginBottom: 14 }}>
          <p style={{ margin: '0 0 7px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            Pick a token to use (generate one above if you don't have one yet):
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {tokens.filter(t => !t.revoked).map(t => (
              <button
                key={t.id}
                onClick={() => setSiriToken(siriToken === t.token ? null : t.token)}
                style={{
                  padding: '5px 12px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)', fontWeight: 600,
                  cursor: 'pointer', border: 'var(--sb-border-width) solid',
                  borderColor: siriToken === t.token ? 'var(--sb-ink-1)' : 'var(--sb-border)',
                  background:  siriToken === t.token ? 'var(--sb-ink-1)' : 'var(--sb-card)',
                  color:       siriToken === t.token ? 'var(--sb-bg)'    : 'var(--sb-ink-2)',
                }}
              >{t.label || 'Unnamed'}</button>
            ))}
            {tokens.filter(t => !t.revoked).length === 0 && (
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>No tokens yet — generate one in the Connections block above.</span>
            )}
          </div>
        </div>

        {siriToken && siriBaseUrl && (() => {
          const shortcutUrl = `${siriBaseUrl}?token=${siriToken}&text={ShortcutInput}`
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* URL row */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{
                  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)',
                  background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
                  borderRadius: 'var(--sb-r-chip)', padding: '7px 9px',
                }}>{shortcutUrl}</code>
                <button
                  style={{
                    flexShrink: 0, padding: '6px 13px', borderRadius: 'var(--sb-r-chip)',
                    border: 'var(--sb-border-width) solid var(--sb-border)',
                    background: copiedSiri ? 'var(--sb-positive-tint)' : 'var(--sb-card)',
                    color: copiedSiri ? 'var(--sb-positive)' : 'var(--sb-ink-2)',
                    fontSize: 'var(--sb-t-meta)', fontWeight: 600, cursor: 'pointer',
                  }}
                  onClick={() => {
                    navigator.clipboard.writeText(shortcutUrl).then(() => {
                      setCopiedSiri(true)
                      setTimeout(() => setCopiedSiri(false), 2000)
                    })
                  }}
                >{copiedSiri ? 'Copied ✓' : 'Copy URL'}</button>
              </div>

              {/* Setup instructions */}
              <div style={{
                padding: '13px 15px', borderRadius: 'var(--sb-r-nav)',
                background: 'var(--sb-accent-tint)', border: 'var(--sb-border-width) solid var(--sb-border)', borderStyle: 'dashed',
              }}>
                <p style={{ margin: '0 0 8px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
                  Set up the "{siriName}" shortcut
                </p>
                <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[
                    <>On iPhone or iPad, open <b>Shortcuts</b> → <b>+</b> → name it <em>{siriName}</em> — Siri answers to the shortcut’s name</>,
                    <>Add action: <b>Ask for Input</b> — prompt "What do you want to ask {siriName}?"</>,
                    <>Add action: <b>Get Contents of URL</b> → paste the URL above (replace <code style={{ fontFamily: 'monospace', fontSize: 'var(--sb-t-meta)' }}>{'{ShortcutInput}'}</code> with the "Provided Input" variable)</>,
                    <>Add action: <b>Speak Text</b> — set input to the result from the previous step</>,
                    <>Then say <b>"Hey Siri, {siriName}"</b>. Its name is the phrase; no extra setting is needed</>,
                  ].map((step, i) => (
                    <li key={i} style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', lineHeight: 1.5 }}>{step}</li>
                  ))}
                </ol>
                <p style={{ margin: '10px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
                  You can also make specific shortcuts — e.g. one that always says "What's on today?" with no input step.
                  The URL is the whole credential; delete the token above to revoke access.
                </p>
              </div>
            </div>
          )
        })()}
      </div>

    </div>
  )
}
