-- ─── Library 3b — a book you mean to buy ─────────────────────────────────────
-- "Want to read" and "going to buy" are different promises: a book can be on
-- the list because a friend lent it, or because it is at the library. One flag,
-- not a new status, so it composes with every reading state (a book you are
-- reading can still be one you mean to own).
--
-- Safe to run more than once. Without it everything else in the Library works;
-- only toggling "To buy" is refused by the server and says so.
alter table public.library_books add column if not exists to_buy boolean not null default false;
