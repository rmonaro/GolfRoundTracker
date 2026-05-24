import { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import type { HoleLayoutData } from '@/services/holesRepo';
import {
  buildProjector,
  expandBoundsFromPoints,
  projectCoords,
  EMPTY_BOUNDS,
  type ProjectedBounds
} from './projectHoleCoords';

interface HoleLayoutProps {
  layout: HoleLayoutData;
  compact?: boolean;
  className?: string;
}

// Feature-type → fill color. Anything unrecognized renders as semi-transparent rough.
const FEATURE_COLOR: Record<string, string> = {
  fairway: '#7cb342',
  green: '#a5d6a7',
  bunker: '#fdd835',
  water_hazard: '#4fc3f7',
  water: '#4fc3f7',
  tee: '#c5e1a5',
  rough: '#5d8c4f',
  cartpath: '#bdbdbd',
  path: '#bdbdbd'
};
const BACKGROUND = '#2d3e2d';

// Z-order so the green sits on top of the fairway, bunkers on top of rough, etc.
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

export function HoleLayout({ layout, compact = false, className }: HoleLayoutProps) {
  const { svg, hasGeometry } = useMemo(() => {
    const proj = buildProjector(layout.hole);
    if (!proj) return { svg: null, hasGeometry: false };

    // Sort features so we draw bottom layers first.
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
      const rings = projectCoords(proj, f.coords);
      for (const ring of rings) bounds = expandBoundsFromPoints(bounds, ring);
      drawables.push({
        key: f.id,
        type: f.feature_type,
        rings,
        isLine: f.is_line
      });
    }

    // Also include tee / green marker positions in the bounds.
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

    if (!Number.isFinite(bounds.minX)) {
      return { svg: null, hasGeometry: false };
    }

    // Pad the bbox so features aren't flush with the edges.
    const padding = compact ? 12 : 24;
    const minX = bounds.minX - padding;
    const minY = bounds.minY - padding;
    const width = bounds.maxX - bounds.minX + padding * 2;
    const height = bounds.maxY - bounds.minY + padding * 2;
    const viewBox = `${minX} ${minY} ${width} ${height}`;

    const svg = (
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
          const fill = FEATURE_COLOR[d.type] ?? 'rgba(255,255,255,0.06)';
          if (d.isLine) {
            // Linestrings (cartpath, hole centerlines, etc.) render as stroked polylines.
            return d.rings.map((ring, i) => (
              <polyline
                key={`${d.key}-${i}`}
                points={ring.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke={fill}
                strokeWidth={d.type === 'cartpath' || d.type === 'path' ? 1.5 : 1}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ));
          }
          // Polygons. fill-rule evenodd makes inner rings (holes in polygon) cut out.
          return (
            <path
              key={d.key}
              d={ringsToPath(d.rings)}
              fill={fill}
              fillRule="evenodd"
              stroke={d.type === 'green' ? '#558b2f' : 'none'}
              strokeWidth={d.type === 'green' ? 0.5 : 0}
            />
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
              points={`${greenXY[0]},${greenXY[1] - (compact ? 12 : 16)} ${greenXY[0] + (compact ? 6 : 8)},${
                greenXY[1] - (compact ? 9 : 13)
              } ${greenXY[0]},${greenXY[1] - (compact ? 6 : 10)}`}
              fill="#e53935"
            />
          </g>
        )}
      </svg>
    );

    return { svg, hasGeometry: true };
  }, [layout, compact]);

  if (!hasGeometry) {
    return (
      <Box
        className={className}
        sx={{
          display: 'grid',
          placeItems: 'center',
          width: '100%',
          height: '100%',
          bgcolor: BACKGROUND,
          color: 'rgba(255,255,255,0.6)',
          p: 2,
          borderRadius: 2
        }}
      >
        <Typography variant="caption">No geometry for this hole yet.</Typography>
      </Box>
    );
  }

  return (
    <Box
      className={className}
      sx={{
        width: '100%',
        height: '100%',
        bgcolor: BACKGROUND,
        borderRadius: 2,
        overflow: 'hidden',
        lineHeight: 0
      }}
    >
      {svg}
    </Box>
  );
}

function ringsToPath(rings: Array<Array<[number, number]>>): string {
  return rings
    .map((ring) =>
      ring
        .map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`))
        .concat('Z')
        .join(' ')
    )
    .join(' ');
}
