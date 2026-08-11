import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActiveRound } from '@/stores/roundStore';

// Record the ORDER of calls: RLS on round_holes/shots requires the parent
// rounds row, so a wrong order isn't a slow path — it's a hard rejection.
const calls: string[] = [];

vi.mock('./roundRepo', () => ({
  roundRepo: {
    create: vi.fn(async () => {
      calls.push('round');
      return {} as never;
    }),
    upsertHoles: vi.fn(async (holes: unknown[]) => {
      calls.push(`holes:${(holes as unknown[]).length}`);
      return [] as never;
    }),
    addShot: vi.fn(async () => {
      calls.push('shot');
      return {} as never;
    }),
    deleteShot: vi.fn(async () => {
      calls.push('delete');
    })
  }
}));

vi.mock('./connectivity', () => ({
  isUsablyOnline: () => true,
  refreshConnectivity: async () => 'online'
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { refreshSession: async () => ({ error: null }) } }
}));

const { syncRound, pendingCount, reconcileLiveRounds } = await import('./roundSync');
const { roundRepo } = await import('./roundRepo');
const { useRoundStore } = await import('@/stores/roundStore');

function shot(id: string, syncedAt: string | null = null) {
  return {
    id,
    shotNumber: 1,
    clubId: null,
    shotResult: 'fairway',
    targetType: null,
    targetResult: null,
    lie: null,
    penaltyType: null,
    distance: null,
    distanceUnit: null,
    notes: null,
    createdAt: '2026-07-31T10:00:00Z',
    syncedAt
  } as never;
}

function round(over: Partial<ActiveRound> = {}): ActiveRound {
  return {
    roundId: 'r1',
    userId: 'u1',
    courseId: 'c1',
    courseName: 'Test GC',
    holesPlayed: 18,
    courseRating: null,
    slopeRating: null,
    totalPar: 72,
    totalYardage: null,
    startedAt: '2026-07-31T10:00:00Z',
    currentHoleIndex: 0,
    holes: [
      {
        holeId: 'h1',
        holeNumber: 1,
        par: 4,
        yardage: null,
        strokes: 1,
        putts: 0,
        penaltyStrokes: 0,
        fairwayResult: null,
        sand: false,
        gir: false,
        clubsUsed: [],
        dirty: false,
        shots: [shot('s1')]
      }
    ],
    ...over
  } as ActiveRound;
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe('syncRound', () => {
  it('pushes round before holes before shots', async () => {
    await syncRound(round());
    expect(calls).toEqual(['round', 'holes:1', 'shot']);
  });

  it('deletes tombstoned shots AFTER upserting, so they are not re-created', async () => {
    // Ordering matters: deleting first would let the shot upsert below
    // resurrect a row the golfer removed.
    await syncRound(round({ deletedShotIds: ['gone-1'] }));
    expect(calls[calls.length - 1]).toBe('delete');
  });

  it('skips shots the server already has', async () => {
    const r = round();
    r.holes[0].shots = [shot('s1', '2026-07-31T10:05:00Z')];
    r.holes[0].syncedAt = '2026-07-31T10:05:00Z';
    await syncRound(r);
    // Round is always re-pushed (cheap, and required for RLS); nothing else.
    expect(calls).toEqual(['round']);
  });

  it('re-pushes a hole marked dirty even when previously synced', async () => {
    const r = round();
    r.holes[0].syncedAt = '2026-07-31T10:05:00Z';
    r.holes[0].dirty = true;
    r.holes[0].shots = [shot('s1', '2026-07-31T10:05:00Z')];
    await syncRound(r);
    expect(calls).toEqual(['round', 'holes:1']);
  });

  it('reports the ids that landed so callers can stamp them', async () => {
    const result = await syncRound(round());
    expect(result.ok).toBe(true);
    expect(result.syncedHoleIds).toEqual(['h1']);
    expect(result.syncedShotIds).toEqual(['s1']);
  });

  it('returns a failure instead of throwing', async () => {
    vi.mocked(roundRepo.create).mockRejectedValueOnce(new Error('network down'));
    const result = await syncRound(round());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('network down');
  });

  it('flags auth failures so callers stop retrying', async () => {
    // An expired session needs the user, not a backoff loop.
    vi.mocked(roundRepo.create).mockRejectedValueOnce(new Error('JWT expired'));
    const result = await syncRound(round());
    expect(result.needsAuth).toBe(true);
  });

  it('does not mark anything synced when the push failed', async () => {
    vi.mocked(roundRepo.create).mockRejectedValueOnce(new Error('nope'));
    const result = await syncRound(round());
    expect(result.syncedShotIds).toEqual([]);
    expect(result.syncedHoleIds).toEqual([]);
  });
});

describe('pendingCount', () => {
  it('is zero for a fully synced round', () => {
    const r = round({ roundSyncedAt: '2026-07-31T10:05:00Z' });
    r.holes[0].syncedAt = '2026-07-31T10:05:00Z';
    r.holes[0].shots = [shot('s1', '2026-07-31T10:05:00Z')];
    expect(pendingCount(r)).toBe(0);
  });

  it('counts the round row itself when it has never been pushed', () => {
    const r = round();
    r.holes[0].syncedAt = '2026-07-31T10:05:00Z';
    r.holes[0].shots = [shot('s1', '2026-07-31T10:05:00Z')];
    expect(pendingCount(r)).toBe(1);
  });

  it('counts unsynced shots, holes and tombstones', () => {
    const r = round({ roundSyncedAt: 'x', deletedShotIds: ['d1', 'd2'] });
    expect(pendingCount(r)).toBe(1 /* hole */ + 1 /* shot */ + 2 /* tombstones */);
  });

  it('is zero with no round', () => {
    expect(pendingCount(null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// reconcileLiveRounds — usually one round; in scorer mode the 2-4 players in a
// tee group, which must sync independently of one another.
// ---------------------------------------------------------------------------
describe('reconcileLiveRounds', () => {
  beforeEach(() => {
    useRoundStore.setState({ active: null, parked: {} });
  });

  function seedGroup() {
    const store = useRoundStore.getState();
    store.startRound(round({ roundId: 'r1' }));
    store.addParallelRound(round({ roundId: 'r2' }));
    store.addParallelRound(round({ roundId: 'r3' }));
  }

  it('pushes every live round, not just the one on screen', async () => {
    seedGroup();
    const result = await reconcileLiveRounds();
    expect(result.ok).toBe(true);
    // Three rounds × (round + holes + shot).
    expect(calls.filter((c) => c === 'round')).toHaveLength(3);
    expect(result.syncedShots).toBe(3);
  });

  it('stamps each round separately', async () => {
    seedGroup();
    await reconcileLiveRounds();
    const s = useRoundStore.getState();
    expect(s.active?.roundSyncedAt).toBeTruthy();
    expect(s.parked.r2.roundSyncedAt).toBeTruthy();
    expect(s.parked.r3.roundSyncedAt).toBeTruthy();
    expect(s.parked.r2.holes[0].shots[0].syncedAt).toBeTruthy();
  });

  it('does not strand the rest of the group when one player fails', async () => {
    // The rounds are independent — a failure on one says nothing about the
    // others, unlike the ordered outbox where stopping early is correct.
    seedGroup();
    vi.mocked(roundRepo.create).mockRejectedValueOnce(new Error('network down'));
    const result = await reconcileLiveRounds();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('network down');
    // All three were attempted; the two healthy ones still landed.
    expect(roundRepo.create).toHaveBeenCalledTimes(3);
    expect(result.syncedShots).toBe(2);
    expect(calls.filter((c) => c === 'shot')).toHaveLength(2);
  });

  it('stops early on an expired session', async () => {
    // Every remaining round would fail identically; retrying just burns
    // round-trips and battery.
    seedGroup();
    vi.mocked(roundRepo.create).mockRejectedValueOnce(new Error('JWT expired'));
    const result = await reconcileLiveRounds();
    expect(result.needsAuth).toBe(true);
    // Only the round that failed was attempted — the other two were abandoned.
    expect(roundRepo.create).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it('skips rounds that have nothing pending', async () => {
    const synced = round({ roundId: 'r1', roundSyncedAt: 'x' });
    synced.holes[0].syncedAt = 'x';
    synced.holes[0].shots = [shot('s1', 'x')];
    useRoundStore.getState().startRound(synced);
    useRoundStore.getState().addParallelRound(round({ roundId: 'r2' }));
    await reconcileLiveRounds();
    expect(calls.filter((c) => c === 'round')).toHaveLength(1);
  });

  it('is a no-op with no rounds at all', async () => {
    const result = await reconcileLiveRounds();
    expect(result).toEqual({ ok: true, syncedShots: 0 });
    expect(calls).toEqual([]);
  });
});
