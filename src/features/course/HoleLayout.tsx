import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import type { HoleLayoutData } from '@/services/holesRepo';
import type { CourseHole, LngLat } from '@/models';
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
const STRAIGHT_LINE_COLOR = '#ffffff';
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

// -------------------- Component --------------------

export function HoleLayout({ layout, compact = false, className }: HoleLayoutProps) {
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
        interactive: false,
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

    const fullYardageLabel = formatDistance(hole.centerline_distance_m, 'yds');

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

      // Straight reference line — "as the crow flies".
      map.addSource('straight-line', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [hole.tee_lng!, hole.tee_lat!],
              [hole.green_lng!, hole.green_lat!]
            ]
          }
        }
      });
      map.addLayer({
        id: 'straight-line',
        type: 'line',
        source: 'straight-line',
        paint: {
          'line-color': STRAIGHT_LINE_COLOR,
          'line-width': 1.5,
          'line-dasharray': [3, 2],
          'line-opacity': 0.5
        }
      });

      // Dogleg centerline — "playing line" (primary). No inline label now;
      // distances are surfaced via the bubble-marker block below.
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

      // Primary yardage bubble — sits to the LEFT of the green marker. Uses
      // `anchor: 'right'` so the bubble's right edge butts against the green
      // point (with a small marginRight gap), making "left of the hole" mean
      // exactly that regardless of map rotation.
      if (hole.centerline_distance_m != null) {
        const fullEl = document.createElement('div');
        fullEl.textContent = fullYardageLabel;
        Object.assign(fullEl.style, {
          background: 'rgba(11,20,16,0.88)',
          color: '#ffffff',
          padding: '4px 10px',
          borderRadius: '12px',
          font: '800 13px system-ui, sans-serif',
          border: '1.5px solid #fbbf24',
          marginRight: '14px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          boxShadow: '0 2px 6px rgba(0,0,0,0.45)'
        } as Partial<CSSStyleDeclaration>);
        new mapboxgl.Marker({ element: fullEl, anchor: 'right' })
          .setLngLat([hole.green_lng!, hole.green_lat!])
          .addTo(map);
      }

      // Walkback distance-to-pin markers along the centerline (100/150/200/250).
      // Only render markers shorter than the hole — a 380-yard hole skips the 250.
      const holeLengthM = hole.centerline_distance_m;
      if (holeLengthM != null) {
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
        map.fitBounds(bounds, {
          padding: { top: 40, bottom: 100, left: 24, right: 110 },
          maxZoom: 18.5,
          bearing,
          animate: false
        });
      } catch {
        // Degenerate bbox (e.g. all points identical) — ignore; the initial
        // center/zoom is already a sensible view.
      }
    };

    map.on('load', onLoad);

    // Critical: release the WebGL context. Capacitor / iOS WebView is strict
    // about concurrent contexts; a leaked map is the kind of bug that only
    // shows up after the user swipes through 10 holes.
    return () => {
      map.remove();
    };
  }, [useMapbox, layout, compact]);

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

      {/* Straight reference line (dashed white, faded). */}
      {teeXY && greenXY && (
        <line
          x1={teeXY[0]}
          y1={teeXY[1]}
          x2={greenXY[0]}
          y2={greenXY[1]}
          stroke={STRAIGHT_LINE_COLOR}
          strokeWidth={compact ? 0.8 : 1.2}
          strokeDasharray={compact ? '3,2' : '4,3'}
          strokeOpacity={0.55}
        />
      )}

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
