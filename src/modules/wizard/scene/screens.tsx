import type { ReactNode } from 'react'
import { HABIT_TEMPLATES } from '@/lib/habitTemplates'
import { DEFAULT_AUTOMATION_RULES } from '@/lib/automation'
import { moduleIsOff } from '@/lib/entitlements'
import { clock, type WizardState } from '../state'
import type { StepId } from '../steps'
import { LaptopScreen } from './LaptopScreen'

/**
 * What the laptop shows for each step: the part of the app that step changes,
 * drawn from the person's own answers and with sample content standing in for
 * what they do not have yet. Nothing here is their data, and the screen says
 * "sample" nowhere because it is a picture on a desk, not a screen of theirs.
 */

const DOTS = ['var(--sb-info)', 'var(--sb-negative)', 'var(--sb-positive)', 'var(--sb-warning)']
const claude = (p: WizardState['ai']['provider']) => (p === 'groq' ? 'Groq' : 'Claude')

function Today({ w, done }: { w: WizardState; done: boolean }) {
  const name = w.name.trim().split(/\s+/)[0] || ''
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <LaptopScreen module="Today" rail={0}>
      <div className="hd">
        <div className="hello"><small>{date}</small><strong>Good morning{name ? `, ${name}` : ''}</strong></div>
        {done ? <span className="pill" data-tone="good" style={{ marginLeft: 'auto' }}>ALL SET</span> : <span className="avatar">{(name[0] ?? '?').toUpperCase()}</span>}
      </div>
      <div className="cols">
        <div className="col" style={{ flex: 1.3 }}>
          <div className="cap">Today · 4 items</div>
          <div className="card task"><span className="tick" />Review Q3 deck<span className="aside">P0</span></div>
          <div className="card task"><span className="tick" data-done="" /><span style={{ textDecoration: 'line-through', opacity: .55 }}>Plan the week</span></div>
          <div className="card task"><span className="dot" style={{ background: 'var(--sb-accent)' }} />Team sync<span className="aside">14:00</span></div>
          <div className="card task"><span className="dot" style={{ background: 'var(--sb-info)' }} />Reply to Dana</div>
        </div>
        <div className="col" style={{ flex: 1 }}>
          <div className="card stat"><div className="cap">Streak</div><div className="num">6<small> days</small></div></div>
          <div className="card stat" data-accent=""><div className="cap">Focus</div><div className="num">2h 10</div></div>
        </div>
      </div>
    </LaptopScreen>
  )
}

function Mail({ w }: { w: WizardState }) {
  const accts = w.accounts.length ? w.accounts : [{ email: 'you@example.com', primary: true }]
  const co = w.companies[0]
  const rows = [
    ['Dana Reyes', 'Re: Contract draft', '08:12'], ['Rosa Lin', 'Q3 numbers attached', '08:05'],
    ['Finance team', 'Invoice 0412 due Friday', '07:58'], ['Maya', 'Dinner on Saturday?', '07:40'],
    ['Calendar', 'Invitation: Team sync, 14:00', '07:15'],
  ]
  return (
    <LaptopScreen module="Mail" rail={1}>
      <div className="hd">
        <h4>Inbox</h4><span className="sub">{rows.length} unread</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
          {accts.slice(0, 4).map((a, i) => (
            <span key={a.email} className="pill"><i className="dot" style={{ background: DOTS[i % 4], width: 7, height: 7 }} />{a.email.split('@')[0].slice(0, 9)}</span>
          ))}
        </span>
      </div>
      <div className="list">
        {rows.map(([who, what, when], i) => {
          const tagged = !!co && i % 2 === 0
          return (
            <div key={who} className="card li" style={{ borderLeft: `3px solid ${tagged ? co.color : 'transparent'}` }}>
              <i className="dot" style={{ background: DOTS[i % Math.min(4, accts.length)] }} />
              <div className="mid"><div className="who">{who}</div><div className="what">{what}</div></div>
              {tagged && <span className="pill" style={{ background: `color-mix(in srgb, ${co.color} 16%, transparent)`, color: 'var(--sb-ink-1)', border: 'none' }}>{co.name.trim().split(' ')[0].slice(0, 9)}</span>}
              <span className="when">{when}</span>
            </div>
          )
        })}
      </div>
    </LaptopScreen>
  )
}

function Assistant({ w }: { w: WizardState }) {
  const awake = w.ai.check === 'ok'
  const model = w.ai.provider === 'groq' ? w.ai.groqModel : w.ai.anthropicModel
  return (
    <LaptopScreen module="Assistant" rail={4}>
      <div className="hd"><h4>Assistant</h4><span className="pill" data-tone={awake ? 'good' : undefined} style={{ marginLeft: 'auto' }}>{awake ? `${claude(w.ai.provider)} · ${modelName(model)}` : 'ASLEEP'}</span></div>
      {awake ? (
        <div className="list" style={{ gap: 7 }}>
          <div className="card msg"><div className="cap">Morning brief</div><p>Good morning{w.name.trim() ? `, ${w.name.trim().split(/\s+/)[0]}` : ''}. 3 meetings and 2 P0 tasks today. The first is at 09:30.</p></div>
          <div className="card msg"><div className="cap">Drafted reply</div><p>Re: Contract draft. "Thanks, this works. I will send the signed copy on Friday."</p></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 'auto' }}>
            <div className="bub" data-me="">What is due this week?</div>
            <div className="bub" data-ai="">Four tasks, one overdue: Send Q3 deck.</div>
          </div>
        </div>
      ) : (
        <div className="card center">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></svg>
          <b>The assistant is asleep</b>
          <span>Add an AI key and test it. The morning brief, drafted replies and questions all wake up with it.</span>
        </div>
      )}
    </LaptopScreen>
  )
}

/** "claude-sonnet-4-6" → "Sonnet 4.6"; "llama-3.3-70b-versatile" → "Llama 3.3 70B". */
function modelName(id: string): string {
  const c = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?/.exec(id)
  if (c) return `${c[1][0].toUpperCase()}${c[1].slice(1)} ${c[3] ? `${c[2]}.${c[3]}` : c[2]}`
  const l = /^llama-([\d.]+)-(\d+b)/.exec(id)
  if (l) return `Llama ${l[1]} ${l[2].toUpperCase()}`
  return id.replace(/-\d{4,}$/, '')
}

function Calendar({ w }: { w: WizardState }) {
  const PX = 14.5, T0 = 6
  const y = (h: number) => Math.round((Math.min(22, Math.max(T0, h)) - T0) * PX * 10) / 10
  const { start, stop, quiet } = w.rhythm
  const inside = (a: number, b: number) => a >= start && b <= stop
  const blocks = [
    { t: 'Deep work', sub: `${clock(start)} to ${clock(start + 2)}`, a: start, b: start + 2, c: 'var(--sb-accent)' },
    { t: 'Reply to the team', sub: clock(start + 2.25), a: start + 2.25, b: start + 3, c: 'var(--sb-info)' },
    { t: 'Team sync', sub: '14:00', a: 14, b: 15, c: 'var(--sb-ink-1)' },
  ]
  const hrs: number[] = []
  for (let h = 6; h <= 20; h += 2) hrs.push(h)
  const hatch = 'repeating-linear-gradient(135deg, var(--sb-hairline) 0 6px, var(--sb-field) 6px 12px)'
  return (
    <LaptopScreen module="Calendar" rail={2}>
      <div className="hd"><h4>Today</h4><span className="sub" style={{ marginLeft: 'auto' }}>Working {clock(start)} to {clock(stop)}</span></div>
      <div className="grid">
        <div className="band" style={{ top: y(7), height: Math.max(0, y(start) - y(7)), background: hatch }} />
        <div className="band" style={{ top: y(stop), height: Math.max(0, y(quiet) - y(stop)), background: hatch }} />
        <div className="band" style={{ left: 34, top: y(start), height: Math.max(0, y(stop) - y(start)), background: 'color-mix(in srgb, var(--sb-accent) 22%, transparent)', borderLeft: '3px solid var(--sb-accent)' }} />
        <div className="band" style={{ top: y(quiet), height: Math.max(0, y(22) - y(quiet) + 4), background: 'color-mix(in srgb, var(--sb-ink-1) 78%, transparent)' }} />
        <div className="band" style={{ top: 0, height: y(7), background: 'color-mix(in srgb, var(--sb-ink-1) 78%, transparent)' }} />
        {hrs.map(h => <div key={h} className="hr" style={{ top: y(h) + 2, color: h < 7 ? 'var(--sb-border)' : 'var(--sb-ink-3)' }}>{h}:00</div>)}
        {blocks.map(b => {
          const ok = inside(b.a, b.b)
          return (
            <div key={b.t} className="blk" style={{ top: y(b.a), height: Math.max(21, y(b.b) - y(b.a)), borderLeftColor: b.c, opacity: ok ? 1 : .4 }}>
              {b.t} <small>{ok ? b.sub : 'outside hours'}</small>
            </div>
          )
        })}
      </div>
    </LaptopScreen>
  )
}

const FEED: Record<string, { text: string; time: string; dot: string; alert?: keyof WizardState['alerts'] }> = {
  'morning-brief':   { text: 'Ready. 3 meetings and 2 P0 tasks today.', time: '06:40', dot: 'var(--sb-accent)' },
  'draft-replies':   { text: '2 replies drafted and waiting for you.', time: '08:10', dot: 'var(--sb-info)', alert: 'draft' },
  'block-focus':     { text: 'Focus block set for Send Q3 deck.', time: '09:00', dot: 'var(--sb-positive)' },
  'distribute-dump': { text: '13 dumped tasks placed on the board.', time: '09:05', dot: 'var(--sb-warning)' },
  'roll-forward':    { text: '2 unfinished tasks moved to today.', time: '00:05', dot: 'var(--sb-negative)' },
  'archive-news':    { text: '9 newsletters archived. Still in All Mail.', time: '06:00', dot: 'var(--sb-info)' },
  'close-week':      { text: 'Sunday 20:00. The week, closed in one note.', time: 'Sun', dot: 'var(--sb-accent-deep)' },
}

function Activity({ w }: { w: WizardState }) {
  const on = DEFAULT_AUTOMATION_RULES.filter(r => w.rules[r.id]).slice(0, 5)
  const alerts = Object.values(w.alerts).filter(Boolean).length
  return (
    <LaptopScreen module="Activity" rail={3}>
      <div className="hd"><h4>Activity</h4><span className="pill" style={{ marginLeft: 'auto' }}>{alerts} alert{alerts === 1 ? '' : 's'} on</span></div>
      <div className="list">
        {on.length === 0 && <div className="card empty">All helpers are off. Switch one on and its work shows up here.</div>}
        {on.map(r => {
          const f = FEED[r.id]
          const alert = f.alert ? w.alerts[f.alert] : false
          return (
            <div key={r.id} className="card li">
              <i className="dot" style={{ background: f.dot }} />
              <div className="mid"><div className="who">{r.action}</div><div className="what">{f.text}</div></div>
              <span className="pill" data-tone={alert ? 'ink' : undefined}>{alert ? 'Alert' : 'Quiet'}</span>
              <span className="when">{f.time}</span>
            </div>
          )
        })}
      </div>
    </LaptopScreen>
  )
}

const DAYS: Record<string, number[]> = {
  water: [1, 0, 1, 1, 0, 1, 1], exercise: [1, 1, 0, 1, 0, 1, 0], reading: [1, 1, 0, 1, 1, 1, 0],
  meditation: [0, 1, 1, 0, 1, 1, 1], sleep: [1, 1, 0, 1, 1, 0, 1], journaling: [1, 0, 1, 0, 1, 1, 0],
}

function Habits({ w }: { w: WizardState }) {
  const chosen = HABIT_TEMPLATES.filter(t => w.habits.includes(t.id))
  const quads = [
    { n: 'Do now', t: 'Send Q3 deck', c: 'var(--sb-negative-deep)' }, { n: 'Plan', t: 'Budget review', c: 'var(--sb-accent-deep)' },
    { n: 'Delegate', t: 'Book travel', c: 'var(--sb-info)' }, { n: 'Drop', t: 'Old newsletter', c: 'var(--sb-ink-3)' },
  ]
  return (
    <LaptopScreen module="Habits" rail={4}>
      <div className="cols">
        <div className="card col" style={{ flex: 1.15, padding: '9px 10px', gap: 6 }}>
          <div className="cap">Habits · last 7 days</div>
          {chosen.length === 0 && <div className="hint">Pick a habit on the left to see its record fill in.</div>}
          {chosen.map(t => {
            const days = DAYS[t.id] ?? [1, 0, 1, 1, 0, 1, 0]
            return (
              <div key={t.id} className="hab">
                <span className="nm">{t.name}</span>
                <span style={{ display: 'flex', gap: 3 }}>{days.map((d, i) => <i key={i} className="sq" data-on={d ? '' : undefined} />)}</span>
              </div>
            )
          })}
        </div>
        <div className="card col" style={{ flex: 1.2, padding: '9px 10px', gap: 6 }}>
          <div className="cap">Tasks · sorted for you</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, flex: 1 }}>
            {quads.map(q => <div key={q.n} className="quad"><b style={{ color: q.c }}>{q.n}</b><span>{q.t}</span></div>)}
          </div>
        </div>
      </div>
    </LaptopScreen>
  )
}

function Finance({ w }: { w: WizardState }) {
  const off = moduleIsOff('finance')
  const locked = w.finance.lock
  let body: ReactNode
  if (off) {
    body = <div className="card center"><b>Finance is not on your plan</b><span>When it is, your budget and ledger appear here, and only you can read them.</span></div>
  } else if (locked) {
    body = (
      <div className="card center">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
        <b>Locked</b><span>Finance asks for your password each time you open it.</span>
      </div>
    )
  } else {
    body = (
      <div className="list" style={{ gap: 7 }}>
        {[['Groceries', '$412', 'left', 62, 'var(--sb-positive)'], ['Eating out', '$96', 'left', 24, 'var(--sb-negative)'], ['Travel fund', '$1,250', 'saved', 41, 'var(--sb-accent)']].map(([n, a, u, p, c]) => (
          <div key={n as string} className="card env">
            <div className="top"><b>{n}</b><em>{a}</em><small>{u}</small></div>
            <div className="bar"><div style={{ width: `${p}%`, background: c as string }} /></div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <LaptopScreen module="Finance" rail={3}>
      <div className="hd"><h4>Budget</h4><span className="sub">This month</span><span className="pill" data-tone={locked || off ? undefined : 'good'} style={{ marginLeft: 'auto' }}>{off ? 'OFF' : locked ? 'LOCKED' : 'PRIVATE'}</span></div>
      {body}
    </LaptopScreen>
  )
}

export function Screen({ step, w }: { step: StepId; w: WizardState }) {
  switch (step) {
    case 'you': return <Today w={w} done={false} />
    case 'done': return <Today w={w} done />
    case 'accounts': return <Mail w={w} />
    case 'ai': return <Assistant w={w} />
    case 'rhythm': return <Calendar w={w} />
    case 'automation': return <Activity w={w} />
    case 'habits': return <Habits w={w} />
    case 'finance': return <Finance w={w} />
  }
}
