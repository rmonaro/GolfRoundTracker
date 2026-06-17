-- Migration 022 — admin read access for the admin panel.
-- Dialect: PostgreSQL (Supabase). Safe to re-run.
--
-- The admin panel lists ALL users and the rounds they have played. The default
-- RLS policies only expose a user's own profile/rounds, so admins (verified by
-- the existing public.is_admin(auth.uid()) helper from migration 007) need
-- additional permissive SELECT policies. Postgres combines permissive policies
-- with OR, so these add admin visibility without affecting normal users.

-- profiles: admins can read every profile (normal users still read only their own).
drop policy if exists "profiles_admin_select" on public.profiles;
create policy "profiles_admin_select" on public.profiles
  for select using (public.is_admin(auth.uid()));

-- rounds: admins can read every round.
drop policy if exists "rounds_admin_select" on public.rounds;
create policy "rounds_admin_select" on public.rounds
  for select using (public.is_admin(auth.uid()));

-- round_holes: admins can read hole-by-hole detail for any round (future round detail view).
drop policy if exists "round_holes_admin_select" on public.round_holes;
create policy "round_holes_admin_select" on public.round_holes
  for select using (public.is_admin(auth.uid()));

-- shots: admins can read shot detail for any round.
drop policy if exists "shots_admin_select" on public.shots;
create policy "shots_admin_select" on public.shots
  for select using (public.is_admin(auth.uid()));
