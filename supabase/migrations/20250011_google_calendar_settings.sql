-- ─── Phase 2: Calendar Settings ───────────────────────────────────────────────
-- Stores per-calendar display preferences (visibility, color, name, sort order).
-- Replaces localStorage keys: cal-intel-cals-cache, cal-intel-hidden-*, etc.
--
-- Design:
--   One row per (user, calendar_id). The calendar_id is Google's opaque
--   calendar identifier (e.g. "user@gmail.com" or the long __@group.calendar.google.com form).
--   account_id references google_accounts for cascade cleanup when an account is removed.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.google_calendar_settings (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users on delete cascade,
  account_id     uuid        not null references public.google_accounts on delete cascade,
  calendar_id    text        not null,
  is_visible     boolean     not null default true,
  custom_color   text,                        -- hex override, null = use Google's color
  display_name   text,                        -- user-renamed label, null = use Google summary
  sort_order     int         not null default 0,
  updated_at     timestamptz not null default now(),
  unique (user_id, calendar_id)
);

alter table public.google_calendar_settings enable row level security;

-- Users can read and manage only their own calendar settings rows.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'google_calendar_settings'
      and policyname = 'google_calendar_settings: own rows'
  ) then
    execute $policy$
      create policy "google_calendar_settings: own rows"
        on public.google_calendar_settings for all
        using  (auth.uid() = user_id)
        with check (auth.uid() = user_id)
    $policy$;
  end if;
end $$;

-- Auto-update updated_at on every write.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'google_calendar_settings_updated_at'
  ) then
    create trigger google_calendar_settings_updated_at
      before update on public.google_calendar_settings
      for each row execute function public.set_updated_at();
  end if;
end $$;

create index if not exists google_calendar_settings_user_id_idx
  on public.google_calendar_settings (user_id);

create index if not exists google_calendar_settings_account_id_idx
  on public.google_calendar_settings (account_id);
