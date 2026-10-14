-- A book's real size, so the shelf can stand it at the height, width and
-- thickness it really has instead of a block that only varies with page count.
--
-- Millimetres, all optional. `dims_source` says where the figures came from, so
-- the shelf (and the person) can tell a measured book from a guessed one:
--   measured  an online catalogue listed it and it passed validation
--   cover     height/width derived from the cover picture's proportions
--   estimate  worked out from the page count and binding
--   manual    typed by the person; never overwritten by a later lookup
--
-- The CHECKs are the same plausibility ranges the app validates with, so a
-- client that skipped the form cannot store a 4 mm-tall book.
-- Safe to run more than once.

alter table public.library_books add column if not exists height_mm    int;
alter table public.library_books add column if not exists width_mm     int;
alter table public.library_books add column if not exists thickness_mm int;
alter table public.library_books add column if not exists dims_source  text;

alter table public.library_books drop constraint if exists library_books_dims_check;
alter table public.library_books add constraint library_books_dims_check check (
  (height_mm    is null or height_mm    between 60 and 500) and
  (width_mm     is null or width_mm     between 40 and 400) and
  (thickness_mm is null or thickness_mm between 2  and 160) and
  (dims_source  is null or dims_source in ('measured','cover','estimate','manual'))
);
