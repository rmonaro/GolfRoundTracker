-- ---------------------------------------------------------------------------
-- 013_profiles_skill_level.sql
--
-- Adds `profiles.skill_level` so a user can self-identify their playing
-- ability. Used to tailor recommendations and stats expectations.
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'skill_level') then
    create type skill_level as enum (
      'beginner',
      'average',
      'good',
      'advanced',
      'pga_tour'
    );
  end if;
end$$;

alter table public.profiles
  add column if not exists skill_level skill_level;
