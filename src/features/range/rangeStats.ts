// Pure session-summary math for the range mode. Kept separate from the screen
// so it's testable and reused by both the live summary panel and the summary
// page.

import type { RangeShot } from '@/types/range';

export interface ClubSummary {
  /** Club label, or 'Unspecified' when no club was attached. */
  club: string;
  shotCount: number;
  /** Mean carry, yards. */
  avgCarryYards: number;
  /** Std dev of the signed offline distance, yards (dispersion). */
  dispersionYards: number;
  /** Mean signed offline (yards) — bias left(-)/right(+). */
  avgOfflineYards: number;
}

const UNSPECIFIED = 'Unspecified';

/** Population standard deviation. */
function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Per-club summaries for clubs with at least `minShots` shots (default 3),
 * sorted by shot count descending. Shots without a club are grouped under
 * 'Unspecified'.
 */
export function computeClubSummaries(shots: RangeShot[], minShots = 3): ClubSummary[] {
  const byClub = new Map<string, RangeShot[]>();
  for (const shot of shots) {
    const key = shot.club ?? UNSPECIFIED;
    const list = byClub.get(key);
    if (list) list.push(shot);
    else byClub.set(key, [shot]);
  }

  const summaries: ClubSummary[] = [];
  for (const [club, list] of byClub) {
    if (list.length < minShots) continue;
    const carries = list.map((s) => s.carryYards);
    const offlines = list.map((s) => s.offlineYards);
    summaries.push({
      club,
      shotCount: list.length,
      avgCarryYards: carries.reduce((a, b) => a + b, 0) / carries.length,
      dispersionYards: stdDev(offlines),
      avgOfflineYards: offlines.reduce((a, b) => a + b, 0) / offlines.length
    });
  }

  return summaries.sort((a, b) => b.shotCount - a.shotCount);
}

/** Human-friendly result chip text for a single shot, e.g. "152 yds · 8 right". */
export function shotChipLabel(carryYards: number, offlineYards: number): string {
  const carry = Math.round(carryYards);
  const off = Math.round(Math.abs(offlineYards));
  if (off === 0) return `${carry} yds · straight`;
  return `${carry} yds · ${off} ${offlineYards > 0 ? 'right' : 'left'}`;
}
