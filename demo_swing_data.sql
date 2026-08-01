-- ===========================================================================
-- DEMO swing data for round 108db827-2e26-4455-b163-eaf71d203735
--
-- Fills shots.swing_type / swing_metrics with realistic FAKE watch data so the
-- round summary's Holes tab shows the per-shot swing detail expander.
--
-- SAFETY:
--   * Scoped to this ONE round id.
--   * Only touches shots where swing_metrics IS NULL, so any real captured
--     watch data is never overwritten. Re-running is therefore a no-op on
--     rows it already filled... EXCEPT it will not refill them either, which
--     is what you want.
--   * Touches only the 3 swing columns. Scores, distances, clubs, GPS and
--     verification flags are untouched, so the scorecard cannot change.
--   * Fully reversible — see step 4.
--
-- Run in: Supabase Dashboard → SQL Editor (runs as postgres, bypasses RLS;
-- the app's anon key cannot do this because of the shots_owner_rw policy).
-- ===========================================================================


-- --- 1. PREFLIGHT: is migration 031 applied? -------------------------------
-- Expect 3 rows (swing_type, swing_metrics, watch_impact_id). If you get 0
-- rows, apply supabase/migrations/031_shot_swing_metrics.sql first — the
-- update below will fail with "column does not exist" otherwise.

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'shots'
  and column_name in ('swing_type', 'swing_metrics', 'watch_impact_id')
order by column_name;


-- --- 2. PREVIEW: what will be filled ---------------------------------------
-- Sanity-check the round has shots and see how many are eligible.

select
  count(*)                                          as total_shots,
  count(*) filter (where s.swing_metrics is null)   as will_be_filled,
  count(*) filter (where s.swing_metrics is not null) as already_have_real_data
from public.shots s
where s.round_id = '108db827-2e26-4455-b163-eaf71d203735';


-- --- 3. FILL ---------------------------------------------------------------
-- Variety is deliberate: the 4 buckets below trigger different feedback chips
-- (all-positive, all-attention, neutral, mixed) and different backswing-length
-- labels, so the UI is actually exercised rather than showing 18 identical rows.

with ordered as (
  select
    s.id,
    row_number() over (order by rh.hole_number, s.shot_number) as n,
    (s.target_type = 'putt' or s.shot_result in ('putt', 'made_putt')) as is_putt,
    coalesce(s.distance, 200) as dist
  from public.shots s
  join public.round_holes rh on rh.id = s.hole_id
  where s.round_id = '108db827-2e26-4455-b163-eaf71d203735'
    and s.swing_metrics is null
),
shaped as (
  select
    id,
    n,
    is_putt,
    case
      when is_putt then 'putt'
      when dist < 30 then 'chip'
      when dist < 70 then 'pitch'
      else 'full'
    end as swing_type,
    -- Bucket 0 = clean swing, 1 = rushed/aggressive, 2 = slow backswing,
    -- 3 = mixed (good tempo, unstable finish).
    (n % 4) as bucket
  from ordered
)
update public.shots s
set
  swing_type = sh.swing_type,
  swing_metrics = jsonb_build_object(
    'backswingTimeMs', case
      when sh.is_putt then 420
      when sh.bucket = 0 then 810
      when sh.bucket = 1 then 560
      when sh.bucket = 2 then 980
      else 760
    end,
    'downswingTimeMs', case
      when sh.is_putt then 380
      when sh.bucket = 0 then 270
      when sh.bucket = 1 then 295
      when sh.bucket = 2 then 228
      else 271
    end,
    'tempoRatio', case
      when sh.is_putt then 1.1
      when sh.bucket = 0 then 3.0
      when sh.bucket = 1 then 1.9   -- fires BACKSWING_RUSHED
      when sh.bucket = 2 then 4.3   -- fires BACKSWING_SLOW
      else 2.8                       -- fires TEMPO_GOOD
    end,
    'transitionScore', case
      when sh.is_putt then 71
      when sh.bucket = 0 then 82    -- TRANSITION_SMOOTH
      when sh.bucket = 1 then 32    -- TRANSITION_AGGRESSIVE
      when sh.bucket = 2 then 60    -- (no chip)
      else 78                        -- TRANSITION_SMOOTH
    end,
    'finishStabilityScore', case
      when sh.is_putt then 88
      when sh.bucket = 0 then 85    -- FINISH_BALANCED
      when sh.bucket = 1 then 35    -- FINISH_UNSTABLE
      when sh.bucket = 2 then 62    -- (no chip)
      else 38                        -- FINISH_UNSTABLE
    end,
    'estimatedHandSpeed', case
      when sh.is_putt then 18
      when sh.bucket = 0 then 79
      when sh.bucket = 1 then 84
      when sh.bucket = 2 then 66
      else 74
    end,
    'wristRotationScore', 55 + ((sh.n * 7) % 40),
    'releaseTimingScore', 48 + ((sh.n * 11) % 45),
    'decelerationScore', 52 + ((sh.n * 13) % 40),
    'transitionDirectionScore', 45 + ((sh.n * 17) % 48),
    -- Radians. <1.6 renders "Short", >2.6 "Long", else "Normal".
    'backswingRotation', case
      when sh.is_putt then 0.9
      when sh.bucket = 2 then 2.85
      when sh.bucket = 1 then 1.45
      else 2.15
    end,
    -- The one genuinely-measured value in the bundle (HealthKit).
    'heartRate', 94 + ((sh.n * 5) % 34)
  )
from shaped sh
where s.id = sh.id;


-- --- 4. VERIFY -------------------------------------------------------------

select
  rh.hole_number,
  s.shot_number,
  s.swing_type,
  s.swing_metrics ->> 'tempoRatio'         as tempo,
  s.swing_metrics ->> 'estimatedHandSpeed' as effort,
  s.swing_metrics ->> 'heartRate'          as bpm
from public.shots s
join public.round_holes rh on rh.id = s.hole_id
where s.round_id = '108db827-2e26-4455-b163-eaf71d203735'
order by rh.hole_number, s.shot_number;


-- --- 5. ROLLBACK (uncomment to undo) ---------------------------------------
-- Clears the demo data. NOTE: this clears ALL swing data on the round, so if
-- you later record real watch shots into this same round, narrow the WHERE
-- clause before running it.
--
-- update public.shots
-- set swing_type = null, swing_metrics = null
-- where round_id = '108db827-2e26-4455-b163-eaf71d203735';
