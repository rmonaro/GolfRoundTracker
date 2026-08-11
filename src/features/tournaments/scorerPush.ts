// TM push for scorer mode.
//
// useTmRoundSync pushes whatever round is on screen, which is the right model
// for a golfer tracking themselves — and it keeps working per-player in scorer
// mode, because switching tabs makes each player the active round in turn.
//
// What it can't do is push for a player who ISN'T on screen, which is exactly
// what quick entry does: one tap per player across the whole group on one hole.
// So these take the round explicitly instead of reading the store.
//
// Every push is best-effort. A scorekeeper walking a course cannot be blocked by
// a dead zone, and TM's endpoints are idempotent per hole, so the next
// successful push self-heals any dropped one.

import type { ActiveRound, LocalHole } from '@/stores/roundStore';
import { useBagStore } from '@/stores/bagStore';
import { tmIntegrationRepo } from '@/services/tmIntegration/tmIntegrationRepo';
import type { TmScorePush, TmShotsPush } from '@/services/tmIntegration/types';
import { holeWasPlayed, toScoreHole, toShotPayloads } from './tmRoundMapping';

/** TM resolution fields for a round. Null when it carries no TM linkage. */
function baseFor(round: ActiveRound) {
  if (!round.tmRegistrationId || round.tmRoundNumber == null) return null;
  return {
    round_tracking_round_id: round.roundId,
    registration_id: round.tmRegistrationId,
    tournament_slug: round.tmTournamentSlug ?? undefined,
    round_number: round.tmRoundNumber
  };
}

/**
 * Push one hole of one player's card — scores, then shots.
 *
 * Note what is NOT sent: `grt_athlete_id`. The edge function resolves who this
 * belongs to from the registration and stamps the ATHLETE's id, never the
 * scorekeeper's. Sending one from here would be ignored, but the omission is
 * deliberate — attribution is a server-side decision.
 */
export async function pushScorerHole(
  round: ActiveRound,
  hole: LocalHole,
  status: 'IN_PROGRESS' | 'SUBMITTED' = 'IN_PROGRESS'
): Promise<void> {
  const base = baseFor(round);
  if (!base) return;

  const scorePayload: TmScorePush = { ...base, status, holes: [toScoreHole(hole)] };
  try {
    await tmIntegrationRepo.pushScores(scorePayload);
  } catch (err) {
    console.error('[scorer-push] score failed', round.athleteName, hole.holeNumber, err);
  }

  const shots = toShotPayloads(hole, useBagStore.getState().clubs);
  if (!shots.length) return;
  const shotsPayload: TmShotsPush = {
    round_tracking_round_id: base.round_tracking_round_id,
    registration_id: base.registration_id,
    tournament_slug: base.tournament_slug,
    round_number: base.round_number,
    holes: [{ hole_number: hole.holeNumber, shots }]
  };
  try {
    await tmIntegrationRepo.pushShots(shotsPayload);
  } catch (err) {
    console.error('[scorer-push] shots failed', round.athleteName, hole.holeNumber, err);
  }
}

/** Push one hole for several players at once — the quick-entry path. */
export async function pushScorerHoleForGroup(
  rounds: ActiveRound[],
  holeNumber: number
): Promise<void> {
  await Promise.all(
    rounds.map((r) => {
      const hole = r.holes.find((h) => h.holeNumber === holeNumber);
      return hole ? pushScorerHole(r, hole) : Promise.resolve();
    })
  );
}

/**
 * Final push for one player: every played hole, then a single SUBMITTED call.
 *
 * The two passes are not redundant. TM locks a scorecard on SUBMITTED and
 * rejects later writes, so submitting before the last hole's shots have landed
 * silently drops them — the same ordering useTmRoundSync.finalizeRound relies
 * on, and the reason scores are re-sent in pass 2 (they're idempotent per hole).
 */
export async function finalizeScorerRound(round: ActiveRound): Promise<void> {
  const base = baseFor(round);
  if (!base) return;
  const played = round.holes.filter(holeWasPlayed);
  if (!played.length) return;

  for (const hole of played) {
    // eslint-disable-next-line no-await-in-loop
    await pushScorerHole(round, hole, 'IN_PROGRESS');
  }

  try {
    await tmIntegrationRepo.pushScores({
      ...base,
      status: 'SUBMITTED',
      holes: played.map(toScoreHole)
    });
  } catch (err) {
    console.error('[scorer-push] final submit failed', round.athleteName, err);
  }
}
