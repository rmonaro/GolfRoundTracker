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
