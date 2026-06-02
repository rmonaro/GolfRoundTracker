/**
 * Estimated handicap utilities.
 * Disclaimer: this is an *estimated* handicap, not an official USGA handicap index.
 */

/** Hard sanity bound for a USGA handicap differential. Real-world values
 *  on any course / score combo stay between roughly -10 and +50. Anything
 *  outside ±60 is almost certainly garbage input (course rating set to a
 *  yardage by mistake, score = 0 because shots hadn't loaded yet, etc.).
 *  Returning null in that case keeps the bad value out of the estimated
 *  handicap calculation downstream. */
const MAX_REASONABLE_DIFFERENTIAL = 60;

export function calculateDifferential(
  adjustedGrossScore: number,
  courseRating: number | null | undefined,
  slopeRating: number | null | undefined
): number | null {
  if (
    courseRating == null ||
    slopeRating == null ||
    Number.isNaN(courseRating) ||
    Number.isNaN(slopeRating) ||
    slopeRating === 0
  ) {
    return null;
  }
  // Defensive: reject obviously bad inputs before the math. A score
  // below the course rating by more than the rating itself, or
  // ratings/slopes outside USGA ranges, means something is wrong
  // with the source data.
  if (adjustedGrossScore <= 0) return null;
  if (courseRating < 50 || courseRating > 90) return null;
  if (slopeRating < 55 || slopeRating > 155) return null;
  const diff = ((adjustedGrossScore - courseRating) * 113) / slopeRating;
  if (!Number.isFinite(diff)) return null;
  if (Math.abs(diff) > MAX_REASONABLE_DIFFERENTIAL) return null;
  return Math.round(diff * 10) / 10;
}

/** Returns true when a persisted differential is so far out of the USGA
 *  range that it has to be data corruption (course rating wrong, score
 *  computed as 0, etc.). Used by callers to invalidate stored values. */
export function isAbsurdDifferential(diff: number | null | undefined): boolean {
  if (diff == null || Number.isNaN(diff)) return false;
  return Math.abs(diff) > MAX_REASONABLE_DIFFERENTIAL;
}

export interface HandicapResult {
  value: number | null;
  message: string | null;
  roundsUsed: number;
}

/**
 * Returns the estimated handicap from an array of valid differentials (newest first).
 * - 1–2 rounds: show message, no number
 * - 3–19 rounds: lowest differential of those available
 * - 20+ rounds: average of best 8 of last 20
 */
export function estimateHandicap(differentials: Array<number | null>): HandicapResult {
  // Filter out nulls AND absurd stored values. Without this, one
  // corrupted round (e.g. an old row written before the input
  // validation in calculateDifferential was added) would dominate
  // the "lowest of 3+" branch below and tank the displayed handicap.
  const recent = differentials.filter(
    (d): d is number => typeof d === 'number' && !isAbsurdDifferential(d)
  );
  const count = recent.length;

  if (count < 3) {
    return {
      value: null,
      message: 'Play more rounds to improve handicap accuracy.',
      roundsUsed: count
    };
  }

  if (count < 20) {
    const lowest = Math.min(...recent);
    return { value: round1(lowest), message: null, roundsUsed: count };
  }

  const last20 = recent.slice(0, 20);
  const best8 = [...last20].sort((a, b) => a - b).slice(0, 8);
  const avg = best8.reduce((s, n) => s + n, 0) / best8.length;
  return { value: round1(avg), message: null, roundsUsed: 20 };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
