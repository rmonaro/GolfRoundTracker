-- ---------------------------------------------------------------------------
-- 015_profiles_onboarded_at.sql
--
-- Marker for whether a user has completed first-run onboarding (gender +
-- skill level + initial bag). Null = needs onboarding; timestamp = done.
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists onboarded_at timestamptz;

-- Backfill: any existing user who already has clubs in their bag has
-- effectively completed onboarding — mark them so they don't get pushed
-- through the first-run flow on their next login.
update public.profiles p
set onboarded_at = coalesce(p.onboarded_at, now())
where exists (
  select 1 from public.user_bag b where b.user_id = p.id
);
