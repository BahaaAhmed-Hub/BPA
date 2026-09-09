-- ─── Bills are gone ──────────────────────────────────────────────────────────
-- There were two places to write down a recurring payment and only one of them
-- did anything. A budget rule with a due day writes the unpaid entry into the
-- ledger, where every balance, envelope and feed already knows what to do with
-- it; finance_bills was a list nothing else read. The screen, the store's CRUD
-- and the client's table map went with this migration, so the table has no
-- reader left. Anything still in it is folded into the budget rules by hand
-- before running this — the drop is not undoable.

do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'finance_bills'
  ) then
    alter publication supabase_realtime drop table public.finance_bills;
  end if;
end $$;

drop policy if exists "finance_bills: own rows" on public.finance_bills;
drop table if exists public.finance_bills;

-- Verify: expect zero rows.
select tablename from pg_tables
 where schemaname = 'public' and tablename = 'finance_bills';
