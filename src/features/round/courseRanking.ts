// Ordering + text-matching for the course picker. Pure — no Capacitor, no
// network, no store — so the rules a golfer actually sees are unit-testable.

import { haversineMeters } from '@/features/range/rangeGeo';
import type { Course } from '@/models';

export interface RankedCourse {
  course: Course;
  /** Straight-line metres to the golfer, or null when either end has no fix. */
  distanceMeters: number | null;
  favorite: boolean;
}

export interface RankOptions {
  favorites: ReadonlySet<string>;
  /** The golfer's current position, or null when location isn't available. */
  origin: { lat: number; lng: number } | null;
  /** Free-text filter over name / club / city / state. */
  search?: string;
}

/** Does this course match the typed query? Matches name, club, city and state. */
export function matchesSearch(course: Course, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [course.name, course.club_name, course.city, course.state].some(
    (field) => field?.toLowerCase().includes(q) ?? false
  );
}

/**
 * Order the picker: starred courses first, then nearest first, then everything
 * whose distance we can't compute, alphabetically.
 *
 * Distance and favourite are independent signals and favourite wins — a golfer
 * who starred their home club wants it on top when they open the app at home,
 * which is precisely when a dozen other courses are also nearby. Within each
 * group the same nearest-first rule applies.
 *
 * Courses with no coordinates (hand-entered ones, mostly) sort last rather than
 * being treated as distance 0, which would float them above the course the
 * golfer is standing on.
 */
export function rankCourses(courses: Course[], opts: RankOptions): RankedCourse[] {
  const { favorites, origin, search = '' } = opts;

  const ranked: RankedCourse[] = courses
    .filter((c) => matchesSearch(c, search))
    .map((course) => ({
      course,
      distanceMeters:
        origin && course.lat != null && course.lng != null
          ? haversineMeters(origin, { lat: course.lat, lng: course.lng })
          : null,
      favorite: favorites.has(course.id)
    }));

  return ranked.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    if (a.distanceMeters != null && b.distanceMeters != null) {
      if (a.distanceMeters !== b.distanceMeters) {
        return a.distanceMeters - b.distanceMeters;
      }
    } else if (a.distanceMeters != null) {
      return -1;
    } else if (b.distanceMeters != null) {
      return 1;
    }
    return a.course.name.localeCompare(b.course.name);
  });
}

const METERS_PER_MILE = 1609.344;

/**
 * Distance for a list row. Miles throughout — the app's other distances are
 * yards, but nobody judges "is this course worth driving to" in yards.
 * Sub-tenth distances read as "here" rather than "0.0 mi", which is the answer
 * the golfer standing in the car park actually wants.
 */
export function formatCourseDistance(meters: number | null): string | null {
  if (meters == null) return null;
  const miles = meters / METERS_PER_MILE;
  if (miles < 0.1) return 'Here';
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
