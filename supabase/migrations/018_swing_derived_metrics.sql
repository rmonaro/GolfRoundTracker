-- 018_swing_derived_metrics.sql
-- Additional MOTION-BASED, relative/estimated signals derived from the same
-- Apple Watch wrist-motion stream. Still NOT launch-monitor measurements —
-- no club path, face angle, plane degrees, launch, ball speed, spin, carry.
--
-- Additive only.

alter table public.swing_metrics
  -- Estimated swing classification from motion magnitude + duration + contact.
  add column if not exists swing_type text
    check (swing_type in ('full', 'pitch', 'chip', 'putt', 'air')),
  -- True when no impact spike was detected (a rehearsal / air swing).
  add column if not exists is_air_swing boolean not null default false,
  -- Wrist rotation amount through the backswing (radians) — a motion amount,
  -- shown to the user only as a relative "short / normal / long".
  add column if not exists backswing_rotation numeric(5, 2),
  -- 0-100 relative: how late the wrist's peak speed occurs in the downswing
  -- (later = more retained speed, a lag-like pattern).
  add column if not exists release_timing_score integer,
  -- 0-100 relative: accelerating through impact (high) vs quitting on it (low).
  add column if not exists deceleration_score integer,
  -- 0-100 relative: how consistent the rotation axis stays from backswing to
  -- downswing (low = an "over-the-top"-style direction shift). A tendency,
  -- NOT a measured club path.
  add column if not exists transition_direction_score integer,
  -- Gravity direction [x,y,z] at takeaway — used to score setup repeatability
  -- across the session.
  add column if not exists address_gravity jsonb;

alter table public.swing_sessions
  -- Average seconds of rest between swings this session.
  add column if not exists avg_rest_seconds numeric(5, 1),
  -- True when the player was working through balls quickly (short rest).
  add column if not exists rushing boolean,
  -- 0-100 relative: how repeatable the address/setup orientation was.
  add column if not exists setup_consistency_score integer;
