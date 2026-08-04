import { describe, it, expect } from 'vitest';
import { migratePersistedRound, PERSIST_VERSION } from './roundStore';
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
});
