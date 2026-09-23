// ─── The admin's side of the entitlement tables ──────────────────────────────
// Every call here is an ordinary query as the signed-in person. Nothing is
// privileged by being in this file: `20260021`'s policies decide, and a
// non-admin running any of it gets empty rows rather than an error — which is
// exactly why the panel can live in the same public bundle as everything else.
//
// What an admin may do is deliberately narrow, and the shape of this file
// follows it: modules, plans and overrides are writable; `subscriptions` is
// readable only (Stripe owns it); `admins` is neither (service role only); and
// there is no function here that reads anybody's tasks, mail or ledger,
// because no policy would allow one.
import { supabase } from './supabase'

export interface ModuleRow { id: string; label: string; core: boolean; sort_order: number }
export interface PlanRow   { plan: string; module_id: string }
export interface Override  { user_id: string; module_id: string; enabled: boolean; note: string | null; set_at: string }
export interface AdminUser {
  id: string
  email: string
  full_name: string | null
  created_at: string
  plan: string
  status: string
  overrides: Record<string, boolean>
  notes: Record<string, string | null>
}

/** Am I one? The table gives out own-row-only, so a row is the whole answer. */
export async function amIAdmin(): Promise<boolean> {
  const { data, error } = await supabase.from('admins').select('user_id').maybeSingle()
  if (error) return false
  return !!data
}

export async function listModules(): Promise<ModuleRow[]> {
  const { data } = await supabase.from('modules').select('*').order('sort_order')
  return (data ?? []) as ModuleRow[]
}

export async function listPlanModules(): Promise<PlanRow[]> {
  const { data } = await supabase.from('plan_modules').select('*')
  return (data ?? []) as PlanRow[]
}

/** Three reads joined here rather than in PostgREST: `subscriptions` and
 *  `user_modules` hang off `auth.users`, not off `public.users`, so there is no
 *  foreign key for an embed to follow. The tables are small and this is one
 *  screen — a join nobody can see is not worth a migration. */
export async function listUsers(): Promise<AdminUser[]> {
  const [{ data: users }, { data: subs }, { data: ovr }] = await Promise.all([
    supabase.from('users').select('id, email, full_name, created_at').order('created_at'),
    supabase.from('subscriptions').select('user_id, plan, status'),
    supabase.from('user_modules').select('user_id, module_id, enabled, note, set_at'),
  ])
  const sub = new Map((subs ?? []).map(s => [s.user_id as string, s as { plan: string; status: string }]))
  const byUser = new Map<string, Override[]>()
  for (const o of (ovr ?? []) as Override[]) {
    const list = byUser.get(o.user_id) ?? []
    list.push(o); byUser.set(o.user_id, list)
  }
  return (users ?? []).map(u => {
    const mine = byUser.get(u.id as string) ?? []
    return {
      id: u.id as string,
      email: (u.email as string) ?? '',
      full_name: (u.full_name as string | null) ?? null,
      created_at: (u.created_at as string) ?? '',
      // No row is the free plan, and a lapsed one is too — `plan_of()`'s rule,
      // said the same way here so the screen agrees with the resolver.
      plan: sub.get(u.id as string)?.plan ?? 'free',
      status: sub.get(u.id as string)?.status ?? 'none',
      overrides: Object.fromEntries(mine.map(o => [o.module_id, o.enabled])),
      notes: Object.fromEntries(mine.map(o => [o.module_id, o.note])),
    }
  })
}

/** What the server says this user actually gets — `has_module()` itself, per
 *  module, rather than a second implementation of core→override→plan→no. Seven
 *  tiny calls for one open user is the right price for not having two answers. */
export async function resolvedFor(userId: string, modules: ModuleRow[]): Promise<Record<string, boolean>> {
  const pairs = await Promise.all(modules.map(async m => {
    const { data } = await supabase.rpc('has_module', { uid: userId, mod: m.id })
    return [m.id, data === true] as const
  }))
  return Object.fromEntries(pairs)
}

/** `null` clears the override — which is "inherit the plan", the commonest
 *  state and the one a tri-state control has to be able to return to. */
export async function setOverride(
  userId: string, moduleId: string, enabled: boolean | null, note?: string,
): Promise<string | null> {
  if (enabled === null) {
    const { error } = await supabase.from('user_modules').delete()
      .eq('user_id', userId).eq('module_id', moduleId)
    return error?.message ?? null
  }
  const { data: me } = await supabase.auth.getUser()
  const { error } = await supabase.from('user_modules').upsert({
    user_id: userId, module_id: moduleId, enabled,
    note: note ?? null, set_by: me?.user?.id ?? null, set_at: new Date().toISOString(),
  }, { onConflict: 'user_id,module_id' })
  return error?.message ?? null
}

export async function setPlanModule(plan: string, moduleId: string, on: boolean): Promise<string | null> {
  if (!on) {
    const { error } = await supabase.from('plan_modules').delete()
      .eq('plan', plan).eq('module_id', moduleId)
    return error?.message ?? null
  }
  const { error } = await supabase.from('plan_modules')
    .upsert({ plan, module_id: moduleId }, { onConflict: 'plan,module_id' })
  return error?.message ?? null
}

/** The audit is not a second table — it is the overrides themselves, newest
 *  first. A change that left no row is a change that was undone, and there is
 *  nothing to say about it that the current state does not already say. */
export async function recentChanges(limit = 50): Promise<(Override & { by: string | null })[]> {
  const { data } = await supabase.from('user_modules')
    .select('user_id, module_id, enabled, note, set_at, set_by')
    .order('set_at', { ascending: false }).limit(limit)
  return (data ?? []).map(r => ({ ...r, by: (r.set_by as string | null) ?? null })) as (Override & { by: string | null })[]
}
