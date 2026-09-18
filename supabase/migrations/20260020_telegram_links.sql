-- telegram_links — maps a Telegram chat_id to a Professor user + token
--
-- When a user sends /connect prof_sk_... to the bot, a row is written here.
-- The bot looks up this row on every incoming message to find the user_id.

create table if not exists public.telegram_links (
  chat_id    text        primary key,            -- Telegram chat id (string to avoid bigint issues)
  user_id    uuid        not null references auth.users(id) on delete cascade,
  token      text        not null,               -- the prof_sk_* token used to link
  linked_at  timestamptz not null default now()
);

create index if not exists telegram_links_user_id_idx on public.telegram_links(user_id);

alter table public.telegram_links enable row level security;

-- Users can read and delete their own links (for Settings UI)
drop policy if exists "telegram_links: own read" on public.telegram_links;
create policy "telegram_links: own read"
  on public.telegram_links for select
  using (auth.uid() = user_id);

drop policy if exists "telegram_links: own delete" on public.telegram_links;
create policy "telegram_links: own delete"
  on public.telegram_links for delete
  using (auth.uid() = user_id);
