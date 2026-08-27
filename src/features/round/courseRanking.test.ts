import { describe, it, expect } from 'vitest';
import { formatCourseDistance, matchesSearch, rankCourses } from './courseRanking';
import type { Course } from '@/models';

/** Minimal Course row — the ranking only reads these fields. */
const course = (over: Partial<Course> & { id: string; name: string }): Course =>
  ({
    tee_box: null,
    course_rating: null,
    slope_rating: null,
    total_par: 72,
    total_yardage: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    course_api_id: null,
    club_name: null,
    country: null,
    lat: null,
    lng: null,
    search_radius: null,
    scorecard_external: null,
    osm_synced_at: null,
    osm_status: null,
    osm_error: null,
    source: null,
    created_by_user: null,
    verified: null,
    verified_by: null,
    verified_at: null,
    tiles_url: null,
    tiles_generated_at: null,
    tiles_min_zoom: null,
    tiles_max_zoom: null,
    tiles_size_bytes: null,
    imagery_source: null,
    imagery_attribution: null,
    imagery_captured_at: null,
    ...over
  }) as Course;

// Roughly Augusta, and points progressively further east.
const HERE = { lat: 33.5, lng: -82.02 };
const near = course({ id: 'near', name: 'Near Club', lat: 33.51, lng: -82.02 });
const mid = course({ id: 'mid', name: 'Mid Club', lat: 33.7, lng: -82.02 });
const far = course({ id: 'far', name: 'Far Club', lat: 35.0, lng: -82.02 });
const noCoords = course({ id: 'none', name: 'A Nameless Muni' });

const none = new Set<string>();

describe('rankCourses', () => {
  it('sorts nearest first when the golfer has a fix', () => {
    const out = rankCourses([far, near, mid], { favorites: none, origin: HERE });
    expect(out.map((r) => r.course.id)).toEqual(['near', 'mid', 'far']);
    expect(out[0].distanceMeters).toBeLessThan(out[1].distanceMeters!);
  });

  it('floats favourites above closer non-favourites', () => {
    const out = rankCourses([near, mid, far], {
      favorites: new Set(['far']),
      origin: HERE
    });
    expect(out.map((r) => r.course.id)).toEqual(['far', 'near', 'mid']);
    expect(out[0].favorite).toBe(true);
  });

  it('still sorts favourites among themselves by distance', () => {
    const out = rankCourses([far, mid, near], {
      favorites: new Set(['far', 'mid']),
      origin: HERE
    });
    expect(out.map((r) => r.course.id)).toEqual(['mid', 'far', 'near']);
  });

  it('puts courses with no coordinates last, not first', () => {
    // The regression this guards: treating a missing lat/lng as distance 0
    // would rank a hand-entered course above the one you are standing on.
    const out = rankCourses([noCoords, mid, near], { favorites: none, origin: HERE });
    expect(out.map((r) => r.course.id)).toEqual(['near', 'mid', 'none']);
    expect(out[2].distanceMeters).toBeNull();
  });

  it('falls back to alphabetical with no fix', () => {
    const out = rankCourses([near, far, mid], { favorites: none, origin: null });
    expect(out.map((r) => r.course.name)).toEqual(['Far Club', 'Mid Club', 'Near Club']);
    expect(out.every((r) => r.distanceMeters === null)).toBe(true);
  });

  it('keeps favourites on top with no fix', () => {
    const out = rankCourses([near, far, mid], {
      favorites: new Set(['near']),
      origin: null
    });
    expect(out[0].course.id).toBe('near');
  });

  it('applies the search filter before ordering', () => {
    const out = rankCourses([near, mid, far], {
      favorites: none,
      origin: HERE,
      search: 'far'
    });
    expect(out.map((r) => r.course.id)).toEqual(['far']);
  });
});

describe('matchesSearch', () => {
  const c = course({
    id: 'x',
    name: 'Pine Valley',
    club_name: 'Pine Valley Golf Club',
    city: 'Clementon',
    state: 'NJ'
  });

  it('matches name, club, city and state, case-insensitively', () => {
    for (const q of ['pine', 'GOLF CLUB', 'clementon', 'nj']) {
      expect(matchesSearch(c, q)).toBe(true);
    }
    expect(matchesSearch(c, 'augusta')).toBe(false);
  });

  it('treats an empty query as "everything"', () => {
    expect(matchesSearch(course({ id: 'y', name: 'Anything' }), '   ')).toBe(true);
  });
});

describe('formatCourseDistance', () => {
  it('reads as "Here" inside a tenth of a mile', () => {
    expect(formatCourseDistance(100)).toBe('Here');
  });

  it('shows a decimal under ten miles and a whole number above', () => {
    expect(formatCourseDistance(1609.344 * 2.5)).toBe('2.5 mi');
    expect(formatCourseDistance(1609.344 * 42.4)).toBe('42 mi');
  });

  it('renders nothing when there is no distance', () => {
    expect(formatCourseDistance(null)).toBeNull();
  });
});
