-- Shopping List module: groups, items, stores, price snapshots
-- Groups are schedulable, recurring shopping lists.
-- Items belong to groups and link to budget envelopes, tasks, and calendar events.
-- Stores are user-defined by URL; price snapshots are written by the Edge Function.
-- Order: groups → stores → items → snapshots (items FK-references stores)

-- ─── shopping_groups ─────────────────────────────────────────────────────────

create table if not exists public.shopping_groups (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  color           text not null default '#F5D14E',
  icon            text not null default '🛒',
  scheduled_date  date,
  recurrence      text not null default 'none'
                  check (recurrence in ('none','daily','weekly','biweekly','monthly','custom')),
  recurrence_rule text,         -- RRULE string for custom recurrence
  next_run_at     timestamptz,
  status          text not null default 'active'
                  check (status in ('active','archived','suspended')),
  sort_order      int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists shopping_groups_user_id_idx on public.shopping_groups(user_id);

drop policy if exists "shopping_groups_owner" on public.shopping_groups;
create policy "shopping_groups_owner"
  on public.shopping_groups for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.shopping_groups enable row level security;

-- ─── shopping_stores ─────────────────────────────────────────────────────────
-- Must be created before shopping_items (items.store_used_id FK references this)

create table if not exists public.shopping_stores (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  url             text not null,
  country         text,
  categories      text[] not null default '{}',
  last_scraped_at timestamptz,
  last_scrape_ok  boolean,
  sort_order      int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists shopping_stores_user_id_idx on public.shopping_stores(user_id);

drop policy if exists "shopping_stores_owner" on public.shopping_stores;
create policy "shopping_stores_owner"
  on public.shopping_stores for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.shopping_stores enable row level security;

-- ─── shopping_items ──────────────────────────────────────────────────────────

create table if not exists public.shopping_items (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  group_id            uuid references public.shopping_groups(id) on delete set null,
  name                text not null,
  category            text not null default 'General',
  quantity            numeric not null default 1,
  unit                text,
  priority            int  not null default 0,
  status              text not null default 'wanted'
                      check (status in ('wanted','planned','purchased')),
  target_price_max    numeric,
  currency            text not null default 'EGP',
  budget_envelope_id  text,     -- references budget_rules.id (text UUID, loose FK)
  calendar_event_id   text,     -- Google Calendar event id
  task_id             text,     -- task row id
  notes               text,
  purchased_at        timestamptz,
  final_price         numeric,
  store_used_id       uuid references public.shopping_stores(id) on delete set null,
  sort_order          int  not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists shopping_items_user_id_idx  on public.shopping_items(user_id);
create index if not exists shopping_items_group_id_idx on public.shopping_items(group_id);
create index if not exists shopping_items_status_idx   on public.shopping_items(status);

drop policy if exists "shopping_items_owner" on public.shopping_items;
create policy "shopping_items_owner"
  on public.shopping_items for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.shopping_items enable row level security;

-- ─── shopping_price_snapshots ─────────────────────────────────────────────────

create table if not exists public.shopping_price_snapshots (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.shopping_items(id) on delete cascade,
  store_id    uuid not null references public.shopping_stores(id) on delete cascade,
  price       numeric not null,
  currency    text not null default 'EGP',
  product_url text,
  available   boolean not null default true,
  scraped_at  timestamptz not null default now()
);

create index if not exists shopping_snapshots_item_id_idx  on public.shopping_price_snapshots(item_id);
create index if not exists shopping_snapshots_store_id_idx on public.shopping_price_snapshots(store_id);
create index if not exists shopping_snapshots_scraped_at_idx on public.shopping_price_snapshots(scraped_at desc);

-- Price snapshots are readable by the item owner only.
drop policy if exists "shopping_snapshots_owner" on public.shopping_price_snapshots;
create policy "shopping_snapshots_owner"
  on public.shopping_price_snapshots for all
  using (
    auth.uid() = (
      select user_id from public.shopping_items where id = item_id
    )
  )
  with check (
    auth.uid() = (
      select user_id from public.shopping_items where id = item_id
    )
  );

alter table public.shopping_price_snapshots enable row level security;

-- ─── Realtime publication ─────────────────────────────────────────────────────

do $$
begin
  begin
    alter publication supabase_realtime add table public.shopping_groups;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.shopping_items;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.shopping_stores;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.shopping_price_snapshots;
  exception when others then null;
  end;
end$$;
