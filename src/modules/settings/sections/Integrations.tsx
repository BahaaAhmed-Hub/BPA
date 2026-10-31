import { useState, useEffect } from 'react'
import { EmptyState } from '@/components/ui'
import { Plus, X } from 'lucide-react'
import { usePersona } from '@/lib/assistantPersona'
import { ICON } from '@/lib/type'
import { listUserTokens, createUserToken, revokeUserToken, type UserToken } from '@/lib/userTokens'
import { getTelegramLinks, revokeTelegramLink, type TelegramLink } from '@/lib/telegramLink'
import { IntegrationHub, type HubNode } from './IntegrationHub'
import { MARKS } from '@/lib/integrationMarks'
import { Block, DRow } from '../ui'

// ─── Integrations Section (11D) ───────────────────────────────────────────────

/** Connected / not connected — a status, not a control. */
function StatusPill({ on, label }: { on: boolean; label?: string }) {
  return (
    <span style={{
      fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '2px 8px', borderRadius: 'var(--sb-r-chip)',
      // 4.06:1 as `--sb-positive` on its own tint, at 10px. The deep sibling
      // exists for this and reads 5.5.
      background: on ? 'color-mix(in srgb, var(--sb-positive) 10%, transparent)' : 'var(--sb-field)',
      color: on ? 'var(--sb-positive-deep)' : 'var(--sb-ink-3)',
      border: on ? 'none' : 'var(--sb-border-width) solid var(--sb-border)',
    }}>{label ?? (on ? 'Connected' : 'Not connected')}</span>
  )
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 'var(--sb-r-chip)',
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', cursor: 'pointer', flexShrink: 0,
}
const dangerBtn: React.CSSProperties = {
  ...btn, padding: '5px 12px', color: 'var(--sb-negative-deep)',
  borderColor: 'color-mix(in srgb, var(--sb-negative) 35%, transparent)',
}
const iconBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 4, display: 'flex', alignItems: 'center' }

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

  const liveTokens = tokens.filter(t => !t.revoked)

  return (
    <div>
      <IntegrationHub nodes={hubNodes} />

      {/* ── CONNECTIONS — what is linked right now ────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <Block title="Connections" sub="Where the assistant can reach you, and what it reaches you with.">
          <DRow label="Telegram" sub={telegramLinks.length > 0 ? `${telegramLinks.length} linked chat${telegramLinks.length === 1 ? '' : 's'}` : 'Set it up below'}>
            <StatusPill on={telegramLinks.length > 0} />
          </DRow>
          <DRow label="Siri Shortcuts" sub={tokens.length > 0 ? 'A token is ready to put in a Shortcut' : 'Needs a token'}>
            <StatusPill on={tokens.length > 0} />
          </DRow>
          <DRow label="MCP server" sub={tokens.length > 0 ? 'A token is ready for your MCP client' : 'Needs a token'} last>
            <StatusPill on={tokens.length > 0} />
          </DRow>
        </Block>

        {/* ── TOKENS — personal access tokens ─────────────────────────────── */}
        <Block title="Access tokens" sub="Tokens let the MCP server, Siri Shortcuts, and Telegram act as you. Each is shown once — copy it before closing.">
          <DRow label="New token" sub="Label it for what will use it" last={!creatingToken && !revealedToken && tokens.length > 0}>
            <button onClick={() => { setCreatingToken(true); setRevealedToken(null) }} style={btn}>
              <Plus size={ICON.sm} /> New token
            </button>
          </DRow>

          {/* Create form */}
          {creatingToken && (
            <DRow label="Label" sub="Shown only to you, e.g. Siri Shortcuts">
              <input
                autoFocus
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleCreateToken(); if (e.key === 'Escape') setCreatingToken(false) }}
                placeholder="Label, e.g. Siri Shortcuts"
                style={{ flex: 1, minWidth: 160, fontSize: 'var(--sb-t-body-s)', padding: '7px 11px', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-field)', color: 'var(--sb-ink-1)', outline: 'none' }}
              />
              <button onClick={() => void handleCreateToken()} disabled={!newLabel.trim()} style={{
                padding: '7px 14px', borderRadius: 'var(--sb-r-chip)', border: 'none',
                background: newLabel.trim() ? 'var(--sb-ink-1)' : 'var(--sb-border)', color: newLabel.trim() ? 'var(--sb-page)' : 'var(--sb-ink-4)', // ui-guard: ink-ok
                fontSize: 'var(--sb-t-body-s)', fontWeight: 600, cursor: newLabel.trim() ? 'pointer' : 'not-allowed',
              }}>Generate</button>
              <button onClick={() => setCreatingToken(false)} aria-label="Cancel" style={iconBtn}>
                <X size={ICON.sm} />
              </button>
            </DRow>
          )}

          {/* Revealed token (shown once) */}
          {revealedToken && (
            <DRow label="Your new token" sub="Shown once — copy it now">
              <code style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-meta)', fontFamily: 'monospace', color: 'var(--sb-ink-1)', wordBreak: 'break-all', lineHeight: 1.5 }}>{revealedToken}</code>
              <button onClick={copyToken} style={{
                ...btn, padding: '5px 11px', fontSize: 'var(--sb-t-meta)',
                background: copied ? 'color-mix(in srgb, var(--sb-positive) 14%, transparent)' : 'var(--sb-card)',
                color: copied ? 'var(--sb-positive-deep)' : 'var(--sb-ink-1)',
              }}>{copied ? 'Copied' : 'Copy'}</button>
              <button onClick={() => setRevealedToken(null)} aria-label="Dismiss" style={iconBtn}>
                <X size={ICON.sm} />
              </button>
            </DRow>
          )}

          {tokens.length === 0 && !creatingToken && (
            <div style={{ padding: '4px 0 8px' }}><EmptyState compact>No tokens yet.</EmptyState></div>
          )}
        </Block>

        {/* ── TELEGRAM ─────────────────────────────────────────────────────── */}
        <Block title="Telegram" sub="Talk to Professor from Telegram — ask about tasks, habits and finances, or add things on the go.">
          <DRow label={telegramLinks.length === 0 ? 'Connect your Telegram' : 'Connect another device'} last>
            <StatusPill on={telegramLinks.length > 0} />
          </DRow>
          <div style={{ padding: '0 0 14px' }}>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {[
                'Generate a token above (label it "Telegram")',
                'Open Telegram and search for your Professor bot',
                <>Send: <code style={{ fontSize: 'var(--sb-t-meta)', fontFamily: 'monospace', background: 'var(--sb-field)', padding: '1px 5px', borderRadius: 4 }}>/connect prof_sk_…</code></>,
                'That\'s it — just talk to it naturally after that',
              ].map((step, i) => (
                <li key={i} style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>{step}</li>
              ))}
            </ol>
            <p style={{ margin: '10px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
              The bot can read and add tasks, log habits, and check your balance. Full AI responses when an Anthropic key is set in Supabase.
            </p>
          </div>
        </Block>

        {/* ── SIRI SHORTCUTS ───────────────────────────────────────────────── */}
        <Block title="Siri Shortcuts" sub={`Say "Hey Siri, ${siriName}" and talk to your AI naturally — add tasks, log habits, check your calendar, and more. This is the hands-free way, and the only one that works with the app closed or the screen locked.`}>
          <DRow label="Token" sub="Pick a token to use (generate one above if you don't have one yet)" last={!(siriToken && siriBaseUrl)}>
            {liveTokens.map(t => (
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
            {liveTokens.length === 0 && (
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>No tokens yet — generate one in the Access tokens block above.</span>
            )}
          </DRow>

          {siriToken && siriBaseUrl && (() => {
            const shortcutUrl = `${siriBaseUrl}?token=${siriToken}&text={ShortcutInput}`
            return (
              <>
                <DRow label="Shortcut URL" sub="The URL is the whole credential">
                  <code style={{
                    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)',
                    background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
                    borderRadius: 'var(--sb-r-chip)', padding: '7px 9px',
                  }}>{shortcutUrl}</code>
                  <button
                    style={{
                      ...btn, padding: '6px 13px', fontSize: 'var(--sb-t-meta)',
                      background: copiedSiri ? 'var(--sb-positive-tint)' : 'var(--sb-card)',
                      color: copiedSiri ? 'var(--sb-positive-deep)' : 'var(--sb-ink-1)',
                    }}
                    onClick={() => {
                      navigator.clipboard.writeText(shortcutUrl).then(() => {
                        setCopiedSiri(true)
                        setTimeout(() => setCopiedSiri(false), 2000)
                      })
                    }}
                  >{copiedSiri ? 'Copied ✓' : 'Copy URL'}</button>
                </DRow>

                {/* Setup instructions */}
                <div style={{ padding: '14px 0' }}>
                  <p style={{ margin: '0 0 8px', fontSize: 'var(--sb-t-body)', fontWeight: 500, color: 'var(--sb-ink-1)' }}>
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
                      <li key={i} style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>{step}</li>
                    ))}
                  </ol>
                  <p style={{ margin: '10px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
                    You can also make specific shortcuts — e.g. one that always says "What's on today?" with no input step.
                    The URL is the whole credential; delete the token above to revoke access.
                  </p>
                </div>
              </>
            )
          })()}
        </Block>

        {/* ── DANGER — revoke a token, disconnect a chat ───────────────────── */}
        {(tokens.length > 0 || telegramLinks.length > 0) && (
          <section style={{ marginBottom: 28 }}>
            <div style={{ margin: '0 0 10px 2px' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-negative-deep)' }}>Revoke access</h3>
              <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
                Revoking a token or disconnecting a chat cuts that tool off at once.
              </p>
            </div>
            <div style={{
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 30%, transparent)',
              borderRadius: 'var(--sb-r-card)', padding: '8px 20px', boxShadow: 'var(--sb-shadow-control)', minWidth: 0,
            }}>
              {tokens.map((tok, i) => (
                <DRow key={tok.id} last={i === tokens.length - 1 && telegramLinks.length === 0}
                  label={tok.label}
                  sub={`Created ${new Date(tok.created_at).toLocaleDateString()}${tok.last_used_at ? ` · Last used ${new Date(tok.last_used_at).toLocaleDateString()}` : ' · Never used'}`}>
                  <code style={{ fontSize: 'var(--sb-t-meta)', fontFamily: 'monospace', color: 'var(--sb-ink-3)', flexShrink: 0 }}>prof_sk_…</code>
                  <button onClick={() => void handleRevoke(tok.id)} style={dangerBtn}>Revoke</button>
                </DRow>
              ))}
              {telegramLinks.map((link, i) => (
                <DRow key={link.chat_id} last={i === telegramLinks.length - 1}
                  label={`Telegram chat #${link.chat_id}`}
                  sub={`Connected ${new Date(link.linked_at).toLocaleDateString()}`}>
                  <StatusPill on label="Active" />
                  <button onClick={() => void handleRevokeTelegram(link.chat_id)} style={dangerBtn}>Disconnect</button>
                </DRow>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
