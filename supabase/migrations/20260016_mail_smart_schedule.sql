-- The nightly run of the smart mail view.
--
-- `mail-smart-run` does the half that needs no language model: fetch what is
-- new, tell a newsletter from a person, work out whether you have replied and
-- which section each thread belongs in. Doing that overnight means opening the
-- Mail tab in the morning shows a finished list rather than starting a sweep,
-- and it costs no model tokens at all — the sentences are written by the
-- browser, where the key is.
--
-- pg_cron and pg_net are Supabase extensions rather than core Postgres, so
-- everything below is conditional: on a project without them the migration is
-- a no-op and the feature degrades to what it already does — a pass when the
-- tab is opened, and every twelve hours while it is. Nothing breaks, the run
-- is just not nightly.
--
-- The secrets it needs are read from Vault, so no key is written into a
-- migration file. Set them once, per project:
--
--   select vault.create_secret('https://<ref>.functions.supabase.co', 'project_functions_url');
--   select vault.create_secret('<the same value as the CRON_SECRET function secret>', 'cron_secret');

do $$
declare
  has_cron boolean;
  has_net  boolean;
  fn_url   text;
  secret   text;
begin
  select exists (select 1 from pg_extension where extname = 'pg_cron') into has_cron;
  select exists (select 1 from pg_extension where extname = 'pg_net')  into has_net;

  if not (has_cron and has_net) then
    raise notice 'pg_cron/pg_net not installed — the smart mail view will run when the tab is opened instead of nightly';
    return;
  end if;

  begin
    select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'project_functions_url';
    select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret';
  exception when others then
    raise notice 'vault secrets not readable — skipping the nightly schedule';
    return;
  end;

  if fn_url is null or secret is null then
    raise notice 'project_functions_url or cron_secret not set in Vault — skipping the nightly schedule';
    return;
  end if;

  -- Unscheduled first: `cron.schedule` on an existing name updates it on newer
  -- versions and errors on older ones, and this file is re-runnable.
  perform cron.unschedule('mail-smart-nightly')
    where exists (select 1 from cron.job where jobname = 'mail-smart-nightly');

  -- 03:10 UTC. Not on the hour: every scheduled job in the world fires at :00,
  -- and this one has no reason to join them.
  perform cron.schedule('mail-smart-nightly', '10 3 * * *', format($cron$
    select net.http_post(
      url     := %L,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', %L
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$, fn_url || '/mail-smart-run', secret));

  raise notice 'smart mail view scheduled nightly at 03:10 UTC';
end $$;
