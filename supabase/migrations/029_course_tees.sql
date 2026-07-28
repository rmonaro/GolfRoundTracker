-- Named tee sets per course + round tee selection (migration 029).
--
-- A course can offer several tee sets (Blue / White / Red / Championship …),
-- each with its own course/slope rating and a per-hole yardage list. GolfCourseAPI
-- returns these under `scorecard_external.tees.{male,female}[]`; the courses-api
-- import edge function fans them out into `course_tees` rows (source='api').
-- Overpass-sourced (OSM) tee boxes that carry a name/ref can be surfaced as
-- name-only rows (source='osm'); their physical geometry already lives in
-- `hole_features` (feature_type='tee') and renders on the hole map.
--
-- Reference data, shared across all users: read for any authenticated user
-- (mirrors holes / hole_features); writes are service_role only (edge functions).
--
-- `rounds` gains `tee_id` / `tee_name` so a round records which tee was played.
-- Selecting a tee at round start stamps the round's course_rating/slope_rating
-- and seeds per-hole round_holes.yardage from the tee's `holes` array.

create table if not exists public.course_tees (
  id uuid primary key default uuid_generate_v4(),
  course_id uuid not null references public.courses(id) on delete cascade,

  -- 'male' | 'female' | null. GolfCourseAPI splits tees by gender; the same
  -- tee_name (e.g. "Blue") can appear under both with different ratings.
  gender text check (gender in ('male', 'female')),

  tee_name text not null,          -- "Blue", "White", "Red", "Championship" …
  course_rating numeric(4,1),
  slope_rating integer,
  bogey_rating numeric(4,1),
  total_yards integer,
  total_meters integer,
  par_total integer,
  number_of_holes integer,

  -- Per-hole detail as returned by the source: [{ par, yardage, handicap }, …]
  -- Index 0 = hole 1. Used to seed per-hole yardage on the round.
  holes jsonb,

  source text not null default 'api' check (source in ('api', 'osm', 'manual')),
  created_at timestamptz not null default now()
);

create index if not exists course_tees_course_idx on public.course_tees(course_id);

-- A course shouldn't hold duplicate (gender, tee_name) rows from the same source;
-- lets the import upsert (onConflict) rather than accumulate on re-import.
-- Plain-column index so PostgREST's onConflict can match it. API tees always
-- carry a gender, so uniqueness is well-defined for the import path.
create unique index if not exists course_tees_unique_idx
  on public.course_tees(course_id, source, gender, tee_name);

alter table public.course_tees enable row level security;

do $$ begin
  -- Reference data: readable by any signed-in user, like holes/hole_features.
  -- No insert/update/delete policy => only service_role (which bypasses RLS)
  -- can write, matching how holes are populated by edge functions.
  drop policy if exists "course_tees_read_authenticated" on public.course_tees;
  create policy "course_tees_read_authenticated" on public.course_tees
    for select using (auth.uid() is not null);
end $$;

-- Round tee selection.
alter table public.rounds add column if not exists tee_id uuid references public.course_tees(id) on delete set null;
alter table public.rounds add column if not exists tee_name text;
