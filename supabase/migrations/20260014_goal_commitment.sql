-- A goal could say what it wants and by when. It could not say what you had
-- decided to put into it each month.
--
-- Those are different questions. "Divide what is left over" answers *when will
-- this land*; it cannot answer "I want 5,000 a month going into the car",
-- which is a decision somebody made rather than an outcome to be worked out.
-- The `commit` policy reads this column: each goal takes the amount named here
-- and no more, in rank order, and what is left after every commitment is met
-- runs down the ladder as usual.
--
-- Held in the goal's own currency, like target_amount and current_amount.
-- Safe to run more than once.

alter table public.finance_goals add column if not exists monthly_commit numeric;

notify pgrst, 'reload schema';

-- Verify: expect one row.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'finance_goals'
   and column_name = 'monthly_commit';
