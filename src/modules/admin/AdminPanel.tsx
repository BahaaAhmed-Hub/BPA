import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Segmented } from '@/components/ui'
import {
  listModules, listPlanModules, listUsers, recentChanges, resolvedFor,
  setOverride, setPlanModule,
  type AdminUser, type ModuleRow, type Override, type PlanRow,
} from '@/lib/admin'
import { notify } from '@/lib/undo'

// ─── The admin panel ─────────────────────────────────────────────────────────
// It lives in the same bundle as everything else, and that is safe for one
// reason: the security is RLS, not this file. A non-admin who forces the route
// gets a page of empty lists, because every query behind it returns nothing.
//
// The whole panel is about **entitlements**. There is no screen here for
// reading somebody's ledger, tasks or mail, and no policy that would allow
// one — power over modules without the liability of their data.

type Tab = 'users' | 'plans' | 'audit'

const EYEBROW: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em',
  color: 'var(--sb-ink-3)', textTransform: 'uppercase', marginBottom: 4,
}

function when(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── A module's state for one user ───────────────────────────────────────────
// Three states, not two, and the third is the commonest: most users are exactly
// their plan. A two-way switch would make "inherit" unsayable, so turning an
// override off would have to mean *revoked* — which is a different decision,
// and one nobody asked for.
function OverrideControl({ module: label, value, onChange, disabled, title }: {
  /** Named, because seven controls all announcing "module override" tell a
   *  screen reader which kind of control it is and nothing about which module. */
  module: string
  value: 'inherit' | 'on' | 'off'
  onChange: (v: 'inherit' | 'on' | 'off') => void
  disabled?: boolean
  title?: string
}) {
  return (
    <div title={title} style={{ opacity: disabled ? 0.45 : 1, pointerEvents: disabled ? 'none' : undefined }}>
      <Segmented
        size="sm"
        aria-label={`${label} — follow the plan, force on, or force off`}
        value={value}
        onChange={onChange}
        options={[
          { value: 'inherit', label: 'Plan' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
      />
    </div>
  )
}

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>('users')
  const [modules, setModules] = useState<ModuleRow[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [log, setLog] = useState<(Override & { by: string | null })[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [resolved, setResolved] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const [m, u, p, l] = await Promise.all([listModules(), listUsers(), listPlanModules(), recentChanges()])
    setModules(m); setUsers(u); setPlans(p); setLog(l); setLoading(false)
  }, [])
  useEffect(() => { void reload() }, [reload])

  const open = users.find(u => u.id === openId) ?? null

  // The resolved set is the server's own answer, asked again whenever the thing
  // it depends on moves — an override, or the plan the user is on.
  useEffect(() => {
    if (!open || !modules.length) { setResolved({}); return }
    let live = true
    void resolvedFor(open.id, modules).then(r => { if (live) setResolved(r) })
    return () => { live = false }
  }, [open, modules])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return users
    return users.filter(u =>
      u.email.toLowerCase().includes(needle) || (u.full_name ?? '').toLowerCase().includes(needle))
  }, [users, q])

  const planNames = useMemo(() => {
    const set = new Set(plans.map(p => p.plan))
    for (const u of users) set.add(u.plan)
    return [...set].sort()
  }, [plans, users])

  const label = (id: string) => modules.find(m => m.id === id)?.label ?? id
  const emailOf = (id: string) => users.find(u => u.id === id)?.email ?? id.slice(0, 8)

  async function flip(user: AdminUser, m: ModuleRow, v: 'inherit' | 'on' | 'off') {
    const enabled = v === 'inherit' ? null : v === 'on'
    const note = enabled === null ? undefined
      : window.prompt(`Why is ${m.label} being turned ${v} for ${user.email}?\n\nIn four months this sentence is the only thing that will explain it.`) ?? undefined
    const err = await setOverride(user.id, m.id, enabled, note)
    if (err) return notify(`Could not change it — ${err}`)
    notify(v === 'inherit'
      ? `${m.label} follows the ${user.plan} plan again for ${user.email}`
      : `${m.label} is ${v} for ${user.email}, whatever the plan says`)
    await reload()
  }

  async function flipPlan(plan: string, m: ModuleRow, on: boolean) {
    const err = await setPlanModule(plan, m.id, on)
    if (err) return notify(`Could not change it — ${err}`)
    notify(`${plan} ${on ? 'includes' : 'no longer includes'} ${m.label}`)
    await reload()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 40 }}>
      <div>
        <div style={EYEBROW}>ADMIN</div>
        <h1 style={{
          margin: 0, fontFamily: 'Outfit, system-ui', fontSize: 28, fontWeight: 600,
          letterSpacing: '-0.03em', color: 'var(--sb-ink-1)',
        }}>Plans &amp; modules</h1>
        <p style={{ margin: '6px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', maxWidth: 620 }}>
          What each plan includes, and the exceptions. Switching a module here changes
          what somebody may see — it never reads their data.
        </p>
      </div>

      <Segmented
        value={tab} onChange={setTab} aria-label="Admin section"
        style={{ alignSelf: 'start' }}
        options={[
          { value: 'users', label: `Users${users.length ? ` · ${users.length}` : ''}` },
          { value: 'plans', label: 'Plans' },
          { value: 'audit', label: `Audit${log.length ? ` · ${log.length}` : ''}` },
        ]}
      />

      {loading && <Card style={{ padding: 18, color: 'var(--sb-ink-3)' }}>Reading the entitlement tables…</Card>}

      {/* Nothing at all is the ordinary answer for a non-admin: every query
          behind this page returns zero rows rather than failing. Saying so is
          better than an empty table that looks broken. */}
      {!loading && !users.length && (
        <Card style={{ padding: 18 }}>
          <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>
            No users are readable from this account.
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
            That is what an ordinary account sees here — the policies answer, not the page.
            If you expect to be an admin, the row goes into <code>public.admins</code> by hand
            with the service role; nothing in the app can mint one.
          </p>
        </Card>
      )}

      {!loading && !!users.length && tab === 'users' && (
        <div style={{ display: 'grid', gridTemplateColumns: open ? 'minmax(280px, 1fr) minmax(340px, 1.1fr)' : '1fr', gap: 14, alignItems: 'start' }}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: 12, borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
              <input
                value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search by name or address"
                style={{
                  width: '100%', height: 'var(--sb-h-pill)', border: 'var(--sb-border-width) solid var(--sb-border)',
                  borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-field)', color: 'var(--sb-ink-1)',
                  padding: '0 10px', fontSize: 'var(--sb-t-body-s)', fontFamily: 'inherit',
                }}
              />
            </div>
            {shown.map(u => {
              const n = Object.keys(u.overrides).length
              return (
                <button
                  key={u.id} onClick={() => setOpenId(u.id === openId ? null : u.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                    background: u.id === openId ? 'var(--sb-accent-tint)' : 'transparent',
                    border: 0, borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
                    padding: '10px 12px', font: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                    }}>{u.full_name || u.email}</span>
                    <span style={{
                      fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.06em',
                      textTransform: 'uppercase', color: 'var(--sb-ink-3)',
                    }}>{u.plan}</span>
                  </div>
                  <div style={{ marginTop: 3, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
                    {u.email}
                    {u.status !== 'active' && u.status !== 'none' && ` · ${u.status}`}
                    {n > 0 && ` · ${n} exception${n > 1 ? 's' : ''}`}
                  </div>
                </button>
              )
            })}
            {!shown.length && (
              <p style={{ margin: 0, padding: 14, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)' }}>
                Nobody matches “{q}”.
              </p>
            )}
          </Card>

          {open && (
            <Card style={{ padding: 16 }}>
              <div style={EYEBROW}>THIS ACCOUNT</div>
              <p style={{ margin: '0 0 2px', fontSize: 'var(--sb-t-h2)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
                {open.full_name || open.email}
              </p>
              <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
                {open.email} · on <strong>{open.plan}</strong>
                {open.status === 'none' ? ' (no subscription row — free by default)' : ` (${open.status})`}
                {' · joined '}{when(open.created_at)}
              </p>

              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {modules.map(m => {
                  const has = open.overrides[m.id]
                  const state: 'inherit' | 'on' | 'off' =
                    has === undefined ? 'inherit' : has ? 'on' : 'off'
                  const byPlan = plans.some(p => p.plan === open.plan && p.module_id === m.id)
                  const live = resolved[m.id]
                  return (
                    <div key={m.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      paddingBottom: 8, borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
                            {m.label}
                          </span>
                          {/* A dot in the colour of the answer, not a word — the
                              row already carries three words and a control. */}
                          <span aria-hidden style={{
                            width: 7, height: 7, borderRadius: 99,
                            background: live === undefined ? 'var(--sb-ink-4)'
                              : live ? 'var(--sb-positive)' : 'var(--sb-negative)',
                          }} />
                          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
                            {live === undefined ? 'asking the server…' : live ? 'they can see it' : 'they cannot'}
                          </span>
                        </div>
                        <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 2 }}>
                          {m.core
                            ? 'Core — cannot be revoked by a plan or an override'
                            : byPlan ? `The ${open.plan} plan includes it` : `The ${open.plan} plan does not`}
                          {open.notes[m.id] ? ` · “${open.notes[m.id]}”` : ''}
                        </div>
                      </div>
                      <OverrideControl
                        module={m.label}
                        value={state}
                        disabled={m.core}
                        title={m.core ? 'A core module is on for everybody' : undefined}
                        onChange={v => { void flip(open, m, v) }}
                      />
                    </div>
                  )
                })}
              </div>

              <p style={{ margin: '12px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
                <strong>Plan</strong> follows whatever the plan says, now and later.
                <strong> On</strong> and <strong>Off</strong> are exceptions that outlive a plan change —
                which is the point of them, and the reason each asks you for a sentence.
              </p>
            </Card>
          )}
        </div>
      )}

      {!loading && !!users.length && tab === 'plans' && (
        <Card style={{ padding: 16 }}>
          <div style={EYEBROW}>WHAT EACH PLAN INCLUDES</div>
          <p style={{ margin: '0 0 12px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
            This is the default for everybody on the plan. A user with an exception keeps it.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 10px 6px 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontWeight: 700 }}>MODULE</th>
                  {planNames.map(p => (
                    <th key={p} style={{ padding: '6px 10px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontWeight: 700, textTransform: 'uppercase' }}>{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modules.map(m => (
                  <tr key={m.id} style={{ borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
                    <td style={{ padding: '8px 10px 8px 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', fontWeight: 600 }}>
                      {m.label}
                      {m.core && <span style={{ marginLeft: 6, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', fontWeight: 400 }}>core</span>}
                    </td>
                    {planNames.map(p => {
                      const on = plans.some(r => r.plan === p && r.module_id === m.id)
                      return (
                        <td key={p} style={{ padding: '6px 10px', textAlign: 'center' }}>
                          <Button
                            size="sm"
                            variant={on ? 'primary' : 'secondary'}
                            disabled={m.core}
                            title={m.core ? 'Core modules are on for every plan' : on ? 'Included — click to remove' : 'Not included — click to add'}
                            onClick={() => { void flipPlan(p, m, !on) }}
                          >{m.core ? 'always' : on ? 'included' : '—'}</Button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && !!users.length && tab === 'audit' && (
        <Card style={{ padding: 16 }}>
          <div style={EYEBROW}>EVERY EXCEPTION, NEWEST FIRST</div>
          <p style={{ margin: '0 0 12px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
            The overrides themselves, not a second table. A change that left no row was undone,
            and the current state already says so.
          </p>
          {!log.length && <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>No exceptions — everybody is exactly their plan.</p>}
          {log.map(r => (
            <div key={`${r.user_id}-${r.module_id}`} style={{
              padding: '9px 0', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
            }}>
              <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)' }}>
                <strong>{label(r.module_id)}</strong> {r.enabled ? 'granted to' : 'revoked from'} {emailOf(r.user_id)}
              </div>
              <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 2 }}>
                {when(r.set_at)}
                {r.by ? ` · by ${emailOf(r.by)}` : ''}
                {r.note ? ` · “${r.note}”` : ' · no reason was given'}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
