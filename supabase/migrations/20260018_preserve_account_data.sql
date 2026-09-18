-- ─── Preserve data when a Google account is removed ───────────────────────────
-- Problem: google_event_metadata and google_calendar_settings used
--   ON DELETE CASCADE, so removing a connected account wiped:
--     • done/cancelled status for every calendar event
--     • AI prep notes
--     • per-calendar display preferences (colour, visibility, sort order)
--
-- Fix:
--   1. Make account_id nullable on both tables (SET NULL instead of CASCADE).
--      Rows survive account removal; account_id becomes NULL.
--   2. Add account_email to google_event_metadata so rows can be relinked
--      when the same email is reconnected (new google_accounts UUID, same email).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── google_event_metadata ─────────────────────────────────────────────────────

-- 1. Add account_email (backfilled from google_accounts where still present)
alter table public.google_event_metadata
  add column if not exists account_email text;

update public.google_event_metadata m
set account_email = a.email
from public.google_accounts a
where m.account_id = a.id
  and m.account_email is null;

-- 2. Drop the CASCADE FK and replace with nullable SET NULL
alter table public.google_event_metadata
  drop constraint if exists google_event_metadata_account_id_fkey;

alter table public.google_event_metadata
  alter column account_id drop not null;

alter table public.google_event_metadata
  add constraint google_event_metadata_account_id_fkey
    foreign key (account_id)
    references public.google_accounts (id)
    on delete set null;

create index if not exists google_event_metadata_account_email_idx
  on public.google_event_metadata (account_email);

-- ── google_calendar_settings ──────────────────────────────────────────────────

-- 1. Add account_email (backfilled from google_accounts where still present)
alter table public.google_calendar_settings
  add column if not exists account_email text;

update public.google_calendar_settings s
set account_email = a.email
from public.google_accounts a
where s.account_id = a.id
  and s.account_email is null;

-- 2. Drop the CASCADE FK and replace with nullable SET NULL
alter table public.google_calendar_settings
  drop constraint if exists google_calendar_settings_account_id_fkey;

alter table public.google_calendar_settings
  alter column account_id drop not null;

alter table public.google_calendar_settings
  add constraint google_calendar_settings_account_id_fkey
    foreign key (account_id)
    references public.google_accounts (id)
    on delete set null;

create index if not exists google_calendar_settings_account_email_idx
  on public.google_calendar_settings (account_email);
