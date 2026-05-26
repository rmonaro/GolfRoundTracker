-- ---------------------------------------------------------------------------
-- 012_user_bag_typical_distance.sql
--
-- Adds `user_bag.typical_distance_yards` so a user can record how far they
-- typically hit each club. Used by the hole-tracking aim mode to recommend a
-- club based on the current target distance.
--
-- Stored in yards as numeric(5,1) — supports half-yard precision and values
-- up to 9999.9 (well clear of any real club distance).
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

alter table public.user_bag
  add column if not exists typical_distance_yards numeric(5, 1);
