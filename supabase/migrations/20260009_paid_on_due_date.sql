-- Every entry paid on the day it was due — ONCE, in early 2026, and never again.
--
-- WHAT THIS USED TO DO, AND WHY IT IS GONE
--
-- An entry carries two dates: the day it is owed and the day the money left.
-- Anything logged before the second one existed had none, so the whole ledger
-- came back unpaid. This file gave every one of them its due date back:
--
--     update public.finance_transactions
--        set paid_at = date, is_cleared = true
--      where paid_at is null;
--
-- It claimed to be safe to run more than once. It was not, and the claim was
-- the bug. `paid_at is null` does not mean "logged before the column existed".
-- After the first run it means exactly one thing: **an entry you deliberately
-- marked unpaid** — a salary not yet received, a bill dated ahead, every future
-- instalment `budgetEntries.ts` writes. The repair could not tell the data it
-- was written for from the answer a person had since given it.
--
-- The migration runner had no record of what it had already applied, so it ran
-- every file on every push that touched this directory. Adding an unrelated
-- migration therefore re-ran this one and marked the entire ledger paid,
-- incomes included, on dates in the future that had not happened yet.
--
-- So the repair is gone from here. It still exists, where a repair belongs:
-- Settings → Finance → PAYMENT DATES, behind a confirm that says what it will
-- do. A one-time fix is something a person asks for once, not something a
-- deploy does to them.
--
-- The column is all that remains, and adding it is genuinely idempotent.

alter table public.finance_transactions add column if not exists paid_at date;

notify pgrst, 'reload schema';

-- Verify: expect one row. How many entries are unpaid is now a question about
-- the ledger rather than about this file, so it is no longer counted here.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'finance_transactions'
   and column_name = 'paid_at';
