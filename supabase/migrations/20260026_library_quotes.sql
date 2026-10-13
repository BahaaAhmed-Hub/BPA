-- ─── Library phase 2a — quotes, notes, bookmarks, and the file bucket ────────
-- Same gate as 20260025: ownership AND has_module(auth.uid(), 'library'), the
-- module call wrapped in (select …) so it runs once per statement.
-- Safe to run more than once.

-- ─── quotes ──────────────────────────────────────────────────────────────────
-- A quote is text you typed or a photograph of a page (`image_path`, in the
-- `library` bucket below). `page`/`line` are where it sits in the book, so the
-- reader (2b) can jump to it.
create table if not exists public.library_quotes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  book_id    uuid not null references public.library_books(id) on delete cascade,
  kind       text not null default 'text' check (kind in ('text','image')),
  body       text,
  image_path text,
  page       int,
  line       int,
  color      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists library_quotes_book_idx on public.library_quotes (book_id);
create index if not exists library_quotes_user_idx on public.library_quotes (user_id, created_at desc);

-- ─── notes ───────────────────────────────────────────────────────────────────
-- One table for every level a note can sit at. `scope` says which of the
-- columns beside it is the anchor, and the check below refuses a note whose
-- anchor is missing — a 'quote' note with no quote is a note about nothing.
create table if not exists public.library_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  scope      text not null check (scope in ('book','quote','list','page','line')),
  book_id    uuid references public.library_books(id) on delete cascade,
  quote_id   uuid references public.library_quotes(id) on delete cascade,
  list_id    uuid references public.library_lists(id) on delete cascade,
  page       int,
  line       int,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'book'  and book_id is not null) or
    (scope = 'quote' and quote_id is not null) or
    (scope = 'list'  and list_id is not null) or
    (scope = 'page'  and book_id is not null and page is not null) or
    (scope = 'line'  and book_id is not null and page is not null and line is not null)
  )
);
create index if not exists library_notes_user_idx on public.library_notes (user_id);
create index if not exists library_notes_book_idx on public.library_notes (book_id);
create index if not exists library_notes_quote_idx on public.library_notes (quote_id);

-- ─── bookmarks ───────────────────────────────────────────────────────────────
-- A bookmark on a *book* is a favourite; on a page, a line or a quote it is a
-- place to come back to.
create table if not exists public.library_bookmarks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('book','page','line','quote')),
  book_id    uuid not null references public.library_books(id) on delete cascade,
  quote_id   uuid references public.library_quotes(id) on delete cascade,
  page       int,
  line       int,
  label      text,
  created_at timestamptz not null default now(),
  check (
    (kind = 'book') or
    (kind = 'quote' and quote_id is not null) or
    (kind = 'page'  and page is not null) or
    (kind = 'line'  and page is not null and line is not null)
  )
);
create index if not exists library_bookmarks_user_idx on public.library_bookmarks (user_id);
create index if not exists library_bookmarks_book_idx on public.library_bookmarks (book_id);

-- ─── policies ────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['library_quotes','library_notes','library_bookmarks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || ': own rows', t);
    execute format(
      'create policy %I on public.%I for all
         using      (auth.uid() = user_id and (select public.has_module(auth.uid(), ''library'')))
         with check (auth.uid() = user_id and (select public.has_module(auth.uid(), ''library'')))',
      t || ': own rows', t);
    execute format('alter table public.%I replica identity full', t);
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ─── the file bucket (used from 2b: PDFs, 2c: quote photos) ──────────────────
-- Private. An object's first path segment is the owner's id, and the policies
-- compare it to auth.uid(), so nobody reads or writes another account's files
-- whatever name they guess.
insert into storage.buckets (id, name, public) values ('library', 'library', false)
on conflict (id) do nothing;

do $$
declare op text;
begin
  foreach op in array array['select','insert','update','delete']
  loop
    execute format('drop policy if exists %I on storage.objects', 'library files: ' || op);
    if op = 'insert' then
      execute 'create policy "library files: insert" on storage.objects for insert to authenticated
        with check (bucket_id = ''library'' and (storage.foldername(name))[1] = auth.uid()::text
                    and (select public.has_module(auth.uid(), ''library'')))';
    else
      execute format(
        'create policy %I on storage.objects for %s to authenticated
           using (bucket_id = ''library'' and (storage.foldername(name))[1] = auth.uid()::text
                  and (select public.has_module(auth.uid(), ''library'')))',
        'library files: ' || op, op);
    end if;
  end loop;
end $$;
