import type { CourseHole, LngLat } from '@/models';

/**
 * Build a (lng, lat) → [x, y] projector for one hole.
 *
 * Pipeline:
 *   1. Translate so the hole's bbox centroid is the origin.
 *   2. Convert lng/lat deltas to local meters using a cosine-of-latitude correction.
 *   3. Rotate by the hole's cached `rotation_radians` so the tee→green vector
 *      points "up" in math coords.
 *   4. Negate y because SVG's y-axis points DOWN — after this, the green sits
 *      visually above the tee on the rendered SVG.
 *
 * Output units are meters. The renderer scales the resulting point cloud to fit
 * the SVG viewBox; we don't pick a pixel scale here so the same projector works
 * for both the compact in-app card and the larger admin preview.
 */
export type HoleCoordProjector = (lng: number, lat: number) => [number, number];

export function buildProjector(hole: CourseHole): HoleCoordProjector | null {
  if (
    hole.bbox_min_lng == null ||
    hole.bbox_min_lat == null ||
    hole.bbox_max_lng == null ||
    hole.bbox_max_lat == null
  ) {
    return null;
  }

  const midLng = (hole.bbox_min_lng + hole.bbox_max_lng) / 2;
  const midLat = (hole.bbox_min_lat + hole.bbox_max_lat) / 2;
  const latCos = Math.cos((midLat * Math.PI) / 180);
  const rotation = hole.rotation_radians ?? 0;
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  return (lng, lat) => {
    const dxM = (lng - midLng) * 111_000 * latCos;
    const dyM = (lat - midLat) * 111_000;
    const rx = dxM * cosR - dyM * sinR;
    const ry = dxM * sinR + dyM * cosR;
    return [rx, -ry];
  };
}

export interface ProjectedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Track bbox of projected points across many calls. */
export function expandBoundsFromPoints(
  bounds: ProjectedBounds,
  points: Array<[number, number]>
): ProjectedBounds {
  let { minX, minY, maxX, maxY } = bounds;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export const EMPTY_BOUNDS: ProjectedBounds = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity
};

/** Project a feature's coords (polygon or linestring) into 2D. */
export function projectCoords(
  proj: HoleCoordProjector,
  coords: LngLat[] | LngLat[][]
): Array<Array<[number, number]>> {
  if (!Array.isArray(coords) || coords.length === 0) return [];
  const first = coords[0];
  // Polygon: outer ring + optional inner rings.
  if (Array.isArray(first) && first.length > 0 && Array.isArray((first as unknown[])[0])) {
    return (coords as LngLat[][]).map((ring) => ring.map(([lng, lat]) => proj(lng, lat)));
  }
  // Linestring.
  return [(coords as LngLat[]).map(([lng, lat]) => proj(lng, lat))];
}
