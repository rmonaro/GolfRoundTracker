import { describe, expect, it } from 'vitest';
import { classifyTournament, groupTournaments } from './groupTournaments';
import type { TmRound, TmTournamentEntry } from '@/services/tmIntegration/types';
import type { RoundRow } from '@/types/database';

const NOW = Date.parse('2026-06-15T12:00:00Z');

function makeRound(over: Partial<TmRound> = {}): TmRound {
  return {
    round_number: 1,
    tee_time: null,
    starting_hole: null,
    can_start: false,
    can_start_reason: 'before_tee_time',
    scorecard: null,
    ...over
  };
}

function makeEntry(
  over: Partial<TmTournamentEntry> & { tournament?: Partial<TmTournamentEntry['tournament']> } = {}
): TmTournamentEntry {
  const { tournament, ...rest } = over;
  return {
    registration_id: 'reg-1',
    registration_status: 'CONFIRMED',
    division: null,
    rounds: [makeRound()],
    ...rest,
    tournament: {
      id: 't-1',
      name: 'Summer Open',
      slug: 'summer-open',
      status: 'SCHEDULED',
      number_rounds: 1,
      start_date: '2026-07-01',
      end_date: '2026-07-02',
      external_course_id: '123',
      course_name: 'Baird State Park',
      ...tournament
    }
  };
}

function localRound(over: Partial<RoundRow> = {}): RoundRow {
  return {
    tm_registration_id: 'reg-1',
    tm_round_number: 1,
    completed_at: null,
    started_at: '2026-06-15T10:00:00Z',
    ...over
  } as RoundRow;
}

describe('classifyTournament', () => {
  it('puts a future event with no open gate in upcoming', () => {
    expect(classifyTournament(makeEntry(), undefined, NOW)).toBe('upcoming');
  });

  it('treats a cleared tee-time gate as in progress', () => {
    const entry = makeEntry({ rounds: [makeRound({ can_start: true })] });
    expect(classifyTournament(entry, undefined, NOW)).toBe('inProgress');
  });

  it('treats a started-but-unfinished local round as in progress', () => {
    expect(classifyTournament(makeEntry(), [localRound()], NOW)).toBe('inProgress');
  });

  it('treats an event inside its date window as in progress', () => {
    const entry = makeEntry({
      tournament: { start_date: '2026-06-14', end_date: '2026-06-16' }
    });
    expect(classifyTournament(entry, undefined, NOW)).toBe('inProgress');
  });

  it('honors a terminal TM status', () => {
    const entry = makeEntry({ tournament: { status: 'CANCELLED' } });
    expect(classifyTournament(entry, undefined, NOW)).toBe('past');
  });

  it('is past once the end date has gone by', () => {
    const entry = makeEntry({
      tournament: { start_date: '2026-06-01', end_date: '2026-06-02' }
    });
    expect(classifyTournament(entry, undefined, NOW)).toBe('past');
  });

  it('stays live through the final day', () => {
    const entry = makeEntry({
      tournament: { start_date: '2026-06-14', end_date: '2026-06-15' }
    });
    expect(classifyTournament(entry, undefined, NOW)).toBe('inProgress');
  });

  it('is past when every round is locally complete, even if TM still says live', () => {
    const entry = makeEntry({
      tournament: { status: 'IN_PROGRESS', start_date: '2026-06-14', end_date: '2026-06-16' },
      rounds: [makeRound({ round_number: 1 }), makeRound({ round_number: 2 })]
    });
    const locals = [
      localRound({ tm_round_number: 1, completed_at: '2026-06-14T18:00:00Z' }),
      localRound({ tm_round_number: 2, completed_at: '2026-06-15T11:00:00Z' })
    ];
    expect(classifyTournament(entry, locals, NOW)).toBe('past');
  });

  it('is still in progress when only some rounds are complete', () => {
    const entry = makeEntry({
      tournament: { status: 'IN_PROGRESS', start_date: '2026-06-14', end_date: '2026-06-16' },
      rounds: [makeRound({ round_number: 1 }), makeRound({ round_number: 2 })]
    });
    const locals = [localRound({ tm_round_number: 1, completed_at: '2026-06-14T18:00:00Z' })];
    expect(classifyTournament(entry, locals, NOW)).toBe('inProgress');
  });

  it('falls back to the start date when there is no end date', () => {
    const entry = makeEntry({
      tournament: { start_date: '2026-05-01', end_date: null }
    });
    expect(classifyTournament(entry, undefined, NOW)).toBe('past');
  });
});

describe('groupTournaments', () => {
  it('splits entries into three shelves and orders each', () => {
    const live = makeEntry({
      registration_id: 'live',
      tournament: { id: 'live', status: 'IN_PROGRESS', start_date: '2026-06-14', end_date: '2026-06-16' },
      rounds: [makeRound({ can_start: true, tee_time: '2026-06-15T14:00:00Z' })]
    });
    const soon = makeEntry({
      registration_id: 'soon',
      tournament: { id: 'soon', start_date: '2026-06-20', end_date: '2026-06-21' },
      rounds: [makeRound({ tee_time: '2026-06-20T13:00:00Z' })]
    });
    const later = makeEntry({
      registration_id: 'later',
      tournament: { id: 'later', start_date: '2026-08-01', end_date: '2026-08-02' },
      rounds: [makeRound({ tee_time: '2026-08-01T13:00:00Z' })]
    });
    const oldEvent = makeEntry({
      registration_id: 'old',
      tournament: { id: 'old', start_date: '2026-01-05', end_date: '2026-01-06' }
    });
    const recentEvent = makeEntry({
      registration_id: 'recent',
      tournament: { id: 'recent', start_date: '2026-05-05', end_date: '2026-05-06' }
    });

    const grouped = groupTournaments([later, oldEvent, live, recentEvent, soon], undefined, NOW);

    expect(grouped.inProgress.map((e) => e.registration_id)).toEqual(['live']);
    expect(grouped.upcoming.map((e) => e.registration_id)).toEqual(['soon', 'later']);
    expect(grouped.past.map((e) => e.registration_id)).toEqual(['recent', 'old']);
  });

  it('returns empty shelves for no entries', () => {
    expect(groupTournaments(undefined, undefined, NOW)).toEqual({
      inProgress: [],
      upcoming: [],
      past: []
    });
  });
});
