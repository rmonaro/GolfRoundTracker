// Duplicate-course matching.
// ---------------------------------------------------------------------------
// Split out of courses-api so it can be unit-tested: this is the piece where a
// mistake is expensive in both directions. Grouping too loosely folds two real
// clubs into one and hides a course from the players who play it; too tightly
// leaves the picker showing the same course twice, half of it unplayable
// because only one copy has OSM geometry.
// ---------------------------------------------------------------------------

import { haversineMeters, type LngLat } from './geo.ts';

/**
 * Words that describe what a golf course IS, and so never distinguish one from
 * another. Everything else is kept deliberately: "at Verrado" and "Devil's
 * Claw" are exactly the words that tell apart two courses sharing a car park.
 */
const GENERIC_NAME_WORDS = new Set([
  'the',
  'golf',
  'club',
  'course',
  'courses',
  'links',
  'country',
  'cc',
  'gc',
  'gcc'
]);

/** "Richter Park Golf Course" and "Richter Park GC" both become "richter park". */
export function normaliseCourseName(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Apostrophes are dropped, not spaced: one source writes "Devil's Claw" and
    // the next writes "Devils Claw", and splitting on the apostrophe would make
    // those two different names.
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !GENERIC_NAME_WORDS.has(w))
    .join(' ')
    .trim();
}

/** Loose comparison key for a town or state, for rows that have no coordinates. */
export function normalisePlace(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface DedupeCandidate {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Two candidates are the same course when their names normalise equal AND they
 * are close enough on the ground.
 *
 * Name alone is not enough: New York has a "Brae Burn" in Purchase and another
 * in Dansville, 250 miles apart, and both are real clubs. Distance alone is not
 * enough either: Whirlwind's Cattail and Devil's Claw share a clubhouse.
 *
 * A state import can land a course with no coordinates at all. Those fall back
 * to town + state, the only locality signal left — which is what catches Hay
 * Harbor, listed once under "Fishers Island" and once under the ZIP-derived
 * "NY 06390"... except that pair only matches on coordinates, because the towns
 * differ. That is the intended asymmetry: with coordinates, trust them.
 */
export function isSameCourse(
  a: DedupeCandidate,
  b: DedupeCandidate,
  maxDistanceKm: number
): boolean {
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    const metres = haversineMeters([a.lng, a.lat] as LngLat, [b.lng, b.lat] as LngLat);
    return metres <= maxDistanceKm * 1000;
  }
  const city = normalisePlace(a.city);
  const state = normalisePlace(a.state);
  return Boolean(city) && city === normalisePlace(b.city) && state === normalisePlace(b.state);
}

export interface DedupeCluster<T extends DedupeCandidate> {
  /** Normalised name the cluster matched on. */
  key: string;
  members: T[];
}

/**
 * Group candidates into clusters of two or more that are the same course.
 *
 * Clustering is greedy from a seed rather than transitive: a chain of rows each
 * within 1 km of the next could otherwise stretch across a whole city, and
 * "within 1 km of the same course" is the property that actually matters.
 */
export function clusterDuplicates<T extends DedupeCandidate>(
  candidates: T[],
  maxDistanceKm: number
): DedupeCluster<T>[] {
  const byName = new Map<string, T[]>();
  for (const c of candidates) {
    const key = normaliseCourseName(c.name);
    if (!key) continue;
    const arr = byName.get(key) ?? [];
    arr.push(c);
    byName.set(key, arr);
  }

  const clusters: DedupeCluster<T>[] = [];
  for (const [key, rows] of byName) {
    if (rows.length < 2) continue;
    const unassigned = [...rows];
    while (unassigned.length) {
      const seed = unassigned.shift()!;
      const members = [seed];
      for (let i = unassigned.length - 1; i >= 0; i--) {
        if (isSameCourse(seed, unassigned[i], maxDistanceKm)) {
          members.push(unassigned[i]);
          unassigned.splice(i, 1);
        }
      }
      if (members.length > 1) clusters.push({ key, members });
    }
  }
  return clusters;
}

export interface DedupeCounts {
  holes: number;
  tees: number;
  features: number;
  rounds: number;
}

export interface DedupeScorable {
  osm_status: string | null;
  verified: boolean | null;
  tiles_url: string | null;
  lat: number | null;
  lng: number | null;
  course_api_id: string | null;
  source: string | null;
}

/**
 * How complete a course row is, used to pre-select the survivor of a merge.
 *
 * OSM geometry dominates everything else because it is the whole reason the
 * visibility gate exists: a course without it is hidden from players no matter
 * how good its scorecard is. Rounds are weighted next — every one of them can
 * be moved, but a merge that doesn't have to move any is the safer merge.
 */
export function completenessScore(c: DedupeScorable, counts: DedupeCounts): number {
  let score = 0;
  if (c.osm_status === 'synced') score += 1000;
  score += counts.rounds * 25;
  score += counts.tees * 15;
  score += counts.holes * 10;
  // Capped: a course with 800 bunkers mapped is not 4x better than one with 200,
  // and without a cap the feature count would outweigh having any holes at all.
  score += Math.min(counts.features, 200) * 2;
  if (c.verified) score += 50;
  if (c.tiles_url) score += 40;
  if (c.lat != null && c.lng != null) score += 20;
  if (c.course_api_id) score += 5;
  if (c.source === 'api') score += 3;
  else if (c.source === 'opengolf') score += 2;
  return score;
}
