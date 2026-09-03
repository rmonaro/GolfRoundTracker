-- OpenGolfAPI as a course source (migration 037).
--
-- Bulk state import pulls whole states from OpenGolfAPI (16,800+ US courses,
-- ODbL). Those courses need three things migration 007/009 didn't anticipate:
--
--   1. A `source` value of their own. Reusing 'api' would conflate two
--      differently-licensed datasets — GolfCourseAPI is proprietary, this is
--      © OpenStreetMap contributors under ODbL 1.0, which requires attribution
--      wherever it's shown.
--   2. Somewhere to keep the OpenGolfAPI id. `course_api_id` is the
--      GolfCourseAPI id and carries a unique constraint the import upserts on;
--      putting UUIDs in the same column would mix two id namespaces. A course
--      can legitimately have both ids once a GolfCourseAPI course is matched to
--      its OpenGolfAPI record.
--   3. Read visibility. `courses_api_read` (migration 009) makes library
--      courses readable by gating on source = 'api'; without an equivalent,
--      imported courses would be invisible to every non-admin.

alter table public.courses
  add column if not exists opengolf_id text;

-- Unique so a state re-import upserts rather than duplicating, and so linking
-- an existing course to its OpenGolfAPI record can't double-assign one id.
create unique index if not exists courses_opengolf_id_idx
  on public.courses(opengolf_id)
  where opengolf_id is not null;

comment on column public.courses.opengolf_id is
  'OpenGolfAPI course UUID (ODbL). Set by the state import or by linking an existing course.';

do $$ begin
  alter table public.courses drop constraint if exists courses_source_check;
  alter table public.courses add constraint courses_source_check
    check (source in ('user', 'api', 'opengolf'));
end $$;

-- Mirror courses_api_read for the new source. Deliberately the same shape as
-- migration 009 (no auth.uid() check) so library courses stay readable exactly
-- as GolfCourseAPI ones already are — `verified` keeps its separate meaning of
-- "an admin has actually checked this one".
drop policy if exists "courses_opengolf_read" on public.courses;
create policy "courses_opengolf_read" on public.courses
  for select using (source = 'opengolf');
