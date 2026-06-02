import type { SkillLevel } from '@/models';

/**
 * Expected strokes baselines, parameterized by skill level.
 *
 * Implementation: the AVERAGE (~90-shooter) tables are the canonical
 * shape (derived from public amateur-data baselines). Other skill
 * levels are produced by applying per-lie multipliers — pros get a
 * bigger discount on long approach shots than on putts, beginners
 * get a bigger penalty on long approaches than on putts, etc. This
 * keeps the relative shot-difficulty curve intact without requiring
 * 5 separate hand-authored tables.
 *
 * Lookup uses piecewise linear interpolation between table rows and
 * clamps at table edges. Beyond the longest table row we extrapolate
 * along the slope of the last segment.
 */
export type SGLie = 'tee' | 'fairway' | 'rough' | 'sand' | 'green' | 'fringe' | 'hole';

type Row = readonly [distance: number, expected: number];

/** Tee-shot baselines indexed by hole length (yards). */
const TEE: readonly Row[] = [
  [80, 2.70],
  [100, 2.85],
  [120, 2.95],
  [150, 3.05],
  [175, 3.15],
  [200, 3.30],
  [250, 3.65],
  [300, 4.00],
  [350, 4.25],
  [400, 4.45],
  [450, 4.65],
  [500, 4.85],
  [550, 5.05],
  [600, 5.25]
];

/** Fairway shots — the cleanest lie, baseline for everything else. */
const FAIRWAY: readonly Row[] = [
  [5, 2.40],
  [10, 2.50],
  [20, 2.60],
  [30, 2.70],
  [40, 2.78],
  [50, 2.85],
  [60, 2.90],
  [80, 2.95],
  [100, 3.00],
  [120, 3.05],
  [140, 3.15],
  [160, 3.25],
  [180, 3.40],
  [200, 3.55],
  [220, 3.70],
  [240, 3.85],
  [260, 4.00],
  [280, 4.15],
  [300, 4.30]
];

/** Light rough — roughly +0.10–0.20 strokes vs fairway. */
const ROUGH: readonly Row[] = [
  [5, 2.55],
  [10, 2.65],
  [20, 2.75],
  [30, 2.85],
  [40, 2.92],
  [50, 3.00],
  [60, 3.05],
  [80, 3.12],
  [100, 3.20],
  [120, 3.28],
  [140, 3.38],
  [160, 3.50],
  [180, 3.65],
  [200, 3.82],
  [220, 4.00],
  [240, 4.18],
  [260, 4.35]
];

/** Sand / bunker — +0.25–0.40 strokes vs fairway, harder from long. */
const SAND: readonly Row[] = [
  [5, 2.65],
  [10, 2.80],
  [20, 2.95],
  [30, 3.05],
  [40, 3.15],
  [50, 3.25],
  [60, 3.32],
  [80, 3.40],
  [100, 3.50],
  [120, 3.60],
  [140, 3.72],
  [160, 3.85],
  [180, 4.00],
  [200, 4.20]
];

/** Fringe — basically fairway-quality lie around the green. */
const FRINGE: readonly Row[] = [
  [5, 2.35],
  [10, 2.45],
  [20, 2.55],
  [30, 2.65]
];

/** On-green putt baseline. Distance is in FEET, not yards. */
const GREEN_PUTT: readonly Row[] = [
  [1, 1.00],
  [3, 1.08],
  [5, 1.25],
  [7, 1.45],
  [10, 1.60],
  [15, 1.80],
  [20, 1.92],
  [25, 2.02],
  [30, 2.10],
  [40, 2.22],
  [50, 2.30],
  [60, 2.38],
  [80, 2.50]
];

/**
 * Per-skill, per-lie multipliers applied to the AVERAGE baseline.
 *
 * The lie row has subtler differences than you might expect: pros are
 * massively better at long approach shots but only marginally better
 * at short putts, because a 3-foot putt is essentially binary for
 * everyone above beginner. So pga_tour: 0.88 on fairway but 0.94 on
 * green — they're not 12% better at the 3-footer, just at the 30-
 * footer (which the table-row slope picks up).
 *
 * Values are honest approximations — feel free to refine over time.
 */
const SKILL_MULTIPLIERS: Record<SkillLevel, Record<SGLie, number>> = {
  beginner: {
    tee: 1.08,
    fairway: 1.07,
    rough: 1.07,
    sand: 1.08,
    fringe: 1.06,
    green: 1.05,
    hole: 1.0
  },
  average: {
    tee: 1.0,
    fairway: 1.0,
    rough: 1.0,
    sand: 1.0,
    fringe: 1.0,
    green: 1.0,
    hole: 1.0
  },
  good: {
    tee: 0.95,
    fairway: 0.96,
    rough: 0.96,
    sand: 0.95,
    fringe: 0.96,
    green: 0.97,
    hole: 1.0
  },
  advanced: {
    tee: 0.91,
    fairway: 0.92,
    rough: 0.92,
    sand: 0.90,
    fringe: 0.92,
    green: 0.94,
    hole: 1.0
  },
  pga_tour: {
    tee: 0.86,
    fairway: 0.88,
    rough: 0.88,
    sand: 0.86,
    fringe: 0.87,
    green: 0.91,
    hole: 1.0
  }
};

function interp(table: readonly Row[], distance: number): number {
  if (table.length === 0) return 0;
  // Clamp below the first row — distance 0 toward target rounds down.
  if (distance <= table[0][0]) return table[0][1];
  // Linear interpolation between adjacent rows.
  for (let i = 0; i < table.length - 1; i++) {
    const [d0, e0] = table[i];
    const [d1, e1] = table[i + 1];
    if (distance >= d0 && distance <= d1) {
      const t = (distance - d0) / (d1 - d0);
      return e0 + t * (e1 - e0);
    }
  }
  // Beyond the tail — extrapolate at the slope of the last segment so
  // far-out shots still return a sane (monotonic) expectation.
  const [d0, e0] = table[table.length - 2];
  const [d1, e1] = table[table.length - 1];
  const slope = (e1 - e0) / (d1 - d0);
  return e1 + slope * (distance - d1);
}

/**
 * Expected strokes from a (lie, distance) position for the given skill
 * level. Distance is yards for everything except putts (green) —
 * putts use feet. Returns 0 for the holed-out terminal state.
 *
 * Skill level defaults to 'average' when null/undefined (e.g., user
 * hasn't filled in their profile yet) so SG stays computable.
 */
export function expectedStrokes(
  lie: SGLie,
  distance: number,
  skill: SkillLevel | null = 'average'
): number {
  if (lie === 'hole') return 0;
  if (distance < 0) return 0;
  let base: number;
  switch (lie) {
    case 'tee':
      base = interp(TEE, distance);
      break;
    case 'fairway':
      base = interp(FAIRWAY, distance);
      break;
    case 'rough':
      base = interp(ROUGH, distance);
      break;
    case 'sand':
      base = interp(SAND, distance);
      break;
    case 'fringe':
      base = interp(FRINGE, distance);
      break;
    case 'green':
      base = interp(GREEN_PUTT, distance);
      break;
  }
  const m = SKILL_MULTIPLIERS[skill ?? 'average'][lie];
  return base * m;
}
