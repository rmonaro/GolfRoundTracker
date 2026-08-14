import dayjs from 'dayjs';
import type { TmTournamentEntry } from '@/services/tmIntegration/types';
import type { RoundRow } from '@/types/database';
import { isTmRoundComplete, isTmRoundInProgress, localRoundFor } from './tournamentProgress';

export type TournamentGroup = 'inProgress' | 'upcoming' | 'past';

/** TM statuses that mean there's nothing left to play. */
export const DONE_STATUSES = new Set([
  'COMPLETED',
  'COMPLETE',
  'FINISHED',
  'CANCELLED',
  'CANCELED',
  'ARCHIVED'
]);

/** TM statuses that mean play is underway. */
const LIVE_STATUSES = new Set(['IN_PROGRESS', 'ACTIVE', 'LIVE']);

/** Has this date passed? Dates are day-granular on TM, so a tournament ending
 *  today stays live until midnight rather than flipping to Past at 00:01. */
const dayHasPassed = (date: string | null, now: number): boolean =>
  date != null && dayjs(date).endOf('day').valueOf() < now;

const dayHasArrived = (date: string | null, now: number): boolean =>
  date != null && dayjs(date).startOf('day').valueOf() <= now;

/**
 * Which shelf a tournament belongs on.
 *
 * Locally-recorded rounds outrank TM's status throughout: the final SUBMITTED
 * push is best-effort, so a player who finished every round offline would
 * otherwise keep seeing their event as live with a Start button on it.
 */
export function classifyTournament(
  entry: TmTournamentEntry,
  localRounds: RoundRow[] | undefined,
  now: number = Date.now()
): TournamentGroup {
  const { tournament, rounds } = entry;
  const status = (tournament.status ?? '').toUpperCase();
  const local = (roundNumber: number) =>
    localRoundFor(localRounds, entry.registration_id, roundNumber);

  if (DONE_STATUSES.has(status)) return 'past';

  const allRoundsComplete =
    rounds.length > 0 && rounds.every((r) => isTmRoundComplete(r, local(r.round_number)));
  if (allRoundsComplete) return 'past';

  // No end date on the tournament → fall back to its start date, so an event
  // from last season doesn't sit in Upcoming forever.
  if (dayHasPassed(tournament.end_date ?? tournament.start_date, now)) return 'past';

  if (rounds.some((r) => isTmRoundInProgress(r, local(r.round_number)))) return 'inProgress';
  if (LIVE_STATUSES.has(status)) return 'inProgress';
  // TM cleared a tee-time gate — the player can walk to the first tee now.
  if (rounds.some((r) => r.can_start)) return 'inProgress';
  if (dayHasArrived(tournament.start_date, now)) return 'inProgress';

  return 'upcoming';
}

/** The moment a tournament is anchored to — its next open tee time, else its
 *  start date. Used for ordering within a group. */
export function tournamentTime(entry: TmTournamentEntry, localRounds?: RoundRow[]): number {
  const openTeeTimes = entry.rounds
    .filter(
      (r) => !isTmRoundComplete(r, localRoundFor(localRounds, entry.registration_id, r.round_number))
    )
    .map((r) => r.tee_time)
    .filter((t): t is string => !!t)
    .map((t) => dayjs(t).valueOf());

  if (openTeeTimes.length) return Math.min(...openTeeTimes);
  const fallback = entry.tournament.start_date;
  return fallback ? dayjs(fallback).valueOf() : Number.POSITIVE_INFINITY;
}

export interface GroupedTournaments {
  /** Playable now or mid-play — soonest first. */
  inProgress: TmTournamentEntry[];
  /** Not started yet — soonest first. */
  upcoming: TmTournamentEntry[];
  /** Done, cancelled or expired — most recent first. */
  past: TmTournamentEntry[];
}

/**
 * Splits a player's tournaments into the three shelves the Tournaments screen
 * renders. Every entry lands in exactly one group.
 */
export function groupTournaments(
  entries: TmTournamentEntry[] | undefined,
  localRounds?: RoundRow[],
  now: number = Date.now()
): GroupedTournaments {
  const grouped: GroupedTournaments = { inProgress: [], upcoming: [], past: [] };
  for (const entry of entries ?? []) {
    grouped[classifyTournament(entry, localRounds, now)].push(entry);
  }

  const soonestFirst = (a: TmTournamentEntry, b: TmTournamentEntry) =>
    tournamentTime(a, localRounds) - tournamentTime(b, localRounds);

  grouped.inProgress.sort(soonestFirst);
  grouped.upcoming.sort(soonestFirst);
  // Past reads newest-down: the event you just finished is the one you want.
  grouped.past.sort((a, b) => {
    const at = dayjs(a.tournament.end_date ?? a.tournament.start_date ?? 0).valueOf();
    const bt = dayjs(b.tournament.end_date ?? b.tournament.start_date ?? 0).valueOf();
    return bt - at;
  });

  return grouped;
}
