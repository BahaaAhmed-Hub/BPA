-- ─── A project's budget — an amount, and the currency it was set in ─────────
-- Optional on purpose: most projects have none, and a project with no budget
-- simply has nothing to compare Spent against. The currency travels with the
-- amount because "base currency" is a per-person setting that can change; a
-- bare number would quietly mean something else the day it does. The app
-- compares in the base currency using the rates the ledger already holds, and
-- says so when there is no rate rather than guessing one.
--
-- Safe to run more than once. The app keeps working without it: a database that
-- lacks these columns refuses the write, the app retries without them and the
-- sync-gap banner names this file.
alter table public.projects add column if not exists budget_amount   numeric;
alter table public.projects add column if not exists budget_currency text;
alter table public.projects drop constraint if exists projects_budget_nonneg;
alter table public.projects add constraint projects_budget_nonneg check (budget_amount is null or budget_amount >= 0);
