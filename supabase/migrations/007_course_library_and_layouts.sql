-- Migration 007 — course library + OSM hole layouts
-- Dialect: PostgreSQL (Supabase). T-SQL linter false-positives expected; paste as-is.
-- Safe to re-run.
--
-- Adds two parallel data pipelines:
--   1) GolfCourseAPI → courses.scorecard_external (admin-imported)
--   2) OSM Overpass → holes + hole_features (auto-synced via edge fn + pg_cron)
--
-- Also gates admin functionality via profiles.is_admin with a trigger that
-- prevents authenticated users from self-promoting (only service_role can).

-- ---------------------------------------------------------------------------
-- 1. profiles.is_admin
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. courses table extensions
-- ---------------------------------------------------------------------------
alter table public.courses add column if not exists course_api_id text;
alter table public.courses add column if not exists club_name text;
alter table public.courses add column if not exists country text;
alter table public.courses add column if not exists lat double precision;
alter table public.courses add column if not exists lng double precision;
alter table public.courses add column if not exists search_radius integer default 1500;
alter table public.courses add column if not exists scorecard_external jsonb;
alter table public.courses add column if not exists osm_synced_at timestamptz;
alter table public.courses add column if not exists osm_status text default 'pending';
alter table public.courses add column if not exists osm_error text;
alter table public.courses add column if not exists source text default 'user';

-- Unique constraint on course_api_id (used by GolfCourseAPI upsert)
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'courses_course_api_id_key'
  ) then
    alter table public.courses add constraint courses_course_api_id_key unique (course_api_id);
  end if;
end $$;

-- Check constraints
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'courses_osm_status_check') then
    alter table public.courses add constraint courses_osm_status_check
      check (osm_status in ('pending', 'synced', 'no_coverage', 'failed', 'skip'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'courses_source_check') then
    alter table public.courses add constraint courses_source_check
      check (source in ('user', 'api'));
  end if;
end $$;

-- Backfill: every existing course was user-added. Mark them and disable OSM sync.
update public.courses
set source = coalesce(source, 'user'),
    osm_status = case
      when source = 'api' then osm_status
      else 'skip'
    end
where osm_status is null or osm_status = 'pending' or source is null;

create index if not exists courses_source_idx on public.courses(source);
create index if not exists courses_osm_status_idx on public.courses(osm_status);

-- ---------------------------------------------------------------------------
-- 3. holes — course-level static geometry
-- Naming note: distinct from `round_holes`, which holds per-round hole state.
-- ---------------------------------------------------------------------------
create table if not exists public.holes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  hole_number integer not null,
  par integer,
  tee_lng double precision,
  tee_lat double precision,
  green_lng double precision,
  green_lat double precision,
  rotation_radians double precision,
  orientation_confidence text
    check (orientation_confidence in ('confirmed', 'reversed', 'assumed', 'manual')),
  bbox_min_lng double precision,
  bbox_min_lat double precision,
  bbox_max_lng double precision,
  bbox_max_lat double precision,
  centerline jsonb,
  unique (course_id, hole_number)
);

create index if not exists holes_course_idx on public.holes(course_id, hole_number);
create index if not exists holes_orientation_idx on public.holes(orientation_confidence);

-- ---------------------------------------------------------------------------
-- 4. hole_features — bunkers, water, fairway polygons, etc. from OSM
-- ---------------------------------------------------------------------------
create table if not exists public.hole_features (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  hole_id uuid references public.holes(id) on delete cascade,
  osm_id bigint,
  feature_type text not null,
  is_line boolean default false,
  coords jsonb not null,
  created_at timestamptz default now()
);

create index if not exists hole_features_course_idx on public.hole_features(course_id);
create index if not exists hole_features_hole_idx on public.hole_features(hole_id);
create index if not exists hole_features_type_idx on public.hole_features(feature_type);

-- ---------------------------------------------------------------------------
-- 5. is_admin helper — used by RLS policies + edge functions
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = uid),
    false
  )
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS policies
-- ---------------------------------------------------------------------------
alter table public.holes enable row level security;
alter table public.hole_features enable row level security;

do $$ begin
  -- holes: any signed-in user can read. Writes go through service_role only
  -- (RLS bypassed for service_role, so no explicit write policy needed).
  drop policy if exists "holes_read_authenticated" on public.holes;
  create policy "holes_read_authenticated" on public.holes
    for select using (auth.uid() is not null);

  drop policy if exists "hole_features_read_authenticated" on public.hole_features;
  create policy "hole_features_read_authenticated" on public.hole_features
    for select using (auth.uid() is not null);

  -- courses: admins can update any course; existing user-insert / user-update policies stay.
  drop policy if exists "courses_admin_update" on public.courses;
  create policy "courses_admin_update" on public.courses
    for update using (public.is_admin(auth.uid()))
    with check (public.is_admin(auth.uid()));
end $$;

-- ---------------------------------------------------------------------------
-- 7. Prevent self-promotion to admin
-- A regular update path can change every column on profiles. We protect
-- is_admin with a trigger that aborts if the calling user (auth.uid()) is
-- trying to change it. service_role calls have auth.uid() = NULL so they pass.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_self_admin_promotion()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.is_admin is distinct from old.is_admin then
    if auth.uid() is not null then
      raise exception 'is_admin can only be changed by the service role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_self_admin on public.profiles;
create trigger profiles_prevent_self_admin
  before update on public.profiles
  for each row execute function public.prevent_self_admin_promotion();
