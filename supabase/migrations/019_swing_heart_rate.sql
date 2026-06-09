-- 019_swing_heart_rate.sql
-- Heart-rate + workout data captured by the Apple Watch HealthKit workout
-- session during practice. Additive only. These ARE real measurements (HR is
-- a sensor reading), unlike the motion-derived estimates.

alter table public.swing_metrics
  -- Heart rate (bpm) at the moment of the swing.
  add column if not exists heart_rate integer;

alter table public.swing_sessions
  add column if not exists avg_heart_rate integer,
  add column if not exists max_heart_rate integer,
  add column if not exists min_heart_rate integer,
  -- Heart-rate variability (SDNN, ms) — often absent during activity.
  add column if not exists hrv_sdnn numeric(6, 1),
  add column if not exists active_calories numeric(6, 1),
  add column if not exists duration_seconds integer;
