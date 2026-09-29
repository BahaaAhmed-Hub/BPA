-- Admin CRUD policies on public.users and public.subscriptions
-- Safe to run more than once (drop-if-exists guards each policy).
--
-- These let an authenticated admin (a row in public.admins matching the caller)
-- insert, update, and delete user rows directly. Auth-level operations
-- (creating/deleting auth.users rows, resetting passwords) still require
-- the admin-user-management edge function which runs with the service role.

-- ── public.users ─────────────────────────────────────────────────────────────
drop policy if exists "admin_insert_users" on public.users;
create policy "admin_insert_users" on public.users
  for insert
  with check (exists (select 1 from public.admins where user_id = auth.uid()));

drop policy if exists "admin_update_users" on public.users;
create policy "admin_update_users" on public.users
  for update
  using (exists (select 1 from public.admins where user_id = auth.uid()));

drop policy if exists "admin_delete_users" on public.users;
create policy "admin_delete_users" on public.users
  for delete
  using (exists (select 1 from public.admins where user_id = auth.uid()));

-- ── public.subscriptions ─────────────────────────────────────────────────────
drop policy if exists "admin_insert_subscriptions" on public.subscriptions;
create policy "admin_insert_subscriptions" on public.subscriptions
  for insert
  with check (exists (select 1 from public.admins where user_id = auth.uid()));

drop policy if exists "admin_update_subscriptions" on public.subscriptions;
create policy "admin_update_subscriptions" on public.subscriptions
  for update
  using (exists (select 1 from public.admins where user_id = auth.uid()));

drop policy if exists "admin_delete_subscriptions" on public.subscriptions;
create policy "admin_delete_subscriptions" on public.subscriptions
  for delete
  using (exists (select 1 from public.admins where user_id = auth.uid()));
