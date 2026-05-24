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
  created_at timestamptz not null default now()
);

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
  created_by_user uuid references public.profiles(id) on delete set null
);

-- Safe-add for existing installs that ran schema.sql before address/city/state/zip existed.
alter table public.courses add column if not exists address text;
alter table public.courses add column if not exists city text;
alter table public.courses add column if not exists state text;
alter table public.courses add column if not exists zip text;

create index if not exists courses_user_idx on public.courses(created_by_user);

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
end $$;
