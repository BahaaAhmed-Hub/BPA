import { useState } from 'react'
import { BellOff } from 'lucide-react'
import { loadNotifSettings, saveNotifSettings, loadQuietHours, saveQuietHours, dormantWhy, type NotifSetting, type NotifChannel } from '@/lib/notifications'
import { ICON, STROKE } from '@/lib/type'
import { Block, DRow, Toggle } from '../ui'

// ─── Notifications Matrix Section (11F) ───────────────────────────────────────

type NChannel = NotifChannel
type NEvent = NotifSetting

export function NotificationsMatrixSection() {
  const [events, setEvents] = useState<NEvent[]>(() => loadNotifSettings())
  // Quiet hours used to live in three pieces of component state — set them,
  // reload, and they were back at 22:30. The bell reads them, so they are kept.
  const [quiet, setQuiet] = useState(() => loadQuietHours())
  const quietOn = quiet.on, quietStart = quiet.start, quietEnd = quiet.end
  const setQuietOn = (on: boolean) => { const q = { ...quiet, on }; setQuiet(q); saveQuietHours(q) }
  const setQStart  = (start: string) => { const q = { ...quiet, start }; setQuiet(q); saveQuietHours(q) }
  const setQEnd    = (end: string) => { const q = { ...quiet, end }; setQuiet(q); saveQuietHours(q) }

  function toggleChannel(id: string, ch: NChannel) {
    const next = events.map(e => e.id === id ? { ...e, [ch]: !e[ch as keyof NEvent] } : e)
    setEvents(next)
    saveNotifSettings(next)
  }

  const ChHead = ({ label }: { label: string }) => (
    <div style={{ width: 44, textAlign: 'center', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.09em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>{label}</div>
  )
  const ChToggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <div style={{ width: 44, display: 'flex', justifyContent: 'center' }}>
      <Toggle checked={on} onChange={onClick} />
    </div>
  )

  const timeStyle = { padding: '5px 10px', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-field)', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)' } as const

  return (
    <div>
      <Block title="Events" sub="Which channel each kind of notification arrives on.">
        {/* Column headers */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px 24px', padding: '14px 0 10px', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
          <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', fontWeight: 700, color: 'var(--sb-ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>EVENT</p>
          <div style={{ display: 'flex', gap: 0 }}>
            <ChHead label="Push" />
            <ChHead label="Mail" />
            <ChHead label="Digest" />
          </div>
        </div>

        {/* Event rows */}
        {events.map(e => (
          <div key={e.id} className="sx-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px 24px', padding: '14px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', fontWeight: 500, color: 'var(--sb-ink-1)', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                {e.label}
                {/* Push is the channel this app delivers — a list under the bell.
                    Every kind is worked out; one whose source has not run yet
                    says what it is waiting on, which beats a bell that stays
                    empty for reasons nobody can see. */}
                {dormantWhy(e.id, events) && (
                  <span style={{
                    fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontWeight: 500,
                    padding: '1px 7px', borderRadius: 'var(--sb-r-pill)',
                    background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-hairline)',
                    whiteSpace: 'nowrap',
                  }}>{dormantWhy(e.id, events)}</span>
                )}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>{e.sub}</p>
            </div>
            <div style={{ display: 'flex', gap: 0, flexShrink: 0 }}>
              <ChToggle on={e.push}   onClick={() => toggleChannel(e.id, 'push')} />
              <ChToggle on={e.mail}   onClick={() => toggleChannel(e.id, 'mail')} />
              <ChToggle on={e.digest} onClick={() => toggleChannel(e.id, 'digest')} />
            </div>
          </div>
        ))}
      </Block>

      <Block title="Quiet hours" sub="Nothing but the morning brief gets through">
        <DRow label="Quiet hours" sub="Hold notifications between these times" last={!quietOn}>
          <Toggle checked={quietOn} onChange={setQuietOn} />
        </DRow>
        {quietOn && (
          <DRow label="Between" last>
            <input type="time" value={quietStart} onChange={e => setQStart(e.target.value)} style={timeStyle} />
            <span style={{ color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)' }}>to</span>
            <input type="time" value={quietEnd} onChange={e => setQEnd(e.target.value)} style={timeStyle} />
          </DRow>
        )}
      </Block>

      {/* Mute button */}
      <Block title="Pause" sub="Silence the bell for a while">
        <DRow label="Mute notifications" last>
          <button style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-3)', cursor: 'pointer' }}>
            <BellOff size={ICON.sm} strokeWidth={STROKE.rest} aria-hidden /> Mute for 1h
          </button>
        </DRow>
      </Block>
    </div>
  )
}
