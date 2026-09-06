#!/usr/bin/env python3
"""
SAM segmentation prototype — derive course polygons from aerial imagery.

    imagery (same fetch the tiler uses) -> SAM masks -> polygons -> classify
                                        -> score against the OSM features we
                                           already hold for the course

The question this exists to answer is narrow: on public-domain NAIP-class
imagery, can segmentation find bunkers, greens and water well enough to be
worth building on? So it writes NOTHING to the database. It emits GeoJSON and a
scorecard against `hole_features`, and a human decides.

Run against a course that is ALREADY OSM-synced, so there is something to score
against:

    docker run --rm --env-file tools/tiler/.env \
      -v "$PWD/out:/out" grt-segment --course-id <uuid> --out /out

Why the numbers below are what they are is noted where it matters; most of them
are guesses that the scorecard exists to test.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import numpy as np

# tile_course lives at /app in the base image and owns everything about
# fetching imagery for a course.
sys.path.insert(0, "/app")
import tile_course as tc  # noqa: E402

from osgeo import gdal, ogr, osr  # noqa: E402

gdal.UseExceptions()

# SAM sees 1024px at a time. Larger tiles are downscaled internally, which
# costs exactly the detail that distinguishes a bunker edge from its shadow.
TILE_PX = 1024
TILE_OVERLAP_PX = 128

# A mask smaller than this is noise (a cart, a shadow); larger than this is the
# whole property rather than a feature. Both in square metres.
MIN_AREA_M2 = 40
MAX_AREA_M2 = 40_000


# --------------------------------------------------------------------------
# Geometry helpers — pixel space to WGS84, without shapely/geopandas
# --------------------------------------------------------------------------

def raster_to_wgs84_transform(ds: gdal.Dataset):
    """Return a fn mapping (px, py) -> (lng, lat)."""
    gt = ds.GetGeoTransform()
    src = osr.SpatialReference()
    src.ImportFromWkt(ds.GetProjection())
    dst = osr.SpatialReference()
    dst.ImportFromEPSG(4326)
    # Without this, GDAL 3 returns lat/lng in authority order rather than x/y.
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    ct = osr.CoordinateTransformation(src, dst)

    def to_wgs(px: float, py: float) -> tuple[float, float]:
        x = gt[0] + px * gt[1] + py * gt[2]
        y = gt[3] + px * gt[4] + py * gt[5]
        lng, lat, _ = ct.TransformPoint(x, y)
        return lng, lat

    return to_wgs


def polygon_area_m2(ring: list[tuple[float, float]]) -> float:
    """Planar area of a small lng/lat ring, metres squared."""
    if len(ring) < 3:
        return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    mx = 111_320 * math.cos(math.radians(lat0))
    my = 110_540
    pts = [((lng * mx), (lat * my)) for lng, lat in ring]
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def point_in_ring(pt: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
    """Ray casting. Enough for scoring; not a general-purpose GIS predicate."""
    x, y = pt
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xin = (x2 - x1) * (y - y1) / (y2 - y1 + 1e-15) + x1
            if x < xin:
                inside = not inside
    return inside


def centroid(ring: list[tuple[float, float]]) -> tuple[float, float]:
    return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))


def mask_to_rings(mask: np.ndarray, x_off: int, y_off: int, to_wgs) -> list[list[tuple[float, float]]]:
    """
    Vectorise a boolean mask with GDAL's Polygonize.

    GDAL rather than OpenCV purely to keep the image small — it is already here
    for the tiler, and Polygonize gives simplified rings straight away.
    """
    h, w = mask.shape
    drv = gdal.GetDriverByName("MEM")
    src = drv.Create("", w, h, 1, gdal.GDT_Byte)
    src.GetRasterBand(1).WriteArray(mask.astype(np.uint8))
    band = src.GetRasterBand(1)

    ogr_drv = ogr.GetDriverByName("Memory")
    vec = ogr_drv.CreateDataSource("mem")
    layer = vec.CreateLayer("polys", None, ogr.wkbPolygon)
    field = ogr.FieldDefn("val", ogr.OFTInteger)
    layer.CreateField(field)
    gdal.Polygonize(band, band, layer, 0, [], callback=None)

    rings: list[list[tuple[float, float]]] = []
    for feat in layer:
        if feat.GetField("val") != 1:
            continue
        geom = feat.GetGeometryRef()
        if geom is None:
            continue
        outer = geom.GetGeometryRef(0)
        if outer is None:
            continue
        ring = []
        for i in range(outer.GetPointCount()):
            px, py = outer.GetPoint_2D(i)
            ring.append(to_wgs(px + x_off, py + y_off))
        if len(ring) >= 4:
            rings.append(ring)
    return rings


# --------------------------------------------------------------------------
# Classification — SAM finds shapes, not meanings
# --------------------------------------------------------------------------

def classify(rgb: np.ndarray, nir: np.ndarray | None, mask: np.ndarray, area_m2: float) -> tuple[str, float]:
    """
    Label a mask from its colour and size.

    This is the weak link and is meant to be: SAM returns regions with no idea
    what golf is, so everything separating a bunker from a cart park happens
    here, on three bands of visible light. The thresholds are first guesses
    calibrated against nothing — the scorecard is what tells us if they hold.
    """
    px = rgb[mask]
    if px.size == 0:
        return "unknown", 0.0
    r, g, b = (px[:, 0].mean(), px[:, 1].mean(), px[:, 2].mean())
    brightness = (r + g + b) / 3
    # Greenness: how much the green band leads the others. Turf is strongly
    # positive, sand is near zero, water is negative.
    greenness = g - (r + b) / 2
    std = float(px.std())

    if brightness > 140 and greenness < 12:
        return "bunker", min(1.0, (brightness - 140) / 60)

    # Water needs the near-infrared band, not visible light.
    #
    # Two attempts failed on RGB alone: `dark and blue >= red` gave 71 false
    # positives on a crop with no water, and tightening to blue-dominant still
    # gave 63. The reason is physical rather than a bad threshold — shadow is
    # lit by blue SKYLIGHT, so shaded canopy genuinely is blue-dominant and
    # looks exactly like water in RGB.
    #
    # NIR separates them outright: water absorbs it almost completely while
    # vegetation is the brightest thing in the scene. NDWI = (G - NIR)/(G + NIR)
    # is positive for water and strongly negative for foliage. The imagery is
    # already 4-band; the tiler just discards NIR because a map only needs
    # visible light.
    if nir is not None:
        nir_px = nir[mask].astype(float)
        g_px = px[:, 1].astype(float)
        ndwi = float(((g_px - nir_px) / (g_px + nir_px + 1e-6)).mean())
        if ndwi > 0.0 and brightness < 130:
            return "water_hazard", min(1.0, ndwi * 4)
    elif brightness < 110 and b > g + 3 and b > r + 8:
        # No NIR available: fall back to the RGB guess, which we know is poor.
        return "water_hazard", 0.2

    if greenness > 8:
        # A putting green is small, smooth turf; a fairway is large turf.
        if 250 <= area_m2 <= 2500 and std < 40:
            return "green", min(1.0, max(0.0, (40 - std) / 40))
        if area_m2 > 2500:
            return "fairway", 0.4
    return "unknown", 0.0


# --------------------------------------------------------------------------
# Scoring against what we already believe
# --------------------------------------------------------------------------

def load_truth(course_id: str) -> dict[str, list[list[tuple[float, float]]]]:
    rows = tc.db_get(
        "hole_features",
        {"course_id": f"eq.{course_id}", "select": "feature_type,coords,is_line"},
    )
    truth: dict[str, list[list[tuple[float, float]]]] = {}
    for r in rows:
        if r.get("is_line"):
            continue
        coords = r.get("coords") or []
        ring = []
        # coords is [[lng,lat],...] for a polygon, or nested one deeper.
        flat = coords[0] if coords and isinstance(coords[0], list) and coords[0] and isinstance(coords[0][0], list) else coords
        for pt in flat:
            if isinstance(pt, list) and len(pt) >= 2:
                ring.append((float(pt[0]), float(pt[1])))
        if len(ring) >= 3:
            truth.setdefault(r["feature_type"], []).append(ring)
    return truth


def score(detected: list[dict], truth: dict[str, list]) -> None:
    """
    Centroid-in-polygon matching, deliberately generous.

    A strict IoU would mostly measure how ragged SAM's edges are, and that is
    not the question. The question is whether it finds the right THINGS in the
    right PLACES — so a detection counts if its centre lands inside a real
    feature of the same type.
    """
    print("\n" + "=" * 72)
    print("SCORECARD  (detected vs the OSM features already in hole_features)")
    print("=" * 72)
    print(f"{'type':16} {'OSM':>5} {'found':>6} {'hit':>5} {'recall':>7} {'precision':>10}")

    for ftype in sorted(set(list(truth.keys()) + [d["type"] for d in detected])):
        real = truth.get(ftype, [])
        mine = [d for d in detected if d["type"] == ftype]
        if not real and not mine:
            continue
        hits = 0
        matched_truth = set()
        for d in mine:
            c = centroid(d["ring"])
            for i, ring in enumerate(real):
                if point_in_ring(c, ring):
                    hits += 1
                    matched_truth.add(i)
                    break
        recall = len(matched_truth) / len(real) if real else float("nan")
        precision = hits / len(mine) if mine else float("nan")
        print(
            f"{ftype:16} {len(real):5} {len(mine):6} {hits:5} "
            f"{recall:7.0%} {precision:10.0%}"
            if real and mine
            else f"{ftype:16} {len(real):5} {len(mine):6} {hits:5} {'—':>7} {'—':>10}"
        )
    print("\nrecall    = OSM features whose area contains at least one detection")
    print("precision = detections landing inside a real feature of that type")


# --------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--course-id", required=True)
    ap.add_argument(
        "--zoom",
        type=int,
        default=18,
        help="Resolution to fetch at. The tiler's own max (CT z20) is far more "
             "pixels than SAM needs on a CPU; z18 is ~0.45 m/px.",
    )
    ap.add_argument(
        "--crop",
        type=float,
        default=1.0,
        help="Shrink the bbox about its centre to this fraction (0-1). SAM on "
             "CPU is ~1-2 min per 1024px tile, and a full course is ~40 tiles; "
             "0.4 gives a signal in minutes. Scoring is restricted to the "
             "fetched area either way, so the numbers stay honest.",
    )
    ap.add_argument("--out", default="/out")
    args = ap.parse_args()

    rows = tc.db_get("courses", {"id": f"eq.{args.course_id}", "select": "id,name,state"})
    if not rows:
        raise SystemExit("course not found")
    course = rows[0]
    cfg = dict(tc.select_source(course))
    cfg["max_zoom"] = min(args.zoom, cfg["max_zoom"])
    # The tiler asks for visible bands only — correct for a basemap, wrong
    # here. Ask for everything the source has so NIR reaches the classifier.
    had_band_ids = cfg.get("band_ids")
    cfg["band_ids"] = None

    print(f"=== {course.get('name')} ({course.get('state')})  source={cfg['label']} z{cfg['max_zoom']}")
    bbox = tc.course_bbox(args.course_id)
    if args.crop < 1.0:
        cx = (bbox.min_lng + bbox.max_lng) / 2
        cy = (bbox.min_lat + bbox.max_lat) / 2
        hw = (bbox.max_lng - bbox.min_lng) * args.crop / 2
        hh = (bbox.max_lat - bbox.min_lat) * args.crop / 2
        bbox = tc.BBox(cx - hw, cy - hh, cx + hw, cy + hh)
    print(f"  bbox {bbox.as_str()}")

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        tif = Path(tmp) / "source.tif"
        tc.fetch_imagery(cfg, bbox, tif)
        print(f"  imagery {tif.stat().st_size / 1e6:.1f} MB")

        ds = gdal.Open(str(tif))
        w, h = ds.RasterXSize, ds.RasterYSize
        print(f"  raster {w}x{h}px, {ds.RasterCount} band(s)")
        to_wgs = raster_to_wgs84_transform(ds)
        rgb = np.dstack([ds.GetRasterBand(i + 1).ReadAsArray() for i in range(min(3, ds.RasterCount))])
        if rgb.dtype != np.uint8:
            rgb = (rgb / rgb.max() * 255).astype(np.uint8)
        nir_full = ds.GetRasterBand(4).ReadAsArray() if ds.RasterCount >= 4 else None
        print(f"  NIR band: {'present' if nir_full is not None else 'absent'}"
              f" (source normally requests bands {had_band_ids})")

        from segment_anything import SamAutomaticMaskGenerator, sam_model_registry

        print("  loading SAM vit_b (CPU)…")
        sam = sam_model_registry["vit_b"](checkpoint="/opt/sam_vit_b.pth")
        sam.to("cpu")
        gen = SamAutomaticMaskGenerator(
            sam,
            # Fewer sample points than the default 32x32: this is a CPU run and
            # golf features are large relative to the frame.
            # Raised from 16/0.86/0.90 after the first run: turf is
            # low-contrast and SAM was returning as few as 2 masks on some
            # tiles, which caps recall no matter how good the classifier is.
            points_per_side=24,
            pred_iou_thresh=0.80,
            stability_score_thresh=0.85,
            # 0, not a threshold: any positive value makes SAM import cv2 for
            # its cleanup pass, and this image runs Python 3.14 where opencv
            # has no wheel (it would try to compile, and there is no compiler).
            # The MIN_AREA_M2 filter below drops small masks anyway, in metres
            # rather than pixels, which is the unit we actually care about.
            min_mask_region_area=0,
        )

        detected: list[dict] = []
        step = TILE_PX - TILE_OVERLAP_PX
        tiles = [(x, y) for y in range(0, h, step) for x in range(0, w, step)]
        print(f"  {len(tiles)} tile(s) of {TILE_PX}px")

        for n, (x, y) in enumerate(tiles, 1):
            sub = rgb[y : y + TILE_PX, x : x + TILE_PX]
            sub_nir = None if nir_full is None else nir_full[y : y + TILE_PX, x : x + TILE_PX]
            if sub.shape[0] < 64 or sub.shape[1] < 64:
                continue
            masks = gen.generate(sub)
            kept = 0
            for m in masks:
                seg = m["segmentation"]
                for ring in mask_to_rings(seg, x, y, to_wgs):
                    area = polygon_area_m2(ring)
                    if not (MIN_AREA_M2 <= area <= MAX_AREA_M2):
                        continue
                    ftype, conf = classify(sub, sub_nir, seg, area)
                    if ftype == "unknown":
                        continue
                    detected.append({"type": ftype, "ring": ring, "area_m2": area, "conf": conf})
                    kept += 1
            print(f"    tile {n}/{len(tiles)} at ({x},{y}): {len(masks)} masks -> {kept} features")

        gj = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"feature_type": d["type"], "area_m2": round(d["area_m2"]), "confidence": round(d["conf"], 2)},
                    "geometry": {"type": "Polygon", "coordinates": [[[p[0], p[1]] for p in d["ring"]]]},
                }
                for d in detected
            ],
        }
        dest = outdir / f"{args.course_id}.geojson"
        dest.write_text(json.dumps(gj))
        print(f"\n  wrote {len(detected)} polygons -> {dest}")

        truth = load_truth(args.course_id)
        if args.crop < 1.0:
            # Otherwise recall is punished for features we never looked at.
            for ftype, rings in list(truth.items()):
                truth[ftype] = [
                    r for r in rings
                    if bbox.min_lng <= centroid(r)[0] <= bbox.max_lng
                    and bbox.min_lat <= centroid(r)[1] <= bbox.max_lat
                ]
        score(detected, truth)


if __name__ == "__main__":
    main()
