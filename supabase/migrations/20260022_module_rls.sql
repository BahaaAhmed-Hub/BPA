-- ─── The gate that actually enforces ─────────────────────────────────────────
-- Everything before this decided what to *draw* and what to *load*. Both live
-- in a JavaScript file served to the public, so both are a courtesy to the
-- person reading the screen — a determined one edits the bundle and asks for
-- the rows anyway. This is the part that answers them.
--
-- Each module's own tables gain `and (select public.has_module(auth.uid(),
-- '<module>'))` to the policy they already had. Ownership still decides first;
-- this only ever narrows.
--
-- **The scalar subquery is not decoration.** A bare `has_module(auth.uid(),
-- 'finance')` in a policy is re-evaluated per row — on a ledger of ten
-- thousand entries that is ten thousand calls. Wrapped in `(select …)` with
-- arguments that are constant for the statement, Postgres hoists it into an
-- InitPlan and runs it once.
--
-- Shopping is gated on **finance**, because it is a tab of Finance rather than
-- a module of its own — the same answer the client gives.
-- `shopping_price_snapshots` has no `user_id` at all (it is owned through
-- `item_id`), so its own clause is left exactly as it was and only the gate is
-- added.
--
-- NOT gated, deliberately: `users`, `companies`, the Google account and token
-- tables, `google_calendar_settings`, `weekly_reviews`, `energy_logs`,
-- `health_links`, `user_tokens`, `telegram_links`. None of them is a module's
-- data — they are who you are, what you have connected, and how other things
-- reach you. Locking someone out of their own connected accounts because a
-- plan changed would be a support ticket, not a downgrade.
--
-- ⚠ THIS IS THE ONE THAT CAN LOCK SOMEBODY OUT. After it applies, a user whose
-- plan does not include Finance cannot read their own ledger — that is the
-- entire point, and it is also why `20260021`'s seeds matter: the backfill put
-- every existing account on `free`, and the seeded `free` plan does NOT carry
-- `finance` or `inbox`. Decide that before running this, not after. Either is
-- one statement:
--     update public.subscriptions set plan = 'pro' where user_id = '<you>';
--     insert into public.plan_modules (plan, module_id)
--       values ('free','finance'), ('free','inbox') on conflict do nothing;
-- Nothing is deleted either way — a module that is off is unreadable, not gone,
-- and putting the plan back puts the data back.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── tasks ───────────────────────────────────────────────────────────────────
drop policy if exists "tasks: own rows only" on public.tasks;
create policy "tasks: own rows only"
  on public.tasks for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'tasks')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'tasks')));


-- ─── habits ──────────────────────────────────────────────────────────────────
drop policy if exists "habits: own rows only" on public.habits;
create policy "habits: own rows only"
  on public.habits for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'habits')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'habits')));

drop policy if exists "habit_logs: own rows only" on public.habit_logs;
create policy "habit_logs: own rows only"
  on public.habit_logs for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'habits')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'habits')));


-- ─── calendar ────────────────────────────────────────────────────────────────
drop policy if exists "calendar_events: own rows only" on public.calendar_events;
create policy "calendar_events: own rows only"
  on public.calendar_events for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'calendar')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'calendar')));

drop policy if exists "google_event_metadata: own rows" on public.google_event_metadata;
create policy "google_event_metadata: own rows"
  on public.google_event_metadata for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'calendar')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'calendar')));


-- ─── mail ────────────────────────────────────────────────────────────────────
drop policy if exists "email_actions: own rows only" on public.email_actions;
create policy "email_actions: own rows only"
  on public.email_actions for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'inbox')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'inbox')));

drop policy if exists "mail_smart_threads: own rows only" on public.mail_smart_threads;
create policy "mail_smart_threads: own rows only"
  on public.mail_smart_threads for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'inbox')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'inbox')));

drop policy if exists "mail_smart_sync: own rows only" on public.mail_smart_sync;
create policy "mail_smart_sync: own rows only"
  on public.mail_smart_sync for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'inbox')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'inbox')));


-- ─── finance (eight tables) ──────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'finance_accounts', 'finance_transactions', 'finance_categories',
    'finance_budgets', 'finance_goals', 'finance_plans',
    'finance_actuals_override', 'finance_cell_comments'
  ] loop
    -- %I, not %L: a policy name is an identifier ("x"), not a string ('x').
    execute format('drop policy if exists %I on public.%I', t || ': own rows', t);
    execute format($f$
      create policy %I on public.%I for all
        using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'finance')))
        with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'finance')))
    $f$, t || ': own rows', t);
  end loop;
end $$;


-- ─── shopping — a tab of Finance, so it follows Finance ──────────────────────
drop policy if exists "shopping_groups_owner" on public.shopping_groups;
create policy "shopping_groups_owner"
  on public.shopping_groups for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'finance')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'finance')));

drop policy if exists "shopping_items_owner" on public.shopping_items;
create policy "shopping_items_owner"
  on public.shopping_items for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'finance')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'finance')));

drop policy if exists "shopping_stores_owner" on public.shopping_stores;
create policy "shopping_stores_owner"
  on public.shopping_stores for all
  using      (auth.uid() = user_id and (select public.has_module(auth.uid(), 'finance')))
  with check (auth.uid() = user_id and (select public.has_module(auth.uid(), 'finance')));

-- Owned through `item_id`, never a `user_id` of its own — that clause is kept
-- exactly as written and only the gate is added beside it.
drop policy if exists "shopping_snapshots_owner" on public.shopping_price_snapshots;
create policy "shopping_snapshots_owner"
  on public.shopping_price_snapshots for all
  using (
    auth.uid() = (select user_id from public.shopping_items where id = item_id)
    and (select public.has_module(auth.uid(), 'finance'))
  )
  with check (
    auth.uid() = (select user_id from public.shopping_items where id = item_id)
    and (select public.has_module(auth.uid(), 'finance'))
  );


-- ─── the way back ────────────────────────────────────────────────────────────
-- Re-run `20240001`, `20260001` and `20260017` — each re-asserts its own
-- policies with the ownership clause alone, which is precisely this file
-- undone. Nothing here drops a column or touches a row.
