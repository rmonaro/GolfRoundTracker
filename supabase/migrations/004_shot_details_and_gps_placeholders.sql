-- Migration 004 — V1 shot details + V2 GPS placeholders.
-- Dialect: PostgreSQL (Supabase). Editors using a T-SQL linter may flag
-- `add column if not exists` and `gin` indexes as errors — those are valid
-- Postgres extensions, run them as-is in the Supabase SQL editor.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Expand shot_result enum to cover the V1 result set.
--    Postgres requires us to add enum values one at a time. Each is idempotent.
-- ---------------------------------------------------------------------------
alter type shot_result add value if not exists 'left';
alter type shot_result add value if not exists 'right';
alter type shot_result add value if not exists 'short';
alter type shot_result add value if not exists 'long';
alter type shot_result add value if not exists 'putt';
alter type shot_result add value if not exists 'made_putt';
-- existing values kept: fairway, rough, sand, green, penalty, recovery

-- ---------------------------------------------------------------------------
-- 2. Per-shot manual distance + unit.
-- ---------------------------------------------------------------------------
alter table public.shots add column if not exists distance numeric(6,1);
alter table public.shots add column if not exists distance_unit text
  check (distance_unit in ('yards', 'feet'));

-- ---------------------------------------------------------------------------
-- 3. V2 placeholders — populated by future GPS flow.
--    Stored now (nullable) so we don't need another migration when GPS ships.
--    Future fields:
--      • start_lat / start_lng — captured when user taps "Start Shot"
--      • end_lat / end_lng     — captured when user taps "End Shot" / walks to ball
--      • calculated_distance   — derived from the two coords (haversine), in yards
--      • club_average_distance — rolling per-user-per-club average (computed view)
-- ---------------------------------------------------------------------------
alter table public.shots add column if not exists start_lat numeric(9,6);
alter table public.shots add column if not exists start_lng numeric(9,6);
alter table public.shots add column if not exists end_lat numeric(9,6);
alter table public.shots add column if not exists end_lng numeric(9,6);
alter table public.shots add column if not exists calculated_distance numeric(6,1);

-- ---------------------------------------------------------------------------
-- 4. clubs_used on round_holes is now derived from shots, not user-edited.
--    The column stays (backwards compatible) but the V1 client no longer writes
--    to it. V2 can either drop it or backfill from a SQL view.
-- ---------------------------------------------------------------------------
-- (no-op intentionally — kept here as documentation)
