-- ============================================================
-- Finance Module Schema
-- ============================================================

-- ─── Accounts ────────────────────────────────────────────────
create table if not exists public.finance_accounts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  name         text not null,
  bank         text not null default 'Other',
  account_type text not null default 'payment',
  currency     text not null default 'EGP',
  balance      numeric not null default 0,
  last4        text,
  emoji        text not null default '🏦',
  color        text not null default '#8C8071',
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table public.finance_accounts enable row level security;
create policy "finance_accounts: own rows"
  on public.finance_accounts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── Categories ──────────────────────────────────────────────
create table if not exists public.finance_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  name       text not null,
  icon       text not null default '📁',
  color      text not null default '#8C8071',
  parent_id  uuid references public.finance_categories(id) on delete set null,
  tx_type    text not null default 'expense',
  sort_order int not null default 0,
  is_system  boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.finance_categories enable row level security;
create policy "finance_categories: own rows"
  on public.finance_categories for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── Transactions ─────────────────────────────────────────────
create table if not exists public.finance_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  account_id   uuid references public.finance_accounts(id) on delete set null,
  category_id  uuid references public.finance_categories(id) on delete set null,
  amount       numeric not null,
  currency     text not null default 'EGP',
  tx_type      text not null default 'expense',
  payee        text not null default '',
  date         date not null,
  note         text,
  is_cleared   boolean not null default false,
  is_recurring boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.finance_transactions enable row level security;
create policy "finance_transactions: own rows"
  on public.finance_transactions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── Plans (planned values per category × month) ─────────────
create table if not exists public.finance_plans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  category_id     uuid not null references public.finance_categories(id) on delete cascade,
  year            int not null,
  month           int not null,
  planned_amount  numeric not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(user_id, category_id, year, month)
);
alter table public.finance_plans enable row level security;
create policy "finance_plans: own rows"
  on public.finance_plans for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Auto-update updated_at
create or replace function public.finance_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger finance_plans_updated_at
  before update on public.finance_plans
  for each row execute function public.finance_set_updated_at();

-- ─── Actual Overrides (manual edits to computed actuals) ─────
create table if not exists public.finance_actuals_override (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  category_id     uuid not null references public.finance_categories(id) on delete cascade,
  year            int not null,
  month           int not null,
  override_amount numeric not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(user_id, category_id, year, month)
);
alter table public.finance_actuals_override enable row level security;
create policy "finance_actuals_override: own rows"
  on public.finance_actuals_override for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger finance_overrides_updated_at
  before update on public.finance_actuals_override
  for each row execute function public.finance_set_updated_at();

-- ─── Cell Comments ────────────────────────────────────────────
create table if not exists public.finance_cell_comments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  category_id uuid not null references public.finance_categories(id) on delete cascade,
  year        int not null,
  month       int not null,
  comment     text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(user_id, category_id, year, month)
);
alter table public.finance_cell_comments enable row level security;
create policy "finance_cell_comments: own rows"
  on public.finance_cell_comments for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger finance_comments_updated_at
  before update on public.finance_cell_comments
  for each row execute function public.finance_set_updated_at();

-- ─── Bills ────────────────────────────────────────────────────
create table if not exists public.finance_bills (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  name        text not null,
  amount      numeric not null,
  currency    text not null default 'EGP',
  category_id uuid references public.finance_categories(id) on delete set null,
  account_id  uuid references public.finance_accounts(id) on delete set null,
  frequency   text not null default 'monthly',
  next_due    date not null,
  is_active   boolean not null default true,
  is_income   boolean not null default false,
  icon        text not null default '📄',
  created_at  timestamptz not null default now()
);
alter table public.finance_bills enable row level security;
create policy "finance_bills: own rows"
  on public.finance_bills for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── Goals ────────────────────────────────────────────────────
create table if not exists public.finance_goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  name           text not null,
  icon           text not null default '🎯',
  target_amount  numeric not null default 0,
  current_amount numeric not null default 0,
  color          text not null default '#C49A3C',
  sub_label      text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
alter table public.finance_goals enable row level security;
create policy "finance_goals: own rows"
  on public.finance_goals for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
