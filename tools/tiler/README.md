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

| Source | Resolution | Year | Coverage |
|---|---|---|---|
| `ct` | **3 inch** (0.076 m) | **2023** | Connecticut |
| `naip` (default) | 0.6 m | 2019 in much of the northeast | Continental US |

**Source choice matters more than anything else here.** NAIP is free and
nationwide, but the USGS service only carries 2019 for large parts of the
country — old enough that a renovated course looks wrong, which is exactly what
prompted adding state sources. CT's programme is eight times sharper and four
years fresher, also free.

Override with `IMAGERY_SOURCE=naip` (or `ct`) to force one for a run.

### Adding a state

Two edits in `tile_course.py`: an entry in `IMAGERY_SOURCES` with the
endpoint and its request limits, and a line in `STATE_SOURCES` mapping the
state code to it. No schema change — `imagery_source`, `imagery_attribution`
and `imagery_captured_at` are per-course columns, so sources can be mixed
freely.

Worth knowing when adding one: these services advertise per-axis size caps but
actually fail on TOTAL PIXELS, usually with a bare HTTP 500. `max_pixels` in
each config is measured, not documented. NY's programme (2022-2025, 6-12 inch)
is a good next candidate, but its endpoint is a MapServer returning
ungeoreferenced PNG/JPEG, so it needs the extent applied manually — unlike CT
and NAIP, which return proper GeoTIFF.

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
