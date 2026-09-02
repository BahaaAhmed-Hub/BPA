-- Two open devices had no way to hear about each other. Everything is read
-- once at sign-in and never again, so a habit ticked on the laptop, a task
-- moved on the iPad or a transaction added on either simply did not exist on
-- the other until someone reloaded.
--
-- The app can fall back to polling, and does, but that is a request every 45
-- seconds and a change nobody sees for up to that long. This publishes the
-- tables it cares about so Postgres pushes the change instead, which arrives
-- in about a second and lets the poll drop to once every five minutes.
--
-- Safe to run more than once.

-- How much, on a day a counter habit was logged. This was the last piece of a
-- habit still living only in the browser: mirrored between devices every five
-- minutes and never read back after start-up, so "4 of 8 glasses" entered on
-- one device was not a fact the other could learn while it was open.
alter table public.habit_logs add column if not exists quantity numeric;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'habits', 'habit_logs', 'tasks',
    'finance_accounts', 'finance_categories', 'finance_transactions',
    'finance_plans', 'finance_actuals_override', 'finance_cell_comments'
  ]
  loop
    if not exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = t
    ) then
      continue;
    end if;

    -- A DELETE normally replicates only the primary key. The client subscribes
    -- with a user_id filter, so without the whole old row there is nothing to
    -- match on and a deletion made on one device never reaches the other.
    execute format('alter table public.%I replica identity full', t);

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Verify: expect all nine rows, each with replica_identity = 'f', and one row
-- from the second query confirming habit_logs.quantity exists.
select t.tablename,
       c.relreplident as replica_identity
  from pg_publication_tables t
  join pg_class c on c.relname = t.tablename
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
 where t.pubname = 'supabase_realtime'
   and t.schemaname = 'public'
 order by t.tablename;

select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'habit_logs' and column_name = 'quantity';
