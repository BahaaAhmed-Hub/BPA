-- ─── Library — every plan that exists carries it ─────────────────────────────
-- 20260025 registered the module for `free` and `pro`, the two plans it knew
-- about. A third plan, `owner`, had been made since (by hand or in the admin
-- panel), carried Finance, Mail and the rest, and had no `library` row — so
-- `has_module(uid, 'library')` resolved false for the owner's own account and
-- the nav hid the module from the one person who built it. Nothing was wrong
-- with the data; the plan simply did not list it.
--
-- A plan is a list of modules, and a module that is on every plan's list is the
-- ordinary case for something not yet priced. So this adds `library` to every
-- plan that already lists anything, rather than naming `owner` — the next plan
-- somebody creates before this runs would have the same hole.
--
-- It only adds. A plan that already has the row is untouched (`on conflict`),
-- and nothing is removed, so a plan that is later edited to exclude the Library
-- on purpose stays excluded: this runs once, from the ledger, and never again.
-- Safe to run more than once.
insert into public.plan_modules (plan, module_id)
select distinct pm.plan, 'library'
  from public.plan_modules pm
 where exists (select 1 from public.modules m where m.id = 'library')
on conflict (plan, module_id) do nothing;
