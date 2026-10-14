-- assistant_pending_actions — an act the Telegram bot or Siri has been asked to
-- do and is waiting for a person to approve.
--
-- The app's assistant asks with a card; the bots cannot hold a card open
-- between two HTTP requests, so the request is parked here and the person's
-- "Approve" (a Telegram button) or spoken "yes" (Siri) takes it out again.
--
-- **Single use.** The act is taken with `delete … returning`, so two taps, a
-- retried webhook or a repeated "yes" can run it once, never twice.
-- **Short-lived.** `expires_at` is checked on the way out: a "yes" a day later
-- must not send an email nobody remembers.
-- **Service role only.** RLS is on and there is deliberately no policy: nobody
-- holding an anon or user key can read what is pending or plant an act in it.
-- The bots write and read with the service role.

create table if not exists public.assistant_pending_actions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  channel    text        not null check (channel in ('telegram', 'siri')),
  chat_id    text,
  tool       text        not null,
  input      jsonb       not null default '{}'::jsonb,
  summary    text        not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);

create index if not exists assistant_pending_user_idx on public.assistant_pending_actions (user_id, channel, created_at desc);

alter table public.assistant_pending_actions enable row level security;
