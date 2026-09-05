-- Every entry paid on the day it was due.
--
-- An entry carries two dates: the day it is owed and the day the money left.
-- Anything logged before the second one existed has none, and now that "not
-- paid" is something a person says on purpose, an entry with no payment date
-- reads as money still owed — so the whole ledger came back unpaid and the
-- "when it was paid" view of the Financials had nothing to show.
--
-- This gives every one of them its own due date back. Unlike the version in
-- 20260006 it does not ask whether the entry was marked cleared: an entry that
-- has been sitting in the ledger for months was paid, whatever flag it carries.
--
-- The column is added first, so this stands on its own if 20260006 was never
-- run — which is the case where nothing in the app could store a payment date
-- at all, and every entry looked unpaid however it was marked.
--
-- Safe to run more than once: the second run finds nothing left to do.
--
-- After this, an entry with no payment date is one you deliberately left
-- unpaid, and every feed marks it with a dotted red border.

alter table public.finance_transactions add column if not exists paid_at date;

update public.finance_transactions
   set paid_at = date,
       is_cleared = true
 where paid_at is null;

notify pgrst, 'reload schema';

-- Verify: expect 0 waiting, and every entry carrying a payment date.
select count(*) filter (where paid_at is null) as still_unpaid,
       count(*)                                as entries
  from public.finance_transactions;
