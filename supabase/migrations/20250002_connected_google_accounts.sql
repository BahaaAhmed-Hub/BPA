-- ─── connected_google_accounts ────────────────────────────────────────────────
-- Stores Google OAuth refresh tokens server-side so the Edge Function can
-- exchange them for fresh access tokens. This eliminates the 60-min token
-- expiry problem that previously caused Cal Intel to lose events silently.
--
-- google_refresh_token: Google's long-lived offline refresh token.
--   Populated from session.provider_refresh_token at OAuth sign-in time.
--   Only the Edge Function (service role) ever reads this column.

create table if not exists public.connected_google_accounts (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null references auth.users on delete cascade,
  email                text        not null,
  name                 text,
  avatar_url           text,
  google_refresh_token text,
  scopes               text[],
  is_primary           boolean     not null default false,
  connected_at         timestamptz not null default now(),
  unique (user_id, email)
);

alter table public.connected_google_accounts enable row level security;

-- Users can read their own rows (needed for account list in Settings).
-- The google_refresh_token column is intentionally readable only via the
-- service-role Edge Function — the anon/authenticated role only gets metadata.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'connected_google_accounts'
      and policyname = 'connected_google_accounts: own rows only'
  ) then
    execute $policy$
      create policy "connected_google_accounts: own rows only"
        on public.connected_google_accounts for all
        using  (auth.uid() = user_id)
        with check (auth.uid() = user_id)
    $policy$;
  end if;
end $$;

create index if not exists connected_google_accounts_user_id_idx
  on public.connected_google_accounts (user_id);
