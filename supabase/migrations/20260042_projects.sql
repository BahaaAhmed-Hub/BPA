-- ─── Projects — a goal with an end, gathering items from several modules ───
-- Chunk 1 of the Projects feature: the data and its sync, with no screen yet.
-- See .claude/rules/projects.md.
--
-- A task carries its project on the task row (`tasks.project_id`); everything
-- else (events, threads, entries, habits, books, lists) links through
-- `project_links`. Milestones are dated phases of one project.
--
-- `tasks.project_id` / `milestone_id` deliberately have NO foreign key. Tasks
-- are pushed as a batch on their own debounce, so a task can be written before
-- the project it points at has reached the server, and a foreign key would turn
-- that ordering into a rejected push of the whole task list. Orphaning is done
-- by the app instead: deleting a project clears `project_id` on its tasks
-- (they are kept), and a task whose project is missing is read as unassigned.
--
-- Safe to run more than once.

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  kind        text not null default 'work' check (kind in ('work','personal')),
  color       text,
  status      text not null default 'active'
              check (status in ('idea','active','paused','done')),
  -- One company at most, and only for a work project. Same meaning as a task's
  -- company_tag: a dynamic company id.
  company_id  text,
  start_date  date,
  target_date date,
  notes       text,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_user_idx on public.projects (user_id, archived, created_at);

create table if not exists public.project_milestones (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- Here for Realtime, which can only filter on a column the row has.
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  due_date   date,
  done       boolean not null default false,
  sort_order int  not null default 0
);

create index if not exists project_milestones_project_idx on public.project_milestones (project_id, sort_order);
create index if not exists project_milestones_user_idx    on public.project_milestones (user_id);

-- Everything that is not a task: an event, a mail thread, a finance entry, a
-- habit, a book or a shopping list. `ref_id` is the other module's own id — a
-- string, because an event id and a thread key are not uuids.
create table if not exists public.project_links (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('event','thread','entry','habit','book','list')),
  ref_id     text not null,
  created_at timestamptz not null default now(),
  -- Linking the same thing twice is one link.
  unique (project_id, kind, ref_id)
);

create index if not exists project_links_user_idx on public.project_links (user_id);

alter table public.projects           enable row level security;
alter table public.project_milestones enable row level security;
alter table public.project_links      enable row level security;

drop policy if exists "projects: own rows" on public.projects;
create policy "projects: own rows"
  on public.projects for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "project_milestones: own rows" on public.project_milestones;
create policy "project_milestones: own rows"
  on public.project_milestones for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "project_links: own rows" on public.project_links;
create policy "project_links: own rows"
  on public.project_links for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── a task's project ────────────────────────────────────────────────────────
alter table public.tasks add column if not exists project_id   uuid;
alter table public.tasks add column if not exists milestone_id uuid;
create index if not exists tasks_project_idx on public.tasks (user_id, project_id);

-- ─── Realtime ────────────────────────────────────────────────────────────────
-- So a project made on the laptop appears on the iPad while both are open.
-- REPLICA IDENTITY FULL lets a DELETE be filtered by user_id.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['projects', 'project_milestones', 'project_links']
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
