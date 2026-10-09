-- Booking — let somebody outside put something on the calendar
--
-- The calendar reads every diary you own and writes to any of them, and nobody
-- who is not you can put an hour on it. A client asking for half an hour costs
-- a thread of mail to settle a time that was already on the screen.
--
-- Two things, kept apart because they answer different questions:
--
--   meeting_plans    the predefined calls an outsider chooses from — a length,
--                    buffers, notice, and the calendar its bookings land on.
--   booking_windows  the hours you are willing to be booked in. NOTHING is open
--                    until you draw it; a window you draw may repeat.
--
-- What an outsider is offered is the intersection: the hours you opened, minus
-- everything already on the calendars the plan nominates, minus buffers and
-- notice. An open hour that stops being free stops being offered.
--
-- **There is no policy here for anybody but the owner.** The public page is
-- served by the `book-me` edge function with the service role, which bypasses
-- RLS; the anon key ships inside a public JavaScript bundle, so the boundary
-- cannot be the client. Nobody holding it can read a plan, a window or a
-- booking — the posture public.admins takes in 20260021.

-- ─── Who the public page is ──────────────────────────────────────────────────
-- One row per user. `timezone` is the zone the open hours are *written* in: a
-- window is a wall clock (09:00 Cairo), so it tracks the offset across a DST
-- change rather than drifting an hour twice a year.
create table if not exists public.booking_profile (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  handle       text        not null unique,
  display_name text,
  blurb        text,
  timezone     text        not null default 'UTC',
  active       boolean     not null default true,
  created_at   timestamptz not null default now()
);

-- ─── The hours you opened ────────────────────────────────────────────────────
-- Minutes from midnight rather than `time`, because the grid this is drawn on
-- works in minutes and `snapMinutes` already produces them.
--
-- `skips` rather than an overrides table: taking back one Wednesday is the only
-- per-occurrence edit that matters, and changing one occurrence's hours is a
-- skip plus a one-off window. One table instead of two.
create table if not exists public.booking_windows (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  on_date    date        not null,
  start_min  integer     not null check (start_min >= 0    and start_min < 1440),
  end_min    integer     not null check (end_min   > 0     and end_min   <= 1440),
  repeat     jsonb       not null default '{"kind":"none"}'::jsonb,
  skips      date[]      not null default '{}',
  label      text,
  created_at timestamptz not null default now(),
  check (end_min > start_min)
);

create index if not exists booking_windows_user_idx on public.booking_windows(user_id, on_date);

-- ─── The predefined calls ────────────────────────────────────────────────────
-- `narrow` trims the shared windows for this plan and can never widen them —
-- {"days":[2,4],"from":840,"to":1020} is "Tue and Thu afternoons only".
create table if not exists public.meeting_plans (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users(id) on delete cascade,
  slug               text        not null,
  title              text        not null,
  blurb              text,
  duration_minutes   integer     not null default 30 check (duration_minutes between 5 and 480),
  slot_step_minutes  integer     not null default 30 check (slot_step_minutes between 5 and 240),
  buffer_before      integer     not null default 0  check (buffer_before >= 0),
  buffer_after       integer     not null default 0  check (buffer_after  >= 0),
  min_notice_minutes integer     not null default 240 check (min_notice_minutes >= 0),
  horizon_days       integer     not null default 30 check (horizon_days between 1 and 365),
  max_per_day        integer     check (max_per_day is null or max_per_day > 0),
  narrow             jsonb,
  target_calendar_id text,
  target_account_id  text,
  busy_calendar_ids  text[]      not null default '{}',
  location_mode      text        not null default 'meet' check (location_mode in ('meet', 'place', 'phone', 'none')),
  location_text      text,
  requires_approval  boolean     not null default false,
  active             boolean     not null default true,
  sort_order         integer     not null default 0,
  created_at         timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists meeting_plans_user_idx on public.meeting_plans(user_id, sort_order);

-- ─── What was booked ─────────────────────────────────────────────────────────
-- `user_id` is denormalised so a policy needs no join, the same reason
-- finance_transactions carries one.
create table if not exists public.bookings (
  id                uuid        primary key default gen_random_uuid(),
  plan_id           uuid        not null references public.meeting_plans(id) on delete cascade,
  user_id           uuid        not null references auth.users(id) on delete cascade,
  start_at          timestamptz not null,
  end_at            timestamptz not null,
  invitee_name      text        not null,
  invitee_email     text        not null,
  invitee_note      text,
  invitee_timezone  text,
  status            text        not null default 'confirmed' check (status in ('confirmed', 'pending', 'cancelled')),
  gcal_event_id     text,
  gcal_calendar_id  text,
  manage_token      uuid        not null default gen_random_uuid(),
  ip_hash           text,
  created_at        timestamptz not null default now(),
  cancelled_at      timestamptz
);

-- **This index is the race guard**, not the application code: two visitors
-- picking the same slot are decided by Postgres, and the loser gets a 409.
-- Keyed on user_id rather than plan_id — two different plans must not sell the
-- same hour twice. A cancelled booking frees its slot.
create unique index if not exists bookings_slot_idx
  on public.bookings(user_id, start_at)
  where status <> 'cancelled';

create index if not exists bookings_manage_idx on public.bookings(manage_token);
create index if not exists bookings_user_idx   on public.bookings(user_id, start_at);
create index if not exists bookings_plan_idx   on public.bookings(plan_id);

-- ─── How often a stranger may ask ────────────────────────────────────────────
-- A public endpoint that writes to a calendar is spam-attackable. The ledger is
-- the function's own: no policy at all, so only the service role sees it. The
-- IP is kept as a hash — it is a rate limit, not a record of who visited.
create table if not exists public.booking_hits (
  id      bigserial   primary key,
  ip_hash text        not null,
  plan_id uuid,
  at      timestamptz not null default now()
);

create index if not exists booking_hits_ip_idx on public.booking_hits(ip_hash, at desc);

-- ─── Row level security ──────────────────────────────────────────────────────
alter table public.booking_profile enable row level security;
alter table public.booking_windows enable row level security;
alter table public.meeting_plans   enable row level security;
alter table public.bookings        enable row level security;
alter table public.booking_hits    enable row level security;

-- Owner-scoped, and gated on the calendar module: booking is the calendar's,
-- and a plan that has been withdrawn must not be readable either. The scalar
-- subquery is not decoration — a bare has_module() in a policy is re-evaluated
-- per row; wrapped, with arguments constant for the statement, Postgres hoists
-- it into an InitPlan and runs it once. See 20260022.
do $$
declare t text;
begin
  foreach t in array array['booking_profile', 'booking_windows', 'meeting_plans', 'bookings']
  loop
    -- %I, not %L: a policy name is an identifier ("x"), not a string ('x').
    execute format('drop policy if exists %I on public.%I', t || ': own rows', t);
    execute format(
      'create policy %I on public.%I for all '
      'using      (auth.uid() = user_id and (select public.has_module(auth.uid(), ''calendar''))) '
      'with check (auth.uid() = user_id and (select public.has_module(auth.uid(), ''calendar'')))',
      t || ': own rows', t);
  end loop;
end $$;

-- booking_hits gets no policy whatsoever. With RLS on, that means nobody
-- holding an anon key can read or write it — which is the whole point of a
-- rate-limit ledger.

-- ─── Rollback (hand-run; the runner never undoes anything) ───────────────────
-- drop table if exists public.booking_hits;
-- drop table if exists public.bookings;
-- drop table if exists public.meeting_plans;
-- drop table if exists public.booking_windows;
-- drop table if exists public.booking_profile;
-- delete from public.schema_migrations where name = '20260024_booking.sql';
