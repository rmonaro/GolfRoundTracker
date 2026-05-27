import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import type { HoleLayoutData } from '@/services/holesRepo';
import type { BagClub, CourseHole, HoleFeature, Lie, LngLat, TargetResult } from '@/models';
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
function teeToGreenBearing(hole: CourseHole): number | null {
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
export function recommendClub(
  bagClubs: BagClub[] | undefined,
  targetYards: number
): BagClub | null {
  if (!bagClubs || bagClubs.length === 0) return null;
  let best: BagClub | null = null;
  let bestDelta = Infinity;
  for (const c of bagClubs) {
    if (c.category === 'putter') continue;
    if (c.typicalDistanceYards == null) continue;
    const delta = Math.abs(c.typicalDistanceYards - targetYards);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = c;
    }
  }
  return best;
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
function classifyTap(
  tap: [number, number],
  features: HoleFeature[],
  bearing: number,
  green: [number, number]
): { lie: Lie | null; targetResult: TargetResult | null } {
  // Walk features by priority so the topmost polygon wins.
  const priority: Array<{ type: string; lie: Lie }> = [
    { type: 'green', lie: 'green' },
    { type: 'bunker', lie: 'bunker' },
    { type: 'water_hazard', lie: 'penalty' },
    { type: 'water', lie: 'penalty' },
    { type: 'fairway', lie: 'fairway' },
    { type: 'tee', lie: 'fairway' },
    { type: 'rough', lie: 'rough' }
  ];

  let matchedLie: Lie | null = null;
  for (const p of priority) {
    for (const f of features) {
      if (f.feature_type !== p.type || f.is_line) continue;
      // Polygon coords are LngLat[][] (outer ring first). Test outer ring only;
      // donut holes (e.g. a bunker carved into the fairway) are good enough for
      // a tap classification — exact hazard nesting is rare in OSM data.
      const rings = f.coords as [number, number][][];
      const outer = Array.isArray(rings[0]) ? rings[0] : null;
      if (!outer) continue;
      if (pointInPolygon(tap, outer)) {
        matchedLie = p.lie;
        break;
      }
    }
    if (matchedLie) break;
  }
  // Default to rough when nothing matched — better than leaving lie null.
  const lie: Lie = matchedLie ?? 'rough';

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

  let targetResult: TargetResult | null;
  if (lie === 'green') {
    targetResult = 'hit';
  } else if (Math.abs(along) > Math.abs(across)) {
    targetResult = along > 0 ? 'long' : 'short';
  } else {
    targetResult = across > 0 ? 'right' : 'left';
  }
  return { lie, targetResult };
}

// -------------------- Component --------------------

export function HoleLayout({
  layout,
  compact = false,
  className,
  aimMode = false,
  ballDistanceFromTeeM = 0,
  suggestedHandleDistanceM,
  puttingMode = false,
  bagClubs,
  onShotLanded,
  landingPoint = null,
  shotEndPoints = []
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

  useEffect(() => {
    if (!useMapbox || !containerRef.current) return;
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

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/satellite-v9',
        center: [centerLng, centerLat],
        zoom: 16.5,
        bearing,
        pitch: 0,
        // `interactive: true` so map.on('click') fires for tap-to-record. All
        // individual gestures disabled so the framing stays locked — user
        // can't accidentally pan/zoom out of the hole view.
        interactive: true,
        dragPan: false,
        scrollZoom: false,
        boxZoom: false,
        dragRotate: false,
        keyboard: false,
        doubleClickZoom: false,
        touchZoomRotate: false,
        touchPitch: false,
        attributionControl: false
      });
    } catch (err) {
      console.warn('[mapbox] init failed', err);
      setMapErrored(true);
      return;
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
      PUTTING_HALF_SPAN_M / (111000 * Math.cos((hole.green_lat * Math.PI) / 180));
    const puttingBounds = new mapboxgl.LngLatBounds(
      [hole.green_lng - dLng, hole.green_lat - dLat],
      [hole.green_lng + dLng, hole.green_lat + dLat]
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
        .setLngLat([hole.green_lng!, hole.green_lat!])
        .addTo(map);

      // Note: the full-hole yardage no longer renders on the map. The parent
      // (HoleTrackingPage) shows it in a fixed left-side panel so it stays
      // legible regardless of zoom / rotation.

      const holeLengthM = hole.centerline_distance_m;

      if (aimMode && !puttingMode) {
        // Aim picker. The handle is UNCONSTRAINED — drag anywhere on the map.
        // Origin is the estimated ball position (aimStartLL): the tee on shot
        // 1, walked along the centerline by the sum of prior shot distances
        // on later shots.
        const pinLL: [number, number] = [hole.green_lng!, hole.green_lat!];

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

        // Default initial aim = pin (full remaining distance). For 3rd+ shots
        // not yet on the green, the caller passes `suggestedHandleDistanceM`
        // so the handle defaults to "ball + previous shot distance" along the
        // centerline — a smarter starting point for short approaches.
        let initialAim: [number, number];
        if (suggestedHandleDistanceM != null) {
          initialAim = pointAlongFromStart(centerlineCoords, suggestedHandleDistanceM) ?? pinLL;
        } else if (isTeeShot && holeLenM != null && holeLenM > teeDefaultCapM) {
          initialAim = pointAlongFromStart(centerlineCoords, teeDefaultCapM) ?? pinLL;
        } else {
          initialAim = pinLL;
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

        // Target-style aim handle: concentric rings + crosshair tick marks +
        // small center dot. Replaces the old filled amber disk so the player
        // can see the green / fairway through the handle (rather than the
        // handle obscuring what they're aiming at). All strokes are amber so
        // the handle reads as one unit at a glance.
        //
        // The first `<rect fill="transparent">` is critical: SVG hit-testing
        // only triggers on filled regions, so without a transparent backing
        // the gaps between rings let taps fall through to the map canvas —
        // which would fire onShotLanded and open the shot sheet on every aim
        // adjustment. The backing makes the entire 44×44 SVG box one target.
        const handleEl = document.createElement('div');
        handleEl.className = 'grt-aim-handle';
        handleEl.innerHTML = `
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
          width: '44px',
          height: '44px',
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

        // Left-side distance label — small amber pill that sits 30px to the
        // left of the target with a right-pointing arrow on its right edge so
        // it visually points at the aim point. Updates live as the user drags
        // so they can see the ball→target distance without looking away.
        //
        // `anchor: 'right'` lines the label's right edge up with the marker
        // position; `marginRight: 30px` then pushes the whole label left.
        // Arrow = two stacked CSS triangles (outer amber + inner dark) so the
        // tip mirrors the pill's amber border with a dark center.
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
          marginRight: '70px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
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
          if (puttingMode) {
            labelText.textContent = `${Math.round(dM * 3.28084)} ft`;
          } else {
            labelText.textContent = `${Math.round(dM / YARDS_TO_METERS)} yds`;
          }
        };
        updateLabel(initialAim);
        const labelMarker = new mapboxgl.Marker({
          element: labelEl,
          anchor: 'right'
        })
          .setLngLat(initialAim)
          .addTo(map);

        // Custom pointer-based drag. Works for mouse, pen, and touch via a
        // single code path. `setPointerCapture` is the key bit on iOS — it
        // routes subsequent move/up events to the handle regardless of which
        // element is actually under the finger, so the canvas underneath
        // can't steal the gesture.
        let activePointerId: number | null = null;
        const onPointerDown = (e: PointerEvent) => {
          if (activePointerId !== null) return;
          activePointerId = e.pointerId;
          handleEl.setPointerCapture(e.pointerId);
          handleEl.style.cursor = 'grabbing';
          e.preventDefault();
          e.stopPropagation();
        };
        const onPointerMove = (e: PointerEvent) => {
          if (e.pointerId !== activePointerId) return;
          e.preventDefault();
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
        };
        const onPointerEnd = (e: PointerEvent) => {
          if (e.pointerId !== activePointerId) return;
          activePointerId = null;
          handleEl.style.cursor = 'grab';
          try {
            handleEl.releasePointerCapture(e.pointerId);
          } catch {
            // Already released — ignore.
          }
        };
        handleEl.addEventListener('pointerdown', onPointerDown);
        handleEl.addEventListener('pointermove', onPointerMove);
        handleEl.addEventListener('pointerup', onPointerEnd);
        handleEl.addEventListener('pointercancel', onPointerEnd);
        // Belt-and-suspenders: kill the synthetic click that follows a tap so
        // it can't bubble up and trigger Mapbox's `map.on('click')` (which
        // opens the shot sheet). Without this the handle can both move AND
        // record a shot from a single tap on iOS.
        handleEl.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
        });
      } else if (holeLengthM != null) {
        // Walkback distance-to-pin markers along the centerline (100/150/200/250).
        // Only render markers shorter than the hole — a 380-yard hole skips 250.
        for (const yds of YARDAGE_MARKERS) {
          const distM = yds * YARDS_TO_METERS;
          if (distM >= holeLengthM) continue;
          const pt = pointAlongFromEnd(centerlineCoords, distM);
          if (!pt) continue;
          const el = document.createElement('div');
          el.textContent = String(yds);
          Object.assign(el.style, {
            background: 'rgba(11,20,16,0.82)',
            color: '#fbbf24',
            padding: '1px 6px',
            borderRadius: '8px',
            font: '700 10px system-ui, sans-serif',
            border: '1px solid rgba(255,255,255,0.4)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.45)'
          } as Partial<CSSStyleDeclaration>);
          new mapboxgl.Marker({ element: el }).setLngLat(pt).addTo(map);
        }
      }

      // Asymmetric padding anchors the hole near the top of the map:
      //   • bottom padding pushes the geometry upward (rangefinder framing)
      //   • right padding clears the floating stats column
      // Critically: Mapbox `fitBounds` RESETS bearing to the value in options
      // (defaulting to 0) unless explicitly passed — we re-pass `bearing` so
      // the tee→green direction stays pointing up after the camera moves.
      // `maxZoom` allows tight framing on short holes (par 3s).
      try {
        map.fitBounds(puttingMode ? puttingBounds : bounds, {
          // Putting mode: small symmetric padding centers the green both
          // horizontally and vertically and lets it fill the viewport for a
          // close-up read of the surface. Normal mode keeps asymmetric padding
          // so the hole anchors near the top (rangefinder framing) with the
          // stats column clear on the right.
          padding: puttingMode
            ? { top: 16, bottom: 16, left: 16, right: 16 }
            : { top: 24, bottom: 70, left: 16, right: 90 },
          // Bump putting maxZoom up to 23 (Mapbox cap is 24) so even a small
          // green still fills the screen — the symmetric padding above gives
          // fitBounds room to push the zoom higher.
          maxZoom: puttingMode ? 23 : 19,
          // Both modes use the tee→green compass bearing so the tee box stays
          // anchored at the bottom of the screen and the green sits above it
          // — consistent orientation whether you're standing on the tee or
          // lining up a putt.
          bearing,
          animate: false
        });
        // Pull the camera back ~10% in normal mode so the hole sits inside the
        // viewport with more breathing room. Mapbox zoom is logarithmic (each
        // level doubles scale) so a 10% scale reduction is log2(1.1) ≈ 0.137
        // zoom units. Putting mode keeps its tight green-only framing.
        if (!puttingMode) {
          map.setZoom(map.getZoom() - Math.log2(1.1));
        }
      } catch {
        // Degenerate bbox (e.g. all points identical) — ignore; the initial
        // center/zoom is already a sensible view.
      }
    };

    map.on('load', onLoad);

    // Recorded-shot markers — small numbered amber disks at each prior shot's
    // end position. The last marker visually sits under the aim handle (which
    // originates from this point), so dropping it slightly behind the handle
    // via z-order isn't necessary — both are 14-18px sized and at the same
    // location. The shotEndPoints array is in chronological order, so index +
    // 1 is the shot number.
    for (let i = 0; i < shotEndPoints.length; i++) {
      const pt = shotEndPoints[i];
      const dot = document.createElement('div');
      Object.assign(dot.style, {
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
        pointerEvents: 'none',
        lineHeight: '1'
      } as Partial<CSSStyleDeclaration>);
      dot.textContent = String(i + 1);
      new mapboxgl.Marker({ element: dot, anchor: 'center' })
        .setLngLat(pt)
        .addTo(map);
    }

    // Pending landing-point marker — a white-ringed red disk dropped where
    // the user last tapped. The parent owns the position (set in
    // `onShotLanded`) and re-passes it here, so the marker persists across
    // renders without needing internal state in this component.
    if (landingPoint) {
      const lpEl = document.createElement('div');
      Object.assign(lpEl.style, {
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        background: '#ef4444',
        border: '3px solid #ffffff',
        boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
        pointerEvents: 'none'
      } as Partial<CSSStyleDeclaration>);
      new mapboxgl.Marker({ element: lpEl, anchor: 'center' })
        .setLngLat(landingPoint)
        .addTo(map);
    }

    // Tap-to-record. Fires for clicks on empty map area. The aim handle
    // captures its own pointer events upstream so it doesn't trigger this.
    // DOM markers (tee pill, green flag) all have pointer-events: none, so
    // taps on them pass through and still register here.
    if (onShotLanded) {
      const greenLL: [number, number] = [hole.green_lng!, hole.green_lat!];
      const onMapClick = (e: mapboxgl.MapMouseEvent) => {
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
          greenLL
        );
        onShotLanded({
          start: aimStartLL,
          end,
          calculatedDistanceM: distM,
          inferredLie: lie,
          inferredTargetResult: targetResult
        });
      };
      map.on('click', onMapClick);
    }

    // Critical: release the WebGL context. Capacitor / iOS WebView is strict
    // about concurrent contexts; a leaked map is the kind of bug that only
    // shows up after the user swipes through 10 holes.
    return () => {
      map.remove();
    };
  }, [
    useMapbox,
    layout,
    compact,
    aimMode,
    ballDistanceFromTeeM,
    suggestedHandleDistanceM,
    puttingMode,
    bagClubs,
    onShotLanded,
    landingPoint,
    shotEndPoints
  ]);

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
  borderRadius: 2
} as const;

const containerSx = {
  width: '100%',
  height: '100%',
  bgcolor: BACKGROUND,
  borderRadius: 2,
  overflow: 'hidden',
  lineHeight: 0
} as const;
