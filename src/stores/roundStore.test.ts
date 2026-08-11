import { describe, it, expect, beforeEach } from 'vitest';
import {
  liveRounds,
  migratePersistedRound,
  PERSIST_VERSION,
  useRoundStore,
  type ActiveRound
} from './roundStore';
import { isUuid } from '@/lib/ids';

// A round as persisted by the PRE-client-id build: shots keyed by `tempId`,
// with `remoteId` present only once the server had accepted them.
function legacyState() {
  return {
    active: {
      roundId: 'a3f1c2d4-0000-4000-8000-000000000001',
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
      tmRegistrationId: null,
      tmRoundNumber: null,
      tmTournamentSlug: null,
      holes: [
        {
          holeId: 'b3f1c2d4-0000-4000-8000-000000000010',
          holeNumber: 1,
          par: 4,
          yardage: null,
          strokes: 2,
          putts: 0,
          penaltyStrokes: 0,
          fairwayResult: null,
          sand: false,
          gir: false,
          clubsUsed: [],
          dirty: false,
          shots: [
            {
              // Synced: server gave it a real UUID.
              tempId: 'tmp_1722000000000_abc',
              remoteId: 'c3f1c2d4-0000-4000-8000-000000000100',
              shotNumber: 1,
              createdAt: '2026-07-31T10:05:00Z'
            },
            {
              // Never reached the server — its id is not a UUID.
              tempId: 'tmp_1722000000001_def',
              shotNumber: 2,
              createdAt: '2026-07-31T10:07:00Z'
            }
          ]
        },
        {
          // A hole the server never named.
          holeNumber: 2,
          par: 3,
          yardage: null,
          strokes: 0,
          putts: 0,
          penaltyStrokes: 0,
          fairwayResult: null,
          sand: false,
          gir: false,
          clubsUsed: [],
          dirty: false,
          shots: []
        }
      ]
    }
  };
}

describe('migratePersistedRound', () => {
  it('keeps the server id for an already-synced shot', () => {
    // Critical: re-minting here would orphan the existing row and duplicate it
    // on the next write.
    const out = migratePersistedRound(legacyState(), 0);
    const shot = out.active!.holes[0].shots[0];
    expect(shot.id).toBe('c3f1c2d4-0000-4000-8000-000000000100');
    expect(shot.syncedAt).toBe('2026-07-31T10:05:00Z');
  });

  it('mints a real UUID for a never-synced shot', () => {
    // `tmp_…` is not a uuid and Postgres would reject it on insert.
    const out = migratePersistedRound(legacyState(), 0);
    const shot = out.active!.holes[0].shots[1];
    expect(isUuid(shot.id)).toBe(true);
    expect(shot.id.startsWith('tmp_')).toBe(false);
    expect(shot.syncedAt).toBeNull();
  });

  it('drops the legacy fields entirely', () => {
    const out = migratePersistedRound(legacyState(), 0);
    for (const shot of out.active!.holes[0].shots) {
      expect(shot).not.toHaveProperty('tempId');
      expect(shot).not.toHaveProperty('remoteId');
    }
  });

  it('mints a holeId for a hole the server never named', () => {
    const out = migratePersistedRound(legacyState(), 0);
    expect(isUuid(out.active!.holes[1].holeId)).toBe(true);
  });

  it('preserves an existing holeId', () => {
    const out = migratePersistedRound(legacyState(), 0);
    expect(out.active!.holes[0].holeId).toBe('b3f1c2d4-0000-4000-8000-000000000010');
  });

  it('preserves unrelated shot and round fields', () => {
    const out = migratePersistedRound(legacyState(), 0);
    expect(out.active!.roundId).toBe('a3f1c2d4-0000-4000-8000-000000000001');
    expect(out.active!.holes[0].strokes).toBe(2);
    expect(out.active!.holes[0].shots[1].shotNumber).toBe(2);
  });

  it('is a no-op at the current version', () => {
    const state = legacyState();
    const out = migratePersistedRound(state, PERSIST_VERSION);
    expect(out).toBe(state);
  });

  it('handles an empty store without throwing', () => {
    expect(migratePersistedRound({ active: null }, 0)).toEqual({ active: null });
    expect(migratePersistedRound(undefined, 0)).toEqual({});
  });

  it('gives every shot in the round a distinct id', () => {
    const out = migratePersistedRound(legacyState(), 0);
    const ids = out.active!.holes.flatMap((h) => h.shots.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries `parked` through a migration rather than dropping it', () => {
    // Scorer mode parks the other 1-3 players in the group. A future version
    // bump must not quietly discard them.
    const state = { ...legacyState(), parked: { r2: mkRound('r2') } };
    const out = migratePersistedRound(state, 0);
    expect(Object.keys(out.parked ?? {})).toEqual(['r2']);
  });
});

// ---------------------------------------------------------------------------
// Multi-round tracking (scorer mode). `parked` holds the other players in a tee
// group while one is on screen; it is empty for every self-tracked round.
// ---------------------------------------------------------------------------

function mkRound(roundId: string, over: Partial<ActiveRound> = {}): ActiveRound {
  return {
    roundId,
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
        holeId: `${roundId}-h1`,
        holeNumber: 1,
        par: 4,
        yardage: null,
        strokes: 0,
        putts: 0,
        penaltyStrokes: 0,
        fairwayResult: null,
        sand: false,
        gir: false,
        clubsUsed: [],
        shots: [],
        dirty: false
      }
    ],
    ...over
  } as ActiveRound;
}

describe('multi-round tracking', () => {
  beforeEach(() => {
    useRoundStore.setState({ active: null, parked: {} });
  });

  it('starts empty, so a self-tracked round is unaffected', () => {
    useRoundStore.getState().startRound(mkRound('r1'));
    const s = useRoundStore.getState();
    expect(s.active?.roundId).toBe('r1');
    expect(s.parked).toEqual({});
    expect(liveRounds(s).map((r) => r.roundId)).toEqual(['r1']);
  });

  it('parks a parallel round without displacing the one on screen', () => {
    const store = useRoundStore.getState();
    store.startRound(mkRound('r1'));
    store.addParallelRound(mkRound('r2'));
    const s = useRoundStore.getState();
    expect(s.active?.roundId).toBe('r1');
    expect(liveRounds(s).map((r) => r.roundId)).toEqual(['r1', 'r2']);
  });

  it('swaps active and parked on switchRound', () => {
    const store = useRoundStore.getState();
    store.startRound(mkRound('r1'));
    store.addParallelRound(mkRound('r2'));
    store.switchRound('r2');
    const s = useRoundStore.getState();
    expect(s.active?.roundId).toBe('r2');
    expect(Object.keys(s.parked)).toEqual(['r1']);
  });

  it('ignores a switch to a round it does not have', () => {
    const store = useRoundStore.getState();
    store.startRound(mkRound('r1'));
    store.switchRound('nope');
    expect(useRoundStore.getState().active?.roundId).toBe('r1');
  });

  it('promotes a parked round when the one on screen is closed', () => {
    // A scorer finishing one player must land on the next, not on nothing.
    const store = useRoundStore.getState();
    store.startRound(mkRound('r1'));
    store.addParallelRound(mkRound('r2'));
    store.closeRound('r1');
    const s = useRoundStore.getState();
    expect(s.active?.roundId).toBe('r2');
    expect(s.parked).toEqual({});
  });

  it('clears active when closing the last round', () => {
    const store = useRoundStore.getState();
    store.startRound(mkRound('r1'));
    store.closeRound('r1');
    expect(useRoundStore.getState().active).toBeNull();
  });

  it('closes a parked round without disturbing the one on screen', () => {
    const store = useRoundStore.getState();
    store.startRound(mkRound('r1'));
    store.addParallelRound(mkRound('r2'));
    store.closeRound('r2');
    const s = useRoundStore.getState();
    expect(s.active?.roundId).toBe('r1');
    expect(s.parked).toEqual({});
  });

  it('reset clears parked rounds too', () => {
    const store = useRoundStore.getState();
    store.startRound(mkRound('r1'));
    store.addParallelRound(mkRound('r2'));
    store.reset();
    const s = useRoundStore.getState();
    expect(s.active).toBeNull();
    expect(s.parked).toEqual({});
  });

  describe('sync stamps', () => {
    it('targets the round on screen when no id is given (unchanged behaviour)', () => {
      const store = useRoundStore.getState();
      store.startRound(mkRound('r1'));
      store.addParallelRound(mkRound('r2'));
      store.markRoundSynced();
      const s = useRoundStore.getState();
      expect(s.active?.roundSyncedAt).toBeTruthy();
      expect(s.parked.r2.roundSyncedAt).toBeUndefined();
    });

    it('stamps a PARKED round by id, leaving the one on screen alone', () => {
      const store = useRoundStore.getState();
      store.startRound(mkRound('r1'));
      store.addParallelRound(mkRound('r2'));
      store.markRoundSynced('r2');
      const s = useRoundStore.getState();
      expect(s.parked.r2.roundSyncedAt).toBeTruthy();
      expect(s.active?.roundSyncedAt).toBeUndefined();
    });

    it('marks holes synced on a parked round', () => {
      const store = useRoundStore.getState();
      store.startRound(mkRound('r1'));
      store.addParallelRound(mkRound('r2'));
      store.markSynced(['r2-h1'], [], 'r2');
      const s = useRoundStore.getState();
      expect(s.parked.r2.holes[0].syncedAt).toBeTruthy();
      expect(s.parked.r2.holes[0].dirty).toBe(false);
      expect(s.active?.holes[0].syncedAt).toBeUndefined();
    });

    it('clears tombstones on a parked round', () => {
      const store = useRoundStore.getState();
      store.startRound(mkRound('r1'));
      store.addParallelRound(mkRound('r2', { deletedShotIds: ['d1', 'd2'] }));
      store.clearShotTombstones(['d1'], 'r2');
      expect(useRoundStore.getState().parked.r2.deletedShotIds).toEqual(['d2']);
    });

    it('is a no-op for a round that was already closed', () => {
      // A stamp can land after the scorer finished that player.
      const store = useRoundStore.getState();
      store.startRound(mkRound('r1'));
      expect(() => store.markRoundSynced('gone')).not.toThrow();
      expect(useRoundStore.getState().active?.roundSyncedAt).toBeUndefined();
    });
  });
});
