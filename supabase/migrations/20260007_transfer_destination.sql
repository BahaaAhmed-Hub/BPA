-- A transfer has two ends. finance_transactions only ever recorded one, so
-- moving money between accounts — paying a credit card off a debit account
-- above all — could not be told from money simply leaving.
alter table public.finance_transactions
  add column if not exists to_account_id uuid references public.finance_accounts(id) on delete set null;

create index if not exists finance_transactions_to_account_idx
  on public.finance_transactions (to_account_id);

notify pgrst, 'reload schema';
