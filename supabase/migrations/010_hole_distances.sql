-- ---------------------------------------------------------------------------
-- 010_hole_distances.sql
--
-- Adds two cached Haversine distances to public.holes for the Mapbox layout
-- feature:
--   * centerline_distance_m — total length along the OSM dogleg centerline
--   * straight_distance_m   — tee→green "as the crow flies" Haversine
--
-- Both populated by the sync-course-osm edge function; existing rows stay
-- null until the next sync (or a one-off ?action=recalc-distances run).
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

alter table public.holes
  add column if not exists centerline_distance_m numeric(8, 2);

alter table public.holes
  add column if not exists straight_distance_m numeric(8, 2);
