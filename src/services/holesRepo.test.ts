import { describe, it, expect } from 'vitest';
import { assignFeaturesToHole } from './holesRepo';
import type { CourseHole, HoleFeature } from '@/models';

// Two holes running parallel, ~400m apart in latitude. Features are placed
// nearer one or the other so the expected assignment is unambiguous.
const HOLE_1 = {
  id: 'h1',
  hole_number: 1,
  tee_lng: -74.0,
  tee_lat: 40.0,
  green_lng: -74.0,
  green_lat: 40.004,
  centerline: [
    [-74.0, 40.0],
    [-74.0, 40.004]
  ] as Array<[number, number]>
};

const HOLE_2 = {
  id: 'h2',
  hole_number: 2,
  tee_lng: -73.99,
  tee_lat: 40.0,
  green_lng: -73.99,
  green_lat: 40.004,
  centerline: [
    [-73.99, 40.0],
    [-73.99, 40.004]
  ] as Array<[number, number]>
};

const ALL_HOLES = [HOLE_1, HOLE_2];

function polygon(id: string, lng: number, lat: number, holeId = 'wrong'): HoleFeature {
  const d = 0.0002;
  return {
    id,
    // Deliberately wrong: assignment must ignore the stored hole_id, which the
    // OSM sync gets wrong on overlapping bboxes.
    hole_id: holeId,
    course_id: 'c1',
    kind: 'bunker',
    coords: [
      [
        [lng - d, lat - d],
        [lng + d, lat - d],
        [lng + d, lat + d],
        [lng - d, lat + d],
        [lng - d, lat - d]
      ]
    ]
  } as unknown as HoleFeature;
}

describe('assignFeaturesToHole', () => {
  it('assigns each feature to the nearest hole, ignoring stored hole_id', () => {
    const nearH1 = polygon('f1', -74.0, 40.002, 'h2'); // stored id says h2 — wrong
    const nearH2 = polygon('f2', -73.99, 40.002, 'h1'); // stored id says h1 — wrong

    const h1 = assignFeaturesToHole(HOLE_1 as unknown as CourseHole, ALL_HOLES, [
      nearH1,
      nearH2
    ]);
    const h2 = assignFeaturesToHole(HOLE_2 as unknown as CourseHole, ALL_HOLES, [
      nearH1,
      nearH2
    ]);

    expect(h1.map((f) => f.id)).toEqual(['f1']);
    expect(h2.map((f) => f.id)).toEqual(['f2']);
  });

  it('partitions features exactly — every feature lands on exactly one hole', () => {
    // The bug this guards: a feature belonging to no hole made tap-to-record
    // always fall back to 'rough'.
    const features = [
      polygon('a', -74.0, 40.001),
      polygon('b', -74.0, 40.003),
      polygon('c', -73.99, 40.001),
      polygon('d', -73.99, 40.003)
    ];
    const h1 = assignFeaturesToHole(HOLE_1 as unknown as CourseHole, ALL_HOLES, features);
    const h2 = assignFeaturesToHole(HOLE_2 as unknown as CourseHole, ALL_HOLES, features);

    expect(h1.length + h2.length).toBe(features.length);
    const ids = [...h1, ...h2].map((f) => f.id).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('drops features with unusable geometry rather than misassigning them', () => {
    const empty = { id: 'x', hole_id: 'h1', course_id: 'c1', kind: 'bunker', coords: [] };
    const result = assignFeaturesToHole(HOLE_1 as unknown as CourseHole, ALL_HOLES, [
      empty as unknown as HoleFeature
    ]);
    expect(result).toEqual([]);
  });

  it('returns nothing when no hole has usable anchors', () => {
    const anchorless = [
      {
        id: 'h1',
        tee_lng: null,
        tee_lat: null,
        green_lng: null,
        green_lat: null,
        centerline: null
      }
    ];
    const result = assignFeaturesToHole(
      HOLE_1 as unknown as CourseHole,
      anchorless,
      [polygon('f1', -74.0, 40.002)]
    );
    expect(result).toEqual([]);
  });

  it('handles line features as well as polygons', () => {
    // Lines are [[lng,lat], ...]; polygons are [[[lng,lat], ...]]. The flatten
    // helper distinguishes them by nesting depth.
    const line = {
      id: 'L',
      hole_id: 'h2',
      course_id: 'c1',
      kind: 'path',
      coords: [
        [-74.0, 40.001],
        [-74.0, 40.002]
      ]
    } as unknown as HoleFeature;

    const h1 = assignFeaturesToHole(HOLE_1 as unknown as CourseHole, ALL_HOLES, [line]);
    expect(h1.map((f) => f.id)).toEqual(['L']);
  });
});
