-- Tiling job queue (migration 033).
--
-- Building a course's imagery pack needs GDAL, so it can't run in an edge
-- function or the client. This table is the hand-off: the app (or an admin)
-- queues a course, and a worker container picks it up — on a laptop today, on
-- Railway later, with no code change. Both can run at once safely because
-- claiming is atomic.

create table if not exists public.course_tile_jobs (
  id uuid primary key default uuid_generate_v4(),
  course_id uuid not null references public.courses(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'done', 'failed')),
  -- Set together when a worker takes the job. `claimed_by` is a hostname or
  -- similar, purely so a stuck job can be traced back to the machine.
  claimed_at timestamptz,
  claimed_by text,
  finished_at timestamptz,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

-- One outstanding job per course: re-queueing a course that's already pending
-- should be a no-op, not a second identical job.
create unique index if not exists course_tile_jobs_pending_idx
  on public.course_tile_jobs(course_id)
  where status in ('queued', 'claimed');

create index if not exists course_tile_jobs_status_idx
  on public.course_tile_jobs(status, created_at);

alter table public.course_tile_jobs enable row level security;

do $$
begin
  -- Any signed-in user may see job status (so the app can show "imagery
  -- pending" on a course) but only admins may queue work, and only the worker
  -- (service role, which bypasses RLS) writes results.
  drop policy if exists "course_tile_jobs_read" on public.course_tile_jobs;
  create policy "course_tile_jobs_read" on public.course_tile_jobs
    for select using (auth.role() = 'authenticated');

  -- Reuses the is_admin() helper from migration 007 rather than re-querying
  -- profiles, so the admin test stays in one place.
  drop policy if exists "course_tile_jobs_admin_insert" on public.course_tile_jobs;
  create policy "course_tile_jobs_admin_insert" on public.course_tile_jobs
    for insert with check (public.is_admin(auth.uid()));
end $$;

/**
 * Atomically claim the oldest queued job.
 *
 * `for update skip locked` is what makes a laptop run and a Railway worker safe
 * to run simultaneously — two workers can never take the same course, and
 * neither blocks waiting for the other.
 */
create or replace function public.claim_tile_job(worker text)
returns public.course_tile_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.course_tile_jobs;
begin
  select * into job
  from public.course_tile_jobs
  where status = 'queued'
  order by created_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.course_tile_jobs
  set status = 'claimed',
      claimed_at = now(),
      claimed_by = worker,
      attempts = attempts + 1
  where id = job.id
  returning * into job;

  return job;
end $$;

revoke all on function public.claim_tile_job(text) from public, anon, authenticated;
