-- ─── Projects — a module of its own, behind the same gate as the rest ───────
-- 20260042 shipped the tables with own-rows policies only, so every account saw
-- the Projects tab whatever its plan. This registers the module and puts
-- `has_module` into the three policies, the way 20260022 did for the older
-- modules and 20260025 for the Library.
--
-- **Registered for every plan that lists anything**, not just `free` and `pro`:
-- 20260039 is the lesson (a third plan, `owner`, had no row and the module
-- vanished from the one account that built it). It only adds — a plan edited
-- later to leave Projects out stays that way — and it runs from the ledger, once.
--
-- **Tasks are not touched.** `tasks.project_id` / `milestone_id` ride the task row
-- under its own `tasks` policy: a plan without Projects keeps every task and its
-- pointer, and the pointer reads as unassigned (the project is not loaded).
-- Nothing is deleted: a module that is off is unreadable, not gone.
--
-- Safe to run more than once.

insert into public.modules (id, label, core, sort_order) values
  ('projects', 'Projects', false, 62)
on conflict (id) do nothing;

insert into public.plan_modules (plan, module_id)
select distinct pm.plan, 'projects'
  from public.plan_modules pm
 where exists (select 1 from public.modules m where m.id = 'projects')
on conflict (plan, module_id) do nothing;

drop policy if exists "projects: own rows" on public.projects;
create policy "projects: own rows"
  on public.projects for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'projects')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'projects')));

drop policy if exists "project_milestones: own rows" on public.project_milestones;
create policy "project_milestones: own rows"
  on public.project_milestones for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'projects')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'projects')));

drop policy if exists "project_links: own rows" on public.project_links;
create policy "project_links: own rows"
  on public.project_links for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'projects')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'projects')));
