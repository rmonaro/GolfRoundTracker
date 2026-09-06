-- Per-course hole `ref` filter for shared OSM extracts (migration 039).
--
-- A multi-course facility is mapped in OSM as ONE area, with each hole's `ref`
-- carrying the course name alongside the number:
--
--   { "golf": "hole", "par": "3", "ref": "14 - Devil's Claw" }
--   { "golf": "hole", "par": "4", "handicap": "9", "ref": "1 - Cattail" }
--
-- Syncing either course pulls every hole in the extract, so a 2x18 facility
-- imports 36 holes and collides on the (course_id, hole_number) unique key.
--
-- With this set, the sync keeps only holes whose ref label contains the filter
-- (case-insensitive) — "Cattail" keeps 1..18 of Cattail and drops Devil's Claw.
-- Holes whose ref is a bare number are always kept, so ordinary single-course
-- extracts are unaffected. Features that land on none of the kept holes are
-- dropped too: in a shared extract they belong to the neighbouring course.
--
-- Left null for the overwhelming majority of courses.

alter table public.courses
  add column if not exists osm_hole_ref_filter text;

comment on column public.courses.osm_hole_ref_filter is
  'For courses sharing an OSM extract: keep only holes whose ref label contains this text (e.g. "Cattail"). Null = keep every hole.';
