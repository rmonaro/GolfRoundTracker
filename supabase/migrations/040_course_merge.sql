-- Duplicate-course merge (migration 040).
--
-- Bulk imports overlap: GolfCourseAPI and OpenGolfAPI both carry Richter Park,
-- and OpenGolfAPI itself can list the same club twice under two spellings of
-- its town ("Fishers Island" / "NY 06390"). The player then sees the same
-- course two or three times in the picker, and only one of the rows has OSM
-- geometry — so which one they tap decides whether auto-tracking works.
--
-- A merge retires the duplicate rather than deleting it. Deleting cascades to
-- holes / hole_features / course_tees and would silently take a player's round
-- history with it if a round were ever missed during reassignment. Instead the
-- loser keeps its rows and points at the survivor: it drops out of every
-- player-facing query, stays available to admins, and the merge can be undone.
--
-- `merged_into` is deliberately NOT enforced as single-level in the database —
-- the merge action rejects chains in application code, where it can explain
-- itself, rather than failing a write with a constraint violation.

alter table public.courses
  add column if not exists merged_into uuid references public.courses(id) on delete set null;
alter table public.courses add column if not exists merged_at timestamptz;
alter table public.courses
  add column if not exists merged_by uuid references public.profiles(id) on delete set null;

-- Partial: the overwhelming majority of rows are null, and every read of this
-- column is either "is null" (player visibility) or "= <survivor>" (admin).
create index if not exists courses_merged_into_idx
  on public.courses(merged_into) where merged_into is not null;

-- A course cannot be merged into itself.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'courses_merged_into_not_self') then
    alter table public.courses add constraint courses_merged_into_not_self
      check (merged_into is null or merged_into <> id);
  end if;
end $$;

comment on column public.courses.merged_into is
  'Set when this course was merged into another as a duplicate. Non-null rows are hidden from players; their holes/tees/features are kept for audit and un-merge.';
