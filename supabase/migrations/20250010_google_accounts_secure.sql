-- ─── Phase 1: Secure Google Calendar Integration ──────────────────────────────
-- Replaces: connected_google_accounts (tokens were readable by frontend RLS)
--
-- New design:
--   google_accounts       — metadata only (email, name, order). Safe to expose.
--   google_account_tokens — access + refresh tokens. NO SELECT for users ever.
--                           Only edge functions with service_role key read this.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── google_accounts ────────────────────────────────────────────────────────────
create table if not exists public.google_accounts (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users on delete cascade,
  email         text        not null,
  name          text,
  avatar_url    text,
  is_primary    boolean     not null default false,
  display_order int         not null default 0,
  connected_at  timestamptz not null default now(),
  unique (user_id, email)
);

alter table public.google_accounts enable row level security;

-- Users can see and manage their own account rows (metadata only — no tokens here)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'google_accounts'
      and policyname = 'google_accounts: own rows'
  ) then
    execute $policy$
      create policy "google_accounts: own rows"
        on public.google_accounts for all
        using  (auth.uid() = user_id)
        with check (auth.uid() = user_id)
    $policy$;
  end if;
end $$;

create index if not exists google_accounts_user_id_idx
  on public.google_accounts (user_id);

-- ── google_account_tokens ──────────────────────────────────────────────────────
-- SECURITY: NO SELECT policy for authenticated users.
-- Only the service_role key used inside edge functions can read this table.
-- access_token and refresh_token NEVER reach the browser.
create table if not exists public.google_account_tokens (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users on delete cascade,
  account_id    uuid        not null references public.google_accounts on delete cascade,
  access_token  text        not null,
  refresh_token text        not null,
  expires_at    timestamptz not null,
  scopes        text[],
  updated_at    timestamptz not null default now(),
  unique (account_id)
);

alter table public.google_account_tokens enable row level security;

-- INSERT/UPDATE allowed (edge functions write via service_role; App writes on connect)
-- SELECT deliberately omitted — frontend can never read tokens
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'google_account_tokens'
      and policyname = 'google_account_tokens: insert own'
  ) then
    execute $policy$
      create policy "google_account_tokens: insert own"
        on public.google_account_tokens for insert
        with check (auth.uid() = user_id)
    $policy$;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'google_account_tokens'
      and policyname = 'google_account_tokens: update own'
  ) then
    execute $policy$
      create policy "google_account_tokens: update own"
        on public.google_account_tokens for update
        using (auth.uid() = user_id)
    $policy$;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'google_account_tokens'
      and policyname = 'google_account_tokens: delete own'
  ) then
    execute $policy$
      create policy "google_account_tokens: delete own"
        on public.google_account_tokens for delete
        using (auth.uid() = user_id)
    $policy$;
  end if;
end $$;

-- No SELECT policy — intentional. Service role bypasses RLS entirely.

create index if not exists google_account_tokens_account_id_idx
  on public.google_account_tokens (account_id);

create index if not exists google_account_tokens_user_id_idx
  on public.google_account_tokens (user_id);
