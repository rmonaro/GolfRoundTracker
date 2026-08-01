-- Per-shot swing metrics on round shots (migration 031).
--
-- The watch already runs the SAME swing-motion detector during a round as it
-- does in practice (SwingMotionService/SwingDetector/SwingMetricsCalculator),
-- but round mode previously forwarded only swingType + handSpeed and stored
-- neither. This persists the full motion-derived metric bundle on each
-- auto-detected shot so the round summary can show swing tempo/quality (like
-- practice) and so tracking can use `swing_type` to classify shots.
--
-- These are RELATIVE, motion-based estimates — NOT launch-monitor measurements
-- (no club path, face angle, ball speed, spin). Same caveat as swing_metrics
-- (migrations 017/018).
--
-- Additive only; all nullable (manual/historical shots have no swing data).

alter table public.shots
  -- Motion swing classification (drives putt/lie inference during tracking).
  add column if not exists swing_type text
    check (swing_type in ('full', 'pitch', 'chip', 'putt', 'air')),
  -- Full metric bundle as sent by the watch (camelCase keys): backswingTimeMs,
  -- downswingTimeMs, tempoRatio, transitionScore, estimatedHandSpeed,
  -- wristRotationScore, finishStabilityScore, planeAxis, backswingRotation,
  -- releaseTimingScore, decelerationScore, transitionDirectionScore,
  -- addressGravity, heartRate. Kept as jsonb so the display layer evolves
  -- without a migration per field.
  add column if not exists swing_metrics jsonb,
  -- The watch's monotonic per-round impact id. Used for idempotency so the same
  -- detected strike can't be committed twice (auto-track + a manual Add Shot).
  add column if not exists watch_impact_id bigint;

-- Fast "does a shot for this impact already exist?" lookup per round (dedup).
create index if not exists shots_watch_impact_idx
  on public.shots(round_id, watch_impact_id)
  where watch_impact_id is not null;
