-- ─── Library 7d (part 2) — a book on the price watch ─────────────────────────
-- A watched book is an ordinary Shopping item (the price watch already knows how
-- to check stores for those); this column is only the pointer from the book to
-- it. No foreign key on purpose: deleting the item in Shopping must not touch the
-- book, and the book's card says when the item it pointed at has gone.
--
-- Safe to run more than once. Without it everything else in the Library works;
-- only starting a watch is refused by the server, and the card says so.
alter table public.library_books add column if not exists watch_item_id uuid;
