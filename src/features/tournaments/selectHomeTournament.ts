import dayjs from 'dayjs';
import type { TmRound, TmTournamentEntry } from '@/services/tmIntegration/types';
import type { RoundRow } from '@/types/database';
import { isTmRoundComplete, isTmRoundInProgress, localRoundFor } from './tournamentProgress';

export interface HomeTournamentSelection {
  entry: TmTournamentEntry;
  /** The next round worth surfacing — ready/in-progress, else soonest upcoming. */
  round: TmRound;
  /** Ready to start now or already in progress (vs. a future/upcoming round). */
  isLive: boolean;
}

// Tournaments in these states have nothing left to play — never surface them.
const DONE_STATUSES = new Set([
  'COMPLETED',
  'COMPLETE',
  'FINISHED',
  'CANCELLED',
  'CANCELED',
  'ARCHIVED'
]);

// Playable right now: TM cleared the tee-time gate, or a round is mid-play.
const roundIsLive = (r: TmRound, local: RoundRow | null): boolean =>
  r.can_start || isTmRoundInProgress(r, local);

const roundTime = (entry: TmTournamentEntry, r: TmRound): number => {
  const t = r.tee_time ?? entry.tournament.start_date;
  return t ? dayjs(t).valueOf() : Number.POSITIVE_INFINITY;
};

/**
 * Picks the single most relevant tournament round to surface on the Home screen:
 * a round the player can start/resume now wins; otherwise the soonest upcoming
 * one. Completed rounds (per local recorded data or TM) are skipped, so a
 * finished round 1 advances the banner to round 2. Returns null when the player
 * has nothing live or upcoming.
 */
export function selectHomeTournament(
  tournaments: TmTournamentEntry[] | undefined,
  localRounds?: RoundRow[]
): HomeTournamentSelection | null {
  if (!tournaments?.length) return null;

  const candidates: HomeTournamentSelection[] = [];
  for (const entry of tournaments) {
    const status = (entry.tournament.status ?? '').toUpperCase();
    if (DONE_STATUSES.has(status)) continue;

    const local = (r: TmRound) =>
      localRoundFor(localRounds, entry.registration_id, r.round_number);

    const openRounds = entry.rounds.filter((r) => !isTmRoundComplete(r, local(r)));
    if (openRounds.length === 0) continue;

    // Prefer a live round; otherwise the soonest-scheduled open round.
    const round =
      openRounds.find((r) => roundIsLive(r, local(r))) ??
      [...openRounds].sort((a, b) => roundTime(entry, a) - roundTime(entry, b))[0];

    candidates.push({ entry, round, isLive: roundIsLive(round, local(round)) });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return roundTime(a.entry, a.round) - roundTime(b.entry, b.round);
  });

  return candidates[0];
}
