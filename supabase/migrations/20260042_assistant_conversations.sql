-- assistant_conversations / assistant_messages — the web assistant's chat, kept
-- on the server.
--
-- Until now the conversation lived in React state inside AssistantPanel and
-- nowhere else, so a reload — which iPad Safari does to any tab that was dimmed
-- for a while — lost it, and a second device never knew it existed. The server
-- is the source of truth from here on; the panel reads it on load and the URL
-- carries the conversation id.
--
-- **Plain text per message, plus the chip.** Like `telegram_turns`, tool_use and
-- tool_result blocks are deliberately not stored: they are stale the moment they
-- are written, they are most of the tokens, and the API requires a tool_use to
-- be followed immediately by its tool_result, which a truncated window cannot
-- promise. What the screen shows of a tool call — "Read habits", running / done
-- / failed — is a row of its own (`role = 'tool'`).
--
-- **Ordering is by `id`, not `created_at`.** Two rows inserted in one statement
-- share the transaction's now(), so a timestamp cannot tell the question from
-- its answer.
--
-- **`status` is what lets a reload resume.** An answer is written as
-- 'streaming' and updated as it grows, then 'complete' or 'error'. A reader that
-- finds the last row 'streaming' knows an answer is on its way (or died).
--
-- **`client_id` makes a retried insert harmless.** The panel already names every
-- bubble with crypto.randomUUID(); a flaky connection that sends the same
-- message twice lands on one row.
--
-- **Who may write.** A person reads, inserts, updates and deletes their own
-- conversations and messages (the web panel writes its own turns until the
-- server takes generation over); the service role, which bypasses RLS, writes
-- the assistant's. Nobody can touch another person's: every policy pins
-- `user_id = auth.uid()`, and a message may only be put in a conversation its
-- writer owns.
--
-- Safe to run more than once.

create table if not exists public.assistant_conversations (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  title       text,
  -- Which model family was answering, so a resume asks the same one.
  provider    text        check (provider in ('anthropic', 'groq')),
  -- "Close, and forget the conversation": hidden from the list, kept on the
  -- server. A person who wants it gone for good deletes the row.
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists assistant_conversations_user_idx
  on public.assistant_conversations (user_id, updated_at desc)
  where archived_at is null;

create table if not exists public.assistant_messages (
  id              bigserial   primary key,
  conversation_id uuid        not null references public.assistant_conversations(id) on delete cascade,
  -- Denormalised from the conversation: the policies and the Realtime filter
  -- both need it without a join.
  user_id         uuid        not null references auth.users(id) on delete cascade,
  client_id       uuid,
  role            text        not null check (role in ('user', 'assistant', 'tool', 'error')),
  content         text        not null default '',
  status          text        not null default 'complete' check (status in ('streaming', 'complete', 'error')),
  -- A chip: which tool, and how it ended. Null on every other role.
  tool            text,
  tool_state      text        check (tool_state in ('running', 'done', 'failed')),
  -- What was attached to a user message — name and kind only. The bytes are not
  -- kept; after a reload the bubble lists the files as chips.
  files           jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint assistant_messages_tool_has_a_name check (role <> 'tool' or tool is not null)
);

create index if not exists assistant_messages_thread_idx
  on public.assistant_messages (conversation_id, id);

-- One row per client-named bubble within a conversation.
create unique index if not exists assistant_messages_client_uniq
  on public.assistant_messages (conversation_id, client_id)
  where client_id is not null;

-- Keeps "most recently active" honest, and lets a list sort by it. A streaming
-- update counts: an answer arriving is activity.
create or replace function public.assistant_touch() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'assistant_messages' then
    update public.assistant_conversations set updated_at = now() where id = new.conversation_id;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists assistant_messages_touch on public.assistant_messages;
create trigger assistant_messages_touch
  before insert or update on public.assistant_messages
  for each row execute function public.assistant_touch();

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages      enable row level security;

drop policy if exists "assistant_conversations: own read" on public.assistant_conversations;
create policy "assistant_conversations: own read"
  on public.assistant_conversations for select using (auth.uid() = user_id);

drop policy if exists "assistant_conversations: own insert" on public.assistant_conversations;
create policy "assistant_conversations: own insert"
  on public.assistant_conversations for insert with check (auth.uid() = user_id);

drop policy if exists "assistant_conversations: own update" on public.assistant_conversations;
create policy "assistant_conversations: own update"
  on public.assistant_conversations for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "assistant_conversations: own delete" on public.assistant_conversations;
create policy "assistant_conversations: own delete"
  on public.assistant_conversations for delete using (auth.uid() = user_id);

drop policy if exists "assistant_messages: own read" on public.assistant_messages;
create policy "assistant_messages: own read"
  on public.assistant_messages for select using (auth.uid() = user_id);

-- The conversation must be the writer's own, or a message could be dropped into
-- somebody else's thread.
drop policy if exists "assistant_messages: own insert" on public.assistant_messages;
create policy "assistant_messages: own insert"
  on public.assistant_messages for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.assistant_conversations c
       where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "assistant_messages: own update" on public.assistant_messages;
create policy "assistant_messages: own update"
  on public.assistant_messages for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "assistant_messages: own delete" on public.assistant_messages;
create policy "assistant_messages: own delete"
  on public.assistant_messages for delete using (auth.uid() = user_id);

-- Realtime: a second device (or this one, back from the dark) hears an answer
-- being written instead of polling for it.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['assistant_conversations', 'assistant_messages']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
