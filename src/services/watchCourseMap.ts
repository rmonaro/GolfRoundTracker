import { supabase } from '@/lib/supabase';
import type { CourseHole, HoleFeature, LngLat } from '@/models';
import { assignFeaturesToHole } from './holesRepo';
import { isUsablyOnline } from './connectivity';
import { getCachedCourse } from './courseCacheRepo';

/**
 * Builds the course-geometry package the Apple Watch renders behind the
 * on-course screen.
 *
 * This is a TRANSPORT format, not a second source of truth: every coordinate
 * comes from the same `holes` / `hole_features` rows the phone's `HoleLayout`
 * draws, assigned to holes by the same `assignFeaturesToHole` pass. What's
 * different is the shape — the watch gets one flat, self-contained document for
 * the whole course, because it has to keep drawing when the phone is pocketed
 * and unreachable, which is most of a round.
 *
 * Coordinates are emitted as EXPLICIT `{ lat, lng }` objects rather than the
 * `[lng, lat]` pairs used internally. The database stores GeoJSON order and the
 * watch consumes `CLLocationCoordinate2D(latitude:longitude:)` — naming the
 * fields is what stops that conversion silently transposing the course into the
 * ocean.
 */

/** One point, in the unambiguous form the watch decodes. */
export interface WatchLatLng {
  lat: number;
  lng: number;
}

export interface WatchMapFeature {
  /** `green` | `fairway` | `tee` | `bunker` | `water` | `water_hazard`. */
  t: string;
  /** True for linestrings (drawn as a stroke, never filled). */
  line: boolean;
  /** Polygon rings, or a single ring for a line. */
  rings: WatchLatLng[][];
}

export interface WatchMapHole {
  n: number;
  par: number | null;
  tee: WatchLatLng | null;
  /** Green centroid from the course row — NOT the pin. */
  green: WatchLatLng | null;
  /** Course-wide stored pin, when one has been recorded. Distinct from
   *  `green`: the watch shows them as different things. */
  pin: WatchLatLng | null;
  centerline: WatchLatLng[];
  features: WatchMapFeature[];
}

export interface WatchCourseMap {
  v: number;
  courseId: string;
  courseName: string | null;
  holes: WatchMapHole[];
}

/** Bumped when the watch-side decoder needs to reject older cached files. */
export const WATCH_COURSE_MAP_VERSION = 1;

/**
 * Feature types worth the watch's pixels. `rough`, `cartpath` and `path` are
 * deliberately dropped: rough is by far the largest geometry on a course and
 * over satellite imagery it reads as noise rather than information, and the
 * cart paths clutter a 1.7" screen without helping anyone aim.
 */
const WATCH_FEATURE_TYPES = new Set([
  'fairway',
  'green',
  'tee',
  'bunker',
  'water',
  'water_hazard'
]);

/**
 * Ring simplification tolerance, in meters.
 *
 * A golf green is ~30 m across on a screen ~180 px wide, so anything under a
 * couple of meters is sub-pixel on the watch. Dropping those vertices is pure
 * win: less to transfer, less for MapKit to tessellate every frame, and no
 * visible difference. 2 m keeps bunker mouths and green lobes recognisable.
 */
const SIMPLIFY_TOLERANCE_M = 2;

/** Hard cap per ring after simplification — a runaway OSM polygon can't blow
 *  up the payload or the watch's render budget. */
const MAX_RING_POINTS = 220;

function isFiniteCoord(p: unknown): p is LngLat {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    Math.abs(p[1] as number) <= 90 &&
    Math.abs(p[0] as number) <= 180
  );
}

/** `[lng, lat]` → `{ lat, lng }`, rounded to ~11 cm. The single place the
 *  GeoJSON axis order is unwound. */
function toLatLng(p: LngLat): WatchLatLng {
  return { lat: round6(p[1]), lng: round6(p[0]) };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Perpendicular distance from `p` to segment `a`–`b`, in meters. Uses a local
 * equirectangular projection (cos-latitude scaling on longitude), which is
 * exact enough at golf-hole scale and far cheaper than a geodesic.
 */
function perpendicularDistanceM(
  p: LngLat,
  a: LngLat,
  b: LngLat,
  mPerDegLng: number,
  mPerDegLat: number
): number {
  const px = (p[0] - a[0]) * mPerDegLng;
  const py = (p[1] - a[1]) * mPerDegLat;
  const bx = (b[0] - a[0]) * mPerDegLng;
  const by = (b[1] - a[1]) * mPerDegLat;
  const segLenSq = bx * bx + by * by;
  if (segLenSq === 0) return Math.hypot(px, py);
  // Project p onto the segment, clamped to its ends.
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / segLenSq));
  return Math.hypot(px - bx * t, py - by * t);
}

/** Douglas–Peucker, iterative so a pathological ring can't blow the stack. */
function simplifyRing(ring: LngLat[], toleranceM: number): LngLat[] {
  if (ring.length <= 3) return ring;
  const midLat = ring[Math.floor(ring.length / 2)][1];
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((midLat * Math.PI) / 180);

  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, ring.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end <= start + 1) continue;
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistanceM(
        ring[i],
        ring[start],
        ring[end],
        mPerDegLng,
        mPerDegLat
      );
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > toleranceM && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }
  const out: LngLat[] = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]);
  return out;
}

/** Evenly thin a ring that is still over the cap after simplification. */
function capRing(ring: LngLat[], max: number): LngLat[] {
  if (ring.length <= max) return ring;
  const step = ring.length / max;
  const out: LngLat[] = [];
  for (let i = 0; i < max; i++) out.push(ring[Math.floor(i * step)]);
  // Keep the ring closed so MapKit doesn't render a gap.
  const last = ring[ring.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Normalize a feature's stored `coords` into a list of rings.
 *
 * The column holds either a linestring (`[[lng,lat], ...]`) or a polygon
 * (`[[[lng,lat], ...], ...]`), distinguished exactly the way `holesRepo` does
 * it — by whether the first element is itself an array of arrays. Anything that
 * doesn't type-check as coordinates is dropped rather than guessed at.
 */
function ringsFromCoords(coords: unknown): LngLat[][] {
  if (!Array.isArray(coords) || coords.length === 0) return [];
  const first = coords[0] as unknown;
  const isPolygon = Array.isArray(first) && Array.isArray((first as unknown[])[0]);
  const raw: unknown[][] = isPolygon ? (coords as unknown[][]) : [coords as unknown[]];
  const out: LngLat[][] = [];
  for (const ring of raw) {
    if (!Array.isArray(ring)) continue;
    const clean = (ring as unknown[]).filter(isFiniteCoord) as LngLat[];
    if (clean.length >= 2) out.push(clean);
  }
  return out;
}

function encodeFeature(f: HoleFeature): WatchMapFeature | null {
  const rings = ringsFromCoords(f.coords);
  if (rings.length === 0) return null;
  const encoded = rings
    .map((r) => capRing(simplifyRing(r, SIMPLIFY_TOLERANCE_M), MAX_RING_POINTS))
    // A polygon needs 3 points to have an area; a line needs 2.
    .filter((r) => r.length >= (f.is_line ? 2 : 3))
    .map((r) => r.map(toLatLng));
  if (encoded.length === 0) return null;
  return { t: f.feature_type, line: !!f.is_line, rings: encoded };
}

function encodeHole(hole: CourseHole, features: HoleFeature[]): WatchMapHole {
  const centerline = Array.isArray(hole.centerline)
    ? (hole.centerline as unknown[]).filter(isFiniteCoord).map((p) => toLatLng(p as LngLat))
    : [];
  return {
    n: hole.hole_number,
    par: hole.par ?? null,
    tee:
      hole.tee_lat != null && hole.tee_lng != null
        ? { lat: round6(hole.tee_lat), lng: round6(hole.tee_lng) }
        : null,
    green:
      hole.green_lat != null && hole.green_lng != null
        ? { lat: round6(hole.green_lat), lng: round6(hole.green_lng) }
        : null,
    pin:
      hole.pin_lat != null && hole.pin_lng != null
        ? { lat: round6(hole.pin_lat), lng: round6(hole.pin_lng) }
        : null,
    centerline,
    features: features
      .filter((f) => WATCH_FEATURE_TYPES.has(f.feature_type))
      .map(encodeFeature)
      .filter((f): f is WatchMapFeature => f != null)
  };
}

/**
 * Assemble the whole course into one watch payload.
 *
 * Offline-first for the same reason `holesRepo.getLayout` is: a golfer who
 * downloaded the course before leaving the car park must still get a map on
 * their wrist at a course with no signal. When a downloaded copy exists it is
 * used verbatim — the network path and the cache path run through the identical
 * assignment + encoding below, so the watch can't render differently depending
 * on reception.
 */
export async function buildWatchCourseMap(
  courseId: string
): Promise<WatchCourseMap | null> {
  let holes: CourseHole[] = [];
  let features: HoleFeature[] = [];
  let courseName: string | null = null;

  const cached = !isUsablyOnline() ? await getCachedCourse(courseId) : null;
  if (cached) {
    holes = cached.holes;
    features = cached.features;
    courseName = cached.courseName;
  } else {
    const [holesRes, featuresRes, courseRes] = await Promise.all([
      supabase.from('holes').select('*').eq('course_id', courseId),
      supabase.from('hole_features').select('*').eq('course_id', courseId),
      supabase.from('courses').select('name').eq('id', courseId).maybeSingle()
    ]);
    if (holesRes.error) throw holesRes.error;
    if (featuresRes.error) throw featuresRes.error;
    holes = (holesRes.data ?? []) as CourseHole[];
    features = (featuresRes.data ?? []) as HoleFeature[];
    courseName = courseRes.data?.name ?? null;
  }

  if (holes.length === 0) return null;

  // Same nearest-hole assignment the phone map uses. The stored `hole_id` is
  // deliberately ignored — see `assignFeaturesToHole` for why it lies.
  const anchorHoles = holes.map((h) => ({
    id: h.id,
    tee_lng: h.tee_lng,
    tee_lat: h.tee_lat,
    green_lng: h.green_lng,
    green_lat: h.green_lat,
    centerline: h.centerline
  }));

  const encoded = holes
    .slice()
    .sort((a, b) => a.hole_number - b.hole_number)
    .map((h) => encodeHole(h, assignFeaturesToHole(h, anchorHoles, features)));

  return {
    v: WATCH_COURSE_MAP_VERSION,
    courseId,
    courseName,
    holes: encoded
  };
}
