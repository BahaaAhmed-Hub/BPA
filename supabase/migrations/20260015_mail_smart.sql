-- The smart mail view's memory.
--
-- The view runs every time the tab is opened. Doing the whole job each time
-- would mean re-reading thirty days of mail and re-asking the model about every
-- thread in it — the two most expensive things the app can do, repeated for an
-- answer that has not changed. So each thread's reading is kept, and the next
-- run only does the work the last one could not have done.
--
-- Two things are stored, and the split matters:
--
--   mail_smart_threads  one row per thread, carrying what was decided about it
--                       and — the load-bearing column — `last_message_id`. A
--                       thread whose newest message is the one already read is
--                       finished: no fetch, no model call, the stored row is
--                       the answer. A new message changes that id and only that
--                       thread is looked at again.
--
--   mail_smart_sync     one row per mailbox, holding how far it has been read.
--                       The next pass asks Gmail for `after:<watermark>` rather
--                       than for the last thirty days, so reopening the tab
--                       costs one small query per mailbox instead of a sweep.
--
-- It is on the server rather than in localStorage because the answer is about
-- your mail, not about this browser: the laptop should not re-analyse what the
-- iPad read an hour ago, and clearing site data should not buy the whole thirty
-- days again.

create table if not exists public.mail_smart_threads (
  user_id         uuid not null references auth.users on delete cascade,
  -- Which mailbox it was read in. A thread reaching two of your accounts is two
  -- rows, because the sections it lands in can honestly differ: addressed to
  -- one address and copied on the other.
  account_email   text not null,
  thread_id       text not null,

  -- The cache key. Same id → the stored reading still stands.
  last_message_id text not null,
  last_at         timestamptz not null,

  subject         text,
  from_name       text,
  from_email      text,

  section         text not null check (section in ('action','radar','fyi')),
  reply_state     text not null check (reply_state in ('replied','pending','none')),

  -- What the model made of it. Null where no model was configured or the call
  -- failed: the row is still useful, it just has no sentence on it.
  need            text,
  draft           text,
  -- The model's read of "a deliverable is attributed to you here".
  direct          boolean not null default false,

  addressed_to      boolean not null default false,
  named_in_body     boolean not null default false,
  bottleneck        boolean not null default false,
  awaiting_customer boolean not null default false,

  -- Set when you have dealt with it here, so a thread you have answered or
  -- turned into a task stops appearing in the action list even before the
  -- reply lands in Gmail.
  handled_at      timestamptz,

  analyzed_at     timestamptz not null default now(),

  primary key (user_id, account_email, thread_id)
);

alter table public.mail_smart_threads enable row level security;

drop policy if exists "mail_smart_threads: own rows only" on public.mail_smart_threads;
create policy "mail_smart_threads: own rows only"
  on public.mail_smart_threads for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists mail_smart_threads_user_idx
  on public.mail_smart_threads (user_id, account_email, last_at desc);

create table if not exists public.mail_smart_sync (
  user_id       uuid not null references auth.users on delete cascade,
  account_email text not null,
  -- Everything up to here has been read. The first run leaves this null and the
  -- pass reaches back thirty days instead.
  synced_to     timestamptz,
  last_run_at   timestamptz not null default now(),
  primary key (user_id, account_email)
);

alter table public.mail_smart_sync enable row level security;

drop policy if exists "mail_smart_sync: own rows only" on public.mail_smart_sync;
create policy "mail_smart_sync: own rows only"
  on public.mail_smart_sync for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
