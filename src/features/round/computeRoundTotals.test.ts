import { describe, it, expect } from 'vitest';
import { computeCompletedTotals } from './computeRoundTotals';
import type { LocalHole, LocalShot } from '@/stores/roundStore';

function shot(n: number, over: Partial<LocalShot> = {}): LocalShot {
  return {
    tempId: `t${n}`,
    shotNumber: n,
    clubId: null,
    shotResult: 'fairway',
    targetType: null,
    targetResult: null,
    lie: null,
    penaltyType: null,
    distance: null,
    distanceUnit: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...over
  } as LocalShot;
}

function hole(holeNumber: number, par: number, over: Partial<LocalHole> = {}): LocalHole {
  return {
    holeNumber,
    par,
    strokes: 0,
    putts: 0,
    penaltyStrokes: 0,
    fairwayResult: null,
    sand: false,
    gir: false,
    clubsUsed: [],
    shots: [],
    dirty: false,
    ...over
  } as LocalHole;
}

describe('computeCompletedTotals', () => {
  it('ignores holes navigated past with no shots recorded', () => {
    // The reported bug: arrowing past a par 3 without playing it counted the
    // hole as complete with 0 strokes, reading as -3 on the round total.
    const active = {
      holes: [hole(1, 3), hole(2, 4), hole(3, 4)],
      currentHoleIndex: 2
    };
    const t = computeCompletedTotals(active);
    expect(t.completedCount).toBe(0);
    expect(t.score).toBe(0);
    expect(t.par).toBe(0);
  });

  it('counts a played hole once navigated past', () => {
    const played = hole(1, 4, { strokes: 5, shots: [shot(1), shot(2), shot(3), shot(4), shot(5)] });
    const t = computeCompletedTotals({ holes: [played, hole(2, 4)], currentHoleIndex: 1 });
    expect(t.completedCount).toBe(1);
    expect(t.score).toBe(5);
    expect(t.par).toBe(4);
  });

  it('counts the current hole as soon as it is holed out', () => {
    const current = hole(1, 3, {
      strokes: 2,
      shots: [shot(1), shot(2, { targetResult: 'made' })]
    });
    const t = computeCompletedTotals({ holes: [current, hole(2, 4)], currentHoleIndex: 0 });
    expect(t.completedCount).toBe(1);
    expect(t.score).toBe(2);
    expect(t.par).toBe(3);
  });

  it('counts a skipped hole that took only penalty strokes', () => {
    const penaltyOnly = hole(1, 4, { strokes: 0, penaltyStrokes: 2 });
    const t = computeCompletedTotals({ holes: [penaltyOnly, hole(2, 4)], currentHoleIndex: 1 });
    expect(t.completedCount).toBe(1);
    expect(t.score).toBe(2);
    expect(t.par).toBe(4);
  });

  it('skips unplayed holes but still counts played ones around them', () => {
    const active = {
      holes: [
        hole(1, 4, { strokes: 4, shots: [shot(1), shot(2), shot(3), shot(4)] }),
        hole(2, 3), // skipped
        hole(3, 5, { strokes: 6, shots: [shot(1)] })
      ],
      currentHoleIndex: 3
    };
    const t = computeCompletedTotals(active);
    expect(t.completedCount).toBe(2);
    expect(t.score).toBe(10);
    expect(t.par).toBe(9);
  });
});
