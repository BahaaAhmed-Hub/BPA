-- ─── Library — a book's summary, and a cache for its videos ──────────────────
-- Two tables, and neither is a module: both ride the Library's own gate.
--
-- library_summaries — the AI summary a person asked for, one per book. It is
-- written a section at a time (an outline, then each section), so a request that
-- fails halfway keeps what it had and can be continued; complete means
-- jsonb_array_length(sections) = jsonb_array_length(outline). Deleting the book
-- takes the summary with it. Paid for once, kept until the person regenerates it.
--
-- library_video_cache — what YouTube answered for a search, keyed by the search.
-- The YouTube Data API's daily quota belongs to the whole project, not to a
-- person, so the same question asked twice (or by two people reading the same
-- book) must cost one call. Only the `library-videos` function touches it, with
-- the service role: RLS is on and there is deliberately no policy, so the app
-- itself can neither read nor write it.
-- Safe to run more than once.
create table if not exists public.library_summaries (
  book_id    uuid primary key references public.library_books(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  length     text not null check (length in ('short','standard','long')),
  premise    text not null default '',
  outline    jsonb not null default '[]'::jsonb,
  sections   jsonb not null default '[]'::jsonb,
  model      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(outline) = 'array' and jsonb_typeof(sections) = 'array')
);
create index if not exists library_summaries_user_idx on public.library_summaries (user_id);

alter table public.library_summaries enable row level security;
drop policy if exists "library_summaries: own rows" on public.library_summaries;
create policy "library_summaries: own rows"
  on public.library_summaries for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'library')));

create table if not exists public.library_video_cache (
  query      text primary key,
  items      jsonb not null check (jsonb_typeof(items) = 'array'),
  fetched_at timestamptz not null default now()
);
alter table public.library_video_cache enable row level security;
