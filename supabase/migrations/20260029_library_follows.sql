-- ─── Library 3d — authors and series you follow ──────────────────────────────
-- A follow is a saved question for Open Library plus the set of works that
-- existed when you asked. "New" is whatever the question returns now that is
-- not in `seen_keys` — so following an author with forty books does not announce
-- forty books, and "mark seen" simply widens the set.
--
--   author  query = author_key:OL23919A          author_key = OL23919A
--   series  query = title:"Name" [AND author_key:…]   (matched by name — a
--           catalogue has no reliable series field, so the screen says so)
--
-- Same gate as the rest of the Library: ownership AND has_module(…, 'library'),
-- the module call wrapped in (select …) so it runs once per statement.
-- Safe to run more than once.
create table if not exists public.library_follows (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('author','series')),
  name       text not null,
  query      text not null,
  author_key text,
  seen_keys  text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists library_follows_user_idx on public.library_follows (user_id, created_at);

alter table public.library_follows enable row level security;
drop policy if exists "library_follows: own rows" on public.library_follows;
create policy "library_follows: own rows"
  on public.library_follows for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')));

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  alter table public.library_follows replica identity full;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'library_follows'
  ) then
    alter publication supabase_realtime add table public.library_follows;
  end if;
end $$;
