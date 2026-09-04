import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Typography
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import mapboxgl from 'mapbox-gl';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { initMapbox } from '@/features/course/mapbox';
import { adminCoursesRepo } from '@/services/adminCoursesRepo';
import { courseTeesRepo } from '@/services/courseTeesRepo';
import { useManualLayout } from '../hooks/useCoursesApi';

/** One polygon out of the segmentation prototype's GeoJSON. */
interface SegFeature {
  featureType: string;
  ring: [number, number][];
}

interface PlacedHole {
  number: number;
  green: [number, number];
  tee: [number, number];
}

const TYPE_COLOR: Record<string, string> = {
  green: '#4caf50',
  bunker: '#e6d3a3',
  water_hazard: '#3f8fd2',
  fairway: '#8bc34a'
};

/**
 * Click-to-number a course that OSM never mapped.
 *
 * Segmentation gives us shapes but no identity — nothing in aerial imagery says
 * "this is the 7th green", and neither scorecard API carries hole coordinates.
 * A human supplies the one missing piece by clicking greens in order; two
 * clicks per hole (green, then tee) produce the same `holes` rows the OSM sync
 * would, so everything downstream behaves identically.
 */
export function AdminHoleMapper() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  const [segFeatures, setSegFeatures] = useState<SegFeature[]>([]);
  const [placed, setPlaced] = useState<PlacedHole[]>([]);
  const [pendingGreen, setPendingGreen] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useManualLayout();

  const { data: course } = useQuery({
    queryKey: ['admin-course', id],
    enabled: !!id,
    queryFn: () => adminCoursesRepo.getOne(id!)
  });

  // Par per hole from the scorecard we already import, so the saved holes carry
  // par without anyone typing it — and so the count of holes is known up front.
  const { data: tees } = useQuery({
    queryKey: ['course-tees', id],
    enabled: !!id,
    queryFn: () => courseTeesRepo.listAllForCourse(id!)
  });
  const parByHole = useMemo(() => {
    const withHoles = (tees ?? []).find((t) => (t.holes?.length ?? 0) > 0);
    const map = new Map<number, number>();
    withHoles?.holes?.forEach((h, i) => {
      if (h.par != null) map.set(i + 1, h.par);
    });
    return map;
  }, [tees]);
  const holeCount = parByHole.size || 18;

  const nextHole = placed.length + 1;

  // ---- map -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !course?.lat || !course?.lng) return;
    if (!initMapbox()) {
      setError('VITE_MAPBOX_TOKEN is not set — the mapper needs satellite imagery.');
      return;
    }
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-v9',
      center: [course.lng, course.lat],
      zoom: 15.5
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [course?.lat, course?.lng]);

  // Draw the segmentation polygons once both map and file are ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || segFeatures.length === 0) return;
    const draw = () => {
      if (map.getLayer('seg-fill')) {
        map.removeLayer('seg-fill');
        map.removeLayer('seg-line');
        map.removeSource('seg');
      }
      map.addSource('seg', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: segFeatures.map((f, i) => ({
            type: 'Feature' as const,
            id: i,
            properties: { color: TYPE_COLOR[f.featureType] ?? '#9e9e9e' },
            geometry: { type: 'Polygon' as const, coordinates: [f.ring] }
          }))
        }
      });
      map.addLayer({
        id: 'seg-fill',
        type: 'fill',
        source: 'seg',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.35 }
      });
      map.addLayer({
        id: 'seg-line',
        type: 'line',
        source: 'seg',
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 }
      });
      // Frame the polygons rather than the course point — the stored lat/lng is
      // often a clubhouse or an entrance, not the middle of the holes.
      const b = new mapboxgl.LngLatBounds();
      segFeatures.forEach((f) => f.ring.forEach((p) => b.extend(p)));
      map.fitBounds(b, { padding: 40, animate: false });
    };
    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
  }, [segFeatures]);

  // ---- click handling --------------------------------------------------
  const onMapClick = useCallback(
    (e: mapboxgl.MapMouseEvent) => {
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      setPendingGreen((green) => {
        if (green === null) return pt; // first click of the pair: the green
        setPlaced((prev) => [
          ...prev,
          { number: prev.length + 1, green, tee: pt }
        ]);
        return null;
      });
    },
    []
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
    };
  }, [onMapClick]);

  // Redraw markers whenever the placement changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const add = (lngLat: [number, number], label: string, color: string) => {
      const el = document.createElement('div');
      el.textContent = label;
      el.style.cssText = `background:${color};color:#fff;border-radius:50%;width:22px;height:22px;
        display:grid;place-items:center;font:600 11px system-ui;border:2px solid #fff;`;
      markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map));
    };

    placed.forEach((h) => {
      add(h.green, String(h.number), '#2e7d32');
      add(h.tee, String(h.number), '#455a64');
    });
    if (pendingGreen) add(pendingGreen, String(nextHole), '#ef6c00');
  }, [placed, pendingGreen, nextHole]);

  // ---- file ------------------------------------------------------------
  const onFile = async (file: File) => {
    setError(null);
    try {
      const gj = JSON.parse(await file.text());
      const feats: SegFeature[] = (gj.features ?? [])
        .filter((f: { geometry?: { type?: string } }) => f.geometry?.type === 'Polygon')
        .map((f: { properties?: { feature_type?: string }; geometry: { coordinates: [number, number][][] } }) => ({
          featureType: f.properties?.feature_type ?? 'unknown',
          ring: f.geometry.coordinates[0]
        }));
      if (feats.length === 0) throw new Error('No polygons in that file');
      setSegFeatures(feats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
    }
  };

  const onSave = () => {
    if (!id || placed.length === 0) return;
    apply.mutate({
      courseId: id,
      holes: placed.map((h) => ({
        number: h.number,
        tee: h.tee,
        green: h.green,
        par: parByHole.get(h.number) ?? null
      })),
      features: segFeatures.map((f) => ({ featureType: f.featureType, coords: f.ring }))
    });
  };

  return (
    <Box sx={{ p: 2 }}>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate(`/admin/courses/${id}`)}>
        Back to course
      </Button>

      <Typography variant="h6" sx={{ mt: 1 }}>
        Map holes — {course?.name ?? '…'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Load the GeoJSON from <code>tools/segment</code>, then click each hole twice:
        first its <strong>green</strong>, then its <strong>tee</strong>. Order is the
        hole order.
      </Typography>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ my: 1.5 }} flexWrap="wrap" useFlexGap>
        <Button variant="outlined" component="label" size="small">
          Load GeoJSON
          <input
            type="file"
            accept=".geojson,application/geo+json,application/json"
            hidden
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </Button>
        <Chip
          size="small"
          color={pendingGreen ? 'warning' : 'primary'}
          label={
            placed.length >= holeCount
              ? `all ${holeCount} holes placed`
              : pendingGreen
                ? `hole ${nextHole}: now click the TEE`
                : `hole ${nextHole}: click the GREEN`
          }
        />
        <Chip size="small" label={`${segFeatures.length} polygons`} />
        <Button
          size="small"
          startIcon={<UndoRoundedIcon />}
          disabled={!placed.length && !pendingGreen}
          onClick={() => {
            if (pendingGreen) setPendingGreen(null);
            else setPlaced((p) => p.slice(0, -1));
          }}
        >
          Undo
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={placed.length === 0 || apply.isPending}
          onClick={onSave}
        >
          {apply.isPending ? 'Saving…' : `Save ${placed.length} hole${placed.length === 1 ? '' : 's'}`}
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {apply.isError && (
        <Alert severity="error" sx={{ mb: 1 }}>{(apply.error as Error).message}</Alert>
      )}
      {apply.isSuccess && (
        <Alert severity="success" sx={{ mb: 1 }}>
          Wrote {apply.data.holes} holes and {apply.data.features} features. The course is
          marked synced — open it to check the hole map.
        </Alert>
      )}

      <Box
        ref={containerRef}
        sx={{ height: 620, borderRadius: 1, overflow: 'hidden', bgcolor: 'grey.900' }}
      />
    </Box>
  );
}
