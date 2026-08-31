import { supabase } from '@/lib/supabase';
import type {
  CourseHole,
  HoleFeature,
  CourseOsmStatus,
  OrientationConfidence,
  LngLat
} from '@/models';
import { toAppError } from './errors';
import { isUsablyOnline } from './connectivity';
import { getCachedCourse, type CachedCourse } from './courseCacheRepo';

export interface HoleLayoutData {
  hole: CourseHole;
  features: HoleFeature[];
}

/** Flatten a feature's coords (line ring OR polygon rings) into a flat point list. */
function flattenFeatureCoords(coords: unknown): LngLat[] {
  if (!Array.isArray(coords) || coords.length === 0) return [];
  // Polygon: [[ [lng,lat], ... ], ...]  →  first element is a ring (array of points).
  // Line:    [ [lng,lat], ... ]         →  first element is a point (array of numbers).
  const first = coords[0] as unknown;
  if (Array.isArray(first) && Array.isArray((first as unknown[])[0])) {
    // Polygon rings — flatten every ring.
    return (coords as LngLat[][]).flat();
  }
  return coords as LngLat[];
}

function centroidOf(points: LngLat[]): LngLat | null {
  if (points.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const [lng, lat] of points) {
    sx += lng;
    sy += lat;
  }
  return [sx / points.length, sy / points.length];
}

/** Anchor points that represent a hole's geometry: centerline vertices + tee + green. */
function holeAnchors(h: {
  tee_lng: number | null;
  tee_lat: number | null;
  green_lng: number | null;
  green_lat: number | null;
  centerline: Array<[number, number]> | null;
}): LngLat[] {
  const pts: LngLat[] = [];
  if (Array.isArray(h.centerline)) pts.push(...(h.centerline as LngLat[]));
  if (h.tee_lng != null && h.tee_lat != null) pts.push([h.tee_lng, h.tee_lat]);
  if (h.green_lng != null && h.green_lat != null) pts.push([h.green_lng, h.green_lat]);
  return pts;
}

/** Squared planar distance with cos-lat correction so lng/lat scales match locally. */
function sqDist(a: LngLat, b: LngLat, cosLat: number): number {
  const dx = (a[0] - b[0]) * cosLat;
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/** Min squared distance from a point to any of a hole's anchor points. */
function minSqDistToHole(c: LngLat, anchors: LngLat[], cosLat: number): number {
  let best = Infinity;
  for (const a of anchors) {
    const d = sqDist(c, a, cosLat);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Assign a course's features to ONE hole by nearest-hole centroid.
 *
 * Extracted so the network path and the offline-cache path can't diverge — both
 * must produce byte-identical layouts, or a hole would render differently
 * depending on signal.
 *
 * We deliberately ignore the stored `hole_id`. The OSM sync assigns features by
 * "first hole whose (60m-expanded) bbox contains the centroid", but adjacent
 * holes' bboxes overlap, so a feature often lands on the wrong hole (or none) —
 * leaving some holes with zero features, which made tap-to-record always fall
 * back to 'rough'. Nearest-hole assignment is overlap-proof and fixes
 * already-synced courses without a re-sync.
 */
export function assignFeaturesToHole(
  hole: CourseHole,
  allHoles: Array<{
    id: string;
    tee_lng: number | null;
    tee_lat: number | null;
    green_lng: number | null;
    green_lat: number | null;
    centerline: Array<[number, number]> | null;
  }>,
  allFeatures: HoleFeature[]
): HoleFeature[] {
  const cosLat = Math.cos(((hole.green_lat ?? hole.tee_lat ?? 0) * Math.PI) / 180);
  const holeAnchorList = allHoles.map((h) => ({
    id: h.id,
    anchors: holeAnchors(h)
  }));

  return allFeatures.filter((f) => {
    const c = centroidOf(flattenFeatureCoords(f.coords));
    if (!c) return false;
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const h of holeAnchorList) {
      if (h.anchors.length === 0) continue;
      const d = minSqDistToHole(c, h.anchors, cosLat);
      if (d < bestDist) {
        bestDist = d;
        bestId = h.id;
      }
    }
    return bestId === hole.id;
  });
}

/**
 * Build the same `{ data, courseStatus }` shape `getLayout` returns, but from a
 * downloaded course. Mirrors the network path's short-circuits exactly so an
 * offline course renders identically to an online one.
 */
function layoutFromCache(
  cached: CachedCourse,
  holeNumber: number
): { data: HoleLayoutData | null; courseStatus: CourseOsmStatus | null } {
  const courseStatus = cached.osmStatus;
  if (courseStatus === 'skip' || courseStatus === 'no_coverage') {
    return { data: null, courseStatus };
  }
  const hole = cached.holes.find((h) => h.hole_number === holeNumber);
  if (!hole) return { data: null, courseStatus };

  const features = assignFeaturesToHole(
    hole,
    cached.holes as Parameters<typeof assignFeaturesToHole>[1],
    cached.features
  );
  return { data: { hole, features }, courseStatus };
}

type LayoutResult = { data: HoleLayoutData | null; courseStatus: CourseOsmStatus | null };

/**
 * How long the hole screen will wait for the network when it already has the
 * course on the device.
 *
 * Shorter than the client-wide request deadline on purpose. That deadline is
 * about giving up; this is about the fact that a golfer standing on the tee has
 * a perfectly good copy of this hole in IndexedDB, so a few seconds is all the
 * freshness is worth. The request isn't cancelled — if it lands late it still
 * warms the cache for the next hole.
 */
const CACHED_LAYOUT_PATIENCE_MS = 3500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('layout-timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function fetchLayoutFromNetwork(
  courseId: string,
  holeNumber: number
): Promise<LayoutResult> {
  const { data: course, error: courseErr } = await supabase
    .from('courses')
    .select('osm_status')
    .eq('id', courseId)
    .maybeSingle();
  if (courseErr) throw toAppError(courseErr, 'Could not load course');
  if (!course) return { data: null, courseStatus: null };

  const courseStatus = (course.osm_status ?? null) as CourseOsmStatus | null;
  // Short-circuit when there's no chance of geometry.
  if (courseStatus === 'skip' || courseStatus === 'no_coverage') {
    return { data: null, courseStatus };
  }

  const { data: hole, error: holeErr } = await supabase
    .from('holes')
    .select('*')
    .eq('course_id', courseId)
    .eq('hole_number', holeNumber)
    .maybeSingle();
  if (holeErr) throw toAppError(holeErr, 'Could not load hole geometry');
  if (!hole) return { data: null, courseStatus };

  // Load EVERY feature for the course, then assign each to its nearest hole
  // here on read — we deliberately ignore the stored `hole_id`. The OSM sync
  // assigns features by "first hole whose (60m-expanded) bbox contains the
  // centroid", but adjacent holes' bboxes overlap, so a feature often lands
  // on the wrong hole (or none) — leaving some holes with zero features, which
  // made tap-to-record always fall back to 'rough'. Nearest-hole assignment
  // is overlap-proof and fixes already-synced courses without a re-sync.
  const { data: allFeatures, error: featErr } = await supabase
    .from('hole_features')
    .select('*')
    .eq('course_id', courseId);
  if (featErr) throw toAppError(featErr, 'Could not load hole features');

  const { data: allHoles, error: holesErr } = await supabase
    .from('holes')
    .select('id, tee_lng, tee_lat, green_lng, green_lat, centerline')
    .eq('course_id', courseId);
  if (holesErr) throw toAppError(holesErr, 'Could not load course holes');

  const features = assignFeaturesToHole(
    hole as CourseHole,
    (allHoles ?? []) as Parameters<typeof assignFeaturesToHole>[1],
    (allFeatures ?? []) as HoleFeature[]
  );

  return {
    data: { hole: hole as CourseHole, features },
    courseStatus
  };
}

export const holesRepo = {
  /**
   * Fetch the static hole + all assigned features for rendering. Also returns the
   * parent course's `osm_status` so callers can render the right empty/pending state.
   *
   * Cache-aware in BOTH directions, which matters more than it sounds. Gating
   * only on `isUsablyOnline()` was enough for a clean disconnect, but not for
   * the way signal actually dies on a course: the status can still say `online`
   * (it's a sampled value) while this very request is the one discovering that
   * it isn't. So when the course is on the device we also cap how long we're
   * willing to wait, and we fall back on any failure — the golfer gets the hole
   * either way, and never sits on a spinner over data they already have.
   */
  async getLayout(courseId: string, holeNumber: number): Promise<LayoutResult> {
    // Read the cache up front so the fallback is in hand before we start
    // waiting on a socket that may never answer.
    const cached = await getCachedCourse(courseId).catch(() => null);

    // Offline (or online-but-unusable): serve from the downloaded course. This
    // is the whole point of the cache — distance-to-pin and the hole render need
    // coordinates, not connectivity.
    if (cached && !isUsablyOnline()) return layoutFromCache(cached, holeNumber);

    const request = fetchLayoutFromNetwork(courseId, holeNumber);

    // No cache — let the request run to the client deadline and fail normally,
    // so the caller shows its existing error/pending state rather than a silent
    // blank.
    if (!cached) return request;

    try {
      return await withTimeout(request, CACHED_LAYOUT_PATIENCE_MS);
    } catch {
      // Swallow the late rejection of the request we walked away from — an
      // unhandled rejection here would be noise, not information.
      void request.catch(() => {});
      return layoutFromCache(cached, holeNumber);
    }
  },

  /** Admin-flip helpers used by the orientation review queue (Phase 4). */
  async setOrientationConfirmed(holeId: string): Promise<void> {
    const { error } = await supabase
      .from('holes')
      .update({ orientation_confidence: 'manual' as OrientationConfidence })
      .eq('id', holeId);
    if (error) throw toAppError(error, 'Could not save orientation');
  },

  /**
   * Update the shared course-wide pin position for a hole. Passing null/null
   * clears the override and falls everyone back to the course's stored green
   * coord. Backed by a SECURITY DEFINER RPC so callers can only touch the
   * pin columns, never the rest of the holes row.
   */
  async setPin(holeId: string, lng: number | null, lat: number | null): Promise<void> {
    const { error } = await supabase.rpc('set_hole_pin', {
      p_hole_id: holeId,
      p_lng: lng,
      p_lat: lat
    });
    if (error) throw toAppError(error, 'Could not save pin position');
  },

  async flipHole(holeId: string): Promise<void> {
    // Fetch the row, swap tee/green, advance rotation by π, mark manual.
    const { data: row, error: fetchErr } = await supabase
      .from('holes')
      .select('tee_lng, tee_lat, green_lng, green_lat, rotation_radians')
      .eq('id', holeId)
      .single();
    if (fetchErr || !row) throw toAppError(fetchErr ?? new Error('Hole not found'));
    const nextRotation =
      row.rotation_radians == null ? null : ((row.rotation_radians + Math.PI) % (2 * Math.PI));
    const { error: updateErr } = await supabase
      .from('holes')
      .update({
        tee_lng: row.green_lng,
        tee_lat: row.green_lat,
        green_lng: row.tee_lng,
        green_lat: row.tee_lat,
        rotation_radians: nextRotation,
        orientation_confidence: 'manual' as OrientationConfidence
      })
      .eq('id', holeId);
    if (updateErr) throw toAppError(updateErr, 'Could not flip hole');
  }
};
