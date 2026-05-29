-- ---------------------------------------------------------------------------
-- 014_profiles_gender.sql
--
-- Adds `profiles.gender` so the club-yardage defaults can pick the right
-- reference table (men's vs women's).
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'gender') then
    create type gender as enum ('male', 'female');
  end if;
end$$;

alter table public.profiles
  add column if not exists gender gender;
