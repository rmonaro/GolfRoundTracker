import type { LocalHole } from '@/stores/roundStore';

/**
 * A hole's total score.
 *
 * In V1 the shot list is the source of truth. We persist the total shot count
 * to `round_holes.strokes` (see HoleTrackingPage), so a hole's total is simply:
 *   strokes (= number of logged shots, putters included) + penalty strokes.
 *
 * Putts are a *subset* of strokes (shots where club category is Putter) and are
 * never re-added to the total — adding them would double-count.
 */
export function holeTotalScore(hole: LocalHole): number {
  return (hole.strokes || 0) + (hole.penaltyStrokes || 0);
}

export function computeTotalScore(holes: LocalHole[]): number {
  return holes.reduce((sum, h) => sum + holeTotalScore(h), 0);
}

export function computeTotalPar(holes: LocalHole[]): number {
  return holes.reduce((sum, h) => sum + (h.par || 0), 0);
}

/**
 * A hole is "complete" if it was actually *played* — at least one stroke or
 * penalty stroke on it — AND either:
 *   • The user has navigated past it (its index < currentHoleIndex), or
 *   • Any shot on the hole was holed out (`targetResult === 'made'`).
 *
 * The played check comes first: skipping ahead without logging a shot leaves a
 * 0-stroke hole, and counting that as complete would subtract its full par from
 * the round total (arrowing past a par 3 read as −3).
 *
 * The holed-out branch matters for the moment between holing out on the
 * current hole and tapping "next" — the user expects the hole's score
 * to show up immediately, not after the navigation gesture.
 */
function isHoleComplete(hole: LocalHole, holeIdx: number, currentHoleIndex: number): boolean {
  const played = holeTotalScore(hole) > 0 || hole.shots.length > 0;
  if (!played) return false;
  if (holeIdx < currentHoleIndex) return true;
  return hole.shots.some((s) => s.targetResult === 'made');
}

/**
 * Running totals across only *completed* holes. The in-progress hole is
 * excluded so partial strokes don't move the round-wide total mid-shot.
 *
 * `completedCount === 0` means no holes have been finished yet —
 * display sites should render "--" instead of "E" in that case so
 * the user doesn't see a false "even with par" reading at the start.
 */
export function computeCompletedTotals(active: {
  holes: LocalHole[];
  currentHoleIndex: number;
}): { score: number; par: number; completedCount: number } {
  const completed = active.holes.filter((h, idx) =>
    isHoleComplete(h, idx, active.currentHoleIndex)
  );
  const score = completed.reduce((s, h) => s + holeTotalScore(h), 0);
  const par = completed.reduce((s, h) => s + (h.par || 0), 0);
  return { score, par, completedCount: completed.length };
}

export interface RoundSnapshotStats {
  totalScore: number;
  totalPar: number;
  scoreVsPar: number;
  putts: number;
  penaltyStrokes: number;
  greensInRegulation: number;
  fairwaysHit: number;
  fairwayAttempts: number;
  missLeft: number;
  missRight: number;
  missShort: number;
  missLong: number;
  sandShots: number;
  holesPlayed: number;
}

export function computeRoundStats(holes: LocalHole[]): RoundSnapshotStats {
  const stats: RoundSnapshotStats = {
    totalScore: 0,
    totalPar: 0,
    scoreVsPar: 0,
    putts: 0,
    penaltyStrokes: 0,
    greensInRegulation: 0,
    fairwaysHit: 0,
    fairwayAttempts: 0,
    missLeft: 0,
    missRight: 0,
    missShort: 0,
    missLong: 0,
    sandShots: 0,
    holesPlayed: 0
  };

  for (const h of holes) {
    const played = h.strokes > 0 || (h.penaltyStrokes ?? 0) > 0;
    if (played) stats.holesPlayed++;
    stats.totalScore += holeTotalScore(h);
    // Only count par for holes that have been started. Unplayed holes
    // would otherwise push score-vs-par negative on a partial round.
    if (played) stats.totalPar += h.par || 0;
    stats.putts += h.putts || 0;
    stats.penaltyStrokes += h.penaltyStrokes || 0;
    if (h.gir) stats.greensInRegulation++;
    if (h.sand) stats.sandShots++;

    if (h.par >= 4 && h.fairwayResult && h.fairwayResult !== 'na') {
      stats.fairwayAttempts++;
      switch (h.fairwayResult) {
        case 'hit':
          stats.fairwaysHit++;
          break;
        case 'left':
          stats.missLeft++;
          break;
        case 'right':
          stats.missRight++;
          break;
        case 'short':
          stats.missShort++;
          break;
        case 'long':
          stats.missLong++;
          break;
      }
    }
  }

  stats.scoreVsPar = stats.totalScore - stats.totalPar;
  return stats;
}
