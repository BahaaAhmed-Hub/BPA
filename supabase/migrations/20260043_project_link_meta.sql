-- A link to an event has to say what the event is, because the project page
-- cannot ask Google about it: only the calendar holds events, and only the week
-- it is showing. So the link carries a small snapshot of the event — its title,
-- when it starts and ends, which calendar — that the calendar refreshes whenever
-- it loads the event, and that the project page reads.
--
-- Optional for every other kind of link (a thread, an entry...), which may carry
-- one of their own later.
--
-- Safe to run more than once.

alter table public.project_links add column if not exists meta jsonb;
