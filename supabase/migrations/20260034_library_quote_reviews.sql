-- ─── Library 7b — spaced review of quotes ────────────────────────────────────
-- One row per quote that has been reviewed at least once; no row means "new".
-- Everything shown on screen (what is due, how many are new today, the next date)
-- is derived from these few columns — nothing here is a count.
--   due_on         the day it is next asked (the reader's calendar day)
--   interval_days  how long the last gap was
--   ease           how much the gap grows each time you get it right (1.3 – 3.0)
--   reps           right answers in a row since the last lapse
--   lapses         times it was forgotten after being known
--   first_on       the day it was first reviewed — what "new today" is counted from
--   last_on        the day it was last reviewed
-- Same gate as the rest of the Library. Safe to run more than once.
create table if not exists public.library_quote_reviews (
  quote_id      uuid primary key references public.library_quotes(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  due_on        date not null,
  interval_days int  not null check (interval_days between 0 and 3650),
  ease          real not null check (ease between 1.3 and 3.0),
  reps          int  not null check (reps >= 0),
  lapses        int  not null default 0 check (lapses >= 0),
  first_on      date not null,
  last_on       date not null
);
create index if not exists library_quote_reviews_due_idx on public.library_quote_reviews (user_id, due_on);

alter table public.library_quote_reviews enable row level security;
drop policy if exists "library_quote_reviews: own rows" on public.library_quote_reviews;
create policy "library_quote_reviews: own rows"
  on public.library_quote_reviews for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')));

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  alter table public.library_quote_reviews replica identity full;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'library_quote_reviews'
  ) then
    alter publication supabase_realtime add table public.library_quote_reviews;
  end if;
end $$;
