import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Box, Typography } from '@mui/material';
import type { HoleLayoutData } from '@/services/holesRepo';
import type { BagClub, CourseHole, HoleFeature, Lie, LngLat, TargetResult, TargetType } from '@/models';
import {
  buildProjector,
  expandBoundsFromPoints,
  projectCoords,
  EMPTY_BOUNDS,
  type ProjectedBounds
} from './projectHoleCoords';
import { hasMapbox, mapboxgl } from './mapbox';
import { formatDistance } from './distance';

interface HoleLayoutProps {
  layout: HoleLayoutData;
  compact?: boolean;
  className?: string;
  /**
   * Allow the user to pan + pinch-zoom the map (rotation stays locked so the
   * tee→green orientation is preserved). Mapbox-only. Default false keeps the
   * legacy locked framing for read-only previews. Pair with `recenterRef` to
   * drive a "recenter to overview" button from the parent.
   */
  interactive?: boolean;
  /**
   * When provided, HoleLayout assigns a "recenter on the hole overview"
   * function to `recenterRef.current` (cleared on unmount). The parent renders
   * its own button and calls it, so the control can be positioned alongside the
   * page's other map overlays.
   */
  recenterRef?: MutableRefObject<(() => void) | null>;
  /**
   * Aim picker mode. When true, walkback distance-to-pin markers are hidden
   * and replaced with a draggable handle. A straight amber "aim line" runs
   * from the current ball position to the handle and updates live. The label
   * shows Haversine distance from ball to handle. Mapbox-only — SVG keeps the
   * static layout (no drag interaction).
   */
  aimMode?: boolean;
  /**
   * Sum of all prior shot distances (in meters) for this hole. Used in aim
   * mode to project the ball's current position along the centerline so the
   * aim line + dashed reference line originate from where the ball is, not
   * the tee. 0 / undefined → ball at tee (first shot).
   */
  ballDistanceFromTeeM?: number;
  /**
   * Hint for where to initially place the draggable aim handle, expressed as
   * distance from the tee along the centerline (meters). Used on 3rd+ shots
   * when the ball isn't on the green yet, to seed the handle at "ball +
   * previous shot distance" so the user has a sensible starting point instead
   * of the handle defaulting to the pin (which may be too far for a short
   * approach / wedge). Undefined → handle starts at the pin (default).
   */
  suggestedHandleDistanceM?: number;
  /**
   * Putting mode — the previous shot ended on the green. Overrides fitBounds
   * to frame only the green polygon (much tighter zoom), and switches the
   * aim label from yards to feet since putt distances are typically <100 ft.
   */
  puttingMode?: boolean;
  /**
   * User's bag clubs. When present, the aim-mode drag label appends the
   * recommended club (closest typicalDistanceYards to the current aim
   * distance). Putters and clubs without a typical distance are skipped.
   */
  bagClubs?: BagClub[];
  /**
   * Tap-to-record callback. Fires when the user taps the map (not the aim
   * handle). Receives the ball's current location (= aim line origin), the
   * tap point, the haversine distance, and an inferred lie + direction-
   * relative-to-green based on which OSM feature polygon the tap landed in.
   * Use case: user took a shot, taps where the ball landed; parent opens
   * AddShotSheet pre-filled.
   */
  onShotLanded?: (data: {
    start: [number, number];
    end: [number, number];
    calculatedDistanceM: number;
    inferredLie: Lie | null;
    inferredTargetResult: TargetResult | null;
  }) => void;
  /**
   * Pending landing point chosen by the user. Renders as a small white-bordered
   * red dot on the map. The parent holds this state (set in `onShotLanded`) and
   * passes it back so we can render the marker without re-opening the shot
   * sheet — the user gets a chance to confirm or move the marker before
   * committing the shot.
   */
  landingPoint?: [number, number] | null;
  /**
   * Recorded shot end positions for this hole, in chronological order
   * ([lng, lat] pairs). Each renders as a numbered amber dot so the player
   * can see exactly where their previous shots landed. When non-empty, the
   * LAST point also becomes the aim-line origin — i.e. the next shot is
   * planned from where the previous one actually ended, not from a centerline
   * walk by total distance. Shots without GPS coords are filtered out by the
   * caller before passing here.
   */
  shotEndPoints?: Array<[number, number]>;
  /**
   * Per-shot label data, aligned by index with `shotEndPoints`. Each entry
   * renders a segmented info box to the left of its numbered dot:
   *   [ shot # | club | distance ]
   * `club` / `distance` segments are omitted when null; `distance` is a
   * preformatted string (e.g. "158y", "18ft"). Optional — when absent the dots
   * render bare (just the number).
   */
  shotLabels?: Array<{ club: string | null; distance: string | null }>;
  /**
   * Suppress the aim UI (handle, line, distance label) WITHOUT falling back
   * to the walkback markers. Used while the player has a pending landing
   * point on screen — they're reviewing the tap, not planning a new aim,
   * so we keep the map clean until they commit or cancel.
   */
  hideAim?: boolean;
  /**
   * When true, the aim handle renders as a small amber dot instead of the
   * larger crosshair-target. Used for approach shots where the target sits
   * on top of the green polygon — a crosshair would obscure the surface
   * the player is trying to read; a dot stays out of the way.
   */
  useTargetDot?: boolean;
  /**
   * Per-round pin override `[lng, lat]`. When set, replaces the course's
   * stored green coord as the canonical pin position for: flag marker,
   * aim-line endpoint, putting bounds center, and direction inference in
   * `classifyTap`. The centerline + walkback markers stay tied to the
   * course centerline (pin moves within a 10-25m green; the course-level
   * playing line approximation stays close enough).
   */
  pinOverride?: [number, number] | null;
  /**
   * Maximum distance (meters) from the ball that the aim handle should
   * default to on shots OFF the tee. When the remaining ball→pin distance
   * exceeds this value, the initial handle position is capped at
   * `ball + maxAimDistanceFromBallM` along the centerline — the player
   * can still drag past, but the default reflects what they can actually
   * reach with a club from their bag. Undefined → no cap (initial aim
   * defaults to the pin as before).
   */
  maxAimDistanceFromBallM?: number;
  /**
   * Target type for the upcoming shot. Used by tap-to-record classification:
   * a tap on the target's surface (fairway for tee shots on par 4/5; green
   * otherwise) registers as targetResult='hit'. Defaults to 'green' to match
   * legacy behavior.
   */
  targetType?: TargetType;
  /**
   * When true, render the centerline yardage markers (100/150/200/250) even
   * while aimMode is on. Non-aim mode always shows them. Off by default so
   * aim mode stays uncluttered until the player toggles them.
   */
  showYardageMarkers?: boolean;
  /**
   * Live user position [lng, lat] from continuous GPS. Renders a pulsing
   * blue "you are here" dot on the map that updates as fixes arrive — the
   * primary feedback during auto-track sessions so the player can see
   * that GPS is firing as they walk. Null = no live position to show.
   */
  currentLocation?: [number, number] | null;
  /**
   * Opaque value the parent bumps when the cached user-drag aim should
   * be discarded — e.g. the user just edited the hole's yardage / par
   * and expects the aim to re-anchor at the new defaults. Same string/
   * number across renders = cache persists; a different value = clear.
   * Mainly intended for `${par}-${yardage}` style derived keys.
   */
  aimResetKey?: string | number | null;
  /**
   * Scaling factor applied to every yardage / feet number rendered on
   * the map (aim handle label, walkback markers). When the player has
   * overridden the hole's stored yardage to correct an OSM value, the
   * physical pin position on the centerline doesn't move — but the
   * *displayed* distance should reflect the override so the aim label
   * matches the "TO PIN" panel on the parent. Defaults to 1.0 (no
   * scaling). Typical value: user_yardage / osm_yardage.
   */
  yardageScale?: number;
  /** When provided, each shot-end-point dot becomes draggable. The
   *  callback fires with the shot's index and the new [lng, lat] when
   *  the user releases the drag. Used by the Round Summary map dialog
   *  so the player can correct mis-recorded shot positions. */
  onShotEndPointMoved?: (index: number, newPos: [number, number]) => void;
  /**
   * Recap replay trigger. Each time this value changes to a fresh positive
   * number, the map animates a "shot replay": an amber line grows from the
   * tee through every recorded shot-landing point to the pin, and each
   * numbered shot dot pops into view as the line reaches it. 0 / undefined =
   * idle (no recap). Mapbox-only. The path + dot handles are captured by the
   * main map-creation effect, so a recap always replays the most recently
   * rendered `shotEndPoints`.
   */
  recapToken?: number;
}

// -------------------- Shared style tokens --------------------

// Mapbox fills sit on top of satellite imagery, so they're semi-transparent.
// The same fill color powers the (opaque) SVG fallback so the two render
// paths feel visually consistent.
const FEATURE_STYLE: Record<
  string,
  { fill: string; outline: string; fillOpacity: number; lineWidth: number }
> = {
  fairway:      { fill: '#7cb342', outline: '#558b2f', fillOpacity: 0.25, lineWidth: 1   },
  green:        { fill: '#a5d6a7', outline: '#388e3c', fillOpacity: 0.40, lineWidth: 1.5 },
  tee:          { fill: '#c5e1a5', outline: '#689f38', fillOpacity: 0.40, lineWidth: 1   },
  bunker:       { fill: '#fdd835', outline: '#f9a825', fillOpacity: 0.55, lineWidth: 1   },
  water_hazard: { fill: '#4fc3f7', outline: '#0288d1', fillOpacity: 0.45, lineWidth: 1.5 },
  water:        { fill: '#4fc3f7', outline: '#0288d1', fillOpacity: 0.45, lineWidth: 1.5 },
  rough:        { fill: '#9ccc65', outline: '#7cb342', fillOpacity: 0.15, lineWidth: 0.5 },
  cartpath:     { fill: '#bdbdbd', outline: '#9e9e9e', fillOpacity: 0.40, lineWidth: 1   },
  path:         { fill: '#bdbdbd', outline: '#9e9e9e', fillOpacity: 0.40, lineWidth: 1   }
};
const BACKGROUND = '#2d3e2d';
const CENTERLINE_COLOR = '#fbbf24';
// Recap-replay growing line. Amber core (matches the numbered shot dots) over
// a white casing so the path stays legible across grass, sand, and water.
const RECAP_LINE_COLOR = '#fbbf24';

// Z-order for polygon fills. Higher index draws on top.
const FEATURE_LAYER_ORDER = [
  'rough',
  'cartpath',
  'path',
  'fairway',
  'water_hazard',
  'water',
  'bunker',
  'tee',
  'green'
] as const;

function featureZ(type: string): number {
  const idx = FEATURE_LAYER_ORDER.indexOf(type as (typeof FEATURE_LAYER_ORDER)[number]);
  return idx === -1 ? 0 : idx;
}

function getStyle(type: string) {
  return (
    FEATURE_STYLE[type] ?? {
      fill: 'rgba(255,255,255,0.06)',
      outline: 'transparent',
      fillOpacity: 0.2,
      lineWidth: 0
    }
  );
}

// -------------------- Geometry helpers --------------------

/**
 * Offset a geographic point by `distM` meters along compass `bearingDeg`
 * (CW from north). Equirectangular approximation — fine for golf-course
 * distances (<300m) where Earth curvature is negligible.
 */
function offsetByMeters(
  point: [number, number],
  bearingDeg: number,
  distM: number
): [number, number] {
  const br = (bearingDeg * Math.PI) / 180;
  const cosLat = Math.cos((point[1] * Math.PI) / 180);
  const dLat = (distM * Math.cos(br)) / 111000;
  const dLng = (distM * Math.sin(br)) / (111000 * cosLat);
  return [point[0] + dLng, point[1] + dLat];
}

/**
 * Walk from `start` along compass `bearingDeg` in 1-meter steps until the
 * point exits `polygon`. Returns the last point still inside. Caps the
 * search at `maxStepsM` (default 50) so we don't loop forever on tiny or
 * malformed polygons. Returns null if `start` itself is already outside.
 */
function walkToPolygonEdge(
  start: [number, number],
  bearingDeg: number,
  polygon: [number, number][],
  maxStepsM = 50
): [number, number] | null {
  if (!pointInPolygon(start, polygon)) return null;
  let lastInside: [number, number] = start;
  for (let d = 1; d <= maxStepsM; d += 1) {
    const test = offsetByMeters(start, bearingDeg, d);
    if (!pointInPolygon(test, polygon)) return lastInside;
    lastInside = test;
  }
  return lastInside;
}

/** Ray-casting point-in-polygon. Polygon is the outer ring as [lng, lat] points. */
function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Compass bearing (degrees CW from north) from tee to green. Null if either is missing. */
export function teeToGreenBearing(hole: CourseHole): number | null {
  if (
    hole.tee_lng == null ||
    hole.tee_lat == null ||
    hole.green_lng == null ||
    hole.green_lat == null
  ) {
    return null;
  }
  const dLng = (hole.green_lng - hole.tee_lng) * Math.cos((hole.tee_lat * Math.PI) / 180);
  const dLat = hole.green_lat - hole.tee_lat;
  return ((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360;
}

/** Convert stored feature coords + is_line flag into a GeoJSON geometry. */
function coordsToGeometry(
  coords: unknown,
  isLine: boolean
): GeoJSON.LineString | GeoJSON.Polygon | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (isLine) {
    return { type: 'LineString', coordinates: coords as [number, number][] };
  }
  return { type: 'Polygon', coordinates: coords as [number, number][][] };
}

/** Flatten polygon-or-line coords into a flat [lng, lat] list for bounds extension. */
function flattenCoords(coords: unknown, isLine: boolean): [number, number][] {
  if (!Array.isArray(coords) || coords.length === 0) return [];
  if (isLine) return coords as [number, number][];
  return (coords as [number, number][][]).flat();
}

const YARDS_TO_METERS = 0.9144;

/**
 * Pick the club whose typical carry distance is closest to a target yardage.
 * Skips putters (handled in putting mode) and clubs with no recorded distance.
 * Returns null when no club qualifies — caller suppresses the recommendation.
 */
/**
 * Pick the club whose typical carry is closest to `targetYards`.
 *
 * Always skips putters and clubs without a recorded `typicalDistanceYards`.
 *
 * When `opts.excludeDriver` is true (shots off the deck — anywhere past
 * the tee box on a long approach), the search is layered:
 *
 *   1. **Woods + hybrids** — if the bag has any with a recorded yardage,
 *      pick the one whose typical carry is CLOSEST to the target. Real
 *      golf intent: from 250 yds in the fairway you swing a 3-wood or a
 *      hybrid, not a driver.
 *   2. **Long irons (1-5)** — if the bag has none of the above but does
 *      have irons, pick the one with the LONGEST typical carry (= lowest
 *      iron number in practice; a 3-iron carries further than a 5-iron).
 *      We don't parse club names to find the "lowest number"; the carry
 *      ranking does it for us and works even on novelty-named irons.
 *   3. **Anything left** — closest yardage match across remaining bag.
 *
 * When excludeDriver is false the function does a plain closest-match
 * search (the historical behavior used in aim mode tooltips).
 */
export function recommendClub(
  bagClubs: BagClub[] | undefined,
  targetYards: number,
  opts: { excludeDriver?: boolean } = {}
): BagClub | null {
  if (!bagClubs || bagClubs.length === 0) return null;
  const excludeDriver = opts.excludeDriver === true;

  const withYardage = bagClubs.filter(
    (c) => c.category !== 'putter' && c.typicalDistanceYards != null
  );
  if (withYardage.length === 0) return null;

  const closestMatch = (pool: BagClub[]): BagClub | null => {
    let best: BagClub | null = null;
    let bestDelta = Infinity;
    for (const c of pool) {
      const delta = Math.abs((c.typicalDistanceYards as number) - targetYards);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = c;
      }
    }
    return best;
  };

  if (excludeDriver) {
    // 1. Woods + hybrids — yardage-matched.
    const woodsHybrids = withYardage.filter(
      (c) => c.category === 'wood' || c.category === 'hybrid'
    );
    if (woodsHybrids.length > 0) {
      return closestMatch(woodsHybrids);
    }
    // 2. Long irons — pick the one that carries furthest (= lowest number).
    const irons = withYardage.filter((c) => c.category === 'iron');
    if (irons.length > 0) {
      return irons.reduce(
        (best, c) =>
          (c.typicalDistanceYards as number) > (best.typicalDistanceYards as number)
            ? c
            : best
      );
    }
    // 3. Fallback — everything except driver + putter.
    const remaining = withYardage.filter((c) => c.category !== 'driver');
    return remaining.length > 0 ? closestMatch(remaining) : null;
  }

  // No exclusion — plain closest-match.
  return closestMatch(withYardage);
}
/** Walkback markers — distance-to-pin reference points spaced from the green. */
const YARDAGE_MARKERS = [100, 150, 200, 250] as const;

/** Haversine distance in meters between two [lng, lat] points. */
function haversineMetersFE(a: [number, number], b: [number, number]): number {
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

/**
 * The centerline jsonb is stored in OSM-original order, which can be either
 * tee→green or green→tee depending on how the way was traced. The sync
 * function records which endpoint is the green separately on the holes row
 * but doesn't rewrite the array. Reverse here if the first coord is closer
 * to the green than the last, so callers can always treat index 0 as tee
 * and the final index as green.
 */
function orientCenterlineTeeToGreen(
  coords: [number, number][],
  greenLngLat: [number, number]
): [number, number][] {
  if (coords.length < 2) return coords;
  const distFromFirst = haversineMetersFE(coords[0], greenLngLat);
  const distFromLast = haversineMetersFE(coords[coords.length - 1], greenLngLat);
  return distFromFirst < distFromLast ? [...coords].reverse() : coords;
}

/**
 * Walk a tee→green polyline FROM THE END (i.e. from the green back toward
 * the tee) by `distanceMeters`, returning the interpolated coord. Returns
 * null if the polyline is shorter than the requested distance.
 */
function pointAlongFromEnd(
  coords: [number, number][],
  distanceMeters: number
): [number, number] | null {
  if (coords.length < 2 || distanceMeters <= 0) return null;
  let remaining = distanceMeters;
  for (let i = coords.length - 1; i > 0; i--) {
    const a = coords[i];
    const b = coords[i - 1];
    const segLen = haversineMetersFE(a, b);
    if (segLen >= remaining) {
      const t = remaining / segLen;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= segLen;
  }
  return null;
}

/**
 * Like `pointAlongFromEnd` but also returns the local tee→green bearing of
 * the segment that contains the returned point. Needed for "right of the
 * fairway" placement on dogleg holes — the global tee→green bearing doesn't
 * line up with the local fairway direction once the centerline turns, so a
 * perpendicular walk drifts off the actual right edge.
 */
function pointAndBearingAlongFromEnd(
  coords: [number, number][],
  distanceMeters: number
): { point: [number, number]; bearingDeg: number } | null {
  if (coords.length < 2 || distanceMeters <= 0) return null;
  let remaining = distanceMeters;
  for (let i = coords.length - 1; i > 0; i--) {
    const a = coords[i];
    const b = coords[i - 1];
    const segLen = haversineMetersFE(a, b);
    if (segLen >= remaining) {
      const t = remaining / segLen;
      const point: [number, number] = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t
      ];
      // Local tee→green direction of this segment = bearing from b → a
      // (b is closer to the tee, a is closer to the green in this loop).
      const cosLat = Math.cos((a[1] * Math.PI) / 180);
      const dLng = (a[0] - b[0]) * cosLat;
      const dLat = a[1] - b[1];
      // atan2(east, north) gives compass bearing CW from north.
      let bearingDeg = (Math.atan2(dLng, dLat) * 180) / Math.PI;
      if (bearingDeg < 0) bearingDeg += 360;
      return { point, bearingDeg };
    }
    remaining -= segLen;
  }
  return null;
}

/**
 * Find the closest point on a polyline to a query point. Uses a local
 * equirectangular projection (cos-lat correction) — sufficient for golf-hole
 * scales (<500m). Returns the snapped point plus the segment index and the
 * 0..1 parameter `t` along that segment, so callers can compute cumulative
 * distance without re-projecting.
 */
function nearestPointOnPolyline(
  query: [number, number],
  polyline: [number, number][]
): { point: [number, number]; segmentIndex: number; t: number } | null {
  if (polyline.length < 2) return null;
  const midLat = polyline.reduce((s, p) => s + p[1], 0) / polyline.length;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const qx = query[0] * cosLat;
  const qy = query[1];

  let bestDist2 = Infinity;
  let bestSegIdx = 0;
  let bestT = 0;
  let bestX = qx;
  let bestY = qy;

  for (let i = 0; i < polyline.length - 1; i++) {
    const ax = polyline[i][0] * cosLat;
    const ay = polyline[i][1];
    const bx = polyline[i + 1][0] * cosLat;
    const by = polyline[i + 1][1];
    const dx = bx - ax;
    const dy = by - ay;
    const segLen2 = dx * dx + dy * dy;
    if (segLen2 < 1e-20) continue;
    let t = ((qx - ax) * dx + (qy - ay) * dy) / segLen2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const ddx = qx - px;
    const ddy = qy - py;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestSegIdx = i;
      bestT = t;
      bestX = px;
      bestY = py;
    }
  }

  return {
    point: [bestX / cosLat, bestY],
    segmentIndex: bestSegIdx,
    t: bestT
  };
}

/**
 * Distance in meters from the start of a tee→green oriented polyline to a
 * point identified by its segmentIndex + t (as returned by
 * nearestPointOnPolyline). Assumes the polyline is in tee-first order.
 */
function distanceAlongPolyline(
  polyline: [number, number][],
  segmentIndex: number,
  t: number
): number {
  let total = 0;
  for (let i = 0; i < segmentIndex; i++) {
    total += haversineMetersFE(polyline[i], polyline[i + 1]);
  }
  const segLen = haversineMetersFE(polyline[segmentIndex], polyline[segmentIndex + 1]);
  return total + segLen * t;
}

/**
 * Walk a tee→green polyline FROM THE START (tee end) by `distanceMeters`,
 * returning the interpolated coord. Clamps to the last coord when the
 * distance exceeds the polyline length. Used to estimate where the ball is
 * after N shots, by walking the playing line by the sum of prior shot
 * distances.
 */
function pointAlongFromStart(
  coords: [number, number][],
  distanceMeters: number
): [number, number] | null {
  if (coords.length < 2) return null;
  if (distanceMeters <= 0) return coords[0];
  let remaining = distanceMeters;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const segLen = haversineMetersFE(a, b);
    if (segLen >= remaining) {
      const t = remaining / segLen;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= segLen;
  }
  return coords[coords.length - 1];
}

/** Projected-space variant — walks an [x, y] polyline backward from its last point. */
function pointAlongFromEndProjected(
  points: Array<[number, number]>,
  distanceMeters: number
): [number, number] | null {
  if (points.length < 2 || distanceMeters <= 0) return null;
  let remaining = distanceMeters;
  for (let i = points.length - 1; i > 0; i--) {
    const a = points[i];
    const b = points[i - 1];
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const segLen = Math.hypot(dx, dy);
    if (segLen >= remaining) {
      const t = remaining / segLen;
      return [a[0] - dx * t, a[1] - dy * t];
    }
    remaining -= segLen;
  }
  return null;
}

/**
 * Classify a map tap against the hole's features:
 *   - lie: type of the topmost polygon containing the point. Priority order is
 *     green → bunker → water → water_hazard → fairway → tee → rough, defaulting
 *     to 'rough' when no polygon matches (consistent with most golf-app conv-
 *     entions — out-of-fairway with no hazard is treated as rough).
 *   - targetResult: direction relative to the GREEN. We rotate the (tap - green)
 *     vector by the negative tee→green bearing so "along the line of play" is
 *     the y-axis and "across" is the x-axis. Then pick the dominant axis:
 *       • |along| > |across|  →  long (past pin)  / short (before pin)
 *       • |across| > |along|  →  right            / left
 *     If the tap is on the green polygon, we treat it as 'hit' regardless of
 *     position — the user can correct it in the shot sheet.
 */
/**
 * Which side of the line of play a point is on, judged against a tee→green
 * polyline (the centerline). Projects the point onto its NEAREST segment and
 * takes the 2D cross product of that segment's direction with the point offset,
 * so the answer follows the fairway through doglegs instead of a straight
 * tee→green line. We need the centerline (not the straight line) because the
 * green centroid is often offset from the fairway — referencing the straight
 * line then reports the whole fairway as one side. `centerline` MUST already be
 * oriented tee→green. Returns null when it's too short to define a direction.
 */
function crossTrackSide(
  tap: [number, number],
  centerline: [number, number][]
): 'left' | 'right' | null {
  if (!Array.isArray(centerline) || centerline.length < 2) return null;
  // cos-lat keeps the (east, north) frame Euclidean at golf scales.
  const cosLat = Math.cos((tap[1] * Math.PI) / 180);
  const px = tap[0] * cosLat;
  const py = tap[1];
  let bestDist = Infinity;
  let bestCross = 0;
  for (let i = 0; i < centerline.length - 1; i++) {
    const ax = centerline[i][0] * cosLat;
    const ay = centerline[i][1];
    const bx = centerline[i + 1][0] * cosLat;
    const by = centerline[i + 1][1];
    const sx = bx - ax;
    const sy = by - ay;
    const segLen2 = sx * sx + sy * sy;
    if (segLen2 === 0) continue;
    const wx = px - ax;
    const wy = py - ay;
    // Clamp the projection to the segment so the nearest POINT is well-defined.
    let t = (wx * sx + wy * sy) / segLen2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = px - (ax + sx * t);
    const dy = py - (ay + sy * t);
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      // z-component of segment × offset. Facing tee→green, >0 = the golfer's
      // LEFT (CCW side), <0 = their right.
      bestCross = sx * wy - sy * wx;
    }
  }
  return bestCross > 0 ? 'left' : 'right';
}

/**
 * Determine the lie at a point by ray-casting it against the mapped course
 * feature polygons, walking them by priority so the topmost (green > bunker >
 * hazard > fairway > tee > rough) wins. Returns null when nothing matched so
 * callers can decide whether to default (taps default to 'rough'; GPS callers
 * may prefer to leave it unset). Shared by `classifyTap` (map taps) and the
 * GPS-based shot paths (auto-track, "Record Shot", watch auto-commit) so every
 * recording route classifies the lie identically from the same geometry.
 */
export function classifyLie(
  point: [number, number],
  features: HoleFeature[]
): Lie | null {
  const priority: Array<{ type: string; lie: Lie }> = [
    { type: 'green', lie: 'green' },
    { type: 'bunker', lie: 'bunker' },
    { type: 'water_hazard', lie: 'penalty' },
    { type: 'water', lie: 'penalty' },
    { type: 'fairway', lie: 'fairway' },
    { type: 'tee', lie: 'fairway' },
    { type: 'rough', lie: 'rough' }
  ];

  for (const p of priority) {
    for (const f of features) {
      if (f.feature_type !== p.type || f.is_line) continue;
      // Polygon coords are LngLat[][] (outer ring first). Test outer ring only;
      // donut holes (e.g. a bunker carved into the fairway) are good enough for
      // a classification — exact hazard nesting is rare in OSM data.
      const rings = f.coords as [number, number][][];
      const outer = Array.isArray(rings[0]) ? rings[0] : null;
      if (!outer) continue;
      if (pointInPolygon(point, outer)) return p.lie;
    }
  }
  return null;
}

export function classifyTap(
  tap: [number, number],
  features: HoleFeature[],
  bearing: number,
  green: [number, number],
  targetType: TargetType,
  centerline?: [number, number][] | null
): { lie: Lie | null; targetResult: TargetResult | null } {
  // Default to rough when nothing matched — better than leaving lie null.
  const lie: Lie = classifyLie(tap, features) ?? 'rough';

  // Direction relative to the green. Decompose (tap - green) onto the
  // tee→green unit vector (along) and its right-perpendicular (across).
  // cos-lat keeps the math-frame (east, north) Euclidean at golf scales.
  // For compass bearing b (CW from north), the tee→green direction in math
  // (east, north) coords is (sin b, cos b); its right-perpendicular (CW)
  // is (cos b, -sin b). So:
  //   along  = dx·sin b + dy·cos b   (positive = past pin, negative = short)
  //   across = dx·cos b − dy·sin b   (positive = right of pin, negative = left)
  const cosLat = Math.cos((green[1] * Math.PI) / 180);
  const dx = (tap[0] - green[0]) * cosLat;
  const dy = tap[1] - green[1];
  const br = (bearing * Math.PI) / 180;
  const along = dx * Math.sin(br) + dy * Math.cos(br);
  const across = dx * Math.cos(br) - dy * Math.sin(br);

  // Side of the line of play, judged against the centerline (follows the
  // fairway through doglegs) rather than the straight tee→green line — the
  // green centroid is frequently offset from the fairway, which skews the
  // straight-line `across` and made the whole fairway read as one side. Falls
  // back to the straight-line `across` sign when no centerline is available.
  const oriented =
    centerline && centerline.length >= 2
      ? orientCenterlineTeeToGreen(centerline, green)
      : null;
  const side: 'left' | 'right' =
    (oriented ? crossTrackSide(tap, oriented) : null) ?? (across > 0 ? 'right' : 'left');

  // Resolve the shot outcome vs the intended target:
  //
  //   • On the green → 'hit', regardless of intended target — landing on the
  //     green is the same good outcome whether aiming at the green or the
  //     fairway (driveable par 4 / mishit short par 5).
  //   • Fairway target (tee / lay-up): on the fairway — or a tee box, which
  //     reports lie='fairway' — is a 'hit'. A miss only cares which SIDE of the
  //     fairway you ended up, not how far short → left / right (vs centerline).
  //   • Green target (approach): report the DOMINANT miss axis vs the pin —
  //     short / long along the line of play, or left / right across it.
  let targetResult: TargetResult | null;
  if (lie === 'green') {
    targetResult = 'hit';
  } else if (targetType === 'fairway') {
    targetResult = lie === 'fairway' ? 'hit' : side;
  } else if (Math.abs(along) > Math.abs(across)) {
    targetResult = along > 0 ? 'long' : 'short';
  } else {
    targetResult = side;
  }
  // TEMP [dir-debug] — remove after diagnosing left/right sign. Click once
  // clearly LEFT and once clearly RIGHT of the fairway and report both lines.
  // eslint-disable-next-line no-console
  console.log('[dir-debug]', {
    bearing: Math.round(bearing),
    green,
    tap,
    along: Math.round(along * 111000),
    across: Math.round(across * 111000),
    hasCenterline: !!oriented,
    side,
    targetType,
    lie,
    targetResult
  });
  return { lie, targetResult };
}

// -------------------- Component --------------------

export function HoleLayout({
  layout,
  compact = false,
  className,
  interactive = false,
  recenterRef,
  aimMode = false,
  ballDistanceFromTeeM = 0,
  suggestedHandleDistanceM,
  puttingMode = false,
  bagClubs,
  onShotLanded,
  landingPoint = null,
  shotEndPoints = [],
  shotLabels = [],
  hideAim = false,
  useTargetDot = false,
  pinOverride = null,
  maxAimDistanceFromBallM,
  targetType = 'green',
  showYardageMarkers = false,
  currentLocation = null,
  aimResetKey = null,
  yardageScale = 1,
  onShotEndPointMoved,
  recapToken
}: HoleLayoutProps) {
  // Decision tree:
  //   - No Mapbox token in env       → use SVG path (server didn't fail; user didn't pay)
  //   - Mapbox init throws / errors   → flip mapErrored, fall back to SVG
  //   - Otherwise                     → render Mapbox
  const tokenAvailable = hasMapbox();
  const [mapErrored, setMapErrored] = useState(false);
  const useMapbox = tokenAvailable && !mapErrored;

  const svgRender = useMemo(() => {
    if (useMapbox) return null;
    return buildSvgRender(layout, compact);
  }, [useMapbox, layout, compact]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Persistent map + landing-point marker handles so we can update them
  // imperatively in side-effects without tearing down the whole map. This is
  // what prevents the "map flashes/reloads on every tap" feeling — the main
  // map-creation effect no longer re-fires when the user taps to record.
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const landingMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  // Persists the user's dragged aim-handle position across map-effect
  // re-runs. Without this, any state change in deps (par/yardage edit,
  // prop ripples) destroys the marker and the handle snaps back to its
  // computed default. The "semantic-reset" refs below clear this only
  // when the hole changes or a new shot is recorded — both cases where
  // the aim *should* re-anchor.
  const userAimPosRef = useRef<[number, number] | null>(null);
  const aimResetLayoutIdRef = useRef<string | null>(null);
  const aimResetBallDistRef = useRef<number>(-1);
  const aimResetKeyRef = useRef<string | number | null>(null);
  // Stable ref so the parent can change the drag-end callback without
  // re-firing the big map-creation effect.
  const onShotEndPointMovedRef = useRef(onShotEndPointMoved);
  useEffect(() => {
    onShotEndPointMovedRef.current = onShotEndPointMoved;
  }, [onShotEndPointMoved]);
  // Keep the latest onShotLanded reachable from the (stable) click handler
  // without having to put it in the effect's deps. Inline arrow functions on
  // the parent get a fresh identity every render — including them as a dep
  // would also force a full map rebuild on every parent state change.
  const onShotLandedRef = useRef(onShotLanded);
  useEffect(() => {
    onShotLandedRef.current = onShotLanded;
  }, [onShotLanded]);

  // --- Recap replay state ---
  // DOM handles for the numbered shot dots, captured during the map-creation
  // effect so the recap animation can hide them all, then reveal each in turn
  // as the growing line reaches it.
  const shotDotElsRef = useRef<HTMLDivElement[]>([]);
  // DOM handles for the segmented info boxes (# / club / yards) that sit to the
  // left of each dot — captured alongside the dots so the recap can hide them
  // and fade each one in (after a beat) as its dot is revealed.
  const shotBoxElsRef = useRef<(HTMLDivElement | null)[]>([]);
  // Ordered recap path `[tee, ...shotEndPoints, pin]` in [lng, lat]. Rebuilt
  // whenever the map effect re-runs so a replay always reflects current shots.
  const recapPathRef = useRef<Array<[number, number]>>([]);
  // Active requestAnimationFrame id for an in-flight recap, so we can cancel it
  // on unmount or when a new recap starts.
  const recapRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!useMapbox || !containerRef.current) return;
    const container = containerRef.current;
    const hole = layout.hole;

    // Without tee + green we can't compute a center, bearing, or markers.
    if (
      hole.tee_lng == null ||
      hole.tee_lat == null ||
      hole.green_lng == null ||
      hole.green_lat == null
    ) {
      setMapErrored(true);
      return;
    }

    const bearing = teeToGreenBearing(hole) ?? 0;
    const centerLng = (hole.tee_lng + hole.green_lng) / 2;
    const centerLat = (hole.tee_lat + hole.green_lat) / 2;
    // Pin position — per-round override (e.g. dragged-by-user pin) wins over
    // the course-level green centroid. Used for the flag marker, aim-line
    // endpoint, puttingBounds center, and direction inference on tap. The
    // centerline + bearing stay tied to the course coords so the playing-line
    // orientation doesn't shift when the cup moves a few meters.
    const effectivePin: [number, number] = pinOverride
      ? pinOverride
      : [hole.green_lng, hole.green_lat];

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/satellite-v9',
        center: [centerLng, centerLat],
        zoom: 16.5,
        bearing,
        pitch: 0,
        // `interactive: true` so map.on('click') fires for tap-to-record. When
        // `interactive` (the prop) is true we additionally enable pan + zoom
        // gestures so the player can explore the hole; the recenter button
        // restores the overview framing. Rotation/pitch stay off in both modes
        // so the tee→green orientation is preserved. Read-only previews keep
        // every gesture locked (the legacy behavior).
        interactive: true,
        dragPan: interactive,
        scrollZoom: interactive,
        boxZoom: interactive,
        dragRotate: false,
        keyboard: interactive,
        doubleClickZoom: interactive,
        touchZoomRotate: interactive,
        touchPitch: false,
        attributionControl: false
      });
    } catch (err) {
      console.warn('[mapbox] init failed', err);
      setMapErrored(true);
      return;
    }

    // Expose the map to side-effects (landing-point marker, etc.) so they
    // can update overlays without forcing this whole effect to re-fire.
    mapRef.current = map;

    // Two-finger gestures should pinch-zoom only — never rotate the carefully
    // computed tee→green bearing. (touchZoomRotate is enabled above when
    // interactive; strip just the rotation half.)
    if (interactive) {
      map.touchZoomRotate.disableRotation();
    }

    map.on('error', (e) => {
      console.warn('[mapbox] runtime error', e);
      setMapErrored(true);
    });

    // Group features by feature_type so we can register one source per type.
    // Bounds are kept TIGHT — just tee + green — so fitBounds zooms to frame
    // the playing line, not every cartpath that happens to cross the hole.
    // Features themselves still render at their real coords; some may fall
    // slightly outside the visible viewport, and that's fine.
    const polygonsByType = new Map<string, GeoJSON.Feature[]>();
    const linesByType = new Map<string, GeoJSON.Feature[]>();
    const bounds = new mapboxgl.LngLatBounds(
      [hole.tee_lng, hole.tee_lat],
      [hole.tee_lng, hole.tee_lat]
    );
    bounds.extend([hole.green_lng, hole.green_lat]);
    // Extend bounds by every recorded shot end position so the wide view (used
    // after the hole is complete — see puttingMode gating in HoleTrackingPage)
    // is guaranteed to frame every dot. Shots between tee and green are a
    // no-op; errant shots widen the bbox just enough to stay in view.
    for (const pt of shotEndPoints) {
      bounds.extend(pt);
    }

    for (const f of layout.features) {
      const geom = coordsToGeometry(f.coords, f.is_line);
      if (!geom) continue;
      const feat: GeoJSON.Feature = {
        type: 'Feature',
        geometry: geom,
        properties: { id: f.id }
      };
      const bucket = f.is_line ? linesByType : polygonsByType;
      const arr = bucket.get(f.feature_type) ?? [];
      arr.push(feat);
      bucket.set(f.feature_type, arr);
    }

    // Putting bounds: a fixed ±18m square centered on the hole's recorded
    // green coordinate. Building bounds from the polygon's actual vertices
    // (the previous approach) made fitBounds center on the polygon's bbox
    // mid-point, which drifts off the green's true center when the polygon
    // is asymmetric — pushing the green into a corner of the viewport. A
    // fixed-radius square around the canonical green coord guarantees the
    // green centers in the viewport with the symmetric padding below.
    const PUTTING_HALF_SPAN_M = 18;
    const dLat = PUTTING_HALF_SPAN_M / 111000;
    const dLng =
      PUTTING_HALF_SPAN_M / (111000 * Math.cos((effectivePin[1] * Math.PI) / 180));
    const puttingBounds = new mapboxgl.LngLatBounds(
      [effectivePin[0] - dLng, effectivePin[1] - dLat],
      [effectivePin[0] + dLng, effectivePin[1] + dLat]
    );

    // Centerline coordinates: prefer the cached OSM dogleg, fall back to a
    // 2-point tee→green line so the amber layer still renders for synthesized
    // holes (which only have tee + green to begin with). Always oriented so
    // index 0 is the tee end and the final index is the green end — required
    // for walkback marker placement below.
    const rawCenterline: [number, number][] =
      Array.isArray(hole.centerline) && hole.centerline.length >= 2
        ? (hole.centerline as [number, number][])
        : [
            [hole.tee_lng, hole.tee_lat],
            [hole.green_lng, hole.green_lat]
          ];
    const centerlineCoords = orientCenterlineTeeToGreen(rawCenterline, [
      hole.green_lng,
      hole.green_lat
    ]);

    // Ball position for the next shot. Three-tier precedence:
    //   1. Last recorded shot's actual end position (when shotEndPoints is
    //      non-empty) — this is the most accurate: GPS / map-tapped where the
    //      ball really landed.
    //   2. Centerline walk by sum of prior shot distances — used when we know
    //      shot distances but not positions (e.g. legacy data, manual entry).
    //   3. Tee box — first shot.
    // Drives both the aim line origin AND the suggested-club distance shown
    // in the left "TO PIN" panel via the parent.
    const lastShotPoint =
      shotEndPoints.length > 0 ? shotEndPoints[shotEndPoints.length - 1] : null;
    const aimStartLL: [number, number] = lastShotPoint
      ? lastShotPoint
      : ballDistanceFromTeeM > 0
        ? pointAlongFromStart(centerlineCoords, ballDistanceFromTeeM) ?? [
            hole.tee_lng,
            hole.tee_lat
          ]
        : [hole.tee_lng, hole.tee_lat];

    const onLoad = () => {
      // Force a resize on load: if the container measured 0×0 at map construction
      // time (common when parent flex / percent-height chains haven't settled),
      // the canvas is locked to that size until we tell it otherwise.
      map.resize();

      // Layer addition order matters — each addLayer goes on top by default,
      // so we add bottom-up: polygons → outlines → straight line → centerline → label.

      for (const type of FEATURE_LAYER_ORDER) {
        const style = getStyle(type);
        const polys = polygonsByType.get(type);
        if (polys && polys.length > 0) {
          const sourceId = `feat-${type}`;
          map.addSource(sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: polys }
          });
          map.addLayer({
            id: `${sourceId}-fill`,
            type: 'fill',
            source: sourceId,
            paint: {
              'fill-color': style.fill,
              'fill-opacity': style.fillOpacity
            }
          });
          map.addLayer({
            id: `${sourceId}-outline`,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': style.outline,
              'line-width': style.lineWidth,
              'line-opacity': 0.9
            }
          });
        }
        const lines = linesByType.get(type);
        if (lines && lines.length > 0) {
          const sourceId = `feat-${type}-line`;
          map.addSource(sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: lines }
          });
          map.addLayer({
            id: `${sourceId}-layer`,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': style.outline,
              'line-width': style.lineWidth,
              'line-opacity': 0.9
            }
          });
        }
      }

      // (Tee→green dashed reference line removed — the amber aim line + the
      // dogleg centerline cover the same intent without the extra clutter.)

      // Dogleg centerline — "playing line" (primary). Hidden in aimMode so
      // the user-controlled aim line below doesn't fight it visually.
      if (!aimMode) {
        map.addSource('centerline', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: centerlineCoords }
          }
        });
        map.addLayer({
          id: 'centerline',
          type: 'line',
          source: 'centerline',
          paint: {
            'line-color': CENTERLINE_COLOR,
            'line-width': compact ? 2 : 2.5,
            'line-opacity': 0.9
          }
        });
      }

      // DOM markers — always above the canvas since they're absolutely-positioned
      // siblings. Mapbox keeps them axis-aligned to the viewport (no rotate-with-map).
      const teeEl = document.createElement('div');
      teeEl.textContent = 'TEE';
      Object.assign(teeEl.style, {
        background: 'rgba(0,0,0,0.7)',
        color: '#fff',
        padding: '2px 6px',
        borderRadius: '8px',
        font: '700 9px system-ui, sans-serif',
        border: '1px solid #fff',
        pointerEvents: 'none',
        whiteSpace: 'nowrap'
      } as Partial<CSSStyleDeclaration>);
      new mapboxgl.Marker({ element: teeEl })
        .setLngLat([hole.tee_lng!, hole.tee_lat!])
        .addTo(map);

      const greenEl = document.createElement('div');
      greenEl.style.pointerEvents = 'none';
      greenEl.innerHTML =
        `<svg width="14" height="22" viewBox="0 0 14 22" xmlns="http://www.w3.org/2000/svg" style="display:block;">
          <line x1="2" y1="22" x2="2" y2="2" stroke="#fff" stroke-width="1.4" />
          <polygon points="2,2 12,5 2,8" fill="#e53935" />
        </svg>`;
      new mapboxgl.Marker({ element: greenEl, anchor: 'bottom' })
        .setLngLat(effectivePin)
        .addTo(map);

      // Note: the full-hole yardage no longer renders on the map. The parent
      // (HoleTrackingPage) shows it in a fixed left-side panel so it stays
      // legible regardless of zoom / rotation.

      const holeLengthM = hole.centerline_distance_m;

      // `hideAim` short-circuits BOTH branches — no aim UI AND no walkback
      // markers. Used while the player has a pending landing point pin up:
      // they're reviewing the tap, not planning a new aim.
      if (hideAim) {
        // Intentionally empty — skip both the aim mode block and the
        // walkback markers below. The recorded-shot dots + landing-point
        // pin (rendered earlier) are all that should show.
      } else if (aimMode && !puttingMode) {
        // Aim picker. The handle is UNCONSTRAINED — drag anywhere on the map.
        // Origin is the estimated ball position (aimStartLL): the tee on shot
        // 1, walked along the centerline by the sum of prior shot distances
        // on later shots.
        const pinLL: [number, number] = effectivePin;

        // Tee-shot landing cap: on a long hole, defaulting the handle to the
        // pin puts the target a club or three further than any human can
        // carry — and forces the user to drag it back every time. Cap the
        // initial position at 225 yds from the tee (roughly a long driver
        // carry) so the handle starts in the fairway. Shorter holes (≤225)
        // keep the pin as the default. Only kicks in on shot 1 (ball at tee)
        // when no explicit suggestedHandleDistanceM was provided.
        const TEE_DEFAULT_CAP_YDS = 225;
        const teeDefaultCapM = TEE_DEFAULT_CAP_YDS * YARDS_TO_METERS;
        const holeLenM = hole.centerline_distance_m;
        const isTeeShot = ballDistanceFromTeeM <= 0;

        // Semantic-reset check: clear the cached user-aim and re-anchor
        // at defaults when ANY of these change:
        //   • the hole itself                 (different hole entirely)
        //   • ballDistanceFromTeeM            (new shot recorded)
        //   • aimResetKey                     (parent's signal that
        //     stored par/yardage moved and the aim should reflect the
        //     new geometry — without this the handle would stay stuck
        //     at the player's last drag, which no longer reflects the
        //     corrected hole length)
        // Other re-renders (prop ripples that don't change the above)
        // preserve whatever the player had dragged.
        const currentLayoutId = layout.hole.id;
        if (
          aimResetLayoutIdRef.current !== currentLayoutId ||
          aimResetBallDistRef.current !== ballDistanceFromTeeM ||
          aimResetKeyRef.current !== aimResetKey
        ) {
          userAimPosRef.current = null;
          aimResetLayoutIdRef.current = currentLayoutId;
          aimResetBallDistRef.current = ballDistanceFromTeeM;
          aimResetKeyRef.current = aimResetKey;
        }

        // Default initial aim = pin (full remaining distance). For 3rd+ shots
        // not yet on the green, the caller passes `suggestedHandleDistanceM`
        // so the handle defaults to "ball + previous shot distance" along the
        // centerline — a smarter starting point for short approaches.
        let initialAim: [number, number];
        if (userAimPosRef.current) {
          // User had already dragged the handle on this hole/shot —
          // restore that position so a yardage / par edit (or any other
          // spurious effect re-run) doesn't snap them back.
          initialAim = userAimPosRef.current;
        } else if (suggestedHandleDistanceM != null) {
          initialAim = pointAlongFromStart(centerlineCoords, suggestedHandleDistanceM) ?? pinLL;
        } else if (isTeeShot && holeLenM != null && holeLenM > teeDefaultCapM) {
          initialAim = pointAlongFromStart(centerlineCoords, teeDefaultCapM) ?? pinLL;
        } else {
          initialAim = pinLL;
        }

        // Bag-reach cap: on shots OFF the tee, if the pin is farther than the
        // player can carry with anything in their bag, pull the default aim
        // back to "ball + max carry" along the centerline. Drags can still
        // exceed this — it's only the initial position. The cap is skipped
        // on the tee (driver lives there) and when the remaining distance
        // already fits inside max carry.
        if (
          !isTeeShot &&
          maxAimDistanceFromBallM != null &&
          maxAimDistanceFromBallM > 0
        ) {
          const remainingToPinM = Math.max(0, (holeLenM ?? 0) - ballDistanceFromTeeM);
          if (remainingToPinM > maxAimDistanceFromBallM) {
            const cappedTotalM = ballDistanceFromTeeM + maxAimDistanceFromBallM;
            const capped = pointAlongFromStart(centerlineCoords, cappedTotalM);
            if (capped) initialAim = capped;
          }
        }

        // Mutable aim line — origin updates only on remount (ballDistanceFromTeeM
        // is in the useEffect deps), so we only need to mutate the end point.
        map.addSource('aim-line', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [aimStartLL, initialAim] }
          }
        });
        map.addLayer({
          id: 'aim-line',
          type: 'line',
          source: 'aim-line',
          paint: {
            'line-color': CENTERLINE_COLOR,
            'line-width': compact ? 2 : 2.5,
            'line-opacity': 0.95
          }
        });
        const aimSource = map.getSource('aim-line') as mapboxgl.GeoJSONSource;

        // Ball indicator — only renders when the ball has moved off the tee.
        if (ballDistanceFromTeeM > 0) {
          const ballEl = document.createElement('div');
          Object.assign(ballEl.style, {
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: '#ffffff',
            border: '2px solid #0b1410',
            boxShadow: '0 2px 5px rgba(0,0,0,0.55)',
            pointerEvents: 'none'
          } as Partial<CSSStyleDeclaration>);
          new mapboxgl.Marker({ element: ballEl, anchor: 'center' })
            .setLngLat(aimStartLL)
            .addTo(map);
        }

        // Aim handle SVG. Two visual modes:
        //   • Default (crosshair): concentric amber rings + cardinal ticks +
        //     center dot. Best for tee shots / longer approaches where the
        //     player wants a precise aiming reticle.
        //   • Compact (useTargetDot): a small amber dot. Used for approach
        //     shots where the target lands on or near the green polygon —
        //     the crosshair would obscure the green surface the player is
        //     trying to read.
        //
        // In BOTH modes the first `<rect fill="rgba(0,0,0,0.001)">` is
        // critical: SVG hit-testing only triggers on filled regions, so
        // without a transparent backing the gaps in the SVG let taps fall
        // through to the map canvas and fire onShotLanded on every aim
        // adjustment. The backing makes the entire SVG box one target.
        const handleSize = useTargetDot ? 28 : 44;
        const handleEl = document.createElement('div');
        handleEl.className = 'grt-aim-handle';
        handleEl.innerHTML = useTargetDot
          ? `
            <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.55));">
              <rect x="0" y="0" width="28" height="28" fill="rgba(0,0,0,0.001)" />
              <circle cx="14" cy="14" r="7" fill="#fbbf24" stroke="#ffffff" stroke-width="2" />
            </svg>
          `
          : `
            <svg width="44" height="44" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.55));">
              <rect x="0" y="0" width="44" height="44" fill="rgba(0,0,0,0.001)" />
              <circle cx="22" cy="22" r="19" fill="none" stroke="#fbbf24" stroke-width="2.5" />
              <circle cx="22" cy="22" r="11" fill="none" stroke="#fbbf24" stroke-width="2" />
              <circle cx="22" cy="22" r="2.4" fill="#fbbf24" />
              <line x1="22" y1="1" x2="22" y2="7" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" />
              <line x1="22" y1="37" x2="22" y2="43" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" />
              <line x1="1" y1="22" x2="7" y2="22" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" />
              <line x1="37" y1="22" x2="43" y2="22" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" />
            </svg>
          `;
        Object.assign(handleEl.style, {
          width: `${handleSize}px`,
          height: `${handleSize}px`,
          cursor: 'grab',
          touchAction: 'none',
          userSelect: 'none',
          // Suppress iOS long-press callout / magnifier that otherwise eats drag gestures.
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent'
        } as Partial<CSSStyleDeclaration>);

        // `draggable: false` — Mapbox's built-in drag uses pointer events that
        // misfire under iOS WKWebView with `interactive: false`. We handle the
        // drag ourselves with `setPointerCapture` so the touch stream stays
        // bound to the handle even when the finger leaves it.
        const handleMarker = new mapboxgl.Marker({
          element: handleEl,
          draggable: false,
          anchor: 'center'
        })
          .setLngLat(initialAim)
          .addTo(map);

        // Left-side distance label — small amber pill positioned to the LEFT
        // of the aim target so it never overlaps the crosshair / dot. Updates
        // live as the user drags so they can see the ball→target distance
        // without looking away.
        //
        // Positioning: `anchor: 'right'` lines the label's right edge up with
        // the lng/lat, then `offset: [-LABEL_OFFSET_PX, 0]` shifts the whole
        // marker left in pixel space (clean separation from the target). CSS
        // margins don't move Mapbox markers — the Marker's offset option is
        // the only reliable way to get a pixel gap.
        const labelEl = document.createElement('div');
        Object.assign(labelEl.style, {
          position: 'relative',
          display: 'inline-block',
          background: 'rgba(11,20,16,0.88)',
          color: '#ffffff',
          padding: '1px 5px',
          borderRadius: '6px',
          font: '700 11px system-ui, sans-serif',
          lineHeight: '1.2',
          border: '1px solid #fbbf24',
          whiteSpace: 'nowrap',
          // Receive taps so they don't fall through to the map canvas and
          // record a shot at the label's location (left of the actual aim).
          // The handlers below convert any tap on the label into a "record
          // shot at the aim's current LngLat" call — same as tapping the
          // crosshair itself.
          pointerEvents: 'auto',
          cursor: 'pointer',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent',
          boxShadow: '0 1px 3px rgba(0,0,0,0.45)'
        } as Partial<CSSStyleDeclaration>);

        const labelText = document.createElement('span');
        labelEl.appendChild(labelText);

        // Outer (amber) triangle — sits just past the pill's right edge so
        // its left base aligns with the pill border. Uses CSS triangle trick
        // (zero w/h + transparent vertical borders + colored horizontal one).
        const arrowOuter = document.createElement('div');
        Object.assign(arrowOuter.style, {
          position: 'absolute',
          right: '-6px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '0',
          height: '0',
          borderTop: '5px solid transparent',
          borderBottom: '5px solid transparent',
          borderLeft: '6px solid #fbbf24'
        } as Partial<CSSStyleDeclaration>);
        labelEl.appendChild(arrowOuter);

        // Inner (dark) triangle — inset by ~1.5px so a thin amber rim shows
        // around the arrow, matching the pill's border.
        const arrowInner = document.createElement('div');
        Object.assign(arrowInner.style, {
          position: 'absolute',
          right: '-4px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '0',
          height: '0',
          borderTop: '3.5px solid transparent',
          borderBottom: '3.5px solid transparent',
          borderLeft: '4.5px solid rgba(11,20,16,0.88)'
        } as Partial<CSSStyleDeclaration>);
        labelEl.appendChild(arrowInner);

        const updateLabel = (aimPt: [number, number]) => {
          const dM = haversineMetersFE(aimStartLL, aimPt);
          // Apply user's yardage override scale so the aim distance
          // tracks the "TO PIN" panel when the player has corrected
          // the hole length. yardageScale defaults to 1 (no scaling)
          // when no override is in effect.
          if (puttingMode) {
            labelText.textContent = `${Math.round(dM * 3.28084 * yardageScale)} ft`;
          } else {
            labelText.textContent = `${Math.round((dM / YARDS_TO_METERS) * yardageScale)} yds`;
          }
        };
        updateLabel(initialAim);
        // Pixel gap between the label's right edge (incl. arrow) and the
        // aim marker's center. Scales with the marker size so the dot and
        // the crosshair both get a sensible gap.
        const LABEL_OFFSET_PX = Math.round(handleSize / 2) + 14;
        const labelMarker = new mapboxgl.Marker({
          element: labelEl,
          anchor: 'right',
          offset: [-LABEL_OFFSET_PX, 0]
        })
          .setLngLat(initialAim)
          .addTo(map);

        // Treat any tap on the yardage label as a tap on the aim crosshair.
        // Without this, taps on the label fall through to the map canvas
        // (since pointerEvents was 'none') and record a shot at the label's
        // screen position — left of the actual aim point.
        const onLabelTap = () => {
          const cb = onShotLandedRef.current;
          if (!cb) return;
          const aimPt = handleMarker.getLngLat();
          const end: [number, number] = [aimPt.lng, aimPt.lat];
          const distM = haversineMetersFE(aimStartLL, end);
          const { lie, targetResult } = classifyTap(
            end,
            layout.features,
            bearing,
            effectivePin,
            targetType,
            layout.hole.centerline
          );
          cb({
            start: aimStartLL,
            end,
            calculatedDistanceM: distM,
            inferredLie: lie,
            inferredTargetResult: targetResult
          });
        };
        // Pointerdown so we beat the map's click. stopPropagation +
        // preventDefault stops Mapbox from also firing its own click
        // handler at the touch location.
        labelEl.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          onLabelTap();
        });
        labelEl.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
        });

        // Custom pointer-based drag. Works for mouse, pen, and touch via a
        // single code path. `setPointerCapture` is the key bit on iOS — it
        // routes subsequent move/up events to the handle regardless of which
        // element is actually under the finger, so the canvas underneath
        // can't steal the gesture.
        //
        // Tap-vs-drag discrimination: tracking the pointer's starting screen
        // position lets us treat a low-movement pointerup as a TAP. A tap on
        // the handle fires onShotLanded with the handle's current location,
        // which solves the "ball landed exactly at my aim mark, but I can't
        // tap there because the handle is in the way" UX hole.
        const TAP_THRESHOLD_PX = 8;
        let activePointerId: number | null = null;
        let pointerStartPx: { x: number; y: number } | null = null;
        let didDrag = false;
        const onPointerDown = (e: PointerEvent) => {
          if (activePointerId !== null) return;
          activePointerId = e.pointerId;
          pointerStartPx = { x: e.clientX, y: e.clientY };
          didDrag = false;
          handleEl.setPointerCapture(e.pointerId);
          handleEl.style.cursor = 'grabbing';
          // With pan/zoom enabled (interactive), Mapbox's own drag handler would
          // otherwise grab this one-finger gesture and pan the map instead of
          // moving the handle. Suspend map panning for the duration of the drag;
          // re-enabled on pointer up/cancel below.
          if (interactive) map.dragPan.disable();
          e.preventDefault();
          e.stopPropagation();
        };
        const onPointerMove = (e: PointerEvent) => {
          if (e.pointerId !== activePointerId) return;
          e.preventDefault();
          // Tap budget: ignore tiny finger jitter so a perfect tap still
          // counts. Once the pointer moves past the threshold we're in
          // drag territory for the rest of this gesture.
          if (!didDrag && pointerStartPx) {
            const dx = e.clientX - pointerStartPx.x;
            const dy = e.clientY - pointerStartPx.y;
            if (Math.hypot(dx, dy) > TAP_THRESHOLD_PX) didDrag = true;
          }
          if (!didDrag) return;
          const rect = map.getContainer().getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          const ll = map.unproject([px, py]);
          const aimPt: [number, number] = [ll.lng, ll.lat];
          handleMarker.setLngLat(aimPt);
          labelMarker.setLngLat(aimPt);
          updateLabel(aimPt);
          aimSource.setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [aimStartLL, aimPt] }
          });
          // Cache the user's chosen aim so it survives the next map-
          // effect re-run (par/yardage edits, prop ripples, etc.).
          userAimPosRef.current = aimPt;
        };
        const onPointerEnd = (e: PointerEvent) => {
          if (e.pointerId !== activePointerId) return;
          const wasTap = !didDrag;
          activePointerId = null;
          pointerStartPx = null;
          didDrag = false;
          handleEl.style.cursor = 'grab';
          // Restore map panning now that the handle drag is over.
          if (interactive) map.dragPan.enable();
          try {
            handleEl.releasePointerCapture(e.pointerId);
          } catch {
            // Already released — ignore.
          }
          // Tap on the handle → "ball landed exactly here". Mirrors the
          // normal map-click flow: classify the lie + direction, then ship
          // up to the parent which opens AddShotSheet pre-filled.
          if (wasTap && onShotLanded) {
            const aimPt = handleMarker.getLngLat();
            const end: [number, number] = [aimPt.lng, aimPt.lat];
            const distM = haversineMetersFE(aimStartLL, end);
            const { lie, targetResult } = classifyTap(
              end,
              layout.features,
              bearing,
              effectivePin,
              targetType,
              layout.hole.centerline
            );
            onShotLanded({
              start: aimStartLL,
              end,
              calculatedDistanceM: distM,
              inferredLie: lie,
              inferredTargetResult: targetResult
            });
          }
        };
        handleEl.addEventListener('pointerdown', onPointerDown);
        handleEl.addEventListener('pointermove', onPointerMove);
        handleEl.addEventListener('pointerup', onPointerEnd);
        handleEl.addEventListener('pointercancel', onPointerEnd);
        // Belt-and-suspenders for touch devices: stop touchstart/touchmove from
        // bubbling to Mapbox's gesture handlers on the canvas container, so the
        // map never even begins to pan/zoom while the finger is on the handle.
        // (Pointer events still fire on the handle and drive the actual drag.)
        const swallowTouch = (e: TouchEvent) => e.stopPropagation();
        handleEl.addEventListener('touchstart', swallowTouch, { passive: true });
        handleEl.addEventListener('touchmove', swallowTouch, { passive: true });
        // Belt-and-suspenders: kill the synthetic click that follows a tap so
        // it can't bubble up and trigger Mapbox's `map.on('click')` (which
        // opens the shot sheet). Without this the handle can both move AND
        // record a shot from a single tap on iOS.
        handleEl.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
        });
      }

      // Walkback distance-to-pin markers along the centerline (100/150/200/250).
      // Shown in non-aim mode by default; in aim mode only when the player
      // toggles them on via `showYardageMarkers`. Only renders markers
      // shorter than the hole — a 380-yard hole skips 250.
      const shouldRenderYardageMarkers =
        holeLengthM != null && !hideAim && !puttingMode &&
        (!aimMode || showYardageMarkers);
      if (shouldRenderYardageMarkers && holeLengthM != null) {
        // Standard golf course distance-marker colors:
        //   Red 100, White 150, Blue 200, Yellow 250.
        // Each marker is a colored circle sitting directly on the
        // centerline at its yard-point. Anchored at center so the pin
        // sits exactly on the geographic point.
        const MARKER_STYLES: Record<number, { bg: string; text: string; border: string }> = {
          100: { bg: '#ef4444', text: '#ffffff', border: '#ffffff' }, // red
          150: { bg: '#ffffff', text: '#0b1410', border: '#0b1410' }, // white
          200: { bg: '#3b82f6', text: '#ffffff', border: '#ffffff' }, // blue
          250: { bg: '#fbbf24', text: '#0b1410', border: '#0b1410' }  // yellow
        };
        for (const yds of YARDAGE_MARKERS) {
          const distM = yds * YARDS_TO_METERS;
          if (distM >= holeLengthM) continue;
          const pt = pointAlongFromEnd(centerlineCoords, distM);
          if (!pt) continue;

          const style = MARKER_STYLES[yds] ?? {
            bg: '#fbbf24',
            text: '#0b1410',
            border: '#ffffff'
          };
          const dot = document.createElement('div');
          dot.textContent = String(yds);
          Object.assign(dot.style, {
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            background: style.bg,
            color: style.text,
            border: `1.5px solid ${style.border}`,
            font: '700 10px system-ui, sans-serif',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.45)'
          } as Partial<CSSStyleDeclaration>);

          new mapboxgl.Marker({ element: dot, anchor: 'center' })
            .setLngLat(pt)
            .addTo(map);
        }
      }

      // Frame the hole overview once the canvas is ready (see applyOverview).
      applyOverview(false);
      // Belt-and-suspenders: re-frame once after the map settles, in case the
      // canvas was still resizing when onLoad ran (otherwise the first fit can
      // be computed against a too-small viewport and crop the tee/green). The
      // jumpTo inside applyOverview triggers its own 'idle'; we don't re-register
      // the listener, so this runs exactly once — no loop.
      map.once('idle', () => applyOverview(false));
    };

    // Frame the hole overview (tee→green + any recorded shots). Extracted so
    // the recenter button can re-run it after the user pans/zooms away. Uses
    // cameraForBounds (rather than fitBounds + setZoom) so the ~10% normal-mode
    // pullback can be folded into a single animated/instant camera move.
    const applyOverview = (animate: boolean) => {
      const targetBounds = puttingMode ? puttingBounds : bounds;
      // Putting mode: small symmetric padding centers the green and lets it
      // fill the viewport. Normal mode keeps asymmetric padding so the hole
      // anchors near the top (rangefinder framing) with the stats column clear
      // on the right.
      const padding = puttingMode
        ? { top: 16, bottom: 16, left: 16, right: 16 }
        : // Thin edge margin only — frame tee→green as large as possible while
          // keeping both fully on screen (the hole runs vertically after the
          // bearing rotation, so top/bottom is what controls the fill).
          { top: 10, bottom: 10, left: 10, right: 10 };
      // Putting maxZoom up to 23 (Mapbox cap is 24) so even a small green fills
      // the screen; normal mode caps at 21 so even short holes fill the view.
      const maxZoom = puttingMode ? 23 : 21;
      try {
        // cameraForBounds is computed against the CURRENT canvas size. On first
        // load the canvas may not have settled to its final dimensions yet, so a
        // stale (smaller) size makes it over-zoom and crop the tee/green. Force a
        // resize first so the fit is measured against the real viewport.
        map.resize();
        // Both modes use the tee→green bearing so the tee anchors at the bottom
        // and the green sits above it.
        const cam = map.cameraForBounds(targetBounds, { padding, maxZoom, bearing });
        if (!cam) return;
        // Negative pulls back from the tee→green fit for breathing room; 0 = the
        // tightest framing that still keeps both ends on screen. Mapbox zoom is
        // logarithmic (each +1 doubles scale), so -0.4 ≈ 25% wider than the fit.
        const LOAD_ZOOM_BOOST = -0.4;
        const zoom = (cam.zoom ?? map.getZoom()) + (puttingMode ? 0 : LOAD_ZOOM_BOOST);
        const camera = { center: cam.center, zoom, bearing };
        if (animate) {
          map.easeTo({ ...camera, duration: 500 });
        } else {
          map.jumpTo(camera);
        }
      } catch {
        // Degenerate bbox (e.g. all points identical) — ignore; the initial
        // center/zoom is already a sensible view.
      }
    };

    // Publish the recenter action so the parent's button can re-frame the hole
    // overview (animated) after the user pans/zooms away.
    if (recenterRef) recenterRef.current = () => applyOverview(true);

    map.on('load', onLoad);

    // Re-fit the overview when the CONTAINER size settles — e.g. a dialog
    // finishing its open animation. cameraForBounds is measured against the
    // canvas, so a mid-animation (smaller) container would otherwise leave the
    // hole over-zoomed (tee/green cropped). We resize on every container change
    // and re-frame until the user first touches the map, then back off so we
    // never fight their gesture. Detecting interaction via DOM pointer/wheel on
    // the container (not Mapbox camera events) avoids tripping on programmatic
    // jumpTo/easeTo from applyOverview itself.
    let userMovedCamera = false;
    const markUserMoved = () => {
      userMovedCamera = true;
    };
    container.addEventListener('pointerdown', markUserMoved);
    container.addEventListener('wheel', markUserMoved, { passive: true });
    let reframeRaf: number | null = null;
    const containerResizeObserver = new ResizeObserver(() => {
      map.resize();
      if (userMovedCamera) return;
      if (reframeRaf != null) cancelAnimationFrame(reframeRaf);
      // Defer a frame so we measure the settled size, not an intermediate one.
      reframeRaf = requestAnimationFrame(() => {
        reframeRaf = null;
        if (!userMovedCamera) applyOverview(false);
      });
    });
    containerResizeObserver.observe(container);

    // Recorded-shot markers — small numbered amber disks at each prior shot's
    // end position. The last marker visually sits under the aim handle (which
    // originates from this point), so dropping it slightly behind the handle
    // via z-order isn't necessary — both are 14-18px sized and at the same
    // location. The shotEndPoints array is in chronological order, so index +
    // 1 is the shot number.
    // Capture the callback as a local so the loop reads from the ref
    // once (whether dots should be draggable is decided per-marker).
    const moveCb = onShotEndPointMovedRef.current;
    const shotDots: HTMLDivElement[] = [];
    const shotBoxes: (HTMLDivElement | null)[] = [];

    // Build one segment of the info box: a padded cell with its own bg + text
    // color. e.g. makeSeg('7I', '#2e7d32', '#ffffff').
    const makeSeg = (text: string, bg: string, color: string): HTMLDivElement => {
      const seg = document.createElement('div');
      seg.textContent = text;
      Object.assign(seg.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3px 6px',
        background: bg,
        color
      } as Partial<CSSStyleDeclaration>);
      return seg;
    };

    for (let i = 0; i < shotEndPoints.length; i++) {
      const pt = shotEndPoints[i];
      // Mapbox drives the marker ROOT's `transform` (a translate that pins it
      // to the map). We must never touch that transform, so the visible disk
      // and its recap pop-in animation (opacity + scale) live on an inner
      // child — clobbering the root's transform would teleport the dot.
      const dot = document.createElement('div');
      Object.assign(dot.style, {
        // Default = pass-through taps. When draggable mode is on we
        // need pointer events on so Mapbox can detect drag gestures
        // on the dot itself.
        pointerEvents: moveCb ? 'auto' : 'none',
        cursor: moveCb ? 'grab' : 'default'
      } as Partial<CSSStyleDeclaration>);
      const inner = document.createElement('div');
      Object.assign(inner.style, {
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        background: '#fbbf24',
        border: '2px solid #ffffff',
        boxShadow: '0 2px 5px rgba(0,0,0,0.55)',
        color: '#0b1410',
        font: '800 11px system-ui, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: '1',
        // Smooth the recap pop-in. No visual effect outside recap since the
        // disk renders at opacity 1 / scale 1.
        transition: 'opacity 200ms ease, transform 200ms ease',
        transform: 'scale(1)',
        opacity: '1'
      } as Partial<CSSStyleDeclaration>);
      // The shot number now lives in the info box, so the dot stays a bare
      // disk when a box is rendered. Fall back to numbering the dot itself when
      // a consumer didn't supply label data for this shot.
      if (!shotLabels[i]) inner.textContent = String(i + 1);
      dot.appendChild(inner);

      // Segmented info box to the LEFT of the dot: [ # | club | yards ].
      // Only built when the consumer passes per-shot label data for this index.
      const label = shotLabels[i];
      let boxInner: HTMLDivElement | null = null;
      if (label) {
        // Wrapper owns the static vertical-centering transform (never animated);
        // the inner pill owns the recap reveal (opacity + slide), so the two
        // transforms don't fight.
        const boxWrap = document.createElement('div');
        Object.assign(boxWrap.style, {
          position: 'absolute',
          // Sit the box fully to the RIGHT of the dot: left edge at the dot's
          // right edge (left:100%) plus a 6px gap. Robust to the disk's exact
          // rendered size (border included). Wrapper owns vertical centering.
          left: '100%',
          marginLeft: '6px',
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none'
        } as Partial<CSSStyleDeclaration>);

        boxInner = document.createElement('div');
        Object.assign(boxInner.style, {
          display: 'flex',
          alignItems: 'stretch',
          borderRadius: '5px',
          overflow: 'hidden',
          border: '1.5px solid #ffffff',
          boxShadow: '0 2px 5px rgba(0,0,0,0.55)',
          font: '800 11px system-ui, sans-serif',
          lineHeight: '1',
          whiteSpace: 'nowrap',
          // Reveal emanates from the dot (left edge) outward to the right.
          transformOrigin: 'left center',
          transition: 'opacity 260ms ease, transform 260ms ease',
          opacity: '1',
          transform: 'translateX(0) scale(1)'
        } as Partial<CSSStyleDeclaration>);

        // # — white bg, black text.
        boxInner.appendChild(makeSeg(String(i + 1), '#ffffff', '#0b1410'));
        // Club — green bg, white text.
        if (label.club) boxInner.appendChild(makeSeg(label.club, '#2e7d32', '#ffffff'));
        // Distance (yards) — #FB7B34 bg, black text.
        if (label.distance) {
          boxInner.appendChild(makeSeg(label.distance, '#FB7B34', '#0b1410'));
        }

        boxWrap.appendChild(boxInner);
        dot.appendChild(boxWrap);
      }
      shotBoxes.push(boxInner);

      const marker = new mapboxgl.Marker({
        element: dot,
        anchor: 'center',
        draggable: moveCb != null
      })
        .setLngLat(pt)
        .addTo(map);
      // Store the INNER disk — that's what the recap animation shows/hides.
      shotDots.push(inner);
      if (moveCb) {
        const index = i;
        marker.on('dragend', () => {
          const ll = marker.getLngLat();
          onShotEndPointMovedRef.current?.(index, [ll.lng, ll.lat]);
        });
      }
    }

    // Capture the recap path + dot handles for the replay animation. Path =
    // tee → each shot landing → pin, so the growing line starts at the tee box
    // and finishes at the flag. `centerlineCoords` is oriented tee→green, so
    // [0] is the tee end; `effectivePin` is the authoritative flag position.
    shotDotElsRef.current = shotDots;
    shotBoxElsRef.current = shotBoxes;
    if (shotEndPoints.length > 0) {
      const path: Array<[number, number]> = [centerlineCoords[0], ...shotEndPoints];
      // Append the pin as the final vertex unless the last shot already
      // finished essentially on top of it (holed out) — avoids a ~0-length
      // tail segment that would stall the animation on the final frame.
      const last = shotEndPoints[shotEndPoints.length - 1];
      if (haversineMetersFE(last, effectivePin) > 2) path.push(effectivePin);
      recapPathRef.current = path;
    } else {
      recapPathRef.current = [];
    }

    // Pending landing-point marker is managed by a separate effect below so
    // a new tap doesn't trigger this whole map-creation effect to re-fire.
    // See `useEffect([landingPoint, useMapbox])` further down.

    // Tap-to-record. Always bind so we don't need to re-attach the listener
    // when `onShotLanded` changes identity (it's an inline arrow in the
    // parent and gets a fresh reference on every render). The handler reads
    // the latest callback via `onShotLandedRef.current` — same effect as
    // useCallback at the call site, without forcing the parent to memo it.
    const greenLL: [number, number] = effectivePin;
    const onMapClick = (e: mapboxgl.MapMouseEvent) => {
      const cb = onShotLandedRef.current;
      if (!cb) return;
      // Defense in depth: even if a click slips past the handle's own
      // stopPropagation (e.g. some platforms don't dispatch a synthetic
      // click after `setPointerCapture`), refuse to open the shot sheet
      // when the underlying DOM target was the handle or one of its
      // descendants. Without this, dragging or even tapping the target
      // would open the shot UI.
      const target = e.originalEvent?.target as Node | null;
      const handleNode = document.querySelector('.grt-aim-handle');
      if (target && handleNode && handleNode.contains(target)) return;
      const end: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const distM = haversineMetersFE(aimStartLL, end);
      const { lie, targetResult } = classifyTap(
        end,
        layout.features,
        bearing,
        greenLL,
        targetType,
        layout.hole.centerline
      );
      cb({
        start: aimStartLL,
        end,
        calculatedDistanceM: distM,
        inferredLie: lie,
        inferredTargetResult: targetResult
      });
    };
    map.on('click', onMapClick);

    // Critical: release the WebGL context. Capacitor / iOS WebView is strict
    // about concurrent contexts; a leaked map is the kind of bug that only
    // shows up after the user swipes through 10 holes.
    return () => {
      // Clear the landing marker first so its DOM node isn't dangling after
      // the map (and its container) is torn down.
      landingMarkerRef.current?.remove();
      landingMarkerRef.current = null;
      if (recenterRef) recenterRef.current = null;
      containerResizeObserver.disconnect();
      container.removeEventListener('pointerdown', markUserMoved);
      container.removeEventListener('wheel', markUserMoved);
      if (reframeRaf != null) cancelAnimationFrame(reframeRaf);
      mapRef.current = null;
      map.remove();
    };
    // Intentionally excluded from deps:
    //   onShotLanded — read from onShotLandedRef inside the click handler so
    //     a fresh inline arrow on the parent doesn't force a map rebuild.
    //   landingPoint — managed by its own effect below so a new tap doesn't
    //     tear down the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    useMapbox,
    layout,
    compact,
    aimMode,
    ballDistanceFromTeeM,
    suggestedHandleDistanceM,
    puttingMode,
    bagClubs,
    shotEndPoints,
    shotLabels,
    hideAim,
    useTargetDot,
    pinOverride,
    maxAimDistanceFromBallM,
    targetType,
    showYardageMarkers,
    aimResetKey,
    // Re-fires the map effect when the parent toggles drag-edit mode
    // (callback flips from undefined ↔ defined) so the numbered shot
    // dots get recreated with the correct `draggable` flag. Stable
    // across renders within a mode via the ref above.
    onShotEndPointMoved != null,
    interactive,
    recenterRef
  ]);

  // Landing-point marker — add/move/remove imperatively on the live map so a
  // user tap doesn't trigger the big map-creation effect above. Keeps the
  // map instance stable across taps (no flash, no re-init, no Mapbox refetch).
  useEffect(() => {
    if (!useMapbox) return;
    const map = mapRef.current;
    if (!map) return;
    if (!landingPoint) {
      landingMarkerRef.current?.remove();
      landingMarkerRef.current = null;
      return;
    }
    if (landingMarkerRef.current) {
      landingMarkerRef.current.setLngLat(landingPoint);
      return;
    }
    const el = document.createElement('div');
    Object.assign(el.style, {
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      background: '#ef4444',
      border: '3px solid #ffffff',
      boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
      pointerEvents: 'none'
    } as Partial<CSSStyleDeclaration>);
    landingMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat(landingPoint)
      .addTo(map);
  }, [landingPoint, useMapbox]);

  // Recap replay — grow an amber line from tee → each shot landing → pin,
  // revealing each numbered dot as the line reaches it. Triggered whenever
  // `recapToken` changes to a fresh positive value. Reads the path + dot
  // handles captured by the main map effect, so it always replays the latest
  // `shotEndPoints` without forcing a map rebuild.
  useEffect(() => {
    if (!useMapbox) return;
    if (!recapToken) return; // 0 / undefined = idle
    const map = mapRef.current;
    if (!map) return;
    const path = recapPathRef.current;
    const dots = shotDotElsRef.current;
    const boxes = shotBoxElsRef.current;
    if (path.length < 2) return;

    const SEGMENT_MS = 520; // grow time per leg
    const easeInOut = (t: number) =>
      t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const lineFeature = (coords: Array<[number, number]>): GeoJSON.Feature => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords }
    });
    const setLine = (coords: Array<[number, number]>) => {
      const src = map.getSource('recap-line') as mapboxgl.GeoJSONSource | undefined;
      src?.setData(lineFeature(coords));
    };

    // Lazily add the source + casing/core layers on first play. Subsequent
    // replays reuse them; map teardown (the main effect's cleanup) disposes
    // them along with everything else.
    if (!map.getSource('recap-line')) {
      map.addSource('recap-line', {
        type: 'geojson',
        data: lineFeature([path[0], path[0]])
      });
      map.addLayer({
        id: 'recap-line-casing',
        type: 'line',
        source: 'recap-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.55 }
      });
      map.addLayer({
        id: 'recap-line-core',
        type: 'line',
        source: 'recap-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': RECAP_LINE_COLOR,
          'line-width': 3.5,
          'line-opacity': 0.98
        }
      });
    }

    // Pop a shot's numbered dot into view.
    const showDot = (d: number) => {
      const el = dots[d];
      if (!el) return;
      el.style.opacity = '1';
      el.style.transform = 'scale(1)';
    };
    // Fade a shot's info box in, emanating from the dot (transform-origin is the
    // box's left edge = the dot side). Called at the start of that shot's pause.
    const revealBox = (d: number) => {
      const box = boxes[d];
      if (!box) return;
      box.style.opacity = '1';
      box.style.transform = 'translateX(0) scale(1)';
    };

    // Start state: nothing drawn, every dot + box hidden. The CSS transitions
    // animate each pop / fade. Boxes start nudged toward the dot so they slide
    // outward as they appear.
    dots.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'scale(0.4)';
    });
    boxes.forEach((box) => {
      if (!box) return;
      box.style.opacity = '0';
      box.style.transform = 'translateX(-10px) scale(0.85)';
    });
    setLine([path[0], path[0]]);

    // The replay is a grow → pause state machine: the line grows one leg, then
    // PAUSES on the shot it just reached while that shot's box fades in, then
    // grows the next leg. Path vertex d+1 corresponds to dot index d (path[0] is
    // the tee); a trailing pin vertex (when the last shot wasn't holed) has no
    // dot, so it grows without a pause.
    const PAUSE_MS = 1000; // hold on each shot while its box fades in
    const segments = path.length - 1;
    let segIdx = 0;
    let phase: 'grow' | 'pause' = 'grow';
    let phaseStart: number | null = null;

    const frame = (ts: number) => {
      if (!mapRef.current) return; // map torn down mid-recap
      if (phaseStart == null) phaseStart = ts;
      const elapsed = ts - phaseStart;

      if (phase === 'grow') {
        const t = easeInOut(Math.min(1, elapsed / SEGMENT_MS));
        const a = path[segIdx];
        const b = path[segIdx + 1];
        const cur: [number, number] = [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t
        ];
        setLine([...path.slice(0, segIdx + 1), cur]);

        if (elapsed >= SEGMENT_MS) {
          // Leg complete — snap the line to the vertex.
          setLine(path.slice(0, segIdx + 2));
          const dotIdx = segIdx; // vertex segIdx+1 → dot index segIdx
          if (dotIdx < dots.length) {
            // Reached a shot: pop the dot, then PAUSE while its box fades in.
            showDot(dotIdx);
            revealBox(dotIdx);
            phase = 'pause';
            phaseStart = ts;
          } else {
            // Trailing pin vertex — no dot, no pause.
            segIdx += 1;
            phaseStart = ts;
            if (segIdx >= segments) {
              recapRafRef.current = null;
              return;
            }
          }
        }
        recapRafRef.current = requestAnimationFrame(frame);
        return;
      }

      // phase === 'pause' — hold on the current shot, then advance.
      if (elapsed >= PAUSE_MS) {
        segIdx += 1;
        if (segIdx >= segments) {
          setLine(path);
          recapRafRef.current = null;
          return;
        }
        phase = 'grow';
        phaseStart = ts;
      }
      recapRafRef.current = requestAnimationFrame(frame);
    };

    recapRafRef.current = requestAnimationFrame(frame);

    return () => {
      if (recapRafRef.current != null) {
        cancelAnimationFrame(recapRafRef.current);
        recapRafRef.current = null;
      }
    };
  }, [recapToken, useMapbox]);

  // Live user-position marker — pulsing blue dot that tracks the player's
  // current GPS fix. Renders only when `currentLocation` is supplied; the
  // parent toggles it on during auto-track sessions. Modeled on the
  // landing-point effect above so adding/moving the marker doesn't
  // trigger a full map rebuild.
  useEffect(() => {
    if (!useMapbox) return;
    const map = mapRef.current;
    if (!map) return;
    if (!currentLocation) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }
    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat(currentLocation);
      return;
    }
    // Inject the keyframe once (cheap dedupe — the style tag carries
    // its own id so re-running the effect doesn't pile up tags).
    const styleId = 'hole-layout-user-pulse-style';
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = `
        @keyframes hole-layout-user-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(33,150,243,0.6); }
          70%  { box-shadow: 0 0 0 16px rgba(33,150,243,0); }
          100% { box-shadow: 0 0 0 0 rgba(33,150,243,0); }
        }
      `;
      document.head.appendChild(styleEl);
    }
    const el = document.createElement('div');
    Object.assign(el.style, {
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      background: '#2196f3',
      border: '3px solid #ffffff',
      boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
      animation: 'hole-layout-user-pulse 1.6s ease-out infinite',
      pointerEvents: 'none'
    } as Partial<CSSStyleDeclaration>);
    userMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat(currentLocation)
      .addTo(map);
  }, [currentLocation, useMapbox]);

  // Explicit min-height so percentage-height collapses don't leave Mapbox with
  // a 0×0 canvas at construction time. Matches HoleLayoutCard's wrapper.
  const minHeight = compact ? 160 : 240;

  // ----- SVG fallback path -----
  if (!useMapbox) {
    if (!svgRender) {
      return (
        <Box className={className} sx={{ ...emptyBoxSx, minHeight }}>
          <Typography variant="caption">No geometry for this hole yet.</Typography>
        </Box>
      );
    }
    return (
      <Box className={className} sx={{ ...containerSx, minHeight }}>
        {svgRender}
      </Box>
    );
  }

  // ----- Mapbox path -----
  return (
    <Box
      ref={containerRef}
      className={className}
      sx={{ ...containerSx, position: 'relative', minHeight }}
    />
  );
}

// -------------------- SVG fallback render --------------------

function buildSvgRender(layout: HoleLayoutData, compact: boolean) {
  const proj = buildProjector(layout.hole);
  if (!proj) return null;

  const sortedFeatures = [...layout.features].sort(
    (a, b) => featureZ(a.feature_type) - featureZ(b.feature_type)
  );

  let bounds: ProjectedBounds = EMPTY_BOUNDS;
  const drawables: Array<{
    key: string;
    type: string;
    rings: Array<Array<[number, number]>>;
    isLine: boolean;
  }> = [];

  for (const f of sortedFeatures) {
    const rings = projectCoords(proj, f.coords as LngLat[] | LngLat[][]);
    for (const ring of rings) bounds = expandBoundsFromPoints(bounds, ring);
    drawables.push({
      key: f.id,
      type: f.feature_type,
      rings,
      isLine: f.is_line
    });
  }

  let teeXY: [number, number] | null = null;
  let greenXY: [number, number] | null = null;
  if (layout.hole.tee_lng != null && layout.hole.tee_lat != null) {
    teeXY = proj(layout.hole.tee_lng, layout.hole.tee_lat);
    bounds = expandBoundsFromPoints(bounds, [teeXY]);
  }
  if (layout.hole.green_lng != null && layout.hole.green_lat != null) {
    greenXY = proj(layout.hole.green_lng, layout.hole.green_lat);
    bounds = expandBoundsFromPoints(bounds, [greenXY]);
  }

  // Centerline projected coords, oriented tee→green so the walkback markers
  // below can walk reliably from the green end. Reverse at the LngLat level
  // (where we have the green's known coord), then project.
  const centerlineXY: Array<[number, number]> = (() => {
    const cl = layout.hole.centerline;
    if (
      Array.isArray(cl) &&
      cl.length >= 2 &&
      layout.hole.green_lng != null &&
      layout.hole.green_lat != null
    ) {
      const oriented = orientCenterlineTeeToGreen(cl as [number, number][], [
        layout.hole.green_lng,
        layout.hole.green_lat
      ]);
      return oriented.map(([lng, lat]) => proj(lng, lat));
    }
    if (teeXY && greenXY) return [teeXY, greenXY];
    return [];
  })();
  for (const pt of centerlineXY) {
    bounds = expandBoundsFromPoints(bounds, [pt]);
  }

  if (!Number.isFinite(bounds.minX)) return null;

  // Asymmetric padding mirrors the Mapbox fitBounds framing: the hole anchors
  // toward the top of the viewport, with extra space below + right to clear
  // the bottom buttons and the floating stats column.
  const padTop = compact ? 10 : 16;
  const padBottom = compact ? 90 : 140;
  const padLeft = compact ? 8 : 16;
  const padRight = compact ? 70 : 100;
  const minX = bounds.minX - padLeft;
  const minY = bounds.minY - padTop;
  const width = bounds.maxX - bounds.minX + padLeft + padRight;
  const height = bounds.maxY - bounds.minY + padTop + padBottom;
  const viewBox = `${minX} ${minY} ${width} ${height}`;

  const fullYardageLabel = formatDistance(layout.hole.centerline_distance_m, 'yds');
  const holeLengthM = layout.hole.centerline_distance_m;

  // SVG bubble sizing — slightly different from screen-px DOM markers because
  // the bubble lives inside the projected viewBox (units ≈ meters).
  const fullBubW = compact ? 32 : 40;
  const fullBubH = compact ? 12 : 16;
  const fullBubGap = compact ? 4 : 6;
  const walkBubW = compact ? 14 : 18;
  const walkBubH = compact ? 8 : 11;

  return (
    <svg
      viewBox={viewBox}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Hole ${layout.hole.hole_number} layout`}
    >
      <rect x={minX} y={minY} width={width} height={height} fill={BACKGROUND} />
      {drawables.map((d) => {
        const style = getStyle(d.type);
        if (d.isLine) {
          return d.rings.map((ring, i) => (
            <polyline
              key={`${d.key}-${i}`}
              points={ring.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke={style.fill}
              strokeWidth={d.type === 'cartpath' || d.type === 'path' ? 1.5 : 1}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ));
        }
        return (
          <path
            key={d.key}
            d={ringsToPath(d.rings)}
            fill={style.fill}
            fillRule="evenodd"
            stroke={d.type === 'green' ? style.outline : 'none'}
            strokeWidth={d.type === 'green' ? 0.5 : 0}
          />
        );
      })}

      {/* (Tee→green dashed reference line removed — the centerline below
          carries the playing-line intent on its own.) */}

      {/* Dogleg centerline (solid amber). */}
      {centerlineXY.length >= 2 && (
        <polyline
          points={centerlineXY.map(([x, y]) => `${x},${y}`).join(' ')}
          fill="none"
          stroke={CENTERLINE_COLOR}
          strokeWidth={compact ? 1.8 : 2.4}
          strokeOpacity={0.9}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* Full hole yardage bubble — to the LEFT of the green flag. */}
      {greenXY && holeLengthM != null && (
        <g>
          <rect
            x={greenXY[0] - fullBubGap - fullBubW}
            y={greenXY[1] - fullBubH / 2}
            width={fullBubW}
            height={fullBubH}
            rx={fullBubH / 2}
            fill="rgba(11,20,16,0.88)"
            stroke="#fbbf24"
            strokeWidth={compact ? 0.5 : 0.7}
          />
          <text
            x={greenXY[0] - fullBubGap - fullBubW / 2}
            y={greenXY[1] + (compact ? 2.8 : 3.6)}
            textAnchor="middle"
            fill="#fff"
            fontSize={compact ? 7 : 9}
            fontWeight={800}
            fontFamily="system-ui, sans-serif"
          >
            {fullYardageLabel}
          </text>
        </g>
      )}

      {/* Walkback distance-to-pin markers along the centerline. */}
      {holeLengthM != null &&
        YARDAGE_MARKERS.map((yds) => {
          const distM = yds * YARDS_TO_METERS;
          if (distM >= holeLengthM) return null;
          const pt = pointAlongFromEndProjected(centerlineXY, distM);
          if (!pt) return null;
          return (
            <g key={yds}>
              <rect
                x={pt[0] - walkBubW / 2}
                y={pt[1] - walkBubH / 2}
                width={walkBubW}
                height={walkBubH}
                rx={walkBubH / 2}
                fill="rgba(11,20,16,0.82)"
                stroke="rgba(255,255,255,0.4)"
                strokeWidth={0.4}
              />
              <text
                x={pt[0]}
                y={pt[1] + (compact ? 2 : 2.6)}
                textAnchor="middle"
                fill="#fbbf24"
                fontSize={compact ? 5.5 : 7}
                fontWeight={700}
                fontFamily="system-ui, sans-serif"
              >
                {yds}
              </text>
            </g>
          );
        })}

      {teeXY && (
        <g>
          <rect
            x={teeXY[0] - (compact ? 9 : 12)}
            y={teeXY[1] - (compact ? 5 : 7)}
            width={compact ? 18 : 24}
            height={compact ? 10 : 14}
            rx={compact ? 5 : 7}
            fill="rgba(0,0,0,0.55)"
            stroke="#fff"
            strokeWidth={1}
          />
          <text
            x={teeXY[0]}
            y={teeXY[1] + (compact ? 3 : 4)}
            textAnchor="middle"
            fill="#fff"
            fontSize={compact ? 7 : 9}
            fontWeight={700}
            fontFamily="system-ui, sans-serif"
          >
            TEE
          </text>
        </g>
      )}

      {greenXY && (
        <g>
          <line
            x1={greenXY[0]}
            y1={greenXY[1]}
            x2={greenXY[0]}
            y2={greenXY[1] - (compact ? 12 : 16)}
            stroke="#fff"
            strokeWidth={1.2}
          />
          <polygon
            points={`${greenXY[0]},${greenXY[1] - (compact ? 12 : 16)} ${
              greenXY[0] + (compact ? 6 : 8)
            },${greenXY[1] - (compact ? 9 : 13)} ${greenXY[0]},${
              greenXY[1] - (compact ? 6 : 10)
            }`}
            fill="#e53935"
          />
        </g>
      )}
    </svg>
  );
}

function ringsToPath(rings: Array<Array<[number, number]>>): string {
  return rings
    .map((ring) =>
      ring.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).concat('Z').join(' ')
    )
    .join(' ');
}

// -------------------- Shared sx --------------------

const emptyBoxSx = {
  display: 'grid',
  placeItems: 'center',
  width: '100%',
  height: '100%',
  bgcolor: BACKGROUND,
  color: 'rgba(255,255,255,0.6)',
  p: 2,
  borderRadius: 0
} as const;

const containerSx = {
  width: '100%',
  height: '100%',
  bgcolor: BACKGROUND,
  borderRadius: 0,
  overflow: 'hidden',
  lineHeight: 0
} as const;
