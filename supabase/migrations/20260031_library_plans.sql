-- ─── Library 4c — reading plans ──────────────────────────────────────────────
-- One plan per book: a day to finish by, a time you mean to give it, or both.
-- Everything a plan *says* (pages a day, whether you are on track, the date you
-- are heading for) is derived from the session log, never stored here, so there
-- is no second copy to drift from what you actually read.
--
-- Same gate as the rest of the Library. Safe to run more than once.
create table if not exists public.library_plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  book_id    uuid not null references public.library_books(id) on delete cascade,
  finish_by  date,
  minutes    int  check (minutes is null or minutes between 1 and 1440),
  per        text not null default 'day' check (per in ('day','week')),
  created_at timestamptz not null default now(),
  constraint library_plans_something check (finish_by is not null or minutes is not null),
  constraint library_plans_one_per_book unique (book_id)
);
create index if not exists library_plans_user_idx on public.library_plans (user_id);

alter table public.library_plans enable row level security;
drop policy if exists "library_plans: own rows" on public.library_plans;
create policy "library_plans: own rows"
  on public.library_plans for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')));

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  alter table public.library_plans replica identity full;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'library_plans'
  ) then
    alter publication supabase_realtime add table public.library_plans;
  end if;
end $$;
