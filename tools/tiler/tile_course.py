#!/usr/bin/env python3
"""
Build a course's offline satellite imagery pack.

    holes geometry -> bbox -> NAIP imagery -> warp -> MBTiles -> PMTiles -> Storage

One PMTiles file per course. A golf course is a fixed ~2 km² area played
repeatedly, which is what makes per-course pre-processing sane where general
"offline maps" are not: the whole pack is ~10 MB and never needs regenerating.

WHY WE HOST THE IMAGERY: Mapbox and MapTiler both permit only temporary
per-user caching and prohibit bulk tile download, so pre-downloading a course
from either would breach their terms. USDA NAIP is public domain and may be
redistributed with attribution, so these tiles are genuinely ours to ship.

Runs anywhere the GDAL container runs — a laptop today, Railway later, both at
once if you like (job claiming is atomic; see migration 033).

Usage:
    python tile_course.py --course-id <uuid>     # one specific course
    python tile_course.py --claim                # take one queued job
    python tile_course.py --claim --loop         # drain the queue

Environment:
    SUPABASE_URL                 required
    SUPABASE_SERVICE_ROLE_KEY    required (bypasses RLS; never ship to a client)
    IMAGERY_SOURCE               force a source ('naip', 'ct'); default is
                                 chosen from the course's state
    MAX_ZOOM                     override the per-source max zoom for every
                                 source (see IMAGERY_SOURCES[*]["max_zoom"]:
                                 naip 18, ct 20, ny 19, az 19, ma 20)
"""

from __future__ import annotations

import argparse
import json
import math
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
IMAGERY_SOURCE = os.environ.get("IMAGERY_SOURCE", "usgs")
BUCKET = "course-tiles"

# Max zoom drives the REQUEST resolution as well as the tile pyramid: the source
# is fetched at exactly this zoom's ground resolution (see fetch_imagery and
# build_pmtiles). So it is not just "how deep does the pack go" — it is "how
# much of the source's detail do we keep", and it must be matched to the SOURCE.
# Hence `max_zoom` per entry in IMAGERY_SOURCES rather than one global value:
# asking for finer than a source actually holds costs 4x the bytes per level
# and returns nothing but interpolation.
#
# Ground resolution at lat 41: z18 = 0.45 m/px, z19 = 0.22, z20 = 0.11.
# Measured native: CT ECO 0.076 m (declared `pixelSizeX`, 3 inch); NY ITS ~0.15 m
# (probed — JPEG size still grew 3.5x on the z18->z19 step, then flattened past
# z20, which is what running out of real detail looks like); NAIP 0.3-0.6 m.
#
# The reason this matters at all: the map zooms to z21 (z23 in putting mode), so
# past the pack's max zoom Mapbox STRETCHES tiles instead of showing detail —
# blurry rather than zoomed.
#
# Each source therefore goes as deep as it genuinely holds detail, capped by
# what's reasonable to download: CT z20, NY z19, NAIP z18. Note these are packs
# a golfer pulls over cellular in a car park, so a source being capable of
# another level is NOT on its own a reason to add one.
MIN_ZOOM = 14
DEFAULT_MAX_ZOOM = 18

# Ceiling on a finished pack. Two independent reasons, and the lower one wins:
#
#  1. Supabase Storage enforces a PROJECT-WIDE upload limit, default 50 MB, and
#     rejects anything larger with a 413 EntityTooLarge. Measured against this
#     project: a 45 MB upload returns 200, a 60 MB upload returns 413. Raising
#     it is a dashboard setting and needs a paid plan.
#  2. This is a file a golfer downloads over cellular in a car park before a
#     round. Even with the limit lifted, 113 MB is not a reasonable ask.
#
# 48 rather than 50 to leave room for the limit being measured against the
# encoded body rather than the file.
PACK_SIZE_LIMIT = int(os.environ.get("PACK_SIZE_LIMIT_MB", "48")) * 1024 * 1024
# Env override applies to every source; used for one-off experiments.
MAX_ZOOM_OVERRIDE = os.environ.get("MAX_ZOOM")


def max_zoom_for(cfg: dict[str, Any]) -> int:
    if MAX_ZOOM_OVERRIDE:
        return int(MAX_ZOOM_OVERRIDE)
    return int(cfg.get("max_zoom", DEFAULT_MAX_ZOOM))

# Ground resolution of one pixel at zoom 0 in EPSG:3857, i.e. earth
# circumference / 256. Halves with each zoom level.
MERCATOR_M_PER_PX = 156543.03392804097

# Padding around the holes so the map isn't cropped at the edge of play when a
# golfer pans, or when a tee shot ends up well offline.
BBOX_PAD_M = 250

# ---------------------------------------------------------------------------
# Imagery sources
# ---------------------------------------------------------------------------
#
# All of these are ArcGIS ImageServer `exportImage` endpoints returning
# georeferenced GeoTIFF, so one fetcher covers them all — only the URL and the
# request limits differ.
#
# Choice of source matters more than anything else in this pipeline. NAIP is
# free and nationwide but flown on a 2-3 year cycle, and the USGS service only
# carries 2019 for much of the northeast — old enough that a renovated course
# looks wrong. State orthoimagery programmes are dramatically better where they
# exist: CT publishes 3-INCH imagery from 2023, eight times sharper than NAIP
# and four years fresher, for free.
#
# `max_pixels` is the constraint that actually bites. Services advertise
# per-axis caps but fail on total pixels — USGS returns a bare HTTP 500 for a
# 4000x2393 request (both axes legal) while 2796x2706 succeeds. Values here are
# measured, not documented.

IMAGERY_SOURCES: dict[str, dict[str, Any]] = {
    "naip": {
        "label": "naip",
        "url": (
            "https://imagery.nationalmap.gov/arcgis/rest/services/"
            "USGSNAIPImagery/ImageServer/exportImage"
        ),
        "max_w": 4000,
        "max_h": 4000,
        "max_pixels": 7_500_000,
        "band_ids": None,
        "kind": "imageserver",
        # 0.3-0.6 m native, so z18 (0.45 m/px) is already at or past it. Going
        # deeper would just quadruple the pack to store interpolation — Pebble
        # Beach alone would go from 21 MB to ~82 MB for no added detail.
        "max_zoom": 18,
        "attribution": "Imagery: USDA NAIP / USGS (public domain)",
        "captured": None,
        "coverage": "continental US",
    },
    "ct": {
        "label": "ct-ortho-2023",
        "url": (
            "https://cteco.uconn.edu/ctraster/rest/services/images/"
            "Ortho_2023/ImageServer/exportImage"
        ),
        # Advertises height<=4100, width<=15000, but the REAL limit is response
        # SIZE: it returns uncompressed RGB, so ~9M px (29 MB) works while
        # 13.4M px (~40 MB) returns a bare HTTP 500. Measured:
        #   2935x3243 = 9.5M px  -> OK (29.4 MB)
        #   3468x3877 = 13.4M px -> 500
        "max_w": 4000,
        "max_h": 4000,
        "max_pixels": 9_000_000,
        # 4-band source (RGB + NIR); take the visible bands only.
        "band_ids": "0,1,2",
        "kind": "imageserver",
        # 0.076 m native (3 inch), so z20 (0.11 m/px) is still real detail
        # rather than interpolation — sharper than Google's typical 0.15 m.
        # The cost is steep and worth knowing before changing this: ~4x the z19
        # pack (expect 40-100 MB/course), ~48 source requests per course, and a
        # ~1.3 GB intermediate GeoTIFF. Every one of those requests hits a free
        # UConn service, so re-tile CT deliberately, not casually.
        "max_zoom": 20,
        "attribution": "Imagery: CT ECO \u2014 UConn CLEAR / CT DEEP (2023)",
        "captured": "2023-01-01",
        "coverage": "Connecticut",
    },
    "ny": {
        "label": "ny-ortho-latest",
        # NOTE: a MapServer, not an ImageServer — `export`, and the response has
        # NO georeferencing, so we apply the extent ourselves (see fetch below).
        "url": "https://orthos.its.ny.gov/arcgis/rest/services/wms/Latest/MapServer/export",
        # Caps each axis at 4096 and SILENTLY RESIZES past it rather than
        # erroring — a 2987x5043 request came back 2426x4096, i.e. quietly
        # downsampled. Staying under 4096 is what keeps that from happening.
        "max_w": 4000,
        "max_h": 4000,
        "max_pixels": 16_000_000,
        "band_ids": None,
        "kind": "mapserver",
        "image_format": "jpg",
        # ~0.15 m native (6 inch) by probe — the service publishes no pixel
        # size, so this was measured by requesting one patch at successively
        # finer resolutions and watching where JPEG size stopped growing with
        # the pixel count. Real detail through z19; z20 is where it flattens.
        "max_zoom": 19,
        "attribution": "Imagery: NYS Orthoimagery Program \u2014 ITS GPO (2022\u20132025)",
        # A rolling mosaic of several flight years; a single date would be a
        # guess, so leave it unset.
        "captured": None,
        "coverage": "New York State",
    },
    "az": {
        "label": "az-naip-2023",
        # AZGeo republishes NAIP for Arizona, and its 2023 layer is 0.3 m —
        # twice the resolution of the USGS national service, which still serves
        # 2019 across much of the state. Same imagery programme, same public
        # domain terms, better pixels: there is no reason to use the national
        # endpoint for an Arizona course.
        "url": (
            "https://azgeo.az.gov/arcgis/rest/services/imagery/"
            "NAIP2023/ImageServer/exportImage"
        ),
        # Advertises maxImageWidth 15000 / maxImageHeight 4100, but like CT the
        # real constraint is response SIZE — it returns uncompressed RGB.
        # Measured against the Whirlwind bbox:
        #   2000x2000 =  4.0M px -> OK (12.6 MB, fast)
        #   3000x3000 =  9.0M px -> OK (28.3 MB)
        #   4000x4000 = 16.0M px -> no response inside 120 s
        "max_w": 4000,
        "max_h": 4000,
        "max_pixels": 9_000_000,
        # 4-band (RGB + NIR); visible bands only. Verified: the response comes
        # back SamplesPerPixel=3 when this is set.
        "band_ids": "0,1,2",
        "kind": "imageserver",
        # 0.3 m native. At Arizona's latitude z18 is 0.50 m/px — coarser than
        # the source, so it would throw away half the detail we fetched; z19 is
        # 0.25 m/px, a slight oversample that keeps effectively all of it.
        # Expect roughly 4x a z18 pack (~16 MB/course), well inside the 48 MB
        # cap.
        "max_zoom": 19,
        "attribution": "Imagery: USDA NAIP 2023 via AZGeo \u2014 State of Arizona (public domain)",
        # Programme year, not the flight date — NAIP flies a state over a
        # season and the service publishes no per-scene capture date.
        "captured": "2023-01-01",
        "coverage": "Arizona",
    },
    "ma": {
        "label": "ma-ortho-2025",
        # NOT an exportImage endpoint. MassGIS publishes no ortho ImageServer at
        # all — the whole programme ships as CACHED TILE LAYERS on ArcGIS Online
        # (checked: their own arcgisserver carries only LiDAR derivatives and a
        # 1994 coastal mosaic). So this one is read as an XYZ pyramid instead of
        # a bbox export; see fetch_from_tile_cache.
        "url": (
            "https://tiles.arcgis.com/tiles/hGdibHYSPO59RG1h/arcgis/rest/"
            "services/Massachusetts_Aerial_Imagery_2025/MapServer/tile/"
            "${z}/${y}/${x}"
        ),
        "kind": "tilecache",
        # No pixel budget applies — the fetch is per 256px tile, and GDAL's WMS
        # driver only requests the blocks the output window touches.
        "max_w": None,
        "max_h": None,
        "max_pixels": None,
        "band_ids": None,
        # Spring 2025, 15 cm statewide and 7.5 cm on Cape Cod. The CACHE, though,
        # stops at z20: z21 returns 404 (verified over both Cape courses), so
        # z20 is the service's real floor rather than a size choice we made.
        "max_zoom": 20,
        "attribution": "Imagery: MassGIS — Commonwealth of Massachusetts (2025)",
        "captured": "2025-04-01",
        "coverage": "Massachusetts",
    },
}

# Which source to use for a course, by `courses.state`. Anything unlisted falls
# back to NAIP, so adding a state is a one-line change here plus its config
# above — no schema change, since imagery_source/attribution are per course.
STATE_SOURCES = {
    "CT": "ct",
    "NY": "ny",
    "MA": "ma",
    "AZ": "az",
}

DEFAULT_SOURCE = "naip"


# --------------------------------------------------------------------------
# Supabase
# --------------------------------------------------------------------------

def _headers() -> dict[str, str]:
    return {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def db_get(path: str, params: dict[str, Any]) -> list[dict]:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{path}", headers=_headers(), params=params, timeout=60
    )
    r.raise_for_status()
    return r.json()


def db_patch(path: str, params: dict[str, Any], body: dict) -> None:
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=_headers(),
        params=params,
        data=json.dumps(body),
        timeout=60,
    )
    r.raise_for_status()


def rpc(fn: str, body: dict) -> Any:
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/{fn}",
        headers=_headers(),
        data=json.dumps(body),
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------

@dataclass
class BBox:
    min_lng: float
    min_lat: float
    max_lng: float
    max_lat: float

    def padded(self, meters: float) -> "BBox":
        # Degrees per metre, corrected for latitude on the longitude axis.
        mid_lat = (self.min_lat + self.max_lat) / 2
        dlat = meters / 111_320.0
        dlng = meters / (111_320.0 * max(0.1, math.cos(math.radians(mid_lat))))
        return BBox(
            self.min_lng - dlng,
            self.min_lat - dlat,
            self.max_lng + dlng,
            self.max_lat + dlat,
        )

    def as_str(self) -> str:
        return f"{self.min_lng},{self.min_lat},{self.max_lng},{self.max_lat}"


def to_mercator(lng: float, lat: float) -> tuple[float, float]:
    """WGS84 -> EPSG:3857 metres. Needed to georeference MapServer responses."""
    x = lng * 20037508.34 / 180.0
    y = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) / (math.pi / 180.0)
    return x, y * 20037508.34 / 180.0


def course_bbox(course_id: str) -> BBox:
    """
    Derive the course footprint from geometry we already store.

    Uses tee/green/centreline points rather than hole_features polygons: the
    points are always present when a course has been synced, and the playing
    line is what defines the area a golfer looks at.
    """
    holes = db_get(
        "holes",
        {
            "course_id": f"eq.{course_id}",
            "select": "tee_lng,tee_lat,green_lng,green_lat,centerline",
        },
    )
    pts: list[tuple[float, float]] = []
    for h in holes:
        for lng, lat in (
            (h.get("tee_lng"), h.get("tee_lat")),
            (h.get("green_lng"), h.get("green_lat")),
        ):
            if lng is not None and lat is not None:
                pts.append((float(lng), float(lat)))
        for pt in h.get("centerline") or []:
            if isinstance(pt, list) and len(pt) >= 2:
                pts.append((float(pt[0]), float(pt[1])))

    if not pts:
        raise SystemExit(
            f"Course {course_id} has no hole geometry — run the OSM sync first."
        )

    lngs = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    return BBox(min(lngs), min(lats), max(lngs), max(lats)).padded(BBOX_PAD_M)


# --------------------------------------------------------------------------
# Imagery
# --------------------------------------------------------------------------

def _export_cell(
    cfg: dict[str, Any], cell: BBox, w: int, h: int, dest: Path, attempts: int = 3
) -> None:
    """
    Fetch one cell, leaving `dest` as a georeferenced GeoTIFF.

    ImageServer `exportImage` returns a real GeoTIFF, so it lands ready to use.
    MapServer `export` returns a bare image with no spatial metadata at all —
    for those we request the bbox in Web Mercator (so the corners are known
    exactly) and stamp the extent on afterwards with `-a_ullr`.
    """
    is_mapserver = cfg.get("kind") == "mapserver"

    if is_mapserver:
        x0, y0 = to_mercator(cell.min_lng, cell.min_lat)
        x1, y1 = to_mercator(cell.max_lng, cell.max_lat)
        params = {
            "bbox": f"{x0},{y0},{x1},{y1}",
            "bboxSR": 3857,
            "imageSR": 3857,
            "size": f"{w},{h}",
            "format": cfg.get("image_format", "jpg"),
            "f": "image",
        }
    else:
        params = {
            "bbox": cell.as_str(),
            "bboxSR": 4326,
            "imageSR": 3857,
            "size": f"{w},{h}",
            "format": "tiff",
            "f": "image",
        }
    if cfg.get("band_ids"):
        params["bandIds"] = cfg["band_ids"]

    last: Exception | None = None
    for attempt in range(attempts):
        try:
            r = requests.get(cfg["url"], params=params, timeout=600)
            r.raise_for_status()
            if not r.content or len(r.content) < 1024:
                raise RuntimeError(
                    f"{cfg['label']} returned an empty image — is the course "
                    f"outside its coverage ({cfg['coverage']})?"
                )
            if not is_mapserver:
                dest.write_bytes(r.content)
                return

            raw = dest.with_suffix(".raw")
            raw.write_bytes(r.content)
            # -a_ullr takes upper-left then lower-right, so maxY precedes minY.
            run([
                "gdal_translate", "-q",
                "-a_srs", "EPSG:3857",
                "-a_ullr", str(x0), str(y1), str(x1), str(y0),
                str(raw), str(dest),
            ])
            raw.unlink(missing_ok=True)
            return
        except requests.HTTPError as exc:
            # 5xx is often transient (these services also 500 under sustained
            # sequential load). Back off rather than failing a whole course on
            # one blip; 4xx is a real problem and is re-raised.
            status = exc.response.status_code if exc.response is not None else 0
            if status < 500:
                raise
            last = exc
            if attempt < attempts - 1:
                wait = 5 * (attempt + 1)
                print(f"      HTTP {status}, retrying in {wait}s")
                time.sleep(wait)
    raise last if last else RuntimeError("image request failed")


def fetch_from_tile_cache(cfg: dict[str, Any], bbox: BBox, out: Path) -> None:
    """
    Read a cached XYZ tile pyramid as if it were one raster.

    Some publishers (MassGIS) ship orthoimagery only as an ArcGIS *tile cache* —
    there is no bbox-export endpoint to call. Rather than hand-rolling a tile
    downloader and stitcher, this hands the pyramid to GDAL's WMS driver as a
    TMS service, so GDAL fetches exactly the 256px blocks the output window
    touches and assembles them. No cell grid, no pixel budget, no VRT mosaic:
    the splitting logic in fetch_imagery exists to work around per-request size
    caps that simply don't apply when the unit of transfer is one tile.

    A happy side effect: the cache is already EPSG:3857 at 256px, which is the
    exact scheme the finished pack uses, so this path resamples nothing.
    """
    zoom = max_zoom_for(cfg)
    x0, y0 = to_mercator(bbox.min_lng, bbox.min_lat)
    x1, y1 = to_mercator(bbox.max_lng, bbox.max_lat)
    res = MERCATOR_M_PER_PX / (2 ** zoom)
    tiles_x = math.ceil((x1 - x0) / (res * 256)) + 1
    tiles_y = math.ceil((y1 - y0) / (res * 256)) + 1
    print(
        f"  [{cfg['label']}] z{zoom} tile cache, {res:.3f} m/px "
        f"-> ~{tiles_x * tiles_y} tiles ({tiles_x}x{tiles_y})"
    )

    # Whole-world data window at the deepest cached level. YOrigin=top because
    # ArcGIS caches number rows from the north, like XYZ and unlike true TMS.
    #
    # ZeroBlockHttpCodes matters at the edges: a course bbox rarely lands on a
    # tile boundary and the cache is clipped to the state, so an edge request
    # can legitimately 404. Without this the whole course fails on one missing
    # corner tile instead of leaving it blank.
    wms = out.parent / "tilecache.xml"
    wms.write_text(
        f"""<GDAL_WMS>
  <Service name="TMS">
    <ServerUrl>{cfg['url']}</ServerUrl>
  </Service>
  <DataWindow>
    <UpperLeftX>-20037508.34</UpperLeftX>
    <UpperLeftY>20037508.34</UpperLeftY>
    <LowerRightX>20037508.34</LowerRightX>
    <LowerRightY>-20037508.34</LowerRightY>
    <TileLevel>{zoom}</TileLevel>
    <TileCountX>1</TileCountX>
    <TileCountY>1</TileCountY>
    <YOrigin>top</YOrigin>
  </DataWindow>
  <Projection>EPSG:3857</Projection>
  <BlockSizeX>256</BlockSizeX>
  <BlockSizeY>256</BlockSizeY>
  <BandsCount>3</BandsCount>
  <MaxConnections>4</MaxConnections>
  <Timeout>120</Timeout>
  <ZeroBlockHttpCodes>204,404,403</ZeroBlockHttpCodes>
  <ZeroBlockOnServerException>true</ZeroBlockOnServerException>
  <UserAgent>golf-round-tracker-tiler</UserAgent>
  <Cache/>
</GDAL_WMS>
"""
    )

    # Thousands of small requests to a CDN drop connections in a way one big
    # exportImage call never does: the failure is a bare SSL "unexpected eof"
    # with HTTP status 0, so ZeroBlockHttpCodes can't catch it — and it MUST NOT,
    # since treating a dropped connection as a blank tile would punch black
    # squares into the middle of a course. Retry instead, and pin HTTP/1.1:
    # multiplexing many tile requests over one HTTP/2 connection is what
    # provokes the resets in the first place.
    env = {
        **os.environ,
        "GDAL_HTTP_MAX_RETRY": "5",
        "GDAL_HTTP_RETRY_DELAY": "2",
        "GDAL_HTTP_VERSION": "1.1",
    }

    # -projwin takes upper-left then lower-right, so maxY precedes minY.
    run([
        "gdal_translate", "-q",
        "-projwin", str(x0), str(y1), str(x1), str(y0),
        "-projwin_srs", "EPSG:3857",
        "-co", "TILED=YES",
        str(wms), str(out),
    ], env=env)


def fetch_imagery(cfg: dict[str, Any], bbox: BBox, out: Path) -> None:
    """
    Pull imagery for `bbox` from an ArcGIS ImageServer, mosaicking if needed.

    The grid split is not an edge case: a typical 18-hole course spans ~2 km,
    which at z18 needs more pixels than these services will return in one go.
    Clamping to the cap instead would silently DOWNSAMPLE — the map would look
    soft at exactly the zoom golfers use to pick a line.
    """
    if cfg.get("kind") == "tilecache":
        fetch_from_tile_cache(cfg, bbox, out)
        return

    mid_lat = (bbox.min_lat + bbox.max_lat) / 2
    cos_lat = math.cos(math.radians(mid_lat))
    width_m = (bbox.max_lng - bbox.min_lng) * 111_320.0 * cos_lat
    height_m = (bbox.max_lat - bbox.min_lat) * 111_320.0

    res = MERCATOR_M_PER_PX * cos_lat / (2 ** max_zoom_for(cfg))
    total_w = max(256, int(width_m / res))
    total_h = max(256, int(height_m / res))

    cols = math.ceil(total_w / cfg["max_w"])
    rows = math.ceil(total_h / cfg["max_h"])
    # Then split further until each cell fits the PIXEL budget. Splitting the
    # longer axis keeps cells roughly square and minimises the request count.
    while (math.ceil(total_w / cols) * math.ceil(total_h / rows)) > cfg["max_pixels"]:
        if math.ceil(total_w / cols) >= math.ceil(total_h / rows):
            cols += 1
        else:
            rows += 1
    cell_px_w = math.ceil(total_w / cols)
    cell_px_h = math.ceil(total_h / rows)

    print(
        f"  [{cfg['label']}] {total_w}x{total_h}px at {res:.2f} m/px "
        f"-> {cols}x{rows} request(s) of {cell_px_w}x{cell_px_h}px"
    )

    workdir = out.parent
    dlng = (bbox.max_lng - bbox.min_lng) / cols
    dlat = (bbox.max_lat - bbox.min_lat) / rows
    parts: list[Path] = []

    for row in range(rows):
        for col in range(cols):
            cell = BBox(
                bbox.min_lng + col * dlng,
                bbox.min_lat + row * dlat,
                bbox.min_lng + (col + 1) * dlng,
                bbox.min_lat + (row + 1) * dlat,
            )
            part = workdir / f"cell_{row}_{col}.tif"
            print(f"    cell {row},{col}")
            _export_cell(cfg, cell, cell_px_w, cell_px_h, part)
            parts.append(part)

    if len(parts) == 1:
        parts[0].rename(out)
        return

    # A VRT stitches the cells without duplicating pixels on disk.
    vrt = workdir / "mosaic.vrt"
    run(["gdalbuildvrt", str(vrt), *[str(p) for p in parts]])
    run(["gdal_translate", "-co", "TILED=YES", str(vrt), str(out)])


# --------------------------------------------------------------------------
# Tiling
# --------------------------------------------------------------------------

def run(cmd: list[str], env: dict | None = None) -> None:
    print("  $", " ".join(cmd[:6]), "…" if len(cmd) > 6 else "")
    subprocess.run(cmd, check=True, env=env or os.environ)


def mbtiles_zoom_range(mbtiles: Path) -> tuple[int, int]:
    """
    Read the zoom range GDAL actually wrote.

    Not an assumption we can afford to make: these values are stored on the
    course row and become minzoom/maxzoom on the client's raster source. Get
    them wrong and the map requests tiles that don't exist while ignoring ones
    that do. GDAL's own choice of base zoom depends on the source resolution,
    so the only reliable answer is to ask the file.
    """
    with sqlite3.connect(mbtiles) as conn:
        rows = dict(
            conn.execute(
                "select name, value from metadata where name in ('minzoom','maxzoom')"
            ).fetchall()
        )
        if "minzoom" in rows and "maxzoom" in rows:
            return int(rows["minzoom"]), int(rows["maxzoom"])
        # Fall back to the tile table if metadata is missing.
        lo, hi = conn.execute("select min(zoom_level), max(zoom_level) from tiles").fetchone()
        return int(lo), int(hi)


def _build_at_zoom(src: Path, workdir: Path, zoom: int) -> tuple[Path, int, int, int]:
    """One build attempt. Returns (pmtiles, zmin, zmax, size_bytes)."""
    warped = workdir / "warped.tif"
    mbtiles = workdir / "course.mbtiles"
    pmtiles = workdir / "course.pmtiles"
    # A retry at a shallower zoom reuses the SAME source GeoTIFF, so nothing is
    # re-fetched — but the outputs of the previous attempt must go, since
    # gdalwarp and the MBTiles driver both refuse to overwrite.
    for stale in (warped, mbtiles, pmtiles):
        stale.unlink(missing_ok=True)

    # Web Mercator is what the tile pyramid is defined in; MBTiles requires it.
    #
    # `-tr` pins the output to EXACTLY the ground resolution of `zoom`. That's
    # how the base zoom is controlled: the MBTiles driver ignores a ZOOM_LEVEL
    # creation option (it warns and carries on) and picks the zoom nearest the
    # source resolution instead. Left to itself on native 0.3 m NAIP it chose
    # z19 — roughly triple the pack size for detail that only matters inside a
    # few yards. Setting the resolution makes the choice deterministic for both
    # the USGS and S3 paths.
    res = MERCATOR_M_PER_PX / (2 ** zoom)
    run(["gdalwarp", "-t_srs", "EPSG:3857", "-r", "bilinear",
         "-tr", str(res), str(res),
         "-co", "TILED=YES", str(src), str(warped)])

    run(["gdal_translate", "-of", "MBTILES",
         # Aerial photography compresses far better as JPEG than PNG — ~5x
         # smaller for a pack a golfer has to download over cellular.
         "-co", "TILE_FORMAT=JPEG",
         "-co", "QUALITY=85",
         str(warped), str(mbtiles)])

    # Overviews ARE the lower zoom levels for the MBTiles driver. Without them
    # the pack contains only the deepest zoom and the map is blank until you're
    # fully zoomed in.
    levels = [str(2 ** i) for i in range(1, (zoom - MIN_ZOOM) + 1)]
    run(["gdaladdo", "-r", "average", str(mbtiles), *levels])

    zmin, zmax = mbtiles_zoom_range(mbtiles)
    run(["pmtiles", "convert", str(mbtiles), str(pmtiles)])
    return pmtiles, zmin, zmax, pmtiles.stat().st_size


def build_pmtiles(src: Path, workdir: Path, cfg: dict[str, Any]) -> tuple[Path, int, int]:
    """
    GeoTIFF -> MBTiles (+ overviews) -> PMTiles. Returns the REAL zoom range.

    Drops a zoom level and rebuilds if the pack won't fit PACK_SIZE_LIMIT.
    This is not a nicety: Supabase Storage rejects anything over its project
    upload limit with a 413, and the failure lands AFTER all the imagery has
    been fetched and the pack built — the most expensive possible place to
    fail. Four CT courses hit exactly that at z20 (69-113 MB), and because the
    upload is the last step, the previous pack stays live and the course looks
    untouched rather than broken.

    The retry costs almost nothing: the source GeoTIFF was fetched at the
    deepest zoom's resolution, so a shallower rebuild just re-warps what's
    already on disk. No further requests to the imagery service.

    Deliberately reactive rather than predictive — pack size depends on JPEG
    compressibility of that specific course (tree cover, water, bunker
    contrast), so measuring beats estimating.
    """
    top = max_zoom_for(cfg)
    for zoom in range(top, MIN_ZOOM, -1):
        pmtiles, zmin, zmax, size = _build_at_zoom(src, workdir, zoom)
        if size <= PACK_SIZE_LIMIT or zoom == MIN_ZOOM + 1:
            if zoom != top:
                print(f"  fell back to z{zoom} to fit the {PACK_SIZE_LIMIT // (1024*1024)} MB limit")
            return pmtiles, zmin, zmax
        print(
            f"  pack {size / 1e6:.1f} MB at z{zoom} exceeds "
            f"{PACK_SIZE_LIMIT // (1024*1024)} MB — rebuilding at z{zoom - 1}"
        )
    raise RuntimeError("unreachable: loop returns at MIN_ZOOM + 1")


# --------------------------------------------------------------------------
# Upload
# --------------------------------------------------------------------------

def ensure_bucket() -> None:
    r = requests.get(f"{SUPABASE_URL}/storage/v1/bucket/{BUCKET}", headers=_headers(), timeout=30)
    if r.status_code == 200:
        return
    # Public: map tiles aren't sensitive, and a public object lets the client
    # issue plain HTTP range requests with no auth round-trip per tile.
    requests.post(
        f"{SUPABASE_URL}/storage/v1/bucket",
        headers=_headers(),
        data=json.dumps({"id": BUCKET, "name": BUCKET, "public": True}),
        timeout=30,
    ).raise_for_status()
    print(f"  created public bucket '{BUCKET}'")


def upload(pmtiles: Path, course_id: str) -> str:
    ensure_bucket()
    key = f"{course_id}.pmtiles"
    with pmtiles.open("rb") as fh:
        r = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{key}",
            headers={
                "apikey": SERVICE_KEY,
                "Authorization": f"Bearer {SERVICE_KEY}",
                "Content-Type": "application/octet-stream",
                # Replace on regeneration rather than erroring.
                "x-upsert": "true",
            },
            data=fh,
            timeout=1800,
        )
    r.raise_for_status()
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{key}"


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------

def select_source(course: dict) -> dict[str, Any]:
    """
    Pick the imagery source for a course.

    Order: explicit IMAGERY_SOURCE override > the course's state > NAIP. State
    routing is what makes this worth having — CT courses get 3-inch 2023
    imagery instead of 0.6 m 2019 NAIP, with no per-course configuration.
    """
    override = os.environ.get("IMAGERY_SOURCE")
    if override:
        if override not in IMAGERY_SOURCES:
            raise SystemExit(
                f"Unknown IMAGERY_SOURCE '{override}'. "
                f"Known: {', '.join(IMAGERY_SOURCES)}"
            )
        return IMAGERY_SOURCES[override]

    state = (course.get("state") or "").strip().upper()
    return IMAGERY_SOURCES[STATE_SOURCES.get(state, DEFAULT_SOURCE)]


def tile_course(course_id: str) -> None:
    rows = db_get("courses", {"id": f"eq.{course_id}", "select": "id,name,state"})
    course = rows[0] if rows else {"id": course_id}
    cfg = select_source(course)

    print(f"\n=== {course.get('name') or course_id} ({course.get('state') or '?'})")
    bbox = course_bbox(course_id)
    print(f"  bbox {bbox.as_str()}")

    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        src = workdir / "source.tif"

        fetch_imagery(cfg, bbox, src)
        print(f"  imagery {src.stat().st_size / 1e6:.1f} MB")

        pmtiles, zmin, zmax = build_pmtiles(src, workdir, cfg)
        size = pmtiles.stat().st_size
        print(f"  pack {size / 1e6:.1f} MB (z{zmin}\u2013z{zmax})")

        url = upload(pmtiles, course_id)

    patch = {
        "tiles_url": url,
        "tiles_generated_at": "now()",
        "tiles_min_zoom": zmin,
        "tiles_max_zoom": zmax,
        "tiles_size_bytes": size,
        "imagery_source": cfg["label"],
        "imagery_attribution": cfg["attribution"],
    }
    # Only set the capture date when the source has a known flight year;
    # leaving it null is more honest than guessing.
    if cfg.get("captured"):
        patch["imagery_captured_at"] = cfg["captured"]
    db_patch("courses", {"id": f"eq.{course_id}"}, patch)
    print(f"  done -> {url}")


def queue_all(rebuild: bool) -> int:
    """
    Queue every course that can actually be tiled.

    "Can be tiled" means it has hole geometry — the bbox comes from tee/green/
    centreline points, so a course without them fails immediately. Filtering
    here keeps the queue free of jobs that can only fail.

    Courses that already have a pack are skipped unless `rebuild` is set (for a
    MAX_ZOOM change, or after NAIP refreshes a state).
    """
    courses = db_get("courses", {"select": "id,name,tiles_url"})
    holes = db_get("holes", {"select": "course_id,green_lat"})

    with_geometry = {h["course_id"] for h in holes if h.get("green_lat") is not None}

    queued = 0
    already_queued = 0
    skipped_no_geom = 0
    skipped_has_pack = 0
    for c in courses:
        if c["id"] not in with_geometry:
            skipped_no_geom += 1
            continue
        if c.get("tiles_url") and not rebuild:
            skipped_has_pack += 1
            continue
        try:
            r = requests.post(
                f"{SUPABASE_URL}/rest/v1/course_tile_jobs",
                headers={**_headers(), "Prefer": "resolution=ignore-duplicates"},
                data=json.dumps({"course_id": c["id"]}),
                timeout=60,
            )
            # A pending job for this course already exists — the partial unique
            # index did its job. Counted, not swallowed: reporting "queued 0"
            # with no explanation reads as "nothing to do" when in fact there is
            # a full queue waiting.
            if r.status_code == 409:
                already_queued += 1
                continue
            r.raise_for_status()
            queued += 1
        except Exception as exc:  # noqa: BLE001
            print(f"  could not queue {c.get('name') or c['id']}: {exc}", file=sys.stderr)

    print(
        f"queued {queued} new · {already_queued} already pending"
        f" · skipped {skipped_no_geom} without geometry"
        f" · skipped {skipped_has_pack} already tiled"
    )
    if already_queued and not queued:
        print(f"  {already_queued} job(s) are waiting — run with --claim --loop to process them")
    return queued + already_queued


def claim_and_run(loop: bool) -> None:
    worker = socket.gethostname()
    while True:
        job = rpc("claim_tile_job", {"worker": worker})
        if not job:
            print("no queued jobs")
            return
        # PostgREST returns the composite as a single object or a 1-item list.
        if isinstance(job, list):
            job = job[0] if job else None
        if not job or not job.get("course_id"):
            print("no queued jobs")
            return

        try:
            tile_course(job["course_id"])
            db_patch("course_tile_jobs", {"id": f"eq.{job['id']}"},
                     {"status": "done", "finished_at": "now()", "error": None})
        except Exception as exc:  # noqa: BLE001 - a failed job must not kill the loop
            print(f"  FAILED: {exc}", file=sys.stderr)
            db_patch("course_tile_jobs", {"id": f"eq.{job['id']}"},
                     {"status": "failed", "finished_at": "now()", "error": str(exc)[:500]})
        if not loop:
            return


def main() -> None:
    if not SUPABASE_URL or not SERVICE_KEY:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--course-id", help="tile one course directly")
    ap.add_argument("--claim", action="store_true", help="take a job from the queue")
    ap.add_argument("--loop", action="store_true", help="with --claim, drain the queue")
    ap.add_argument("--queue-all", action="store_true",
                    help="queue every tileable course, then exit (add --loop to also run them)")
    ap.add_argument("--rebuild", action="store_true",
                    help="with --queue-all, re-tile courses that already have a pack")
    args = ap.parse_args()

    if args.course_id:
        tile_course(args.course_id)
    elif args.queue_all:
        queue_all(args.rebuild)
        if args.loop:
            claim_and_run(True)
    elif args.claim:
        claim_and_run(args.loop)
    else:
        ap.error("pass --course-id, --queue-all or --claim")


if __name__ == "__main__":
    main()
