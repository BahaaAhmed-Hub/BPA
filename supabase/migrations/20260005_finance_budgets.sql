-- The finance store has carried a `budgets` array with upsert and remove since
-- it was written, but there has never been a table behind it — so a budget was
-- only ever real in the browser that created it. Bills and goals had the
-- opposite problem: the tables landed in 20260001 and nothing was ever written
-- to them (see 20260005's companion change in financeDb.ts).
--
-- Safe to run more than once.

create table if not exists public.finance_budgets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  category_id    uuid not null references public.finance_categories(id) on delete cascade,
  monthly_amount numeric not null default 0,
  currency       text not null default 'EGP',
  start_date     text not null,        -- 'YYYY-MM'
  end_date       text,                 -- 'YYYY-MM'; null means it never ends
  rollover       boolean not null default false,
  created_at     timestamptz not null default now()
);

alter table public.finance_budgets enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'finance_budgets'
       and policyname = 'finance_budgets: own rows'
  ) then
    create policy "finance_budgets: own rows"
      on public.finance_budgets for all
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- Bring the three into live sync alongside the rest of finance, on the same
-- terms as 20260004: the whole old row has to replicate or a delete carries
-- only its primary key and never matches the client's user_id filter.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array['finance_bills', 'finance_goals', 'finance_budgets']
  loop
    if not exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = t
    ) then
      continue;
    end if;

    execute format('alter table public.%I replica identity full', t);

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Verify: expect three rows.
select tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public'
   and tablename in ('finance_bills', 'finance_goals', 'finance_budgets')
 order by tablename;
