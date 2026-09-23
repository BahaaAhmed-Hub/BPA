-- ─── Plans, modules, and who gets which ──────────────────────────────────────
-- Three questions kept apart, because they have three different answers:
--   what modules exist           → public.modules
--   what a plan includes         → public.plan_modules
--   what THIS user gets anyway   → public.user_modules   (the override)
--
-- The override is a row's PRESENCE, not a nullable boolean. Present-and-true
-- grants a module the plan does not include; present-and-false revokes one it
-- does; no row at all means "inherit the plan". Absence has to be sayable, and
-- it is the commonest case by far — most users are exactly their plan.
--
-- `has_module()` is the only thing that resolves the three, so an RLS policy,
-- an edge function and the client cannot come to different conclusions about
-- the same user.
--
-- ADMIN IS ITS OWN TABLE, NEVER A COLUMN ON public.users. That table carries
-- `for all ... using (auth.uid() = id)` from 20240001, so an `is_admin` column
-- on it would be writable by its own subject — every user one UPDATE away from
-- being an admin. public.admins has no write policy at all: rows go in by hand
-- with the service role, which is the only way a privilege should be handed out.
--
-- Seeds are `on conflict do nothing`, so re-applying this file never overwrites
-- a plan edited since in the admin panel. A row DELETED there would come back —
-- but the runner only re-applies a file whose checksum changed, so that is a
-- visible decision rather than something a deploy does behind you.
--
-- A rollback block sits at the foot of this file.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── who is an admin ─────────────────────────────────────────────────────────
create table if not exists public.admins (
  user_id  uuid        primary key references auth.users(id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Read your own row only: the client asks "am I an admin?" and nothing else.
-- There is deliberately NO insert/update/delete policy — with RLS on, that
-- means nobody holding an anon key can write this table at all.
drop policy if exists "admins: read own" on public.admins;
create policy "admins: read own"
  on public.admins for select
  using (auth.uid() = user_id);

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;


-- ─── what a user is paying for ───────────────────────────────────────────────
-- Stripe is the truth; this is a cache of it, written only by the webhook with
-- the service role. `status` uses Stripe's own vocabulary so the two never need
-- translating. A lapsed subscription is not deleted — `plan_of()` reads any
-- status outside (active, trialing) as free, which is the downgrade-but-keep-
-- the-data behaviour a ledger deserves.
create table if not exists public.subscriptions (
  user_id            uuid        primary key references auth.users(id) on delete cascade,
  plan               text        not null default 'free',
  status             text        not null default 'active',
  stripe_customer_id text,
  current_period_end timestamptz,
  updated_at         timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions: read own" on public.subscriptions;
create policy "subscriptions: read own"
  on public.subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "subscriptions: admin reads all" on public.subscriptions;
create policy "subscriptions: admin reads all"
  on public.subscriptions for select
  using (public.is_admin());

-- No write policy for either. The Stripe webhook uses the service role; an
-- admin changing someone's PLAN by hand would put this table out of step with
-- the thing that actually bills them. Overrides are what the admin panel edits.


-- An admin has to be able to LIST users, or the panel has nothing to show. This
-- is a second permissive SELECT policy beside 20240001's "own row only", so it
-- widens reading and changes nothing about writing.
--
-- Note what is deliberately NOT here: no admin policy on finance_transactions,
-- tasks, habits, mail or any other data table. You get the power to switch a
-- module off without the power — or the liability — of reading somebody's
-- ledger. Grant that per incident if you ever truly need it.
drop policy if exists "users: admin reads all" on public.users;
create policy "users: admin reads all"
  on public.users for select
  using (public.is_admin());


-- ─── the module registry ─────────────────────────────────────────────────────
-- `core` is a module that can never be revoked, by a plan or by an override.
-- Without it a user can be left signed in with no home screen and no way to
-- reach Settings, which is a support ticket rather than a downgrade.
create table if not exists public.modules (
  id         text    primary key,
  label      text    not null,
  core       boolean not null default false,
  sort_order int     not null default 0
);

alter table public.modules enable row level security;

drop policy if exists "modules: readable by all" on public.modules;
create policy "modules: readable by all"
  on public.modules for select
  using (auth.uid() is not null);

drop policy if exists "modules: admin writes" on public.modules;
create policy "modules: admin writes"
  on public.modules for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.modules (id, label, core, sort_order) values
  ('morning',   'Today',     true,  10),
  ('calendar',  'Calendar',  false, 20),
  ('inbox',     'Mail',      false, 30),
  ('tasks',     'Tasks',     false, 40),
  ('habits',    'Habits',    false, 50),
  ('finance',   'Finance',   false, 60),
  ('dashboard', 'Dashboard', true,  70)
on conflict (id) do nothing;


-- ─── what each plan includes ─────────────────────────────────────────────────
-- Readable by any signed-in user, because "Finance is on Pro" is exactly what
-- an upgrade prompt has to be able to say.
create table if not exists public.plan_modules (
  plan      text not null,
  module_id text not null references public.modules(id) on delete cascade,
  primary key (plan, module_id)
);

alter table public.plan_modules enable row level security;

drop policy if exists "plan_modules: readable by all" on public.plan_modules;
create policy "plan_modules: readable by all"
  on public.plan_modules for select
  using (auth.uid() is not null);

drop policy if exists "plan_modules: admin writes" on public.plan_modules;
create policy "plan_modules: admin writes"
  on public.plan_modules for all
  using (public.is_admin()) with check (public.is_admin());

-- A starting point, not a decision: edit it in the admin panel. The core two
-- are listed for both so the table reads as the whole truth about a plan
-- rather than a partial one you have to know to add core back onto.
insert into public.plan_modules (plan, module_id) values
  ('free', 'morning'), ('free', 'dashboard'),
  ('free', 'calendar'), ('free', 'tasks'), ('free', 'habits'),
  ('pro',  'morning'), ('pro',  'dashboard'),
  ('pro',  'calendar'), ('pro',  'tasks'), ('pro',  'habits'),
  ('pro',  'inbox'),   ('pro',  'finance')
on conflict (plan, module_id) do nothing;


-- ─── the per-user override ───────────────────────────────────────────────────
-- `note` and `set_by` are not decoration: in four months the only thing that
-- can explain why one user has Mail on a free plan is a sentence somebody
-- wrote at the time.
create table if not exists public.user_modules (
  user_id   uuid        not null references auth.users(id) on delete cascade,
  module_id text        not null references public.modules(id) on delete cascade,
  enabled   boolean     not null,
  note      text,
  set_by    uuid        references auth.users(id) on delete set null,
  set_at    timestamptz not null default now(),
  primary key (user_id, module_id)
);

alter table public.user_modules enable row level security;

drop policy if exists "user_modules: read own" on public.user_modules;
create policy "user_modules: read own"
  on public.user_modules for select
  using (auth.uid() = user_id);

drop policy if exists "user_modules: admin writes" on public.user_modules;
create policy "user_modules: admin writes"
  on public.user_modules for all
  using (public.is_admin()) with check (public.is_admin());


-- ─── the resolver ────────────────────────────────────────────────────────────
-- A user with no subscription row, or one whose payment has lapsed, is on the
-- free plan. Nothing is deleted and nothing is inferred.
create or replace function public.plan_of(uid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select plan from public.subscriptions
      where user_id = uid and status in ('active', 'trialing')),
    'free')
$$;

-- The order is the whole policy: core beats everything, then the user's own
-- override, then the plan, then no. An unknown module id resolves to false —
-- a typo must not grant anything.
create or replace function public.has_module(uid uuid, mod text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when uid is null then false
    when (select core from public.modules where id = mod) then true
    else coalesce(
      (select enabled from public.user_modules
        where user_id = uid and module_id = mod),
      (select true from public.plan_modules
        where plan = public.plan_of(uid) and module_id = mod),
      false)
  end
$$;

-- One round trip for the whole answer, which is what the client needs before
-- it hydrates anything: a module that is off must never be LOADED, or an empty
-- store reads as "my data is gone" rather than "this is not on your plan".
create or replace function public.my_modules()
returns table (module_id text, label text, enabled boolean)
language sql stable security definer set search_path = public
as $$
  select m.id, m.label, public.has_module(auth.uid(), m.id)
    from public.modules m
   order by m.sort_order, m.id
$$;


-- ─── backfill ────────────────────────────────────────────────────────────────
-- Every existing user gets a free-plan row. This identifies exactly what it is
-- changing (a user with no subscription) and does nothing to anyone who has
-- one, so it is safe on a re-run — unlike the repair in 20260009.
insert into public.subscriptions (user_id, plan, status)
  select id, 'free', 'active' from public.users
on conflict (user_id) do nothing;


-- ─── rollback ────────────────────────────────────────────────────────────────
-- Nothing above alters an existing table, so undoing it is four drops. Run by
-- hand; delete the row from public.schema_migrations too, or the runner will
-- consider this file applied.
--
--   drop function if exists public.my_modules();
--   drop function if exists public.has_module(uuid, text);
--   drop function if exists public.plan_of(uuid);
--   drop function if exists public.is_admin();
--   drop table if exists public.user_modules;
--   drop table if exists public.plan_modules;
--   drop table if exists public.modules;
--   drop table if exists public.subscriptions;
--   drop table if exists public.admins;
--   delete from public.schema_migrations where name = '20260021_entitlements.sql';
