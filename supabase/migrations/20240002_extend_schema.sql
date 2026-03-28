-- ============================================================
-- BPA – Schema Extensions
-- Run in Supabase SQL editor or via: supabase db push
-- ============================================================

-- ─── companies: add users_data, email_domain, account_id ─────
alter table public.companies
  add column if not exists email_domain text,
  add column if not exists account_id   text,
  add column if not exists users_data   jsonb not null default '[]'::jsonb;

-- ─── tasks: add metadata for local-only fields ────────────────
alter table public.tasks
  add column if not exists planned_time text,
  add column if not exists owner_id     text,
  add column if not exists company_tag  text,
  add column if not exists completed    boolean not null default false;

-- ─── users: add connected_accounts + app_preferences ─────────
-- Store connected Google accounts and extra preferences in schedule_rules (already jsonb)
-- No schema change needed — stored as sub-keys in schedule_rules jsonb.

