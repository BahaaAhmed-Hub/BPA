-- telegram_turns — what was said in a chat, so the bot can follow a conversation
--
-- A Telegram webhook is one HTTP request per message and nothing carries over
-- between them, so every message reached the model on its own. The system
-- prompt already told it how to read "that habit" / "mark it done" against the
-- conversation — about a conversation it was never given. This table is that
-- conversation.
--
-- Only the plain text of each side is kept. Tool calls and their results are
-- deliberately NOT stored: they are stale the moment they are written (a count
-- from yesterday is not today's), they are most of the tokens, and the API
-- requires a tool_use block to be followed immediately by its tool_result —
-- which a truncated window cannot promise.
--
-- Ordering is by `id`, not `created_at`: two rows inserted in one statement
-- share the transaction's now(), so a timestamp cannot tell the question from
-- its answer. `created_at` is only used to age a window out.

create table if not exists public.telegram_turns (
  id         bigserial   primary key,
  chat_id    text        not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  role       text        not null check (role in ('user', 'assistant')),
  content    text        not null,
  created_at timestamptz not null default now()
);

create index if not exists telegram_turns_chat_idx on public.telegram_turns(chat_id, id desc);
create index if not exists telegram_turns_user_idx on public.telegram_turns(user_id);

alter table public.telegram_turns enable row level security;

-- The bot writes with the service role, which bypasses RLS. A person may read
-- and delete their own chat and nothing else: there is no insert or update
-- policy at all, so nobody holding an anon key can put words in their own
-- history or edit what was said.
drop policy if exists "telegram_turns: own read" on public.telegram_turns;
create policy "telegram_turns: own read"
  on public.telegram_turns for select
  using (auth.uid() = user_id);

drop policy if exists "telegram_turns: own delete" on public.telegram_turns;
create policy "telegram_turns: own delete"
  on public.telegram_turns for delete
  using (auth.uid() = user_id);
