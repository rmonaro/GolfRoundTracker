// Pure geo-math for the driving-range mode. No external deps and no imports
// from the Capacitor-bound gpsService, so this module is trivially unit-tested
// in a plain node env.
//
// Convention here mirrors the rest of the app's hand-coded geo helpers
// (gpsService.haversineMeters, HoleLayout): haversine for distance, the
// standard great-circle initial-bearing formula for direction. At driving-range
// scale (<300 yds) these are exact to well within GPS noise — turf.js would use
// the same formulas, so it'd add a dependency without adding accuracy.

import type { LatLng } from '@/types/range';

const EARTH_RADIUS_M = 6371000;
const M_PER_YARD = 0.9144;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Normalize an angle in degrees to the range [-180, 180). */
export function normalizeAngle(deg: number): number {
  return (((deg % 360) + 540) % 360) - 180;
}

/** Haversine great-circle distance in meters between two points. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Initial great-circle bearing from `origin` to `dest`, in degrees clockwise
 * from true north, normalized to [0, 360).
 */
export function computeBearing(origin: LatLng, dest: LatLng): number {
  const φ1 = toRad(origin.lat);
  const φ2 = toRad(dest.lat);
  const Δλ = toRad(dest.lng - origin.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Point reached by travelling `distanceM` meters from `origin` along
 * `bearingDeg` (clockwise from north). Used to draw yardage arcs/labels and
 * to build deterministic test fixtures.
 */
export function destinationPoint(origin: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(origin.lat);
  const λ1 = toRad(origin.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

export interface ShotDecomposition {
  /** Distance along the target line, meters (can be negative if behind origin). */
  carryM: number;
  /** Perpendicular offset, meters. + = right of line, - = left. */
  offlineM: number;
  /** Straight-line origin -> land, meters. */
  totalM: number;
}

/**
 * Decompose a landing point into carry (along the target line) and signed
 * offline distance (+ right, - left), relative to the origin->target line.
 */
export function computeShot(origin: LatLng, target: LatLng, land: LatLng): ShotDecomposition {
  const totalM = haversineMeters(origin, land);
  const bTarget = computeBearing(origin, target);
  const bShot = computeBearing(origin, land);
  // Clockwise (to the right of the target line) is a positive angle, so sin is
  // positive on the right and negative on the left.
  const angleRad = toRad(normalizeAngle(bShot - bTarget));
  return {
    carryM: totalM * Math.cos(angleRad),
    offlineM: totalM * Math.sin(angleRad),
    totalM
  };
}

/** A geodesic circle as a closed ring of [lng, lat] points (GeoJSON order). */
export function circleRing(center: LatLng, radiusM: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destinationPoint(center, (i / steps) * 360, radiusM);
    ring.push([p.lng, p.lat]);
  }
  return ring;
}

/**
 * The forward half of a geodesic circle: a 180° arc centered on `bearingDeg`,
 * spanning from (bearing - 90°) to (bearing + 90°). Used to draw yardage arcs
 * that only fan out in front of the mat, not behind it. Returns an open
 * line-string of [lng, lat] points (GeoJSON order).
 */
export function forwardArcRing(
  center: LatLng,
  radiusM: number,
  bearingDeg: number,
  steps = 48
): [number, number][] {
  const ring: [number, number][] = [];
  const start = bearingDeg - 90;
  for (let i = 0; i <= steps; i++) {
    const p = destinationPoint(center, start + (i / steps) * 180, radiusM);
    ring.push([p.lng, p.lat]);
  }
  return ring;
}

/** Ray-casting point-in-polygon test. `ring` is a list of {lat,lng} vertices. */
export function pointInPolygon(point: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Simple average centroid of a polygon ring (good enough for green-sized shapes). */
export function polygonCentroid(ring: LatLng[]): LatLng {
  const n = ring.length || 1;
  let lat = 0;
  let lng = 0;
  for (const p of ring) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / n, lng: lng / n };
}

export const mToYards = (m: number): number => m / M_PER_YARD;
export const yardsToM = (y: number): number => y * M_PER_YARD;
