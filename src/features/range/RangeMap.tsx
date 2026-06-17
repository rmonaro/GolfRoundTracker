import { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { mapboxgl, hasMapbox } from '@/features/course/mapbox';
import type { LatLng } from '@/types/range';
import { destinationPoint, forwardArcRing, yardsToM } from './rangeGeo';

/** One landing point to render. `n` is the 1-based shot number. */
export interface ShotMarker {
  lng: number;
  lat: number;
  n: number;
}

/** A target shape to render: a closed ring of [lng,lat] plus selection state. */
export interface TargetShape {
  id: string;
  ring: [number, number][];
  label: string | null;
  selected: boolean;
}

interface RangeMapProps {
  origin: LatLng;
  target: LatLng | null;
  /** Map orientation: degrees so the target line points up. */
  bearing: number;
  shots: ShotMarker[];
  /** Show the labelled yardage semicircle arcs. */
  showArcs?: boolean;
  /** Reserve the lower screen for the session bar (logging phase) when framing. */
  bottomBar?: boolean;
  /** Saved target shapes (greens/spots). */
  targets?: TargetShape[];
  /** In-progress shape being drawn (ring of [lng,lat]); rendered distinctly. */
  draftRing?: [number, number][] | null;
  /** When true, taps add geometry (drawing) rather than selecting/logging. */
  drawing?: boolean;
  /** Tapped an existing target (selection) — only fires when not drawing. */
  onTargetTap?: (id: string) => void;
  /** Called on every map tap with the tapped {lat, lng}. */
  onMapTap: (p: LatLng) => void;
}

const ARC_YARDS = [50, 100, 150, 200, 250, 300, 350];
const FORWARD_YARDS = 350;
// PDI palette accents (used directly — the satellite imagery isn't themed).
const ARC_COLOR = '#ffd580'; // warm gold yardage rings
const TARGET_LINE_COLOR = '#f88930'; // PDI orange aim line
const MAT_COLOR = '#324279'; // PDI navy origin marker
const TARGET_COLOR = '#f88930'; // PDI orange target marker
const SHOT_COLOR = '#ff5a52'; // landed shot dots

function el(html: string, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = document.createElement('div');
  node.innerHTML = html;
  Object.assign(node.style, style);
  return node;
}

export function RangeMap({
  origin,
  target,
  bearing,
  shots,
  showArcs,
  bottomBar,
  targets,
  draftRing,
  drawing,
  onTargetTap,
  onMapTap
}: RangeMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const readyRef = useRef(false);
  const tapRef = useRef(onMapTap);
  tapRef.current = onMapTap;
  const targetTapRef = useRef(onTargetTap);
  targetTapRef.current = onTargetTap;
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  const originMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const targetMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const arcLabelMarkersRef = useRef<mapboxgl.Marker[]>([]);

  // --- camera: mat near the bottom, FORWARD_YARDS of range filling upward --
  // The mat doesn't sit at the viewport center: we offset the camera forward
  // (up the target line) so the origin lands near the bottom edge and the
  // 350 yd arc lands near the top. Zoom is derived from the container height so
  // the framing holds across devices.
  function frameForward(animate: boolean) {
    const map = mapRef.current;
    if (!map) return;
    const forwardM = yardsToM(FORWARD_YARDS);
    const h = map.getContainer().clientHeight || 700;
    // Reserve just enough at the bottom to clear the floating summary card +
    // controls, so the mat sits near the bottom edge (not mid-screen).
    const bottomReserve = bottomBar ? 132 : 24;
    const topPad = 56;
    const margin = 12;
    const yMat = h - bottomReserve - margin; // screen y (px from top) for the mat
    const spanPx = Math.max(120, yMat - topPad); // mat -> top of the 350 yd arc
    const mPerPx = forwardM / spanPx;
    // Camera center projects to the viewport vertical middle; place it forward
    // of the mat by the meters corresponding to (yMat - h/2) px.
    const center = destinationPoint(origin, bearing, (yMat - h / 2) * mPerPx);
    // Mapbox GL uses 512px tiles: mPerPx = 78271.517 * cos(lat) / 2^zoom.
    const zoom = Math.log2((78271.51696 * Math.cos((origin.lat * Math.PI) / 180)) / mPerPx);
    const opts = { center: [center.lng, center.lat] as [number, number], zoom, bearing };
    if (animate) map.easeTo({ ...opts, duration: 400 });
    else map.jumpTo(opts);
  }
  const frameRef = useRef(frameForward);
  frameRef.current = frameForward;

  // --- create the map once ------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !hasMapbox()) return;

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/satellite-v9',
        center: [origin.lng, origin.lat],
        zoom: 16,
        bearing,
        pitch: 0,
        dragRotate: false,
        attributionControl: false
      });
    } catch (err) {
      console.warn('[range-map] init failed', err);
      return;
    }
    mapRef.current = map;
    // Pan + pinch-zoom stay on; rotation stays locked so "up" is the target line.
    map.touchZoomRotate.disableRotation();

    map.on('error', (e) => console.warn('[range-map] runtime error', e));

    map.on('click', (e: mapboxgl.MapMouseEvent) => {
      // Not drawing → a tap on an existing target selects it (aim).
      if (!drawingRef.current && targetTapRef.current) {
        const hits = map.queryRenderedFeatures(e.point, { layers: ['range-targets-fill'] });
        const tid = hits[0]?.properties?.tid;
        if (tid) {
          targetTapRef.current(String(tid));
          return;
        }
      }
      tapRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    map.on('load', () => {
      readyRef.current = true;

      // Origin (mat) marker.
      originMarkerRef.current = new mapboxgl.Marker({
        element: el('MAT', {
          padding: '2px 6px',
          background: MAT_COLOR,
          color: '#fff',
          fontSize: '11px',
          fontWeight: '700',
          borderRadius: '4px',
          border: '1px solid #fff'
        }),
        anchor: 'center'
      })
        .setLngLat([origin.lng, origin.lat])
        .addTo(map);

      // Target line + shots sources/layers (data filled by the effects below).
      map.addSource('range-target-line', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} }
      });
      map.addLayer({
        id: 'range-target-line',
        type: 'line',
        source: 'range-target-line',
        paint: { 'line-color': TARGET_LINE_COLOR, 'line-width': 2.5, 'line-dasharray': [2, 1.5] }
      });

      map.addSource('range-arcs', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'range-arcs',
        type: 'line',
        source: 'range-arcs',
        paint: { 'line-color': ARC_COLOR, 'line-width': 1, 'line-opacity': 0.55 }
      });

      map.addSource('range-shots', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'range-shots-dot',
        type: 'circle',
        source: 'range-shots',
        paint: {
          'circle-radius': 6,
          'circle-color': SHOT_COLOR,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2
        }
      });
      // Numeric labels are best-effort (need glyphs); the dots above are the
      // guaranteed render.
      map.addLayer({
        id: 'range-shots-num',
        type: 'symbol',
        source: 'range-shots',
        layout: {
          'text-field': ['to-string', ['get', 'n']],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 11,
          'text-offset': [0, -1.1],
          'text-allow-overlap': true
        },
        paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1 }
      });

      // Saved targets (fill + outline + labels), data-driven by `sel`.
      map.addSource('range-targets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'range-targets-fill',
        type: 'fill',
        source: 'range-targets',
        paint: {
          'fill-color': ['case', ['==', ['get', 'sel'], 1], TARGET_COLOR, ARC_COLOR],
          'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.35, 0.18]
        }
      });
      map.addLayer({
        id: 'range-targets-line',
        type: 'line',
        source: 'range-targets',
        paint: {
          'line-color': ['case', ['==', ['get', 'sel'], 1], TARGET_COLOR, ARC_COLOR],
          'line-width': ['case', ['==', ['get', 'sel'], 1], 2.5, 1.5]
        }
      });
      map.addLayer({
        id: 'range-targets-label',
        type: 'symbol',
        source: 'range-targets',
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 12
        },
        paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.2 }
      });

      // In-progress draft shape.
      map.addSource('range-draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'range-draft-fill',
        type: 'fill',
        source: 'range-draft',
        paint: { 'fill-color': TARGET_COLOR, 'fill-opacity': 0.25 }
      });
      map.addLayer({
        id: 'range-draft-line',
        type: 'line',
        source: 'range-draft',
        paint: { 'line-color': TARGET_COLOR, 'line-width': 2 }
      });

      syncTargetLine();
      syncArcs();
      syncShots();
      syncTargets();
      syncDraft();
      frameRef.current(false);
    });

    return () => {
      arcLabelMarkersRef.current.forEach((m) => m.remove());
      arcLabelMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- re-frame when the target line / phase changes ----------------------
  useEffect(() => {
    frameForward(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bearing, showArcs, bottomBar, origin.lat, origin.lng]);

  // --- target marker + line ----------------------------------------------
  function syncTargetLine() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource('range-target-line') as mapboxgl.GeoJSONSource | undefined;
    if (target) {
      src?.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [origin.lng, origin.lat],
            [target.lng, target.lat]
          ]
        }
      });
      if (targetMarkerRef.current) {
        targetMarkerRef.current.setLngLat([target.lng, target.lat]);
      } else {
        targetMarkerRef.current = new mapboxgl.Marker({
          element: el('', {
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            background: TARGET_COLOR,
            border: '3px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.25)'
          }),
          anchor: 'center'
        })
          .setLngLat([target.lng, target.lat])
          .addTo(map);
      }
    } else {
      src?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } });
      targetMarkerRef.current?.remove();
      targetMarkerRef.current = null;
    }
  }
  useEffect(syncTargetLine, [target?.lat, target?.lng, origin.lat, origin.lng]);

  // --- yardage arcs + labels ---------------------------------------------
  function syncArcs() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource('range-arcs') as mapboxgl.GeoJSONSource | undefined;

    arcLabelMarkersRef.current.forEach((m) => m.remove());
    arcLabelMarkersRef.current = [];

    if (!showArcs) {
      src?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    src?.setData({
      type: 'FeatureCollection',
      features: ARC_YARDS.map((yd) => ({
        type: 'Feature',
        properties: { yd },
        geometry: { type: 'LineString', coordinates: forwardArcRing(origin, yardsToM(yd), bearing) }
      }))
    });

    // Place a DOM label at each arc's apex, up the target line (guaranteed to
    // render regardless of font glyph availability).
    for (const yd of ARC_YARDS) {
      const apex = destinationPoint(origin, bearing, yardsToM(yd));
      const marker = new mapboxgl.Marker({
        element: el(`${yd}y`, {
          padding: '1px 5px',
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          fontSize: '11px',
          fontWeight: '600',
          borderRadius: '3px',
          pointerEvents: 'none'
        }),
        anchor: 'center'
      })
        .setLngLat([apex.lng, apex.lat])
        .addTo(map);
      arcLabelMarkersRef.current.push(marker);
    }
  }
  useEffect(syncArcs, [showArcs, bearing, origin.lat, origin.lng]);

  // --- shots --------------------------------------------------------------
  function syncShots() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource('range-shots') as mapboxgl.GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: shots.map((s) => ({
        type: 'Feature',
        properties: { n: s.n },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] }
      }))
    });
  }
  useEffect(syncShots, [shots]);

  // --- targets ------------------------------------------------------------
  function syncTargets() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource('range-targets') as mapboxgl.GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: (targets ?? []).map((t) => ({
        type: 'Feature',
        properties: { tid: t.id, sel: t.selected ? 1 : 0, label: t.label ?? '' },
        geometry: { type: 'Polygon', coordinates: [t.ring] }
      }))
    });
  }
  useEffect(syncTargets, [targets]);

  // --- draft (in-progress drawing) ----------------------------------------
  function syncDraft() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource('range-draft') as mapboxgl.GeoJSONSource | undefined;
    if (!draftRing || draftRing.length < 2) {
      src?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    // >=3 points → polygon (fills); 2 points → line only.
    const geometry: GeoJSON.Geometry =
      draftRing.length >= 3
        ? { type: 'Polygon', coordinates: [draftRing] }
        : { type: 'LineString', coordinates: draftRing };
    src?.setData({ type: 'Feature', properties: {}, geometry });
  }
  useEffect(syncDraft, [draftRing]);

  if (!hasMapbox()) {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.paper',
          p: 3,
          textAlign: 'center'
        }}
      >
        <Typography color="text.secondary">
          Map unavailable — VITE_MAPBOX_TOKEN is not configured.
        </Typography>
      </Box>
    );
  }

  return <Box ref={containerRef} sx={{ position: 'absolute', inset: 0 }} />;
}
