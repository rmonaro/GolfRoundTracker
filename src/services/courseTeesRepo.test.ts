// Cross-source tee dedupe.
//
// The bug these pin: importing an OpenGolfAPI scorecard onto a course that
// already had GolfCourseAPI tees put both sets in `course_tees`, so the
// start-round picker showed "BLUE" and "Blue" as two choices — same tee, same
// yardage, different slope. Picking the wrong one silently changes the round's
// slope_rating and therefore the handicap differential.

import { describe, it, expect } from 'vitest';
import { dedupeTees } from './courseTeesRepo';
import type { CourseTee, CourseTeeSource } from '@/models';

function tee(
  partial: Partial<CourseTee> & { tee_name: string; source: CourseTeeSource }
): CourseTee {
  return {
    id: `${partial.source}-${partial.tee_name}-${partial.gender ?? 'any'}`,
    course_id: 'c1',
    gender: null,
    tee_color: null,
    course_rating: null,
    slope_rating: null,
    bogey_rating: null,
    total_yards: null,
    total_meters: null,
    par_total: null,
    number_of_holes: 18,
    holes: null,
    created_at: '2026-01-01T00:00:00Z',
    ...partial
  } as CourseTee;
}

describe('dedupeTees', () => {
  it('keeps the GolfCourseAPI row when both sources describe the same tee', () => {
    const result = dedupeTees([
      tee({ tee_name: 'BLUE', gender: 'male', source: 'api', slope_rating: 143 }),
      tee({ tee_name: 'Blue', gender: 'male', source: 'opengolf', slope_rating: 135 })
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('api');
    expect(result[0].slope_rating).toBe(143);
  });

  it('keeps an OpenGolfAPI tee that GolfCourseAPI does not have', () => {
    const result = dedupeTees([
      tee({ tee_name: 'BLUE', gender: 'male', source: 'api' }),
      tee({ tee_name: 'Blue', gender: 'male', source: 'opengolf' }),
      tee({ tee_name: 'Green', gender: 'male', source: 'opengolf' })
    ]);
    expect(result.map((t) => `${t.tee_name}:${t.source}`)).toEqual([
      'BLUE:api',
      'Green:opengolf'
    ]);
  });

  it('treats the same name under different genders as different tees', () => {
    const result = dedupeTees([
      tee({ tee_name: 'GOLD', gender: 'male', source: 'api' }),
      tee({ tee_name: 'GOLD', gender: 'female', source: 'api' })
    ]);
    expect(result).toHaveLength(2);
  });

  it('ignores punctuation and spacing differences in the name', () => {
    const result = dedupeTees([
      tee({ tee_name: 'GOLD / WHITE COMBO', gender: 'male', source: 'api' }),
      tee({ tee_name: 'Gold/White Combo', gender: 'male', source: 'opengolf' })
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('api');
  });

  it('lets a manual correction beat every imported source', () => {
    const result = dedupeTees([
      tee({ tee_name: 'Blue', gender: 'male', source: 'api', slope_rating: 143 }),
      tee({ tee_name: 'Blue', gender: 'male', source: 'manual', slope_rating: 140 })
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('manual');
  });

  it('ranks a name-only OSM tee below every source that carries ratings', () => {
    const result = dedupeTees([
      tee({ tee_name: 'Blue', gender: 'male', source: 'osm' }),
      tee({ tee_name: 'Blue', gender: 'male', source: 'opengolf', slope_rating: 135 })
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('opengolf');
  });

  it('preserves the incoming order of the rows it keeps', () => {
    const result = dedupeTees([
      tee({ tee_name: 'Blue', gender: 'male', source: 'opengolf', total_yards: 6954 }),
      tee({ tee_name: 'White', gender: 'male', source: 'api', total_yards: 6375 }),
      tee({ tee_name: 'BLUE', gender: 'male', source: 'api', total_yards: 6954 })
    ]);
    // The 'api' Blue wins, but stays where it sat in the yardage ordering.
    expect(result.map((t) => t.tee_name)).toEqual(['White', 'BLUE']);
  });

  it('returns an empty list unchanged', () => {
    expect(dedupeTees([])).toEqual([]);
  });
});
