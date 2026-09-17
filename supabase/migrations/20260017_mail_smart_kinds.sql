-- What kind of thing a thread is, and the two ways to stop seeing it.
--
-- "Needs your attention" was carrying four different jobs: a renewal waiting on
-- an answer, a meeting invitation, a sign-in alert and a cloud status notice.
-- All four got the same three buttons, one of which offered to draft a reply —
-- to a login notification. `kind` is what lets a row offer the thing that
-- actually answers it: Yes/Maybe/No for an invitation, an acknowledgement for a
-- security notice, a draft only where somebody is genuinely waiting on words.
--
-- `muted` and `archived_at` are different promises and are kept apart:
--   muted       — you have said you do not want this thread, ever. New messages
--                 on it do not bring it back. This is "ignore".
--   archived_at — it has been archived in the mail itself. Recorded here only
--                 so the row can leave the list immediately rather than when
--                 the next pass notices.

alter table public.mail_smart_threads
  add column if not exists kind text not null default 'reply',
  add column if not exists muted boolean not null default false,
  add column if not exists archived_at timestamptz,
  -- Seen and dismissed, for the kinds that are never actions: a sign-in you
  -- have looked at, a meeting you have registered as cancelled.
  add column if not exists acknowledged_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mail_smart_threads_kind_check'
  ) then
    alter table public.mail_smart_threads
      add constraint mail_smart_threads_kind_check
      check (kind in ('invitation','cancelled','security','update','reply'));
  end if;
end $$;

-- The section check predates the split of "needs your attention" into what you
-- owe and what you should know, so it would reject every `attention` row.
alter table public.mail_smart_threads drop constraint if exists mail_smart_threads_section_check;
alter table public.mail_smart_threads
  add constraint mail_smart_threads_section_check
  check (section in ('action','attention','radar','fyi'));

create index if not exists mail_smart_threads_live_idx
  on public.mail_smart_threads (user_id, muted, section, last_at desc);
