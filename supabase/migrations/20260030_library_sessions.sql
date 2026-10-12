-- ─── Library 4a — reading and listening sessions ─────────────────────────────
-- One row per sitting: how long, which day, and (for reading) the page you had
-- reached. Progress is *derived* from these — the highest `to_page` — rather
-- than stored on the book, so there is no second copy to disagree with the log
-- and deleting a mistaken session puts the progress back by itself.
--
-- Same gate as the rest of the Library. Safe to run more than once.
create table if not exists public.library_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  book_id    uuid not null references public.library_books(id) on delete cascade,
  kind       text not null default 'read' check (kind in ('read','listen')),
  on_date    date not null,
  minutes    int  not null check (minutes between 1 and 1440),
  pages      int  check (pages is null or pages >= 0),
  to_page    int  check (to_page is null or to_page >= 0),
  created_at timestamptz not null default now()
);
create index if not exists library_sessions_user_idx on public.library_sessions (user_id, on_date desc);
create index if not exists library_sessions_book_idx on public.library_sessions (book_id);

alter table public.library_sessions enable row level security;
drop policy if exists "library_sessions: own rows" on public.library_sessions;
create policy "library_sessions: own rows"
  on public.library_sessions for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')));

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  alter table public.library_sessions replica identity full;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'library_sessions'
  ) then
    alter publication supabase_realtime add table public.library_sessions;
  end if;
end $$;
