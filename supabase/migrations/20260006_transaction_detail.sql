-- A transaction's tags and receipts were collected by the form and then went
-- nowhere: neither column existed, so they lived in one browser and no other
-- device ever saw them.
--
-- paid_at is new. A transaction has two dates that are not the same fact —
-- when the money is owed, and when it actually left. Keeping only one meant
-- the ledger could not tell a bill due on the 1st and paid on the 9th from one
-- paid the day it landed.
--
-- Safe to run more than once.

alter table public.finance_transactions add column if not exists paid_at     date;
alter table public.finance_transactions add column if not exists tags        jsonb not null default '[]'::jsonb;
alter table public.finance_transactions add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Everything already marked cleared was paid on the day it is dated, which is
-- the only honest thing that can be said about it in hindsight.
update public.finance_transactions
   set paid_at = date
 where paid_at is null and is_cleared;

notify pgrst, 'reload schema';

-- Verify: expect three rows.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'finance_transactions'
   and column_name in ('paid_at', 'tags', 'attachments')
 order by column_name;
