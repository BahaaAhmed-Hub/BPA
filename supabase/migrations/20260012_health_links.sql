-- Apple Health, the only way it can reach a web app.
--
-- HealthKit is a native iOS framework: no web API, no OAuth, nothing a browser
-- can call. What Apple does give is Shortcuts — on the phone, a Shortcut can
-- read a health sample and POST it anywhere, and an Automation can run it every
-- morning without being opened. So the phone pushes and this receives.
--
-- A link is one habit, one metric and one secret token. The Shortcut posts the
-- number to /functions/v1/health-ingest?token=…, and the function writes it as
-- that day's quantity for that habit. Per-habit tokens mean deleting a link
-- revokes exactly one thing, and the token is the only credential involved —
-- there is no way to ask it for anything else.

create table if not exists public.health_links (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  -- The habit this feeds. Text rather than a foreign key: a habit that exists
  -- only in the browser can still be linked, and the ingest fails loudly on the
  -- habit_logs foreign key rather than refusing the link months earlier.
  habit_id     text not null,
  metric       text not null check (metric in ('steps','distance_km','active_minutes','workout_minutes')),
  token        text not null unique,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.health_links enable row level security;

-- The owner can see and manage their own links. The ingest function runs with
-- the service role and looks a link up by token, which is why the token has to
-- be long and random rather than guessable.
drop policy if exists "health_links: own rows only" on public.health_links;
drop policy if exists "health_links: own rows only" on public.health_links;
create policy "health_links: own rows only"
  on public.health_links for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists health_links_user_idx  on public.health_links (user_id);
create index if not exists health_links_token_idx on public.health_links (token);

-- The quantity column the ingest writes into. Already added by 20260004 for
-- most installs; asserted here so this migration stands on its own.
alter table public.habit_logs add column if not exists quantity numeric;

notify pgrst, 'reload schema';
