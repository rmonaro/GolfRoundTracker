// Offline cache of a course's static geometry.
//
// A course's geometry never changes during a round (and rarely between rounds),
// so it's the ideal thing to hold on device. Caching it is what makes position
// and distance-to-pin work with no signal: those calculations only ever needed
// COORDINATES, never map tiles. Satellite imagery is a separate concern
// (see docs/OFFLINE_MODE.md, Phase 3/4).
//
// What we store is deliberately the RAW rows, not a processed layout: feature →
// hole assignment is done at read time by `assignFeaturesToHole` (nearest-hole,
// see holesRepo), and that logic evolves. Caching raw rows means a logic change
// doesn't invalidate every download.
//
// `getLayout` already fetches every hole and every feature for the whole course
// on each per-hole call, so one download covers all 18 holes at no extra cost.

import { get, set, del, keys, createStore } from 'idb-keyval';
import { supabase } from '@/lib/supabase';
import type { CourseHole, CourseOsmStatus, HoleFeature } from '@/models';
import { toAppError } from './errors';

const store = createStore('grt-course-cache', 'courses');

/** Bump when the cached shape changes so stale entries are discarded, not misread. */
const CACHE_VERSION = 1;

export interface CachedCourse {
  version: number;
  courseId: string;
  courseName: string | null;
  osmStatus: CourseOsmStatus | null;
  holes: CourseHole[];
  features: HoleFeature[];
  downloadedAt: string;
  /** Rough byte size of the serialized entry, for the manage-downloads UI. */
  sizeBytes: number;
}

function keyFor(courseId: string) {
  return `course:${courseId}`;
}

/**
 * Pull a course's full geometry and store it. Safe to call repeatedly — a
 * re-download replaces the entry, which is how a course refreshes after an OSM
 * re-sync.
 */
export async function downloadCourse(courseId: string): Promise<CachedCourse> {
  const [courseRes, holesRes, featuresRes] = await Promise.all([
    supabase.from('courses').select('id, name, osm_status').eq('id', courseId).maybeSingle(),
    supabase.from('holes').select('*').eq('course_id', courseId),
    supabase.from('hole_features').select('*').eq('course_id', courseId)
  ]);

  if (courseRes.error) throw toAppError(courseRes.error, 'Could not load course');
  if (holesRes.error) throw toAppError(holesRes.error, 'Could not load course holes');
  if (featuresRes.error) throw toAppError(featuresRes.error, 'Could not load course features');

  const entry: CachedCourse = {
    version: CACHE_VERSION,
    courseId,
    courseName: (courseRes.data?.name as string | null) ?? null,
    osmStatus: (courseRes.data?.osm_status ?? null) as CourseOsmStatus | null,
    holes: (holesRes.data ?? []) as CourseHole[],
    features: (featuresRes.data ?? []) as HoleFeature[],
    downloadedAt: new Date().toISOString(),
    sizeBytes: 0
  };
  // Measure after building so the number reflects what actually gets stored.
  entry.sizeBytes = JSON.stringify(entry).length;

  await set(keyFor(courseId), entry, store);
  return entry;
}

/** Read a cached course. Returns null when absent or written by an older version. */
export async function getCachedCourse(courseId: string): Promise<CachedCourse | null> {
  try {
    const entry = await get<CachedCourse>(keyFor(courseId), store);
    if (!entry) return null;
    if (entry.version !== CACHE_VERSION) {
      // Shape changed under us — drop rather than risk misreading it.
      await del(keyFor(courseId), store);
      return null;
    }
    return entry;
  } catch (err) {
    console.warn('[courseCache] read failed', err);
    return null;
  }
}

export async function isCourseCached(courseId: string): Promise<boolean> {
  return (await getCachedCourse(courseId)) != null;
}

export async function deleteCachedCourse(courseId: string): Promise<void> {
  await del(keyFor(courseId), store);
}

/** Every cached course, newest first — backs a manage-downloads screen. */
export async function listCachedCourses(): Promise<CachedCourse[]> {
  try {
    const allKeys = await keys(store);
    const entries = await Promise.all(
      allKeys.map((k) => get<CachedCourse>(k as string, store))
    );
    return entries
      .filter((e): e is CachedCourse => !!e && e.version === CACHE_VERSION)
      .sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
  } catch (err) {
    console.warn('[courseCache] list failed', err);
    return [];
  }
}

/**
 * Cache a course in the background, swallowing failures.
 *
 * Used on round start: having geometry on device is a resilience win, never a
 * reason to block or fail the thing the golfer actually asked for.
 */
export function cacheCourseInBackground(courseId: string | null | undefined): void {
  if (!courseId) return;
  void downloadCourse(courseId).catch((err) => {
    console.warn('[courseCache] background download failed', err);
  });
}
