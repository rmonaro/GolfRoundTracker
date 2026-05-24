// Lightweight geo helpers shared by sync-course-osm.
// All inputs use [lng, lat] order (GeoJSON / OSM convention).

export type LngLat = [number, number];

/** Haversine distance in meters between two [lng, lat] points. */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Simple arithmetic-mean centroid. Adequate for the small polygons OSM emits for golf features. */
export function centroid(coords: LngLat[]): LngLat {
  let lng = 0;
  let lat = 0;
  for (const [x, y] of coords) {
    lng += x;
    lat += y;
  }
  const n = coords.length || 1;
  return [lng / n, lat / n];
}

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export function bboxOf(coords: LngLat[]): BBox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [x, y] of coords) {
    if (x < minLng) minLng = x;
    if (x > maxLng) maxLng = x;
    if (y < minLat) minLat = y;
    if (y > maxLat) maxLat = y;
  }
  return { minLng, minLat, maxLng, maxLat };
}

export function bboxContains(bb: BBox, p: LngLat): boolean {
  return p[0] >= bb.minLng && p[0] <= bb.maxLng && p[1] >= bb.minLat && p[1] <= bb.maxLat;
}

/** Expand a bbox by `padMeters` in each direction (approximate, lat-degree-based). */
export function expandBBox(bb: BBox, padMeters: number): BBox {
  const latPad = padMeters / 111000;
  const midLat = (bb.minLat + bb.maxLat) / 2;
  const lngPad = padMeters / (111000 * Math.cos((midLat * Math.PI) / 180));
  return {
    minLng: bb.minLng - lngPad,
    minLat: bb.minLat - latPad,
    maxLng: bb.maxLng + lngPad,
    maxLat: bb.maxLat + latPad
  };
}

/**
 * Rotation needed to point the hole's tee→green direction toward "up" (north on screen).
 * Returns radians for use with CSS / SVG transforms.
 */
export function rotationRadians(
  tee: LngLat,
  green: LngLat
): number {
  const midLat = (tee[1] + green[1]) / 2;
  const dx = (green[0] - tee[0]) * Math.cos((midLat * Math.PI) / 180);
  const dy = green[1] - tee[1];
  return Math.PI / 2 - Math.atan2(dy, dx);
}
