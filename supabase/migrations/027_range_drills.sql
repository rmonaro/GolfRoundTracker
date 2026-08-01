-- Structured practice drills on top of the GPS range mode (migration 027).
--
-- A drill run is just a range_session with drill metadata — drills write to the
-- existing range_sessions / range_shots tables (no new tables), which preserves
-- the watch-swing join (swing_event_id) and reuses all the range tooling.
--
--   range_sessions.drill_id      — which drill (null = free play), e.g. 'gapping'
--   range_sessions.drill_config  — the choices made at setup (clubs, shot counts…)
--   range_shots.prescribed_club  — the club the drill ASKED for that shot
--   range_shots.target_yards     — the intended carry for that shot, if any
--   range_shots.proximity_m      — distance from where it landed to the intended
--                                  point (meters); null for non-proximity drills
--
-- Distances stay metric (meters); the display layer converts to yards.

alter table public.range_sessions
  add column if not exists drill_id text,
  add column if not exists drill_config jsonb;

alter table public.range_shots
  add column if not exists prescribed_club text,
  add column if not exists target_yards double precision,
  add column if not exists proximity_m double precision;

-- Lets history/lists filter to drill runs (or free play) cheaply.
create index if not exists range_sessions_drill_id_idx on public.range_sessions (drill_id);
