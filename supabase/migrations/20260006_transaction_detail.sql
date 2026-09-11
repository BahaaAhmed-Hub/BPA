-- A transaction's tags and receipts were collected by the form and then went
-- nowhere: neither column existed, so they lived in one browser and no other
-- device ever saw them.
--
-- paid_at is new. A transaction has two dates that are not the same fact —
-- when the money is owed, and when it actually left. Keeping only one meant
-- the ledger could not tell a bill due on the 1st and paid on the 9th from one
-- paid the day it landed.
--
-- Safe to run more than once: it is only DDL now.

alter table public.finance_transactions add column if not exists paid_at     date;
alter table public.finance_transactions add column if not exists tags        jsonb not null default '[]'::jsonb;
alter table public.finance_transactions add column if not exists attachments jsonb not null default '[]'::jsonb;

-- The backfill that used to live here is gone, for the reason written out in
-- full in 20260009: `paid_at is null` stops meaning "logged before the column
-- existed" the moment the column exists, and starts meaning "deliberately
-- unpaid". `is_cleared` did not save it — an entry marked unpaid through the
-- entry panel keeps whatever that flag was, so a re-run silently paid it again.
--
--     update public.finance_transactions
--        set paid_at = date
--      where paid_at is null and is_cleared;
--
-- Settings → Finance → PAYMENT DATES does this on request, once, with a confirm.

notify pgrst, 'reload schema';

-- Verify: expect three rows.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'finance_transactions'
   and column_name in ('paid_at', 'tags', 'attachments')
 order by column_name;
