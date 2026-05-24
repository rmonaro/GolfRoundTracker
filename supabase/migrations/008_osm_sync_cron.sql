-- Migration 008 — pg_cron schedule for sync-course-osm
-- Dialect: PostgreSQL (Supabase). T-SQL linter false-positives expected.
--
-- Run this AFTER `supabase functions deploy sync-course-osm` so the URL exists.
-- Replace the two placeholders below before running:
--   :PROJECT_REF          → your project ref (the subdomain part of supabase.co URL)
--   :SERVICE_ROLE_KEY     → your project's service-role key (Settings → API)
--
-- Frequency: every 6 hours. Each tick processes up to 10 pending api-sourced
-- courses with a 2-second gap between Overpass calls.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drop and recreate so re-running this migration is safe.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'sync-courses-osm') then
    perform cron.unschedule('sync-courses-osm');
  end if;
end $$;

select cron.schedule(
  'sync-courses-osm',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://:PROJECT_REF.supabase.co/functions/v1/sync-course-osm',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer :SERVICE_ROLE_KEY'
    ),
    body := jsonb_build_object('syncAll', false)
  );
  $$
);

-- Verify:
--   select jobname, schedule, command from cron.job where jobname = 'sync-courses-osm';
--   select jobname, status, return_message from cron.job_run_details
--     order by start_time desc limit 5;
