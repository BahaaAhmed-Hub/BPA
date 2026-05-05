-- ─── Phase 3: Event Metadata ──────────────────────────────────────────────────
-- Stores user-defined per-event overrides: done/cancelled status, AI prep notes.
-- Replaces localStorage keys: cal-event-statuses, cal-event-prep-*, etc.
--
-- Design:
--   One row per (user, event_id). event_id is Google's opaque event ID.
--   calendar_id stored for context and future queries; no FK to avoid coupling
--   to a Google-side construct that can be deleted without our knowledge.
--   account_id references google_accounts for cascade cleanup.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.google_event_metadata (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users on delete cascade,
  account_id    uuid        not null references public.google_accounts on delete cascade,
  event_id      text        not null,   -- Google Calendar event ID
  calendar_id   text        not null,   -- Google Calendar ID that owns the event
  status        text,                   -- 'done' | 'cancelled' | null (normal)
  prep_notes    text,                   -- AI-generated prep text
  prep_error    text,                   -- last prep error message, if any
  prep_at       timestamptz,            -- when prep was last generated
  updated_at    timestamptz not null default now(),
  unique (user_id, event_id)
);

alter table public.google_event_metadata enable row level security;

-- Users can read and manage only their own event metadata rows.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'google_event_metadata'
      and policyname = 'google_event_metadata: own rows'
  ) then
    execute $policy$
      create policy "google_event_metadata: own rows"
        on public.google_event_metadata for all
        using  (auth.uid() = user_id)
        with check (auth.uid() = user_id)
    $policy$;
  end if;
end $$;

-- Reuse the set_updated_at() function created in 20250011.
do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'google_event_metadata_updated_at'
  ) then
    create trigger google_event_metadata_updated_at
      before update on public.google_event_metadata
      for each row execute function public.set_updated_at();
  end if;
end $$;

create index if not exists google_event_metadata_user_id_idx
  on public.google_event_metadata (user_id);

create index if not exists google_event_metadata_account_id_idx
  on public.google_event_metadata (account_id);

-- Composite index for fast lookup by calendar (e.g. fetch all metadata for a calendar)
create index if not exists google_event_metadata_user_cal_idx
  on public.google_event_metadata (user_id, calendar_id);
