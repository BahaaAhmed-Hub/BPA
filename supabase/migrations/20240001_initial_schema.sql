-- ============================================================
-- BPA – Initial Schema
-- Run this in the Supabase SQL editor (or via supabase db push)
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── users ───────────────────────────────────────────────────
create table if not exists public.users (
  id                uuid        primary key references auth.users on delete cascade,
  email             text        not null,
  full_name         text,
  avatar_url        text,
  active_framework  text        not null default 'time_blocking',
  schedule_rules    jsonb       not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

alter table public.users enable row level security;

drop policy if exists "users: own row only" on public.users;
create policy "users: own row only"
  on public.users for all
  using  (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create profile on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── companies ───────────────────────────────────────────────
create table if not exists public.companies (
  id          uuid    primary key default gen_random_uuid(),
  user_id     uuid    not null references public.users on delete cascade,
  name        text    not null,
  color_tag   text,
  calendar_id text,
  is_active   boolean not null default true
);

alter table public.companies enable row level security;

drop policy if exists "companies: own rows only" on public.companies;
create policy "companies: own rows only"
  on public.companies for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists companies_user_id_idx on public.companies (user_id);

-- ─── tasks ───────────────────────────────────────────────────
create table if not exists public.tasks (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.users on delete cascade,
  company_id      uuid        references public.companies on delete set null,
  title           text        not null,
  description     text,
  quadrant        text        check (quadrant in (
                                'urgent_important',
                                'important_not_urgent',
                                'urgent_not_important',
                                'neither'
                              )),
  effort_minutes  int,
  due_date        date,
  status          text        not null default 'todo'
                              check (status in ('todo','in_progress','done','deferred')),
  delegated_to    text,
  done_looks_like text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

alter table public.tasks enable row level security;

drop policy if exists "tasks: own rows only" on public.tasks;
create policy "tasks: own rows only"
  on public.tasks for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists tasks_user_id_idx      on public.tasks (user_id);
create index if not exists tasks_company_id_idx   on public.tasks (company_id);
create index if not exists tasks_status_idx       on public.tasks (status);

-- ─── habits ──────────────────────────────────────────────────
create table if not exists public.habits (
  id              uuid    primary key default gen_random_uuid(),
  user_id         uuid    not null references public.users on delete cascade,
  name            text    not null,
  frequency       text    not null check (frequency in ('daily','weekdays','weekly')),
  current_streak  int     not null default 0,
  longest_streak  int     not null default 0,
  is_active       boolean not null default true
);

alter table public.habits enable row level security;

drop policy if exists "habits: own rows only" on public.habits;
create policy "habits: own rows only"
  on public.habits for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists habits_user_id_idx on public.habits (user_id);

-- ─── habit_logs ──────────────────────────────────────────────
create table if not exists public.habit_logs (
  id        uuid    primary key default gen_random_uuid(),
  habit_id  uuid    not null references public.habits on delete cascade,
  user_id   uuid    not null references public.users on delete cascade,
  date      date    not null,
  completed boolean not null default false,
  unique (habit_id, date)
);

alter table public.habit_logs enable row level security;

drop policy if exists "habit_logs: own rows only" on public.habit_logs;
create policy "habit_logs: own rows only"
  on public.habit_logs for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists habit_logs_user_id_idx  on public.habit_logs (user_id);
create index if not exists habit_logs_habit_id_idx on public.habit_logs (habit_id);

-- ─── energy_logs ─────────────────────────────────────────────
create table if not exists public.energy_logs (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references public.users on delete cascade,
  date              date        not null,
  morning_level     int         check (morning_level between 1 and 5),
  afternoon_level   int         check (afternoon_level between 1 and 5),
  notes             text,
  unique (user_id, date)
);

alter table public.energy_logs enable row level security;

drop policy if exists "energy_logs: own rows only" on public.energy_logs;
create policy "energy_logs: own rows only"
  on public.energy_logs for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists energy_logs_user_id_idx on public.energy_logs (user_id);

-- ─── calendar_events ─────────────────────────────────────────
create table if not exists public.calendar_events (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references public.users on delete cascade,
  company_id       uuid        references public.companies on delete set null,
  google_event_id  text        unique,
  title            text        not null,
  start_time       timestamptz not null,
  end_time         timestamptz not null,
  location         text,
  meeting_type     text,
  prep_notes       text,
  is_synced        boolean     not null default false
);

alter table public.calendar_events enable row level security;

drop policy if exists "calendar_events: own rows only" on public.calendar_events;
create policy "calendar_events: own rows only"
  on public.calendar_events for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists calendar_events_user_id_idx    on public.calendar_events (user_id);
create index if not exists calendar_events_start_time_idx on public.calendar_events (start_time);

-- ─── email_actions ───────────────────────────────────────────
create table if not exists public.email_actions (
  id               uuid  primary key default gen_random_uuid(),
  user_id          uuid  not null references public.users on delete cascade,
  gmail_id         text,
  subject          text,
  from_email       text,
  classification   text  check (classification in ('decision','fyi','waiting','delegate')),
  suggested_reply  text,
  status           text,
  follow_up_date   date
);

alter table public.email_actions enable row level security;

drop policy if exists "email_actions: own rows only" on public.email_actions;
create policy "email_actions: own rows only"
  on public.email_actions for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists email_actions_user_id_idx on public.email_actions (user_id);

-- ─── weekly_reviews ──────────────────────────────────────────
create table if not exists public.weekly_reviews (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references public.users on delete cascade,
  week_of           date        not null,
  shipped_count     int,
  slipped_count     int,
  focus_hours       numeric,
  meeting_hours     numeric,
  professor_insight text,
  created_at        timestamptz not null default now(),
  unique (user_id, week_of)
);

alter table public.weekly_reviews enable row level security;

drop policy if exists "weekly_reviews: own rows only" on public.weekly_reviews;
create policy "weekly_reviews: own rows only"
  on public.weekly_reviews for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists weekly_reviews_user_id_idx on public.weekly_reviews (user_id);
