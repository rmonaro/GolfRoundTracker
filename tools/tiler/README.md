# Course imagery tiler

Builds one PMTiles satellite pack per golf course, for offline play.

```
holes geometry → bbox → NAIP imagery → warp → MBTiles → PMTiles → Supabase Storage
```

Part of Phase 3 in [`docs/OFFLINE_MODE.md`](../../docs/OFFLINE_MODE.md).

## Why we host the imagery

Mapbox and MapTiler both permit only *temporary, per-user* caching and prohibit
bulk tile download — so pre-downloading a course from either would breach their
terms. Legal offline via those providers means Mapbox's native Mobile SDK (needs
a native map view; the Capacitor plugins are unmaintained) or MapTiler On-Prem
($2,500/yr, 500 MAU cap, medium-res satellite).

USDA **NAIP** imagery is public domain — 0.3–0.6 m since 2018, redistributable
with attribution. A golf course is a fixed ~2 km² area played repeatedly, so
per-course pre-processing is cheap and the resulting tiles are genuinely ours to
ship offline.

## Setup

```bash
docker build -t grt-tiler tools/tiler
```

Create `tools/tiler/.env` (git-ignored — it holds a service-role key):

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

> The service-role key bypasses RLS. It belongs only here and in the Railway
> environment — never in the app bundle.

Apply migrations `032_course_imagery.sql` and `033_course_tile_jobs.sql` first.

## Usage

One course:

```bash
docker run --rm --env-file tools/tiler/.env grt-tiler --course-id <uuid>
```

Drain the job queue (what you'd run overnight):

```bash
docker run --rm --env-file tools/tiler/.env grt-tiler --claim --loop
```

Queue a course from SQL:

```sql
insert into public.course_tile_jobs (course_id) values ('<uuid>');
```

Claiming is atomic (`for update skip locked`), so a laptop run and a Railway
worker can run simultaneously without ever taking the same course.

## Imagery source

Chosen automatically from the course's `state`, falling back to NAIP.

| Source | Resolution | Year | Coverage | Kind |
|---|---|---|---|---|
| `ct` | **3 inch** (0.076 m) | **2023** | Connecticut | ImageServer |
| `ny` | ~6 inch (0.15 m) | 2022–2025 rolling | New York State | MapServer |
| `ma` | 15 cm (7.5 cm on Cape Cod) | **2025** | Massachusetts | tile cache |
| `az` | 0.3 m | **2023** | Arizona | ImageServer |
| `naip` (default) | 0.6 m | 2019 in much of the northeast | Continental US | ImageServer |

**Source choice matters more than anything else here.** NAIP is free and
nationwide, but the USGS service only carries 2019 for large parts of the
country — old enough that a renovated course looks wrong, which is exactly what
prompted adding state sources. CT's programme is eight times sharper and four
years fresher, also free.

Arizona is the cheap version of the same win: AZGeo republishes the *same* NAIP
programme, but its 2023 layer is 0.3 m where the national service still serves
2019 at 0.6 m. Same licence, same request shape, twice the resolution and four
years newer — so `az` is worth using for any Arizona course.

Override with `IMAGERY_SOURCE=naip` (or `ct`) to force one for a run.

### Adding a state

Usually two edits in `tile_course.py`: an entry in `IMAGERY_SOURCES` with the
endpoint and its request limits, and a line in `STATE_SOURCES` mapping the
state code to it. No schema change — `imagery_source`, `imagery_attribution`
and `imagery_captured_at` are per-course columns, so sources can be mixed
freely.

**First work out which of the three kinds you're dealing with**, because it
decides how much work it is:

| `kind` | What the endpoint gives you | Examples |
|---|---|---|
| `imageserver` | `exportImage` → a real GeoTIFF, ready to use | NAIP, CT |
| `mapserver` | `export` → a bare image, **no georeferencing** | NY |
| `tilecache` | No bbox export at all — a cached XYZ pyramid | MA |

For `mapserver` the extent is stamped on afterwards with `-a_ullr`, which takes
upper-left then lower-right: **maxY precedes minY**, and getting that order
wrong mirrors the image inside a correct bbox, which looks plausible and is
badly wrong.

For `tilecache` there is nothing to size-split — GDAL's WMS driver reads the
pyramid as one raster and fetches only the 256px blocks the window touches, so
`max_w`/`max_h`/`max_pixels` are all `None`. Two things bite here instead:

- The cache's deepest level is a hard ceiling. MassGIS advertises LODs to z23
  and publishes 7.5 cm on Cape Cod, but z21 returns 404 — the cache stops at
  z20, so that is `max_zoom` regardless of native resolution. Probe it with a
  single `curl` on a tile before assuming.
- Thousands of small CDN requests fail differently from one big export: dropped
  TLS connections surface as `SSL_read: unexpected eof` with **HTTP status 0**.
  Do NOT add 0 to `ZeroBlockHttpCodes` to silence it — that turns a dropped
  connection into a black square in the middle of a fairway. Retry instead
  (`GDAL_HTTP_MAX_RETRY`) and pin `GDAL_HTTP_VERSION=1.1`.

For the export kinds, note that these services advertise per-axis size caps but
actually fail on TOTAL PIXELS, usually with a bare HTTP 500. `max_pixels` in
each config is measured, not documented.

Whatever the kind, verify georeferencing on a real course before trusting a new
source: pull one tile from the finished pack and the same z/x/y straight from
the publisher, and look at both. Identical framing proves the whole chain.

## Size and zoom

`MAX_ZOOM` defaults to **18** (~0.6 m/px), which is enough to pick a line over
trees and read bunker shapes. `MAX_ZOOM=19` roughly triples the pack for detail
that only matters inside a few yards.

**Measured on real NAIP imagery: ~4 MB per course.** A 1.27 × 1.22 km footprint
produced a 1.88 MB pack (186 tiles, ~10 KB each as JPEG); a typical 2.0 × 1.7 km
course scales to ~4.1 MB. Tiles are JPEG rather than PNG — roughly 5× smaller
for aerial photography, which matters when a golfer downloads over cellular.

The base zoom is pinned by warping to exactly the z18 ground resolution (`-tr`).
Don't rely on the MBTiles `ZOOM_LEVEL` creation option: the driver silently
ignores it and picks the zoom nearest the source resolution instead, which sends
native 0.3 m NAIP to z19.

For comparison, the vector geometry cached in Phase 2 is ~145 KB per course —
imagery is ~28× larger, which is why it gets a download-management UI and the
geometry doesn't.

## Moving to Railway

Nothing changes. Deploy this same image, set the same environment variables, and
run it as a cron job or one-off with `--claim --loop`. Do that when you want
courses tiled on demand without being present, or when worldwide expansion grows
the volume past what's comfortable to babysit.

## Worldwide

NAIP is US-only. The app already falls back to online Mapbox for any course with
no `tiles_url`, so non-US courses keep working exactly as they do today. Adding
a region means adding an imagery source to `fetch_*` in `tile_course.py`;
`imagery_source` and `imagery_attribution` are per-course columns so licensing
and credit can vary without a schema change.
