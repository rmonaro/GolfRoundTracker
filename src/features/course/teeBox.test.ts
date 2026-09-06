// Placing the tee for the SELECTED tee set.
//
// The bug these pin: every tee colour rendered from the same box — whichever
// one the OSM sync happened to store — so a player off the whites saw their
// tee shot start from the back markers, with the distance to match.

import { describe, it, expect } from 'vitest';
import { selectedTeeBox } from './teeBox';
import type { HoleFeature } from '@/models';

/** One metre of longitude at latitude 41.41 — 1 / (111320 · cos φ). Fixtures
 *  are written in metres and converted with this, so the numbers in the
 *  assertions are real distances. */
const M = 0.000011977;
const GREEN: [number, number] = [-73.5, 41.41];

function teeAt(lng: number, lat: number): HoleFeature {
  return {
    id: `t${lng}`,
    course_id: 'c',
    hole_id: 'h',
    osm_id: null,
    feature_type: 'tee',
    is_line: false,
    coords: [
      [
        [lng, lat],
        [lng + M, lat],
        [lng + M, lat + M],
        [lng, lat + M]
      ]
    ],
    created_at: ''
  } as unknown as HoleFeature;
}

/** A straight hole running due west from the green. */
function straightLine(lengthM: number): [number, number][] {
  return [
    [GREEN[0] - lengthM * M, GREEN[1]],
    GREEN
  ];
}

describe('selectedTeeBox', () => {
  it('returns null without a yardage to match against', () => {
    expect(selectedTeeBox([], GREEN, null, straightLine(300))).toBeNull();
  });

  it('walks the card yardage back along the centreline', () => {
    // 300 yards = 274 m. On a straight line the tee lands 274 m from the green.
    const pt = selectedTeeBox([], GREEN, 300, straightLine(400));
    expect(pt).not.toBeNull();
    const metresFromGreen = Math.abs(pt![0] - GREEN[0]) / M;
    expect(metresFromGreen).toBeGreaterThan(265);
    expect(metresFromGreen).toBeLessThan(285);
  });

  it('snaps to a mapped tee box when one sits at that distance', () => {
    const near: [number, number] = [GREEN[0] - 280 * M, GREEN[1]];
    const pt = selectedTeeBox([teeAt(near[0], near[1])], GREEN, 300, straightLine(400));
    // The surveyed box wins over the computed point.
    expect(pt![0]).toBeCloseTo(near[0] + M / 2, 6);
  });

  it('picks the right box when several tees sit on one hole', () => {
    const boxes = [
      teeAt(GREEN[0] - 430 * M, GREEN[1]), // back tee, ~470 yd
      teeAt(GREEN[0] - 280 * M, GREEN[1]), // white,    ~306 yd
      teeAt(GREEN[0] - 180 * M, GREEN[1]) // forward,  ~197 yd
    ];
    const white = selectedTeeBox(boxes, GREEN, 300, straightLine(500));
    expect(Math.abs(white![0] - GREEN[0]) / M).toBeGreaterThan(270);
    expect(Math.abs(white![0] - GREEN[0]) / M).toBeLessThan(295);

    const forward = selectedTeeBox(boxes, GREEN, 200, straightLine(500));
    expect(Math.abs(forward![0] - GREEN[0]) / M).toBeLessThan(200);
  });

  it('still answers when OSM mapped only ONE tee box', () => {
    // The case that motivated walking the line: one box on the hole must not
    // become every colour's tee.
    const onlyBox = [teeAt(GREEN[0] - 430 * M, GREEN[1])];
    const forward = selectedTeeBox(onlyBox, GREEN, 200, straightLine(500));
    // Far from the single mapped box, so the computed point is used instead.
    expect(Math.abs(forward![0] - GREEN[0]) / M).toBeLessThan(200);
  });

  it('falls back to distance matching when the hole has no centreline', () => {
    const boxes = [
      teeAt(GREEN[0] - 430 * M, GREEN[1]),
      teeAt(GREEN[0] - 280 * M, GREEN[1])
    ];
    const pt = selectedTeeBox(boxes, GREEN, 300, null);
    expect(Math.abs(pt![0] - GREEN[0]) / M).toBeGreaterThan(270);
    expect(Math.abs(pt![0] - GREEN[0]) / M).toBeLessThan(295);
  });

  it('returns the far end rather than overshooting a short centreline', () => {
    const pt = selectedTeeBox([], GREEN, 600, straightLine(200));
    expect(Math.abs(pt![0] - GREEN[0]) / M).toBeCloseTo(200, 0);
  });
});
