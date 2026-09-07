-- A company can be hidden, and the browser has always said so.
--
-- `hidden` was written by the app from the day companies could be hidden, and
-- never added to the table. Postgres rejected the whole row for it, and the
-- client's fallback answered by writing the company back with *only* its base
-- columns — so a column nobody had cost each company its linked Google account
-- (`account_id`), its email domain and its people (`users_data`) as well. The
-- next load read those back as empty and wrote them over the browser's copy,
-- which is why linking an account held until the page was refreshed.
--
-- The client no longer drops four columns for one missing one, but the column
-- still has to exist for hiding a company to survive a reload.
--
-- Safe to run more than once.

alter table public.companies
  add column if not exists hidden       boolean not null default false,
  add column if not exists email_domain text,
  add column if not exists account_id   text,
  add column if not exists users_data   jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';

-- Verify: every company keeps what it was linked to.
select id, name, account_id, email_domain, hidden,
       jsonb_array_length(coalesce(users_data, '[]'::jsonb)) as people
  from public.companies
 order by name;
