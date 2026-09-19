-- Stores the last N message pairs per Telegram chat so the agent remembers context
-- across separate messages. Stored as a JSON array of {role, content} objects.
-- Safe to run more than once.
alter table public.telegram_links
  add column if not exists context jsonb not null default '[]'::jsonb;
