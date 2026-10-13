-- ─── Library 4e — yearly reading goals and challenges ────────────────────────
-- A goal is a target for a calendar year: books finished, pages read or minutes
-- spent. A *challenge* is the same goal narrowed to one list or category
-- ("6 books from my classics list in 2026") — `list_id` is the only difference,
-- so there is one table and one set of controls, not two.
-- Progress is never stored: it is counted from finished books and the session
-- log, so a corrected finish date or a deleted session moves the bar by itself.
-- Same gate as the rest of the Library. Safe to run more than once.
create table if not exists public.library_goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  year       int  not null check (year between 2000 and 2200),
  kind       text not null check (kind in ('books','pages','minutes')),
  target     int  not null check (target between 1 and 1000000),
  list_id    uuid references public.library_lists(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- One goal per (year, kind, scope). A null list_id is "everything", and a plain unique
-- would treat two nulls as different, so the scope is coalesced to a fixed uuid.
create unique index if not exists library_goals_scope_uq
  on public.library_goals (user_id, year, kind, coalesce(list_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists library_goals_user_idx on public.library_goals (user_id, year);

alter table public.library_goals enable row level security;
drop policy if exists "library_goals: own rows" on public.library_goals;
create policy "library_goals: own rows"
  on public.library_goals for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')));

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  alter table public.library_goals replica identity full;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'library_goals'
  ) then
    alter publication supabase_realtime add table public.library_goals;
  end if;
end $$;
