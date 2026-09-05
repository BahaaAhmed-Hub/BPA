-- A goal was a name, a target and a free-text note. Planning needs three more
-- facts: where it sits in the queue, the day it has to be there by, and what
-- it is counted in.
--
-- rank is the important one. When there is not enough for everything, saying
-- what goes first is the whole decision — money is poured down the ranking,
-- and a goal with no rank waits behind the ones that have one.
--
-- Safe to run more than once.

alter table public.finance_goals add column if not exists rank     integer;
alter table public.finance_goals add column if not exists deadline date;
alter table public.finance_goals add column if not exists currency text;

notify pgrst, 'reload schema';

-- Verify: expect three rows.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'finance_goals'
   and column_name in ('rank', 'deadline', 'currency')
 order by column_name;
