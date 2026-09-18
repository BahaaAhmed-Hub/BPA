-- ─── Personal access tokens for external integrations ────────────────────────
-- Lets the MCP server, Telegram bot, and Siri Shortcuts authenticate as a user
-- without needing a Supabase JWT (which expires in 1h and lives in the browser).
--
-- A token starts with `prof_sk_` and is stored plaintext (RLS means only the
-- owner's own session can SELECT it; the MCP server uses the service role and
-- looks up by value with the token index).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.user_tokens (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  token        text        not null unique,
  label        text        not null default 'My token',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked      boolean     not null default false
);

alter table public.user_tokens enable row level security;

drop policy if exists "Users manage own tokens" on public.user_tokens;
create policy "Users manage own tokens"
  on public.user_tokens
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Fast lookup by token value (used by the MCP edge function with service role)
create index if not exists user_tokens_token_idx
  on public.user_tokens (token)
  where not revoked;

create index if not exists user_tokens_user_idx
  on public.user_tokens (user_id);
