-- A card's balance says what is owed. It says nothing about how much of the
-- card is left, which is the number you need before spending on it.
alter table public.finance_accounts
  add column if not exists credit_limit numeric;

notify pgrst, 'reload schema';
