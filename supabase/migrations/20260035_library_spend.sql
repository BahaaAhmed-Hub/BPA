-- ─── Library 7d — what a book cost ───────────────────────────────────────────
-- Four optional facts about buying a book. They live on the book rather than in
-- Finance on purpose: the Library works without the Finance module (and its
-- lock), and a book price is a note about the book, not a ledger entry.
-- Money is never converted here — totals are kept per currency.
--
-- Safe to run more than once. Without it everything else in the Library works;
-- only saving a price is refused by the server, and the panel says so.
alter table public.library_books add column if not exists paid_amount   numeric(12,2);
alter table public.library_books add column if not exists paid_currency text;
alter table public.library_books add column if not exists bought_on     date;
alter table public.library_books add column if not exists bought_at     text;

alter table public.library_books drop constraint if exists library_books_paid_amount_check;
alter table public.library_books add constraint library_books_paid_amount_check check (paid_amount is null or paid_amount >= 0);
alter table public.library_books drop constraint if exists library_books_paid_currency_check;
alter table public.library_books add constraint library_books_paid_currency_check check (paid_currency is null or paid_currency ~ '^[A-Z]{3}$');
