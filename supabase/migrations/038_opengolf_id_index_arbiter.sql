-- Make courses.opengolf_id usable as an ON CONFLICT arbiter (migration 038).
--
-- Migration 037 created this index WHERE opengolf_id is not null. Postgres only
-- accepts a partial index as an ON CONFLICT arbiter when the statement repeats
-- the index predicate, and PostgREST's upsert never emits one — so the state
-- import failed with 42P10 ("no unique or exclusion constraint matching the ON
-- CONFLICT specification") on its very first page.
--
-- The predicate bought nothing: NULLs are distinct in a Postgres unique index,
-- so a plain unique index already allows any number of rows with no
-- opengolf_id while still keeping assigned ids unique.

drop index if exists public.courses_opengolf_id_idx;

create unique index if not exists courses_opengolf_id_idx
  on public.courses(opengolf_id);
