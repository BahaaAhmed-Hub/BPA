import { useState, useEffect, useRef } from 'react'
import { Button, Segmented } from '@/components/ui'
import { Plus, Trash2, X, Pencil, ImagePlus } from 'lucide-react'
import { stepFor, setHabitStep, loadHabitSteps } from '@/lib/habitSteps'
import { loadHealthLinks, createHealthLink, deleteHealthLink, ingestUrl, checkHealthLink, isMovementHabit, suggestMetric, METRIC_LABEL, METRIC_SAMPLE, type HealthLink, type HealthMetric, type LinkCheck } from '@/lib/healthLink'
import { useHabitsStore, getHabitColors } from '@/store/habitsStore'
import { HABIT_VIEWS, loadHabitView, saveHabitView, EmojiBtn, type HabitView } from '@/modules/habits/HabitsModule'
import { ICON, STROKE } from '@/lib/type'
import { DEFAULT_HABIT_EMOJI } from '@/lib/glyphs'
import { Toggle } from '../ui'

const FREQ_OPTS    = ['daily','weekdays','weekly'] as const

/** Reads a picked file into a data URL, downscaled so localStorage can hold it. */
function readHabitImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('unreadable'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('not an image'))
      img.onload = () => {
        const MAX = 640
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(String(reader.result)); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/** The picture in a habit row: click it to swap the file, no form needed. */
function HabitRowImage({ image, emoji, onChange }: {
  image?: string
  emoji: string
  onChange: (v: string | undefined) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        onContextMenu={e => { if (image) { e.preventDefault(); onChange(undefined) } }}
        title={image ? 'Click to change the picture · right-click to remove it' : 'Click to add a picture'}
        style={{
          width: 30, height: 30, borderRadius: 'var(--sb-r-chip)', flexShrink: 0, padding: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', cursor: 'pointer', fontSize: 'var(--sb-t-h3)',
        }}>
        {image
          ? <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : emoji}
      </button>
      <input
        ref={ref} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={async e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          try { onChange(await readHabitImage(file)) } catch { /* not a usable image */ }
        }} />
    </>
  )
}

interface SettingsHabitFormState {
  image?: string
  /** Set while editing an existing habit, so its step can be read and written. */
  id?: string
  name: string; emoji: string; color: string; freq: typeof FREQ_OPTS[number]
  type: 'boolean' | 'quantity'; goal: string; unit: string
  /** What one press adds. Blank means the sensible guess for the unit. */
  step: string
}

function SettingsHabitForm({
  initial, onSave, onCancel, saveLabel = 'Add Habit',
}: {
  initial: SettingsHabitFormState
  onSave: (s: SettingsHabitFormState) => void
  onCancel: () => void
  saveLabel?: string
}) {
  const [s, setS] = useState<SettingsHabitFormState>(initial)
  const update = (patch: Partial<SettingsHabitFormState>) => setS(prev => ({ ...prev, ...patch }))
  const imageRef = useRef<HTMLInputElement>(null)
  const valid = s.name.trim() !== '' && (s.type === 'boolean' || (parseFloat(s.goal) > 0 && s.unit.trim() !== ''))

  const LABEL: React.CSSProperties = {
    display: 'block', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em',
    color: 'var(--sb-ink-3)', textTransform: 'uppercase', marginBottom: 7,
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 18, marginTop: 12,
      padding: 18, background: 'var(--sb-field)', borderRadius: 'var(--sb-r-nav)', border: 'var(--sb-border-width) solid var(--sb-border)',
    }}>

      {/* Picture, icon, name — the three things that identify a habit */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              type="button"
              onClick={() => imageRef.current?.click()}
              title={s.image ? 'Change picture' : 'Add a picture'}
              style={{
                width: 46, height: 46, borderRadius: 'var(--sb-r-nav)', padding: 0, cursor: 'pointer', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 'var(--sb-t-h2)', color: 'var(--sb-ink-3)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
              }}>
              {s.image
                ? <img src={s.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <ImagePlus size={ICON.lg} />}
            </button>
            {s.image && (
              <button
                type="button"
                onClick={() => update({ image: undefined })}
                title="Remove picture"
                style={{
                  position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 'var(--sb-r-pill)',
                  padding: 0, cursor: 'pointer', background: 'var(--sb-ink-1)', border: 'var(--sb-border-emphasis) solid var(--sb-field)',
                  color: 'var(--sb-ink-on-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <X size={ICON.sm} strokeWidth={STROKE.active} />
              </button>
            )}
          </span>
          <input
            ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={async e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try { update({ image: await readHabitImage(file) }) } catch { /* not a usable image */ }
            }} />
          {!s.image && <span style={{ color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-meta)' }}>Picture</span>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <EmojiBtn value={s.emoji || DEFAULT_HABIT_EMOJI} onSelect={v => update({ emoji: v })} size={46} />
          <span style={{ color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-meta)' }}>Icon</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={s.name}
            onChange={e => update({ name: e.target.value })}
            autoFocus
            placeholder="e.g. Drink water, Walk 5 miles…"
            onKeyDown={e => { if (e.key === 'Enter' && valid) onSave(s); if (e.key === 'Escape') onCancel() }}
            style={{
              width: '100%', boxSizing: 'border-box', height: 42, padding: '0 14px',
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
              fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontFamily: 'inherit', outline: 'none', textAlign: 'left',
            }} />
        </div>
      </div>

      {/* How it is tracked, and how often — one line, they belong together */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <span style={LABEL}>Type</span>
          <Segmented
            value={s.type}
            options={[
              { value: 'boolean' as const, label: 'Done / not done' },
              { value: 'quantity' as const, label: 'Measurable' },
            ]}
            onChange={t => update({ type: t })}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={LABEL}>Interval</span>
          <Segmented
            value={s.freq}
            options={FREQ_OPTS.map(f => ({
              value: f,
              label: f === 'weekdays' ? 'Weekdays' : f.charAt(0).toUpperCase() + f.slice(1),
            }))}
            onChange={f => update({ freq: f })}
          />
        </div>
      </div>

      {/* What counts as a day's worth — a measurable habit only */}
      {s.type === 'quantity' && (
        <div>
          <span style={LABEL}>Daily target</span>
          <div style={{ display: 'flex', gap: 7 }}>
            <input type="number" min={1} value={s.goal} onChange={e => update({ goal: e.target.value })}
              placeholder="8"
              style={{
                width: 90, boxSizing: 'border-box', height: 'var(--sb-h-nav)', padding: '0 12px',
                background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-sm)',
                fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontFamily: 'inherit', outline: 'none', textAlign: 'left',
              }} />
            <input value={s.unit} onChange={e => update({ unit: e.target.value })}
              placeholder="glasses / ml / minutes…"
              style={{
                flex: 1, minWidth: 0, boxSizing: 'border-box', height: 'var(--sb-h-nav)', padding: '0 12px',
                background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-sm)',
                fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontFamily: 'inherit', outline: 'none', textAlign: 'left',
              }} />
          </div>

          {/* What one tap is worth. 200 ml counted one millilitre at a time is
              two hundred taps — nobody sets a habit up meaning that. */}
          <div style={{ marginTop: 10 }}>
            <span style={LABEL}>Each tap adds</span>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <input type="number" min={1} value={s.step}
                onChange={e => update({ step: e.target.value })}
                placeholder={String(stepFor({ id: s.id ?? '', goal: Number(s.goal) || 0, unit: s.unit }))}
                style={{
                  width: 90, boxSizing: 'border-box', height: 'var(--sb-h-nav)', padding: '0 12px',
                  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-sm)',
                  fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontFamily: 'inherit', outline: 'none', textAlign: 'left',
                }} />
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
                {s.unit || 'units'} per press
                {!s.step && ` · ${stepFor({ id: s.id ?? '', goal: Number(s.goal) || 0, unit: s.unit })} unless you say otherwise`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
        <button onClick={() => valid && onSave(s)} disabled={!valid}
          style={{
            height: 38, padding: '0 18px', borderRadius: 'var(--sb-r-pill)', border: 'none',
            background: valid ? 'var(--sb-accent)' : 'var(--sb-field)', color: valid ? 'var(--sb-accent-ink)' : 'var(--sb-ink-4)', // ui-guard: ink-ok
            fontSize: 'var(--sb-t-label)', fontWeight: 600, fontFamily: 'inherit',
            cursor: valid ? 'pointer' : 'default',
            display: 'flex', gap: 6, alignItems: 'center',
          }}>
          <Plus size={ICON.sm} /> {saveLabel}
        </button>
        <button onClick={onCancel}
          style={{
            height: 38, padding: '0 16px', borderRadius: 'var(--sb-r-pill)',
            background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)',
            fontSize: 'var(--sb-t-body)', fontFamily: 'inherit', cursor: 'pointer',
            display: 'flex', gap: 6, alignItems: 'center',
          }}>
          <X size={ICON.sm} /> Cancel
        </button>
      </div>
    </div>
  )
}

/** What a habit is, in one line: how it is tracked, how much, how often. */
function describeHabit(h: { type?: string; goal?: number; unit?: string; frequency: string }): string {
  const how = h.frequency === 'weekdays' ? 'on weekdays' : h.frequency === 'weekly' ? 'weekly' : 'daily'
  if (h.type !== 'quantity') return `Done or not · ${how}`
  if (h.goal && h.goal > 0) return `${h.goal} ${h.unit ?? 'times'} · ${how}`
  return `Counts ${h.unit ?? 'times'} · ${how}`
}

// ─── Settings → Habits → Apple Health ────────────────────────────────────────
//
// A web page cannot read Apple Health. HealthKit is native to iOS: no web API,
// no OAuth, nothing a browser can call — so this is not a connect button and
// pretending otherwise would waste your afternoon.
//
// What does work is the phone pushing. A Shortcut reads the sample and POSTs
// the number to a URL; an Automation runs it every morning without being
// opened. Each link is one habit, one metric, one secret URL — so the setup is
// a copy, a paste, and four taps in Shortcuts.

function AppleHealthBlock({ habits }: { habits: { id: string; name: string; unit?: string; type?: string }[] }) {
  const [links, setLinks]   = useState<HealthLink[] | null>(null)
  const [ready, setReady]   = useState(false)
  const [busy, setBusy]     = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [err, setErr]       = useState<string | null>(null)
  const [open, setOpen]     = useState<string | null>(null)
  const [check, setCheck]   = useState<Record<string, LinkCheck | 'checking'>>({})

  useEffect(() => { void loadHealthLinks().then(l => { setLinks(l); setReady(true) }) }, [])

  // Only where it means something. A habit called "Read 20 pages" has nothing
  // in Health to take.
  const movement = habits.filter(h => isMovementHabit(h.name, h.unit))

  async function add(habitId: string, metric: HealthMetric) {
    setBusy(habitId); setErr(null)
    try {
      const link = await createHealthLink(habitId, metric)
      setLinks(prev => [...(prev ?? []), link])
      setOpen(link.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not make the link.')
    } finally { setBusy(null) }
  }

  async function drop(id: string) {
    setBusy(id); setErr(null)
    try {
      await deleteHealthLink(id)
      setLinks(prev => (prev ?? []).filter(l => l.id !== id))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove it.')
    } finally { setBusy(null) }
  }

  function copy(text: string, id: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(id)
      window.setTimeout(() => setCopied(null), 1800)
    })
  }

  const pill = {
    height: 28, padding: '0 11px', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
    background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)',
  } as const

  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
      <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 10 }}>
        APPLE HEALTH
      </span>
      <p style={{ margin: '0 0 14px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.6, maxWidth: 660 }}>
        Apple gives a web app no way to read Health — HealthKit is native to the phone, with no web
        API to ask. What it does give is Shortcuts: your iPhone reads the number and sends it here
        each morning. Link a habit below and you get a private address to paste into a Shortcut;
        after that it fills itself in.
      </p>

      {movement.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.6 }}>
          Nothing to link yet. Add a habit about walking, running, steps or distance and it appears
          here.
        </p>
      ) : !ready ? (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Looking…</p>
      ) : links === null ? (
        <div style={{
          fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-accent-deep)', lineHeight: 1.55, maxWidth: 720,
          background: 'var(--sb-accent-tint)', border: 'var(--sb-border-width) solid var(--sb-accent-border)', borderRadius: 'var(--sb-r-nav)', padding: '11px 14px',
        }}>
          Your database has nowhere to keep these yet — run{' '}
          <code style={{ fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)' }}>supabase/migrations/20260012</code>{' '}
          and deploy the <code style={{ fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)' }}>health-ingest</code> function,
          then reload.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 720 }}>
          {movement.map(h => {
            const link = links.find(l => l.habitId === h.id)
            const metric = link?.metric ?? suggestMetric(h.name, h.unit)
            return (
              <div key={h.id} style={{ border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-card)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px' }}>
                  <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', flex: 1, minWidth: 0 }}>
                    {h.name}
                    <span style={{ fontWeight: 400, color: 'var(--sb-ink-3)' }}> · {METRIC_LABEL[metric]}</span>
                  </span>
                  {link ? (
                    <>
                      <span style={{ fontSize: 'var(--sb-t-meta)', color: link.lastSeenAt ? 'var(--sb-positive)' : 'var(--sb-ink-3)' }}>
                        {link.lastSeenAt
                          ? `last sent ${new Date(link.lastSeenAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                          : 'nothing sent yet'}
                      </span>
                      <button style={pill} onClick={() => setOpen(open === link.id ? null : link.id)}>
                        {open === link.id ? 'Hide' : 'How to set it up'}
                      </button>
                      <button style={{ ...pill, color: 'var(--sb-negative)' }} disabled={busy === link.id}
                        onClick={() => void drop(link.id)}>Unlink</button>
                    </>
                  ) : (
                    <Button variant="primary" disabled={busy === h.id} onClick={() => void add(h.id, suggestMetric(h.name, h.unit))} style={{ ...pill }}>
                      {busy === h.id ? 'Linking…' : 'Link to Health'}
                    </Button>
                  )}
                </div>

                {link && open === link.id && (
                  <div style={{ borderTop: 'var(--sb-border-width) solid var(--sb-hairline)', padding: '12px 13px', background: 'var(--sb-header)' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                      <code style={{
                        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)',
                        background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '7px 9px',
                      }}>{ingestUrl(link.token) || 'This build has no Supabase address configured.'}</code>
                      <button style={pill} onClick={() => copy(ingestUrl(link.token), link.id)}>
                        {copied === link.id ? 'Copied' : 'Copy'}
                      </button>
                      {/* Three things have to be true before a step count can
                          arrive, and "nothing yet" tells you none of them. */}
                      <button style={pill}
                        onClick={async () => {
                          setCheck(c => ({ ...c, [link.id]: 'checking' }))
                          setCheck(c => ({ ...c, [link.id]: { ok: false, detail: '' } }))
                          const result = await checkHealthLink(link.token)
                          setCheck(c => ({ ...c, [link.id]: result }))
                        }}>
                        Check it
                      </button>
                    </div>
                    {check[link.id] && check[link.id] !== 'checking' && (check[link.id] as LinkCheck).detail && (
                      <p style={{
                        margin: '0 0 10px', fontSize: 'var(--sb-t-body-s)',
                        color: (check[link.id] as LinkCheck).ok ? 'var(--sb-positive)' : 'var(--sb-negative)', lineHeight: 1.5,
                      }}>
                        {(check[link.id] as LinkCheck).detail}
                      </p>
                    )}
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.75 }}>
                      <li>On the iPhone, open <b>Shortcuts</b> → <b>Automation</b> → <b>+</b> → <b>Time of Day</b>,
                        pick a time (10pm catches the whole day) and <b>Run Immediately</b>.</li>
                      <li>Add <b>Find Health Samples</b> — type <b>{METRIC_SAMPLE[link.metric]}</b>, sorted by
                        Start Date, and <b>Calculate Statistics</b> → <b>Sum</b> over <b>Today</b>.</li>
                      <li>Add <b>Get Contents of URL</b>, paste the address above, set <b>Method</b> to
                        <b> POST</b>, <b>Request Body</b> to <b>JSON</b>, and one field named{' '}
                        <code style={{ fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)' }}>value</code>{' '}
                        holding the number from step 2.</li>
                      <li>Run it once by hand. The line above turns green when the first number lands.</li>
                    </ol>
                    <p style={{ margin: '10px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.6 }}>
                      The address is the whole credential and it feeds this one habit — it can read nothing
                      and write nowhere else. Unlink to make it stop working.
                    </p>
                  </div>
                )}
              </div>
            )
          })}
          {err && <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{err}</p>}
        </div>
      )}
    </div>
  )
}

export function HabitsSection() {
  const COLORS = getHabitColors()
  const { habits, addHabit: storeAdd, updateHabit, deleteHabit: storeDel } = useHabitsStore()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [habitView, setHabitView] = useState<HabitView>(() => loadHabitView())

  function chooseView(v: HabitView) {
    setHabitView(v)
    saveHabitView(v)
    // The Habits page may already be mounted — let it re-read rather than wait
    window.dispatchEvent(new Event('professor:habitViewUpdated'))
  }

  function toggle(id: string) {
    const h = habits.find(x => x.id === id)
    if (h) updateHabit(id, { isActive: !h.isActive })
  }

  const editingHabit = editingId ? habits.find(h => h.id === editingId) : null

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
        Changes here instantly sync with the Habits Tracker page.
      </p>

      {/* Which view the Habits page opens on — switching it there sticks too */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingBottom: 14, marginBottom: 4, borderBottom: 'var(--sb-border-width) solid var(--sb-border)' }}>
        <div style={{ flex: '1 1 150px', minWidth: 0, maxWidth: 200 }}>
          <div style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>Default view</div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginTop: 2 }}>
            {HABIT_VIEWS.find(v => v.id === habitView)?.hint}
          </div>
        </div>
        <div style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'flex-end' }}>
          <Segmented
            value={habitView}
            options={HABIT_VIEWS.map(v => ({ value: v.id, label: v.label }))}
            onChange={chooseView}
          />
        </div>
      </div>

      {habits.map(h => (
        <div key={h.id}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-border)',
            opacity: h.isActive ? 1 : 0.5,
          }}>
            <HabitRowImage
              image={h.image}
              emoji={h.emoji}
              onChange={img => updateHabit(h.id, { image: img })}
            />
            <div style={{ width: 10, height: 10, borderRadius: 'var(--sb-r-pill)', background: h.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>{h.name}</span>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {describeHabit(h)}
            </span>
            <Toggle checked={h.isActive} onChange={() => toggle(h.id)} />
            <button onClick={() => setEditingId(editingId === h.id ? null : h.id)} title="Edit habit"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: editingId === h.id ? 'var(--sb-accent)' : 'var(--sb-ink-3)', padding: 4 }}>
              <Pencil size={ICON.sm} />
            </button>
            <button onClick={() => { if (editingId === h.id) setEditingId(null); storeDel(h.id) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 4 }}>
              <Trash2 size={ICON.sm} />
            </button>
          </div>

          {/* Inline edit form */}
          {editingId === h.id && editingHabit && (
            <SettingsHabitForm
              key={h.id + '-edit'}
              initial={{
                id: h.id,
                name: h.name, emoji: h.emoji, color: h.color, image: h.image,
                freq: h.frequency as typeof FREQ_OPTS[number],
                type: h.type ?? 'boolean',
                goal: h.goal != null ? String(h.goal) : '',
                unit: h.unit ?? '',
                step: loadHabitSteps()[h.id] != null ? String(loadHabitSteps()[h.id]) : '',
              }}
              saveLabel="Save Changes"
              onSave={s => {
                updateHabit(h.id, {
                  name: s.name.trim(), emoji: s.emoji, color: s.color, image: s.image,
                  frequency: s.freq,
                  type: s.type,
                  goal: s.type === 'quantity' ? parseFloat(s.goal) : undefined,
                  unit: s.type === 'quantity' ? s.unit.trim() : undefined,
                })
                setHabitStep(h.id, s.type === 'quantity' && parseFloat(s.step) > 0 ? parseFloat(s.step) : null)
                setEditingId(null)
              }}
              onCancel={() => setEditingId(null)}
            />
          )}
        </div>
      ))}

      {adding ? (
        <SettingsHabitForm
          initial={{ name: '', emoji: DEFAULT_HABIT_EMOJI, color: COLORS[habits.length % COLORS.length], freq: 'daily', type: 'boolean', goal: '', unit: '', step: '' }}
          onSave={s => {
            const made = storeAdd({
              name: s.name.trim(), emoji: s.emoji, color: s.color, image: s.image,
              frequency: s.freq, isActive: true,
              type: s.type,
              goal: s.type === 'quantity' ? parseFloat(s.goal) : undefined,
              unit: s.type === 'quantity' ? s.unit.trim() : undefined,
            })
            // addHabit hands back the new id, which is what the step is filed under.
            if (made && s.type === 'quantity' && parseFloat(s.step) > 0) setHabitStep(made, parseFloat(s.step))
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button onClick={() => { setEditingId(null); setAdding(true) }} style={{
          marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, width: '100%',
          padding: '11px 16px', borderRadius: 'var(--sb-r-sm)', background: 'transparent',
          border: '1px dashed var(--sb-border)',
          color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body)', cursor: 'pointer',
        }}>
          <Plus size={ICON.sm} /> Add a habit
        </button>
      )}

      {/* Steps and distance can come from the phone rather than from you. */}
      <AppleHealthBlock habits={habits} />
    </div>
  )
}
