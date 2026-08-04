# Offline Mode — Implementation Plan

**Status:** Phases 0-5 implemented and verified. Phase 6 (watch) outstanding.
Offline satellite imagery confirmed rendering in a browser from a real pack.
**Written:** 2026-07-31
**Goal:** a golfer arrives at a course with no usable signal, plays a full round
with satellite maps, live GPS position and distance-to-pin on both phone and
watch, and everything syncs when service returns.

---

## 1. The problem

Golf courses are the worst-case connectivity environment: rural, no wifi, one
bar of LTE if you're lucky, and the phone is in a pocket for four hours. Today
that breaks three separate things — map tiles, course geometry, and every write
to Supabase.

The requirement is specifically **satellite imagery**, not a schematic. Golfers
use the aerial view to pick a line over trees and read bunker shapes; a vector
render of the hole outline is not a substitute.

---

## 2. Current state

### Already works offline (more than expected)

| Capability | Why it already works |
|---|---|
| GPS position | `@capacitor/geolocation` is device-local, no network |
| Distance math | `src/features/course/distance.ts` — local haversine |
| Active round survives reload | `roundStore` uses zustand `persist` (`roundStore.ts:118`) |
| Shots written locally first | `addShotLocal` runs before the remote call (`HoleTrackingPage.tsx:1370`) |
| Watch computes its own distances | From its own GPS + per-hole green/pin coords pushed over WatchConnectivity |
| A network-free hole renderer exists | `buildSvgRender()` (`HoleLayout.tsx:2296-2544`), used today when the Mapbox token is absent |

### What breaks

| # | Break | Evidence |
|---|---|---|
| 1 | **Cannot start a round offline.** `roundRepo.create()` is awaited for a server-assigned `round.id`, then `upsertHoles` for `hole_id`s. | `useStartRound.ts:117,197` |
| 2 | **Shots cannot attach.** Save paths bail at `if (!holeId) return;` when hole ids never resolved. | `HoleTrackingPage.tsx:1421` |
| 3 | **Failed saves are dropped silently and forever.** `catch (err) { console.error('[shot] save failed', err); }` — no retry, no queue. The shot survives in localStorage but never reaches Supabase. | `HoleTrackingPage.tsx:1485` |
| 4 | **Course geometry is network-only.** React Query holds it in memory for `gcTime: 5min`, with no persistence. | `App.tsx:22` |
| 5 | **Satellite tiles are network-only.** `runtimeCaching` covers `/assets/` only; style is `mapbox://styles/mapbox/satellite-v9`. | `vite.config.ts:37`, `HoleLayout.tsx:944` |
| 6 | **Nothing detects connectivity.** Zero occurrences of `navigator.onLine` in `src/`. | — |

### Useful accidents

- `holesRepo.getLayout()` already fetches **every** feature and **every** hole
  for the whole course on each call (`holesRepo.ts:111-121`). Wasteful online,
  but it means "download a course" is only three queries.
- `roundRepo.upsertHole()` / `upsertHoles()` already accept an optional `id`
  (`roundRepo.ts:118,128`), so client-supplied ids are half-supported already.
- `LocalHole` already carries a `dirty` flag, set on every local mutation and
  cleared by `applyHoleIds`. The seed of a sync mechanism exists; nothing drains it.

---

## 3. Key decisions

### 3.1 Imagery: self-host per-course PMTiles from public-domain NAIP

**Decision:** generate one PMTiles file per course from USDA NAIP imagery,
store it in Supabase Storage, and serve it to both the online and offline map.

**Why not just cache Mapbox tiles?** Mapbox's terms permit temporary
performance caching, not permanent offline packs. Sanctioned offline is a
*Mobile SDK* product, which needs a native map view — the Capacitor plugins for
that are 2020–2021 demo-grade and unmaintained, and adopting one means replacing
the ~2,500-line GL JS `HoleLayout`.

**Why not MapTiler Cloud?** Its terms are materially the same as Mapbox's:
results may be stored in "a temporary personal cache … for use by a single
end-user," and it is "prohibited to batch or excessive bulk download of map
tiles." Legal offline means MapTiler **On-Prem** — $2,500/yr Standard, capped at
500 MAU, and only "Satellite Medium-Res"; high-resolution satellite is a
Custom-tier add-on with sales-contact pricing.

**Why NAIP works.** It is public domain — "may be freely distributed or
copied," attribution requested. Resolution is 0.6 m from 2018, and the 2025
acquisition delivered half the states at 0.3 m. That is at or better than
MapTiler's medium-res tier, for free. A golf course is a fixed ~2 km² area
played repeatedly, so per-course pre-processing is a natural fit.

**Trade-offs accepted:**
- **US only.** Worldwide expansion needs another source per region (see §9).
- **Imagery is 1–3 years old.** Irrelevant for golf unless a course is mid-renovation.
- **We own a processing pipeline.** One-time per course.
- **Attribution required** — credit line on the map.

### 3.2 PMTiles, not individual tile objects

One file per course rather than ~900 objects.

`mapbox-gl` **3.24.0** is installed; PMTiles source support landed in **3.21.0**,
so this needs no MapLibre migration.

- **Online:** raster source points at the `.pmtiles` in Supabase Storage; GL JS
  fetches byte ranges. No tile server, no per-tile billing.
- **Offline:** "Download course" is a single HTTP GET to Capacitor Filesystem;
  the same protocol reads ranges locally.
- No 900-object sync to reconcile, resume, or partially fail.

**Size budget:** ~10 MB/course at z18 (0.6 m/px, ample for picking a line),
~30 MB at z19. 512 px tiles halve the object count.

### 3.3 Client-generated UUIDs

Rounds, `round_holes` and `shots` get client-minted UUIDs, and inserts become
**upserts on primary key**.

Two properties fall out: a round can be created with zero connectivity, and
every sync retry becomes idempotent — a replayed write is a no-op instead of a
duplicate. This also retires `watch_impact_id` as the sole dedup mechanism.

No schema change needed: the `id` columns already default to
`uuid_generate_v4()`, and supplying a value is legal.

### 3.4 Reconciler, not a generic mutation log

The local store is already the source of truth and already persisted, so sync is
a `syncRound()` that walks the round and upserts anything unsynced — rather than
a parallel append-only log of mutations that can drift from the store.

Deletes are the one thing a pure reconciler can't express, so those need a
tombstone list.

### 3.5 Move round persistence off localStorage

localStorage in a WebView can be evicted under storage pressure, and it is
synchronous. An offline round is unsynced data that must not be lost, so
`roundStore`'s `persist` should use an IndexedDB-backed storage adapter instead.

---

## 4. New dependencies

Currently absent from `package.json` and required:

- `@capacitor/filesystem` — store PMTiles packs on device
- `@capacitor/network` — reliable connectivity signal (`navigator.onLine` lies
  about captive portals and "connected but unusable")
- `pmtiles` — protocol handler for local range reads
- An IndexedDB helper (`idb` or `idb-keyval`) for the geometry cache and store adapter

---

## 5. Schema changes

### Migration 032 — course imagery

```
alter table public.courses
  add column if not exists tiles_url text,
  add column if not exists tiles_generated_at timestamptz,
  add column if not exists tiles_min_zoom smallint,
  add column if not exists tiles_max_zoom smallint,
  add column if not exists imagery_source text,        -- 'naip' | 'mapbox' | ...
  add column if not exists imagery_attribution text,
  add column if not exists imagery_captured_at date;   -- NAIP acquisition year
```

### Migration 033 — tiling job queue

```
create table if not exists public.course_tile_jobs (
  id uuid primary key default uuid_generate_v4(),
  course_id uuid not null references public.courses(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','claimed','done','failed')),
  claimed_at timestamptz,
  claimed_by text,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
```

Claiming must be atomic (`update … where status='queued' returning *`) so a
laptop run and a Railway worker can't collide.

---

## 6. Phases

### Phase 0 — Foundations ✅ DONE

Shipped as: `src/services/connectivity.ts`, `src/features/offline/useConnectivity.ts`,
`src/lib/idbStorage.ts`, `initConnectivity()` in `App.tsx`, dev toggle in Settings.

- `@capacitor/network` + `idb-keyval` added.
- Three-state connectivity with a Supabase reachability probe (4s timeout) —
  "connected but useless" is the common course failure and must not be treated
  as online.
- `roundStore` persistence moved to IndexedDB, with a one-time lift of any
  existing localStorage round so an in-progress round survives the update.
- Dev-only "Simulate offline" switch in Settings; `setSimulatedOffline` is a
  no-op in production builds.

- Add the dependencies above.
- `useConnectivity()` hook: `@capacitor/network` + reachability probe. Expose
  `online | offline | degraded`. "Degraded" matters — a course usually has *a*
  connection that is too slow to be useful, which is worse than none because
  every request hangs before failing.
- Swap `roundStore` persistence to IndexedDB (§3.5).
- Dev-only "simulate offline" toggle. Everything downstream is untestable without it.

**Ships:** nothing user-visible. Prerequisite for the rest.

### Phase 1 — Client-generated UUIDs ✅ DONE

Shipped as: `src/lib/ids.ts`, `roundStore` v1 persist migration, upsert-on-PK in
`roundRepo`, local-first `useStartRound`, `syncedAt` replacing `remoteId`.

- `LocalShot.tempId` → `id`; `LocalHole.holeId` now required. Both are real
  UUIDs minted on device (`tmp_…` would be rejected by the `uuid` columns).
- **`remoteId` presence → explicit `syncedAt`** on both shots and holes. With
  client ids, having an id says nothing about whether the row exists remotely,
  so every "is it on the server?" test had to become explicit or offline rows
  would look synced and their edits/deletes would target rows that aren't there.
- `create`/`upsertHole(s)`/`addShot` are upserts. Holes conflict on **`id`, not
  `(round_id, hole_number)`** — conflicting on the natural key while sending an
  id makes Postgres rewrite the primary key and orphan every shot pointing at
  it. The natural-key unique constraint stays as a loud guard.
- `useStartRound` writes the store first and pushes best-effort; per-hole par
  now reads the Phase 2 cache first, so an offline round doesn't silently get
  course-average par on every par 3 and par 5.
- Persist `version: 1` + `migratePersistedRound` lifts rounds saved by older
  builds — synced shots KEEP their server id, unsynced ones are re-minted.
  9 tests in `roundStore.test.ts`.

**Known limit (by design, closes in Phase 5):** a round started offline does not
self-heal when signal returns. The RLS policies on `round_holes` and `shots`
require the parent `rounds` row to exist, so writes keep failing until something
pushes round → holes → shots in order. That ordered drain is Phase 5.

---

### Phase 1 (original spec)

- Mint `id` client-side for rounds, `round_holes`, `shots`.
- `LocalShot.tempId` → canonical `id`; keep a migration path for rounds already
  persisted under the old shape.
- All inserts become upserts on PK.
- `useStartRound` no longer awaits the network to obtain ids — it writes the
  local store first, then syncs.
- Remove the `if (!holeId) return;` bail (`HoleTrackingPage.tsx:1421`).

**Ships:** a round can be started and played with zero connectivity. Sync still
missing, so data stays local until Phase 5.

**Risk:** every code path that treats `remoteId != null` as "synced" needs
auditing. That inference disappears — presence of an id no longer implies the
server has seen it.

### Phase 2 — Course geometry cache ✅ DONE

Shipped as: `src/services/courseCacheRepo.ts`, cache-first branches in
`holesRepo.getLayout` and `useWatchSync`'s `holesMetaQuery`,
`cacheCourseInBackground()` on round start, `OfflineCoursesCard` in Settings.

- Raw rows are cached, not processed layouts — feature→hole assignment evolves,
  and caching raw means a logic change doesn't invalidate every download.
- `assignFeaturesToHole` extracted from `getLayout` so the network and cache
  paths *cannot* diverge; covered by `holesRepo.test.ts`.
- `CACHE_VERSION` discards entries written under an older shape.

**Still open:** the pre-trip "Download this course" button on the course picker
was deliberately deferred to Phase 4, where it belongs with imagery — a user
downloading a course for offline will want tiles too, and building that UI twice
is waste. `OfflineCoursesCard` covers the manage/measure half today.

**Payload size: MEASURED at ~145 KB per course** (2026-07-31, real 18-hole
course). That settles the plan's main open question on this phase — 50 courses
is ~7 MB, which is noise on any phone. Two consequences:

- Geometry caching is effectively free. There is no need for eviction policy or
  a storage budget at this scale.
- We can afford to be far more aggressive than "cache on round start" — e.g.
  pre-cache every course near the golfer, or every course they've ever played,
  so an unplanned round at a new course still works. Worth doing before Phase 5.

Note this is geometry only. Imagery (Phase 3) is ~10 MB/course, two orders of
magnitude larger, and *that* is what will need a management UI.

---

### Phase 2 (original spec)

- `courseCacheRepo` over IndexedDB, keyed by `courseId`: the `courses` row, all
  `holes` rows, all `hole_features` rows, plus `downloadedAt`.
- `holesRepo.getLayout()` and `useWatchSync`'s `holesMetaQuery`
  (`useWatchSync.ts:50-72`) read cache-first, revalidating in background when online.
- Auto-cache the full course when a round starts; explicit "Download for offline"
  control on the course screen for pre-trip prep.
- **Measure the payload against a real 18-hole course before committing.**
  Polygon-heavy layouts are the unknown here.

**Ships:** position, hole shape, and distance-to-pin work offline on **phone and
watch** — none of which ever needed tiles, only coordinates.

### Phase 3 — Imagery pipeline ✅ DONE (untested — see below)

Shipped as: `tools/tiler/` (Dockerfile + `tile_course.py` + README), migrations
`032_course_imagery.sql` and `033_course_tile_jobs.sql`, `CourseRow` fields.

- Pipeline: hole geometry → bbox (+250 m pad) → NAIP → warp → MBTiles
  (+`gdaladdo` for the lower zooms) → `pmtiles convert` → Supabase Storage.
- **Source defaults to USGS**, not AWS. The `naip-visualization` COGs are
  requester-pays — free only inside `us-east-1`, billed from a laptop. USGS
  needs no credentials. `IMAGERY_SOURCE=s3` switches.
- **The USGS 4000 px cap is the common case, not an edge case.** A typical
  18-hole course is ~2 km, which at z18 (~0.46 m/px) needs 4373×3721 px. The
  first version clamped to the cap, silently downsampling at exactly the zoom
  golfers use to pick a line. It now splits into a grid, fetches each cell at
  full resolution, and mosaics via VRT. Verified: 9-hole → 1 request, typical
  18 → 2, large resort → 4, every cell under the cap.
- Job claiming uses `for update skip locked`, so a laptop run and a Railway
  worker can run at the same time and never take the same course.
- Verified against live APIs: go-pmtiles **1.31.2** (not the 1.22.1 I first
  wrote), GDAL **3.13.2**, and the `ghcr.io/osgeo/gdal:ubuntu-small-3.13.2` tag
  returns HTTP 200. `TARGETARCH` handles Apple Silicon vs x86 runners.
- Measured estimate: **~10 MB per course** at z18 (~333 tiles at ~30 KB).

**VERIFIED end to end** (2026-08-01, real NAIP imagery over Bethpage State
Park):

| Check | Result |
|---|---|
| Image builds (arm64) | ✅ GDAL 3.13.2 + pmtiles 1.31.2 |
| Live USGS fetch | ✅ 31.7 MB GeoTIFF, EPSG:3857, 0.597 m/px = exactly z18 |
| Full chain → PMTiles | ✅ valid PMTiles v3, JPEG tiles (`ffd8ff`) |
| Pyramid | ✅ z14:2 · z15:4 · z16:12 · z17:36 · z18:132 tiles |
| Tiles are real imagery | ✅ 132/132 distinct blobs at z18 (no blank fill) |
| Reported zoom = actual | ✅ after the fix below |

**Two bugs the real run caught:**

1. `build_pmtiles` returned hardcoded `MIN_ZOOM, MAX_ZOOM` while the file
   actually held z15–z19. Those values go on the course row and become
   minzoom/maxzoom on the client source, so the map would have requested tiles
   that don't exist and ignored ones that do. Now read back from the MBTiles
   metadata — measured, not assumed.
2. The `ZOOM_LEVEL` creation option is **silently ignored** by the MBTiles
   driver ("does not support creation option", then it carries on). The correct
   zoom was coming from AUTO by luck, and native 0.3 m NAIP would have drifted
   to z19 — ~3× the pack size. Base zoom is now pinned by warping to exactly the
   z18 ground resolution with `-tr`, which is deterministic for both sources.

**Size, measured (not estimated): ~4 MB per course**, not the ~10 MB projected.
JPEG at quality 85 compresses aerial imagery far better than PNG — 1.88 MB for a
1.27 × 1.22 km footprint, scaling to ~4.1 MB for a typical 2.0 × 1.7 km course.

**Still unverified, and load-bearing for Phase 4:** whether Supabase Storage
serves HTTP **Range** requests. (Needs a service-role key, which isn't on this
machine — the upload and `course_bbox` steps are the only untested parts.) PMTiles reads by byte range, so if it doesn't,
the online path needs a different host (offline is unaffected — the file is
downloaded whole). Test with a `curl -r 0-99` against an uploaded pack before
building Phase 4 on top of it.

---

### Phase 3 (original spec)

A containerised job (`ghcr.io/osgeo/gdal`), run locally now and on Railway later
without modification.

1. **Bbox** — computed from hole geometry already in the DB. No new input.
2. **Fetch NAIP** — cloud-optimised GeoTIFFs on AWS Open Data, or USGS's
   National Map service. *Confirm the exact endpoint and whether the bucket is
   requester-pays at build time.* AWS is faster and more scriptable; USGS is free
   but rate-limited.
3. **`gdalwarp`** → EPSG:3857, clipped to bbox.
4. **Tile** z15–z19 → convert to PMTiles.
5. **Upload** to Supabase Storage; write `tiles_url` + metadata to the course row.

**Where it runs.** Laptop first — one job per course, ever; a course tiled never
needs tiling again short of an imagery refresh. Overnight batch is fine; the
bottleneck is NAIP download bandwidth, not CPU. Move to Railway when you want
on-demand tiling without being present, or when worldwide volume grows. Same
image, same queue, either way.

**Ships:** nothing user-visible yet — tiles exist but nothing reads them.

### Phase 4 — Map source swap ✅ DONE

Shipped as: `pmtilesProvider.ts`, `pmtilesSetup.ts`, `useImagerySource.ts`,
`coursePackRepo.ts`, `CoursePackButton`, imagery layer + attribution in
`HoleLayout`.

**Mapbox's own PMTiles support is unusable for us.** mapbox-gl 3.24 resolves
`.pmtiles` sources through a provider script fetched at RUNTIME from
`api.mapbox.com/mapbox-gl-js/plugins/…` — a network dependency at exactly the
moment there is no network. So we register our own via `addTileProvider`.

**The provider module is a blob-URL shim.** `addTileProvider(name, url)`
dynamically imports a module, and Vite's `new URL('./x.ts', import.meta.url)`
does NOT produce a usable one — it inlines the untranspiled TypeScript as a
`data:video/mp2t` URL the browser can't execute. The shim is dependency-free
plain JS built at runtime; the `pmtiles` library and the archives stay in the
main bundle behind a global bridge.

**A tile-URL template is mandatory even though it's never fetched.** Returning
`tiles: []` from `load()` makes the source load fine and then throw on every
tile (`.replace` of undefined inside Mapbox's URL builder). `load()` now returns
a placeholder template; `loadTile` uses the z/x/y arguments.

Source resolution, in order: downloaded pack → remote pack via Storage range
requests → Mapbox satellite → SVG. A pack always wins, online or not.

**VERIFIED IN A BROWSER** against the real uploaded pack: provider registered,
source loaded, zero console errors, and a screenshot showing the course's actual
NAIP imagery — fairways, greens, bunkers, clubhouse. Also verified in Node that
`getZxy` returns valid JPEG bytes (9958 B at z18) over HTTP range.

**Known bet:** `addTileProvider` is `@experimental` and typed `@private` in
mapbox-gl 3.24. If a future release removes it, registration throws, the tier
resolver falls back to Mapbox satellite and then SVG. Offline imagery would stop
working; nothing breaks outright.

---

### Phase 4 (original spec)

- Register the PMTiles protocol once at app startup (not per component).
- `HoleLayout` source resolution becomes:
  1. local PMTiles pack, if downloaded → **works offline**
  2. remote PMTiles from Storage, if `tiles_url` set → online, no Mapbox billing
  3. Mapbox satellite → online fallback for courses without imagery
  4. existing SVG render → last resort (`HoleLayout.tsx:2296`)
- Drive the choice off Phase 0's connectivity state **and** Mapbox tile `error`
  events. Today the SVG fallback is chosen purely by token presence
  (`HoleLayout.tsx:854`).
- Attribution line for NAIP.
- "Download course" UI: size, progress, downloaded state, delete.

**Ships:** satellite imagery offline. The headline feature.

### Phase 5 — Outbox and sync ✅ DONE

Shipped as: `src/services/roundSync.ts`, `src/stores/outboxStore.ts`,
`useSyncScheduler`, `SyncStatusChip`, tombstones + `roundSyncedAt` on the store.

- **Reconciler**, as planned — walks the local round and upserts what's missing.
  `syncRound()` returns a result instead of throwing; callers are background
  triggers where an exception is just noise.
- **Order is load-bearing.** RLS on `round_holes` and `shots` both require the
  parent `rounds` row, so a hole or shot pushed first is REJECTED, not merely
  slow. Round → holes → shots, and tombstoned deletes go LAST — deleting before
  the upserts would let the shot upsert resurrect a row the golfer removed.
  Both orderings are pinned by tests.
- **Tombstones** (`deletedShotIds`) close the reconciler's one blind spot: it
  compares local to remote and can't express "this used to exist", so an offline
  delete would otherwise reappear on the next sync.
- **Outbox** holds finished-but-unsynced rounds. `finishRound` snapshots the
  round into it BEFORE the store is cleared — that's the moment a golfer
  believes their round is safe, and it previously called `roundRepo.update()` on
  a round the server had never heard of, failing into a `console.error`.
- **Token refresh before writing**, not per row, so a round that outlived its
  access token doesn't fail one shot at a time. Auth failures are flagged
  (`needsAuth`) so the scheduler stops retrying and asks the user instead.
- `syncAll()` is serialised — reconnect, resume and the 60s timer routinely fire
  together and would otherwise race on the same rows.
- Triggers: connectivity → online (transition only, so a flapping signal driving
  away from a course doesn't hammer it), app resume, 60s retry, and mount.
- 12 tests in `roundSync.test.ts`.

**Also shipped — the Phase 4 SVG slice:** `HoleLayout` no longer attempts Mapbox
when it knows there's no signal (blank map, then a failed request, then
fallback). It goes straight to the existing SVG render off Phase 2's cached
geometry. A map that already loaded is NOT torn down when signal drops — its
tiles are in memory, and a working satellite view beats a schematic. Recovers
automatically when signal returns.

---

### Phase 5 (original spec)

- Per-shot `syncedAt`; reuse the existing `dirty` flag on holes.
- `deletedShotIds` tombstone list in the persisted store.
- `syncRound()` — upsert round → holes → shots (FK order), then drain tombstones,
  then mark synced. Idempotent via client UUIDs.
- Drain triggers: `online` event, app resume, round end, backoff timer.
- Replace the silent `console.error` (`HoleTrackingPage.tsx:1485`) with enqueue.
- UI: connectivity indicator, "N shots pending sync", manual "Sync now". Never
  block play on sync.

**Ships:** the round reaches Supabase. Feature complete.

### Phase 6 — Watch

Mostly falls out of Phase 2 — the watch already computes distance from its own
GPS and the coords the phone pushes. Verify the snapshot still populates when
the phone is offline, and that a watch-recorded shot arriving while offline gets
queued rather than dropped.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| **Supabase token expiry mid-round.** A 4-hour offline round could outlive a session; queued writes then fail at drain. | Attempt refresh on reconnect before draining. On failure, keep the outbox and surface "sign in to sync". Data is never lost — it's in IndexedDB. |
| **Phase 1 blast radius.** `remoteId != null` no longer implies "synced". | Audit every consumer before changing the store shape. Highest-risk item in the plan. |
| **Geometry payload larger than expected.** | Measure in Phase 2 before committing to IndexedDB shape. |
| **Device storage exhaustion.** 10 courses ≈ 100–300 MB. | Manage-downloads UI, LRU eviction, size shown before download. |
| **NAIP endpoint churn / requester-pays cost.** | Confirm at build time; USGS fallback. Cost is per-course-once and small. |
| **Multi-device editing.** Same round edited on two devices while one is offline. | Out of scope. Last-write-wins per row. Document it. |
| **Partial PMTiles download.** | Single file, so it either lands or doesn't — write to temp, atomic rename on completion. |

---

## 8. Testing

- Dev "simulate offline" toggle (Phase 0) — the only way most of this is testable.
- Airplane-mode round on a real device, start to finish, including app kill/relaunch mid-round.
- Token-expiry simulation: force-expire a session, play offline, reconnect.
- Sync idempotency: drain twice, assert no duplicate shots.
- Storage pressure: fill the device, confirm the round survives.
- On-course validation — the only test that actually counts.

---

## 9. Worldwide expansion

The architecture already accommodates it: the map source chain falls back to
Mapbox online for any course without `tiles_url`. Non-US courses keep working
exactly as they do today, and each region gets imagery by populating
`tiles_url`.

What changes per region is only step 2 of the pipeline — the imagery source.
Several countries publish open aerial imagery on NAIP-like terms; others need a
commercial license. `imagery_source` / `imagery_attribution` on the course row
exist so this can vary per course without further schema work.

---

## 10. Sequencing

```
Phase 0 ──┬── Phase 1 ──── Phase 5      (offline round + sync)
          └── Phase 2 ──── Phase 6      (offline distances, phone + watch)

Phase 3 ──── Phase 4                    (offline satellite; independent)
```

Phase 3 is independent of the round work and can proceed in parallel — it's
mostly pipeline engineering rather than app changes.

**Fastest visible win:** Phase 0 → 2. Restores maps-as-geometry and distances
offline on both devices, with no dependency on the ID change.

**Highest value:** Phase 3 → 4, the satellite imagery. Also the most self-contained.

**Most foundational:** Phase 1, which unblocks Phase 5 and is invisible alone.

---

## Sources

- [MapTiler Cloud Terms](https://www.maptiler.com/terms/cloud/)
- [MapTiler On-Prem Pricing](https://www.maptiler.com/data/pricing/)
- [Mapbox Offline Maps](https://docs.mapbox.com/help/dive-deeper/mobile-offline/)
- [Mapbox Android Offline Concepts](https://docs.mapbox.com/android/maps/guides/offline/concepts/)
- [NAIP on data.gov](https://catalog.data.gov/dataset/national-agriculture-imagery-program-naip-imagery)
- [USGS EROS NAIP Archive](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip)
- [PMTiles for MapLibre / protocol docs](https://docs.protomaps.com/pmtiles/maplibre)
