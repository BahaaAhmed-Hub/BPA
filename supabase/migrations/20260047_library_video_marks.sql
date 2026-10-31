-- ─── Library — managing a book's videos: favourites, removed, and paging ─────
-- library_video_marks — what a person decided about a video FOR ONE BOOK: it is a
-- favourite, or it is removed from the list. The title, channel and date are kept
-- on the row so a favourite still reads as itself when a later search no longer
-- returns it (the cache turns over weekly), and a removed one can be named when it
-- is offered back. The thumbnail is derived from the id and never stored.
-- Deleting the book takes its marks with it. Same Library gate as everything else.
--
-- library_video_cache.next_page — the token for the next page of the same search,
-- so "Search for more" asks YouTube for page two of the question already held
-- instead of starting again. Still service-role only (20260046).
-- Safe to run more than once.
create table if not exists public.library_video_marks (
  book_id      uuid not null references public.library_books(id) on delete cascade,
  video_id     text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  user_id      uuid not null references auth.users(id) on delete cascade,
  mark         text not null check (mark in ('favorite','hidden')),
  title        text not null default '',
  channel      text not null default '',
  published_at text not null default '',
  created_at   timestamptz not null default now(),
  primary key (book_id, video_id)
);
create index if not exists library_video_marks_user_idx on public.library_video_marks (user_id, book_id);

alter table public.library_video_marks enable row level security;
drop policy if exists "library_video_marks: own rows" on public.library_video_marks;
create policy "library_video_marks: own rows"
  on public.library_video_marks for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')));

alter table public.library_video_cache add column if not exists next_page text;
