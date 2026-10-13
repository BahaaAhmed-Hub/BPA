-- ─── Library — books, and the lists and categories they are shelved under ───
-- Phase 1 of the Library module: a shelf you can add to, edit and delete from.
-- Quotes, notes, bookmarks, reading sessions and plans arrive in later phases
-- as their own migrations, so this one stays reviewable.
--
-- **Gated like every other module.** Each policy is ownership AND
-- `has_module(auth.uid(), 'library')`, wrapped in `(select …)` so Postgres runs
-- it once per statement rather than once per row (see 20260022).
--
-- **Registered for `free` as well as `pro`.** 20260021's backfill put every
-- existing account on `free`; a module registered for neither plan would
-- resolve to false for everybody and vanish from the nav the moment this ran.
-- Narrow it in the admin panel if Library should be a paid feature.
--
-- Safe to run more than once.

-- ─── the module ──────────────────────────────────────────────────────────────
insert into public.modules (id, label, core, sort_order) values
  ('library', 'Library', false, 65)
on conflict (id) do nothing;

insert into public.plan_modules (plan, module_id) values
  ('free', 'library'),
  ('pro',  'library')
on conflict (plan, module_id) do nothing;


-- ─── books ───────────────────────────────────────────────────────────────────
create table if not exists public.library_books (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  title          text not null,
  subtitle       text,
  authors        text[] not null default '{}',
  isbn           text,
  publisher      text,
  published_year int,
  pages          int,
  language       text,
  description    text,
  cover_url      text,
  -- Where the metadata came from, so a later phase can refresh it without
  -- guessing: 'manual' | 'openlibrary' | 'google'.
  source         text not null default 'manual',
  source_key     text,
  status         text not null default 'want'
                 check (status in ('want','reading','finished','paused','abandoned')),
  format         text not null default 'print'
                 check (format in ('print','ebook','pdf','audio')),
  -- 0 means unrated, not "one star short of nothing".
  rating         int  not null default 0 check (rating between 0 and 5),
  review         text,
  -- A spine colour is the book's own: picked from the cover where there is one,
  -- or chosen here, so the shelf does not repaint itself on every load.
  spine_color    text,
  -- Reserved for Phase 2 (an uploaded PDF in the `library` bucket).
  file_path      text,
  shelf_order    int  not null default 0,
  started_on     date,
  finished_on    date,
  added_at       timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists library_books_user_idx on public.library_books (user_id, shelf_order);

alter table public.library_books enable row level security;

drop policy if exists "library_books: own rows" on public.library_books;
create policy "library_books: own rows"
  on public.library_books for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')));


-- ─── lists and categories ────────────────────────────────────────────────────
-- One table for both: a *category* is what a book is (Fiction, Business) and a
-- *list* is what you are doing with it (Summer reading, Lend out). They differ
-- in the questions the UI asks, not in their shape, and two tables would
-- mean two copies of every control that edits a name and a thumbnail.
create table if not exists public.library_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  kind        text not null default 'list' check (kind in ('list','category')),
  description text,
  thumb_url   text,
  color       text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists library_lists_user_idx on public.library_lists (user_id, sort_order);

alter table public.library_lists enable row level security;

drop policy if exists "library_lists: own rows" on public.library_lists;
create policy "library_lists: own rows"
  on public.library_lists for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')));


-- A book may be on many lists, and in more than one category.
-- `user_id` is here for Realtime, which can only filter on a column the row has.
create table if not exists public.library_list_books (
  list_id    uuid not null references public.library_lists(id) on delete cascade,
  book_id    uuid not null references public.library_books(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  sort_order int  not null default 0,
  added_at   timestamptz not null default now(),
  primary key (list_id, book_id)
);

create index if not exists library_list_books_user_idx on public.library_list_books (user_id);
create index if not exists library_list_books_book_idx on public.library_list_books (book_id);

alter table public.library_list_books enable row level security;

drop policy if exists "library_list_books: own rows" on public.library_list_books;
create policy "library_list_books: own rows"
  on public.library_list_books for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')));


-- ─── Realtime ────────────────────────────────────────────────────────────────
-- So a book added on the laptop appears on the iPad while both are open.
-- REPLICA IDENTITY FULL lets a DELETE be filtered by user_id.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['library_books', 'library_lists', 'library_list_books']
  loop
    execute format('alter table public.%I replica identity full', t);
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
