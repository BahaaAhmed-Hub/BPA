-- ─── Library 7e — new releases, found while the app is closed ────────────────
-- A follow (20260029) is a saved Open Library question plus the works that
-- existed when it was asked. The check used to run only when the Following view
-- was open. A scheduled function now asks the same question for everyone and
-- writes what it finds here, so the answer is waiting when the app is opened.
--
-- `library_follow_news` is a *record of announcements*, never the baseline:
-- `seen_keys` on the follow stays the only thing that decides what is new, and
-- "Mark all seen" still just widens it. A news row goes when its book reaches
-- the shelf, is marked seen, or the follow is removed (cascade).
--
-- Same gate as the rest of the Library: ownership AND has_module(…, 'library'),
-- the module call wrapped in (select …) so it runs once per statement. The
-- function writes with the service role, which bypasses RLS by design.
-- Safe to run more than once.
alter table public.library_follows add column if not exists last_checked_at timestamptz;
alter table public.library_follows add column if not exists last_check_ok   boolean;

create table if not exists public.library_follow_news (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  follow_id      uuid not null references public.library_follows(id) on delete cascade,
  work_key       text not null,
  title          text not null,
  authors        text[] not null default '{}',
  isbn           text,
  published_year int,
  cover_url      text,
  found_at       timestamptz not null default now(),
  read_at        timestamptz,
  unique (follow_id, work_key)
);
create index if not exists library_follow_news_user_idx on public.library_follow_news (user_id, found_at desc);

alter table public.library_follow_news enable row level security;
drop policy if exists "library_follow_news: own rows" on public.library_follow_news;
create policy "library_follow_news: own rows"
  on public.library_follow_news for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')));

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  alter table public.library_follow_news replica identity full;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'library_follow_news'
  ) then
    alter publication supabase_realtime add table public.library_follow_news;
  end if;
end $$;
