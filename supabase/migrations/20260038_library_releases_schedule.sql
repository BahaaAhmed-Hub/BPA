-- ─── Library 7e — the daily check for new releases ───────────────────────────
-- Schedules `library-follow-check` the way 20260016 schedules the smart mail
-- run: pg_cron + pg_net, the function URL and the shared secret read from Vault
-- (the same two entries — `project_functions_url` and `cron_secret` — so there is
-- nothing new to set), and conditional all the way down. On a project without
-- them this is a no-op and the Following view still checks when it is opened.
-- Safe to run more than once.
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
    raise notice 'pg_cron/pg_net not installed — new releases are checked when the Following view is opened instead of daily';
    return;
  end if;

  begin
    select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'project_functions_url';
    select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret';
  exception when others then
    raise notice 'vault secrets not readable — skipping the daily release check';
    return;
  end;
  if fn_url is null or secret is null then
    raise notice 'project_functions_url or cron_secret not set in Vault — skipping the daily release check';
    return;
  end if;

  perform cron.unschedule('library-follow-check-daily')
    where exists (select 1 from cron.job where jobname = 'library-follow-check-daily');

  -- 05:40 UTC: off the hour, and after the 03:10 mail run has finished.
  perform cron.schedule('library-follow-check-daily', '40 5 * * *', format($cron$
    select net.http_post(
      url     := %L,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$, fn_url || '/library-follow-check', secret));

  raise notice 'new releases scheduled daily at 05:40 UTC';
end $$;
