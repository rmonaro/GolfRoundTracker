-- Per-course satellite imagery packs (migration 032).
--
-- Golf courses are fixed ~2 km² areas played repeatedly, which makes per-course
-- pre-processing viable where general-purpose offline maps are not. Each course
-- gets ONE PMTiles file in Supabase Storage: a single object the map reads by
-- HTTP range online, and that the device downloads whole for offline play.
--
-- Why we host imagery ourselves rather than caching a provider's tiles: both
-- Mapbox and MapTiler permit only temporary per-user caching and prohibit bulk
-- tile download, so a pre-downloaded course would breach their terms. USDA NAIP
-- imagery is public domain (0.3–0.6 m since 2018) and may be redistributed with
-- attribution, so the tiles we generate are genuinely ours to ship offline.
--
-- Additive only; all nullable. A course with no pack falls back to online
-- Mapbox exactly as before — which is also how non-US courses keep working
-- until imagery exists for them.

alter table public.courses
  -- Public URL of the .pmtiles object. Null = no pack; use the online fallback.
  add column if not exists tiles_url text,
  add column if not exists tiles_generated_at timestamptz,
  -- Zoom range baked into the pack, so the client can set minzoom/maxzoom on
  -- the raster source instead of requesting tiles that don't exist.
  add column if not exists tiles_min_zoom smallint,
  add column if not exists tiles_max_zoom smallint,
  -- Approximate size, so a download can be sized before it starts.
  add column if not exists tiles_size_bytes bigint,
  -- 'naip' today. Per-course so worldwide expansion can mix sources without
  -- another migration — each region brings its own licensing and attribution.
  add column if not exists imagery_source text,
  -- Required credit line, rendered on the map. NAIP asks for USDA attribution.
  add column if not exists imagery_attribution text,
  -- Acquisition date of the source imagery. Fairways don't move, but a course
  -- mid-renovation is exactly when a golfer needs to know the photo is old.
  add column if not exists imagery_captured_at date;

comment on column public.courses.tiles_url is
  'Public URL of this course''s PMTiles imagery pack; null falls back to online Mapbox.';
