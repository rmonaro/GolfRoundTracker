-- Golf Round Tracker — Postgres schema
-- Run in the Supabase SQL editor or via `supabase db push`.
-- Enables RLS so users can only access their own data.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create type dominant_hand as enum ('right', 'left');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  email text not null,
  handicap_goal numeric(4,1),
  dominant_hand dominant_hand,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Safe-add for existing installs (migration 007).
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- Auto-create a profile row whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- clubs (shared catalog, scoped via user_bag)
-- ---------------------------------------------------------------------------
create type club_category as enum ('driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter');

create table if not exists public.clubs (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category club_category not null
);

create table if not exists public.user_bag (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  custom_name text,
  brand text,
  model text,
  loft numeric(4,1),
  order_position integer not null default 0
);

-- Safe-add for existing installs that ran schema.sql before brand/model/loft existed.
alter table public.user_bag add column if not exists brand text;
alter table public.user_bag add column if not exists model text;
alter table public.user_bag add column if not exists loft numeric(4,1);

create index if not exists user_bag_user_idx on public.user_bag(user_id, order_position);

-- ---------------------------------------------------------------------------
-- courses
-- ---------------------------------------------------------------------------
create table if not exists public.courses (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  tee_box text,
  course_rating numeric(4,1),
  slope_rating integer,
  total_par integer,
  total_yardage integer,
  address text,
  city text,
  state text,
  zip text,
  -- Course library (migration 007)
  course_api_id text unique,
  club_name text,
  country text,
  lat double precision,
  lng double precision,
  search_radius integer default 1500,
  scorecard_external jsonb,
  osm_synced_at timestamptz,
  osm_status text default 'pending' check (osm_status in ('pending', 'synced', 'no_coverage', 'failed', 'skip')),
  osm_error text,
  source text default 'user' check (source in ('user', 'api')),
  created_by_user uuid references public.profiles(id) on delete set null
);

-- Safe-add for existing installs (migration 002 + 007).
alter table public.courses add column if not exists address text;
alter table public.courses add column if not exists city text;
alter table public.courses add column if not exists state text;
alter table public.courses add column if not exists zip text;
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

create index if not exists courses_user_idx on public.courses(created_by_user);
create index if not exists courses_source_idx on public.courses(source);
create index if not exists courses_osm_status_idx on public.courses(osm_status);

-- Course library — static hole geometry sourced from OSM (migration 007).
-- Distinct from `round_holes`, which holds per-round hole state.
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
-- rounds
-- ---------------------------------------------------------------------------
create table if not exists public.rounds (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  course_name text not null,
  holes_played integer not null,
  score integer not null default 0,
  par integer not null default 0,
  score_vs_par integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  course_rating numeric(4,1),
  slope_rating integer,
  estimated_handicap numeric(4,1),
  handicap_differential numeric(5,1)
);

create index if not exists rounds_user_started_idx on public.rounds(user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- round_holes
-- ---------------------------------------------------------------------------
create type fairway_result as enum ('hit', 'left', 'right', 'short', 'long', 'na');

create table if not exists public.round_holes (
  id uuid primary key default uuid_generate_v4(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  hole_number integer not null,
  par integer not null,
  yardage integer,
  strokes integer not null default 0,
  putts integer not null default 0,
  fairway_result fairway_result,
  sand boolean not null default false,
  gir boolean not null default false,
  penalty_strokes integer not null default 0,
  clubs_used uuid[] not null default '{}',
  unique (round_id, hole_number)
);

alter table public.round_holes
  add column if not exists clubs_used uuid[] not null default '{}';

create index if not exists round_holes_round_idx on public.round_holes(round_id, hole_number);
create index if not exists round_holes_clubs_used_idx
  on public.round_holes using gin (clubs_used);

-- ---------------------------------------------------------------------------
-- shots
-- ---------------------------------------------------------------------------
create type shot_result as enum (
  'fairway', 'rough', 'sand', 'green', 'penalty', 'recovery',
  'left', 'right', 'short', 'long', 'putt', 'made_putt'
);

create table if not exists public.shots (
  id uuid primary key default uuid_generate_v4(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  hole_id uuid not null references public.round_holes(id) on delete cascade,
  shot_number integer not null,
  club_id uuid references public.clubs(id) on delete set null,
  shot_result shot_result not null,
  distance numeric(6,1),
  distance_unit text check (distance_unit in ('yards', 'feet')),
  notes text,
  -- V2 GPS placeholders (nullable until GPS flow ships)
  start_lat numeric(9,6),
  start_lng numeric(9,6),
  end_lat numeric(9,6),
  end_lng numeric(9,6),
  calculated_distance numeric(6,1),
  created_at timestamptz not null default now()
);

-- Safe-add: existing installs see migrations/004 for these columns + enum extensions.
alter table public.shots add column if not exists distance numeric(6,1);
alter table public.shots add column if not exists distance_unit text
  check (distance_unit in ('yards', 'feet'));
alter table public.shots add column if not exists start_lat numeric(9,6);
alter table public.shots add column if not exists start_lng numeric(9,6);
alter table public.shots add column if not exists end_lat numeric(9,6);
alter table public.shots add column if not exists end_lng numeric(9,6);
alter table public.shots add column if not exists calculated_distance numeric(6,1);

-- Structured shot outcomes (migration 005)
alter table public.shots add column if not exists target_type text
  check (target_type in ('green', 'fairway', 'putt'));
alter table public.shots add column if not exists target_result text
  check (target_result in ('hit', 'left', 'right', 'short', 'long', 'made', 'missed'));
alter table public.shots add column if not exists lie text
  check (lie in ('fairway', 'rough', 'bunker', 'green', 'penalty'));

-- Per-shot penalty type (migration 006)
alter table public.shots add column if not exists penalty_type text
  check (penalty_type in ('ob', 'water', 'lost_ball', 'unplayable', 'wrong_ball', 'bunker'));

create index if not exists shots_round_hole_idx on public.shots(round_id, hole_id, shot_number);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.user_bag enable row level security;
alter table public.courses enable row level security;
alter table public.rounds enable row level security;
alter table public.round_holes enable row level security;
alter table public.shots enable row level security;
alter table public.holes enable row level security;
alter table public.hole_features enable row level security;

-- is_admin helper (migration 007) — used by RLS policies + edge functions.
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

-- Prevent users from self-promoting to admin (migration 007).
-- service_role bypasses RLS but triggers still run; auth.uid() = NULL signals service_role.
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

-- Helper: drop and re-create a policy idempotently.
do $$ begin
  -- profiles
  drop policy if exists "profiles_self_select" on public.profiles;
  drop policy if exists "profiles_self_modify" on public.profiles;
  create policy "profiles_self_select" on public.profiles
    for select using (auth.uid() = id);
  create policy "profiles_self_modify" on public.profiles
    for all using (auth.uid() = id) with check (auth.uid() = id);

  -- clubs: public read so we don't duplicate the catalog; only signed-in users can create/own clubs.
  drop policy if exists "clubs_read_all" on public.clubs;
  drop policy if exists "clubs_authenticated_insert" on public.clubs;
  create policy "clubs_read_all" on public.clubs for select using (true);
  create policy "clubs_authenticated_insert" on public.clubs
    for insert with check (auth.uid() is not null);

  -- user_bag
  drop policy if exists "user_bag_owner_rw" on public.user_bag;
  create policy "user_bag_owner_rw" on public.user_bag
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

  -- courses: visible if you created it OR if it has no owner (shared course catalog).
  drop policy if exists "courses_select" on public.courses;
  drop policy if exists "courses_insert" on public.courses;
  drop policy if exists "courses_update_own" on public.courses;
  drop policy if exists "courses_delete_own" on public.courses;
  create policy "courses_select" on public.courses
    for select using (created_by_user = auth.uid() or created_by_user is null);
  create policy "courses_insert" on public.courses
    for insert with check (auth.uid() = created_by_user);
  create policy "courses_update_own" on public.courses
    for update using (auth.uid() = created_by_user);
  create policy "courses_delete_own" on public.courses
    for delete using (auth.uid() = created_by_user);

  -- rounds
  drop policy if exists "rounds_owner_rw" on public.rounds;
  create policy "rounds_owner_rw" on public.rounds
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

  -- round_holes via parent round ownership
  drop policy if exists "round_holes_owner_rw" on public.round_holes;
  create policy "round_holes_owner_rw" on public.round_holes
    for all using (
      exists (select 1 from public.rounds r where r.id = round_holes.round_id and r.user_id = auth.uid())
    ) with check (
      exists (select 1 from public.rounds r where r.id = round_holes.round_id and r.user_id = auth.uid())
    );

  -- shots via parent round ownership
  drop policy if exists "shots_owner_rw" on public.shots;
  create policy "shots_owner_rw" on public.shots
    for all using (
      exists (select 1 from public.rounds r where r.id = shots.round_id and r.user_id = auth.uid())
    ) with check (
      exists (select 1 from public.rounds r where r.id = shots.round_id and r.user_id = auth.uid())
    );

  -- Course library (migration 007)
  drop policy if exists "holes_read_authenticated" on public.holes;
  create policy "holes_read_authenticated" on public.holes
    for select using (auth.uid() is not null);

  drop policy if exists "hole_features_read_authenticated" on public.hole_features;
  create policy "hole_features_read_authenticated" on public.hole_features
    for select using (auth.uid() is not null);

  -- Admins can update any course (user-insert + user-update from earlier policies stay).
  drop policy if exists "courses_admin_update" on public.courses;
  create policy "courses_admin_update" on public.courses
    for update using (public.is_admin(auth.uid()))
    with check (public.is_admin(auth.uid()));

  -- Library: any signed-in user can read api-sourced courses (migration 009).
  drop policy if exists "courses_api_read" on public.courses;
  create policy "courses_api_read" on public.courses
    for select using (source = 'api');
end $$;
