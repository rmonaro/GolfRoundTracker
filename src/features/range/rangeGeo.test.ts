import { describe, it, expect } from 'vitest';
import {
  computeShot,
  computeBearing,
  destinationPoint,
  normalizeAngle,
  haversineMeters,
  mToYards
} from './rangeGeo';
import type { LatLng } from '@/types/range';

// A mat somewhere flat. Target line points due north (bearing 0) 150 m away,
// built with destinationPoint so the fixtures are independent of computeShot.
const origin: LatLng = { lat: 40.0, lng: -74.0 };
const target = destinationPoint(origin, 0, 150);

describe('normalizeAngle', () => {
  it('wraps into [-180, 180)', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0);
    expect(normalizeAngle(190)).toBeCloseTo(-170);
    expect(normalizeAngle(-190)).toBeCloseTo(170);
    expect(normalizeAngle(360)).toBeCloseTo(0);
    expect(normalizeAngle(540)).toBeCloseTo(180 - 360); // 540 -> -180
  });
});

describe('computeShot', () => {
  it('dead-straight shot: offline ~ 0, carry ~ total', () => {
    const land = destinationPoint(origin, 0, 137);
    const { carryM, offlineM, totalM } = computeShot(origin, target, land);
    expect(Math.abs(offlineM)).toBeLessThan(0.05); // sub-5cm
    expect(carryM).toBeCloseTo(137, 1);
    expect(totalM).toBeCloseTo(137, 1);
  });

  it('shot 10° right of the line: offline positive', () => {
    const dist = 137;
    const land = destinationPoint(origin, 10, dist);
    const { carryM, offlineM, totalM } = computeShot(origin, target, land);
    expect(offlineM).toBeGreaterThan(0);
    expect(offlineM).toBeCloseTo(dist * Math.sin((10 * Math.PI) / 180), 0);
    expect(carryM).toBeCloseTo(dist * Math.cos((10 * Math.PI) / 180), 0);
    expect(totalM).toBeCloseTo(dist, 1);
  });

  it('shot 10° left of the line: offline negative', () => {
    const dist = 137;
    const land = destinationPoint(origin, 350, dist); // -10°
    const { offlineM } = computeShot(origin, target, land);
    expect(offlineM).toBeLessThan(0);
    expect(offlineM).toBeCloseTo(-dist * Math.sin((10 * Math.PI) / 180), 0);
  });

  it('carry and offline satisfy the Pythagorean identity vs total', () => {
    const land = destinationPoint(origin, 22, 180);
    const { carryM, offlineM, totalM } = computeShot(origin, target, land);
    expect(Math.hypot(carryM, offlineM)).toBeCloseTo(totalM, 6);
  });

  it('known fixed-coordinate case', () => {
    // Hand-fixed coords (no projection helper): a point east-north-east of the
    // mat. Verifies absolute numbers, not just signs.
    const o: LatLng = { lat: 40.0, lng: -74.0 };
    const t: LatLng = { lat: 40.00135, lng: -74.0 }; // ~150 m due north
    const land: LatLng = { lat: 40.0011, lng: -73.99975 }; // up-and-right

    const { carryM, offlineM, totalM } = computeShot(o, t, land);

    // total = straight-line origin->land
    expect(totalM).toBeCloseTo(haversineMeters(o, land), 6);
    // Landing point is north (carry forward) and east (right) of the line.
    expect(carryM).toBeGreaterThan(0);
    expect(offlineM).toBeGreaterThan(0);
    // Sanity bounds (point is ~120-140 m out, slightly right).
    expect(totalM).toBeGreaterThan(110);
    expect(totalM).toBeLessThan(150);
    expect(mToYards(carryM)).toBeGreaterThan(mToYards(offlineM));
  });
});

describe('computeBearing', () => {
  it('is ~0 due north and ~90 due east', () => {
    expect(computeBearing(origin, destinationPoint(origin, 0, 100))).toBeCloseTo(0, 1);
    expect(computeBearing(origin, destinationPoint(origin, 90, 100))).toBeCloseTo(90, 1);
  });
});
