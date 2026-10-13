-- ─── Library 4d — a plan's time on the calendar ──────────────────────────────
-- A plan with a time budget can put one repeating block on the primary Google
-- calendar. The plan remembers three things about it and nothing more:
--   block_at        the time of day it starts, 'HH:MM' (the reader's wall clock)
--   block_event_id  the Google event that is the block — the only handle to it,
--                   so losing it would orphan the event for good
--   block_sig       what the block was built from, so the card can tell the
--                   plan has moved on since without asking Google
-- Safe to run more than once.
alter table public.library_plans add column if not exists block_at       text;
alter table public.library_plans add column if not exists block_event_id text;
alter table public.library_plans add column if not exists block_sig      text;

alter table public.library_plans drop constraint if exists library_plans_block_at_fmt;
alter table public.library_plans add constraint library_plans_block_at_fmt
  check (block_at is null or block_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
