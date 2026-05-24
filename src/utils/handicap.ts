/**
 * Estimated handicap utilities.
 * Disclaimer: this is an *estimated* handicap, not an official USGA handicap index.
 */

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
  const diff = ((adjustedGrossScore - courseRating) * 113) / slopeRating;
  return Math.round(diff * 10) / 10;
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
  const recent = differentials.filter((d): d is number => typeof d === 'number');
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
