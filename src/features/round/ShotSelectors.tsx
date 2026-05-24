import { Box, Typography, useTheme } from '@mui/material';
import type { Lie, PenaltyType, TargetResult } from '@/models';
import { LIE_OPTIONS } from '@/models';

// ---------------------------------------------------------------------------
// Shared shape: an option for the bullseye target.
// ---------------------------------------------------------------------------

export interface BullseyeOption {
  value: TargetResult;
  label: string;
}

interface BullseyeTargetProps {
  value: TargetResult | null;
  onChange: (value: TargetResult) => void;
  /** Center "ideal outcome" — Green (approach) or Made (putt). */
  center: BullseyeOption;
  /** Outer ring outcomes, mapped to compass positions. */
  top: BullseyeOption;
  right: BullseyeOption;
  bottom: BullseyeOption;
  left: BullseyeOption;
  /** Visual variant — controls the active fill of the center. */
  centerVariant?: 'green' | 'success';
}

// ---------------------------------------------------------------------------
// Helpers — SVG annular segment path math
// ---------------------------------------------------------------------------

const SIZE = 280;
const C = SIZE / 2;          // center
const OUTER_R = 130;          // outer ring radius
const INNER_R = 56;           // inner ring radius (also the center circle)
const SEGMENT_GAP_DEG = 3;    // visual gap between adjacent segments

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * Builds an SVG path for one quadrant of an annulus, sweep-side-aware.
 * startDeg/endDeg use SVG math convention (0° = right, 90° = bottom, 270° = top).
 */
function annularSegment(startDeg: number, endDeg: number): string {
  const outerStart = polar(C, C, OUTER_R, endDeg);
  const outerEnd = polar(C, C, OUTER_R, startDeg);
  const innerEnd = polar(C, C, INNER_R, startDeg);
  const innerStart = polar(C, C, INNER_R, endDeg);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${OUTER_R} ${OUTER_R} 0 0 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${INNER_R} ${INNER_R} 0 0 1 ${innerStart.x} ${innerStart.y}`,
    'Z'
  ].join(' ');
}

// Compass-aligned segment ranges (SVG y-down). Top = 270°, Right = 0°, Bottom = 90°, Left = 180°.
const TOP_RANGE = { start: 225 + SEGMENT_GAP_DEG / 2, end: 315 - SEGMENT_GAP_DEG / 2 };
const RIGHT_RANGE = { start: 315 + SEGMENT_GAP_DEG / 2, end: 405 - SEGMENT_GAP_DEG / 2 };
const BOTTOM_RANGE = { start: 45 + SEGMENT_GAP_DEG / 2, end: 135 - SEGMENT_GAP_DEG / 2 };
const LEFT_RANGE = { start: 135 + SEGMENT_GAP_DEG / 2, end: 225 - SEGMENT_GAP_DEG / 2 };

// ---------------------------------------------------------------------------
// BullseyeTarget — circular target with 4 outer segments + center
// Used for green target (approach shots) and putting result.
// ---------------------------------------------------------------------------

export function BullseyeTarget({
  value,
  onChange,
  center,
  top,
  right,
  bottom,
  left,
  centerVariant = 'green'
}: BullseyeTargetProps) {
  const theme = useTheme();
  const segments = [
    { range: TOP_RANGE, opt: top, anchor: { x: C, y: 36 } },
    { range: RIGHT_RANGE, opt: right, anchor: { x: SIZE - 30, y: C + 4 } },
    { range: BOTTOM_RANGE, opt: bottom, anchor: { x: C, y: SIZE - 24 } },
    { range: LEFT_RANGE, opt: left, anchor: { x: 30, y: C + 4 } }
  ];

  const centerActive = value === center.value;
  const activeFill = theme.palette.primary.main;
  const idleFill = theme.palette.action.hover;
  const idleStroke = theme.palette.divider;
  const labelColor = theme.palette.text.primary;
  const activeLabelColor = theme.palette.primary.contrastText;
  const centerActiveFill =
    centerVariant === 'green' ? '#2E7D32' : theme.palette.success.main;

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', userSelect: 'none' }}>
      <Box
        component="svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        sx={{
          width: '100%',
          maxWidth: 320,
          height: 'auto',
          touchAction: 'manipulation'
        }}
        aria-label="Shot outcome selector"
      >
        {segments.map(({ range, opt, anchor }) => {
          const active = value === opt.value;
          return (
            <g
              key={opt.value}
              onClick={() => onChange(opt.value)}
              style={{ cursor: 'pointer' }}
              role="button"
              aria-pressed={active}
              aria-label={opt.label}
            >
              <path
                d={annularSegment(range.start, range.end)}
                fill={active ? activeFill : idleFill}
                stroke={idleStroke}
                strokeWidth={1.5}
              />
              <text
                x={anchor.x}
                y={anchor.y}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontFamily: theme.typography.fontFamily,
                  fontSize: 14,
                  fontWeight: 700,
                  fill: active ? activeLabelColor : labelColor,
                  pointerEvents: 'none'
                }}
              >
                {opt.label}
              </text>
            </g>
          );
        })}

        {/* Center hit circle */}
        <g
          onClick={() => onChange(center.value)}
          style={{ cursor: 'pointer' }}
          role="button"
          aria-pressed={centerActive}
          aria-label={center.label}
        >
          <circle
            cx={C}
            cy={C}
            r={INNER_R - 6}
            fill={centerActive ? centerActiveFill : 'rgba(76,175,80,0.18)'}
            stroke={centerActive ? centerActiveFill : '#4CAF50'}
            strokeWidth={2}
          />
          <text
            x={C}
            y={C}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fontFamily: theme.typography.fontFamily,
              fontSize: 18,
              fontWeight: 800,
              fill: centerActive ? '#fff' : '#4CAF50',
              pointerEvents: 'none'
            }}
          >
            {center.label}
          </text>
        </g>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// FairwaySelector — wide fairway oval with crescent-shaped Left / Right roughs
// curving around it (visually separate via a small gap).
// ---------------------------------------------------------------------------

interface FairwaySelectorProps {
  value: TargetResult | null;
  /** Tap the active region a second time to deselect (caller receives null). */
  onChange: (value: TargetResult | null) => void;
}

const FW_VIEW_W = 300;
const FW_VIEW_H = 320;
const FW_CX = FW_VIEW_W / 2;       // 150
const FW_CY = FW_VIEW_H / 2;       // 160

// Central fairway target — wide
const FAIRWAY_RX = 78;
const FAIRWAY_RY = 140;

// Crescent geometry — elliptical arcs so we can make the crescents taller
// without bulging them sideways. Horns sit at (hornX, FW_CY ± HORN_Y_OFFSET).
//   • Outer ellipse: rx=70, ry=HORN_Y_OFFSET — centered at the horn x, the
//     ellipse naturally passes through both horns since ry equals their offset.
//   • Inner ellipse: rx=80, ry computed so the ellipse (centered at the fairway
//     center) also passes through the horns.
const HORN_X_OFFSET = 40;          // horn at FW_CX ± 40 — sits just inside fairway
const HORN_Y_OFFSET = 130;         // → each crescent spans 2 × 130 = 260 px (taller)
const CRESCENT_OUTER_RX = 100;     // bulge — bigger value = wider crescents
const FAIRWAY_GAP = 5;             // visible gap (centerline) between fairway and crescents
const CRESCENT_INNER_RX = FAIRWAY_RX + FAIRWAY_GAP;

// Inner ry solved from: HORN_X_OFFSET²/innerRx² + HORN_Y_OFFSET²/innerRy² = 1
const CRESCENT_INNER_RY = Math.sqrt(
  (HORN_Y_OFFSET * HORN_Y_OFFSET) /
    (1 - (HORN_X_OFFSET * HORN_X_OFFSET) / (CRESCENT_INNER_RX * CRESCENT_INNER_RX))
);

function buildCrescent(side: 'left' | 'right'): string {
  const dir = side === 'left' ? -1 : 1;
  const hornX = FW_CX + dir * HORN_X_OFFSET;
  const topY = FW_CY - HORN_Y_OFFSET;
  const botY = FW_CY + HORN_Y_OFFSET;
  // Both arcs bulge through the same FAR side (left for left crescent), with
  // the outer arc reaching further out than the inner. Sweep flags differ
  // between the two arcs because they're on ellipses with different centers.
  const outerSweep = side === 'left' ? 0 : 1;
  const innerSweep = side === 'left' ? 1 : 0;
  return [
    `M ${hornX} ${topY}`,
    `A ${CRESCENT_OUTER_RX} ${HORN_Y_OFFSET} 0 0 ${outerSweep} ${hornX} ${botY}`,
    `A ${CRESCENT_INNER_RX} ${CRESCENT_INNER_RY} 0 0 ${innerSweep} ${hornX} ${topY}`,
    'Z'
  ].join(' ');
}

export function FairwaySelector({ value, onChange }: FairwaySelectorProps) {
  const theme = useTheme();
  const idleFill = theme.palette.action.hover;
  const idleStroke = theme.palette.divider;
  // Rough misses use warning (orange) so they don't visually compete with the
  // green fairway — green is reserved for "hit the target".
  const activeFill = theme.palette.warning.main;
  const greenHitFill = '#2E7D32';
  const labelColor = theme.palette.text.primary;
  const activeLabelColor = theme.palette.warning.contrastText;

  // Label sits at the midpoint of the crescent's body on the centerline.
  // At y=FW_CY: outer-left edge is at (hornX - outerRx); inner edge at (FW_CX - innerRx).
  const leftLabelX =
    FW_CX - (HORN_X_OFFSET + CRESCENT_OUTER_RX + CRESCENT_INNER_RX) / 2;
  const rightLabelX =
    FW_CX + (HORN_X_OFFSET + CRESCENT_OUTER_RX + CRESCENT_INNER_RX) / 2;

  const sides: Array<{ key: 'left' | 'right'; label: string; labelX: number }> = [
    { key: 'left', label: 'Left', labelX: leftLabelX },
    { key: 'right', label: 'Right', labelX: rightLabelX }
  ];

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', userSelect: 'none' }}>
      <Box
        component="svg"
        viewBox={`0 0 ${FW_VIEW_W} ${FW_VIEW_H}`}
        sx={{
          width: '100%',
          maxWidth: 300,
          height: 'auto',
          touchAction: 'manipulation'
        }}
        aria-label="Fairway target selector"
      >
        {sides.map(({ key, label, labelX }) => {
          const active = value === key;
          return (
            <g
              key={key}
              onClick={() => onChange(active ? null : key)}
              style={{ cursor: 'pointer' }}
              role="button"
              aria-pressed={active}
              aria-label={label}
            >
              <path
                d={buildCrescent(key)}
                fill={active ? activeFill : idleFill}
                stroke={idleStroke}
                strokeWidth={1.5}
              />
              <text
                x={labelX}
                y={FW_CY}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontFamily: theme.typography.fontFamily,
                  fontSize: 15,
                  fontWeight: 700,
                  fill: active ? activeLabelColor : labelColor,
                  pointerEvents: 'none'
                }}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Wide fairway oval in the middle */}
        <g
          onClick={() => onChange(value === 'hit' ? null : 'hit')}
          style={{ cursor: 'pointer' }}
          role="button"
          aria-pressed={value === 'hit'}
          aria-label="Fairway"
        >
          <ellipse
            cx={FW_CX}
            cy={FW_CY}
            rx={FAIRWAY_RX}
            ry={FAIRWAY_RY}
            fill={value === 'hit' ? greenHitFill : 'rgba(76,175,80,0.18)'}
            stroke={value === 'hit' ? greenHitFill : '#4CAF50'}
            strokeWidth={2}
          />
          {/* Label rotated 90° so it reads top-to-bottom down the fairway */}
          <text
            x={FW_CX}
            y={FW_CY}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(90 ${FW_CX} ${FW_CY})`}
            style={{
              fontFamily: theme.typography.fontFamily,
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: 6,
              fill: value === 'hit' ? '#fff' : '#4CAF50',
              pointerEvents: 'none'
            }}
          >
            FAIRWAY
          </text>
        </g>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// LieSelector — Bunker / Rough / Fairway / Green / Penalty
// ---------------------------------------------------------------------------

interface LieSelectorProps {
  value: Lie | null;
  onChange: (value: Lie | null) => void;
}

const LIE_LABEL: Record<Lie, string> = {
  bunker: 'Bunker',
  rough: 'Rough',
  fairway: 'Fairway',
  green: 'Green',
  penalty: 'Penalty'
};

// Display order — user-spec'd list, ordered by frequency on course.
const LIE_DISPLAY: readonly Lie[] = ['fairway', 'rough', 'bunker', 'green', 'penalty'];

export function LieSelector({ value, onChange }: LieSelectorProps) {
  void LIE_OPTIONS; // re-exported for callers; consumed by the type system
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 0.5
      }}
    >
      {LIE_DISPLAY.map((lie) => {
        const active = value === lie;
        return (
          <Box
            key={lie}
            role="button"
            onClick={() => onChange(active ? null : lie)}
            sx={{
              minHeight: 52,
              borderRadius: 2,
              border: '1.5px solid',
              borderColor: active ? 'primary.main' : 'divider',
              bgcolor: active ? 'primary.main' : 'transparent',
              color: active ? 'primary.contrastText' : 'text.primary',
              fontWeight: 600,
              fontSize: '0.85rem',
              display: 'grid',
              placeItems: 'center',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 120ms ease',
              userSelect: 'none',
              '&:hover': { borderColor: active ? 'primary.dark' : 'text.secondary' }
            }}
          >
            {LIE_LABEL[lie]}
          </Box>
        );
      })}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// PenaltySelector — 6 circular tap targets for per-shot penalty types
// ---------------------------------------------------------------------------

interface PenaltySelectorProps {
  value: PenaltyType | null;
  onChange: (value: PenaltyType | null) => void;
}

// Short labels that fit inside a ~48px circle on a 6-up row.
const PENALTY_SHORT: Record<PenaltyType, string> = {
  ob: 'OB',
  water: 'Water',
  lost_ball: 'Lost',
  unplayable: 'Unp',
  wrong_ball: 'WB',
  bunker: 'Bunker'
};

// Full labels used by the shot timeline and accessibility hints.
const PENALTY_LABEL: Record<PenaltyType, string> = {
  ob: 'OB',
  water: 'Water',
  lost_ball: 'Lost Ball',
  unplayable: 'Unplayable',
  wrong_ball: 'Wrong Ball',
  bunker: 'Bunker'
};

const PENALTY_DESCRIPTION: Record<PenaltyType, string> = {
  ob: 'Out of Bounds',
  water: 'Water hazard',
  lost_ball: 'Lost ball',
  unplayable: 'Unplayable',
  wrong_ball: 'Wrong ball',
  bunker: 'Bunker'
};

// Display order — most-common penalties first.
const PENALTY_DISPLAY: readonly PenaltyType[] = [
  'ob',
  'water',
  'lost_ball',
  'unplayable',
  'wrong_ball',
  'bunker'
];

export function PenaltySelector({ value, onChange }: PenaltySelectorProps) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: 0.75
      }}
    >
      {PENALTY_DISPLAY.map((p) => {
        const active = value === p;
        return (
          <Box
            key={p}
            role="button"
            aria-pressed={active}
            aria-label={PENALTY_DESCRIPTION[p]}
            title={PENALTY_DESCRIPTION[p]}
            onClick={() => onChange(active ? null : p)}
            sx={{
              aspectRatio: '1 / 1',
              borderRadius: '50%',
              border: '2px solid',
              borderColor: active ? 'warning.main' : 'divider',
              bgcolor: active ? 'warning.main' : 'transparent',
              color: active ? 'warning.contrastText' : 'text.primary',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              transition: 'all 120ms ease',
              userSelect: 'none',
              textAlign: 'center',
              minWidth: 0,
              '&:hover': { borderColor: active ? 'warning.dark' : 'text.secondary' }
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontWeight: 800,
                fontSize: '0.72rem',
                lineHeight: 1,
                color: 'inherit',
                letterSpacing: 0
              }}
            >
              {PENALTY_SHORT[p]}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

export const PENALTY_LABELS = PENALTY_LABEL;

// ---------------------------------------------------------------------------
// Preset configurations for the two BullseyeTarget use cases
// ---------------------------------------------------------------------------

export const GREEN_TARGET_PRESET = {
  center: { value: 'hit' as TargetResult, label: 'GREEN' },
  top: { value: 'long' as TargetResult, label: 'Long' },
  right: { value: 'right' as TargetResult, label: 'Right' },
  bottom: { value: 'short' as TargetResult, label: 'Short' },
  left: { value: 'left' as TargetResult, label: 'Left' }
} as const;

export const PUTT_TARGET_PRESET = {
  center: { value: 'made' as TargetResult, label: 'MADE' },
  top: { value: 'long' as TargetResult, label: 'Long' },
  right: { value: 'right' as TargetResult, label: 'Right' },
  bottom: { value: 'short' as TargetResult, label: 'Short' },
  left: { value: 'left' as TargetResult, label: 'Left' }
} as const;
