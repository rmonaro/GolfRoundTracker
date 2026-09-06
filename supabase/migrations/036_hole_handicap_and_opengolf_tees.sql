-- Stroke index on holes + OpenGolfAPI as a tee source (migration 036).
--
-- Why a column on `holes` rather than another key in `course_tees.holes`:
-- handicap allocation (stroke index) is a property of the HOLE, not of the tee
-- set played from it. Every tee at a course shares the same 1..18 allocation,
-- so storing it per tee duplicates it N times and leaves net scoring with no
-- answer when a round has no tee selected. GolfCourseAPI happens to nest a
-- `handicap` inside each tee's per-hole array; that stays where it is (it's the
-- raw payload shape), but the canonical value now lives here.
--
-- Source: OpenGolfAPI /api/v1/courses/{id}/holes — OSM-mapped and community
-- edited, © OpenStreetMap contributors, ODbL 1.0.

alter table public.holes
  add column if not exists handicap integer;

-- A 9-hole course allocates 1..9, an 18-hole course 1..18. Some clubs number a
-- 27-hole facility's combined cards up to 27, so leave headroom rather than
-- pinning to 18 and rejecting a legitimate import.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'holes_handicap_check') then
    alter table public.holes add constraint holes_handicap_check
      check (handicap is null or (handicap >= 1 and handicap <= 36));
  end if;
end $$;

comment on column public.holes.handicap is
  'Stroke index / handicap allocation for the hole (1 = hardest). Shared across all tee sets.';

-- Tee colour, which OpenGolfAPI carries explicitly ("blue", "gold", "white").
-- Without it the tee picker has to infer a colour by string-matching tee_name,
-- which fails on names like "Championship" or "Member".
alter table public.course_tees
  add column if not exists tee_color text;

comment on column public.course_tees.tee_color is
  'Tee colour as published by the source (e.g. "blue"). Null when the source only names the tee.';

-- `opengolf` joins api/osm/manual as a tee provenance. Kept distinct from
-- `api` (GolfCourseAPI) because the two carry different licences: OpenGolfAPI
-- data is ODbL and requires attribution downstream.
do $$ begin
  alter table public.course_tees drop constraint if exists course_tees_source_check;
  alter table public.course_tees add constraint course_tees_source_check
    check (source in ('api', 'osm', 'manual', 'opengolf'));
end $$;
