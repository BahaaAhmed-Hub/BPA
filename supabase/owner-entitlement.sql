-- ─── The owner's account: highest tier, plus a floor under it ────────────────
-- NOT a migration. It lives outside supabase/migrations on purpose, so no
-- deploy ever runs it — `scripts/migrate.mjs` only reads that directory. Run
-- it by hand in the Supabase SQL editor, which executes as a privileged role
-- and so bypasses RLS; `subscriptions` has no write policy at all and cannot
-- be changed from the app by anybody, admin included.
--
-- It is idempotent and meant to be re-run — after adding a module, say, since
-- blocks 1 and 3 both read `public.modules` and pick up whatever is there now.
--
-- Two layers, because they fail differently:
--
--   1. The `owner` PLAN carries every module. A plan is the ordinary way to be
--      entitled, and this is the tier above `pro` — not something a customer
--      buys, but what the person who runs the place is on. Keeping it separate
--      from `pro` means `pro` can be trimmed later without touching you.
--
--   2. An explicit OVERRIDE per module, which `has_module()` reads *before*
--      the plan. This is the floor. `plan_of()` returns `'free'` for any
--      status outside (active, trialing), so the day a Stripe webhook writes
--      `past_due` the plan alone would stop entitling you — silently, and to
--      your own ledger. An override does not care what the plan says, what its
--      status is, or whether the plan still exists.
--
-- Core modules are skipped in block 3: `has_module()` answers `true` for them
-- before it looks at anything else, so a row would be noise — and the admin
-- panel would count it as an exception it cannot switch.
-- ─────────────────────────────────────────────────────────────────────────────

\set owner_email 'eng.bahaa.a@gmail.com'

-- 1. the tier
insert into public.plan_modules (plan, module_id)
  select 'owner', id from public.modules
on conflict (plan, module_id) do nothing;

-- 2. the account is on it
insert into public.subscriptions (user_id, plan, status)
  select id, 'owner', 'active' from public.users where email = :'owner_email'
on conflict (user_id) do update
  set plan = 'owner', status = 'active', updated_at = now();

-- 3. the floor — one pinned override per non-core module
insert into public.user_modules (user_id, module_id, enabled, note, set_by)
  select u.id, m.id, true, 'owner — pinned, independent of any plan', u.id
    from public.users u cross join public.modules m
   where u.email = :'owner_email' and not m.core
on conflict (user_id, module_id) do update
  set enabled = true, note = excluded.note, set_at = now();

-- 4. what the server now says, module by module. Every row must read `t`.
--    This is `has_module()` itself — the same function every policy calls —
--    so it is the answer, not a prediction of it.
select m.label            as module,
       m.core             as is_core,
       (select enabled from public.user_modules
         where user_id = u.id and module_id = m.id) as override,
       public.has_module(u.id, m.id) as can_see
  from public.modules m cross join public.users u
 where u.email = :'owner_email'
 order by m.sort_order;
