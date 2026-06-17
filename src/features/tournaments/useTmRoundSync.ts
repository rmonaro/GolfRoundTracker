import { useCallback, useRef } from 'react';
import { useRoundStore, type LocalHole } from '@/stores/roundStore';
import { useBagStore } from '@/stores/bagStore';
import { tmIntegrationRepo } from '@/services/tmIntegration/tmIntegrationRepo';
import type { TmScorePush, TmShotsPush } from '@/services/tmIntegration/types';
import { holeWasPlayed, toScoreHole, toShotPayloads } from './tmRoundMapping';

/**
 * Pushes the active round's scores + shots to TournamentManagement (TM) during
 * play. Only does anything when the round is a tournament round (started from
 * "My Tournaments", so it carries a TM registration). Hole scores drive TM's
 * live leaderboard; shots power the public parent replay.
 *
 * The flow pushes on every shot (`syncHole`), debounced lightly per hole so a
 * flurry of stroke edits coalesces into one call, and sends a final SUBMITTED
 * push covering every played hole when the round finishes (`finalizeRound`).
 *
 * All pushes are best-effort: failures are logged, never thrown, so a flaky
 * network never blocks scoring. TM's endpoints are idempotent per hole, so the
 * next successful push self-heals any dropped one.
 */
export function useTmRoundSync() {
  const isTournamentRound = useRoundStore((s) => !!s.active?.tmRegistrationId);
  // Club labels are read fresh from the store at push time (see pushHole), so we
  // don't need to subscribe to bag changes here.
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  /** Common TM resolution fields for the active round. Null if not a TM round. */
  const baseRef = useCallback(() => {
    const active = useRoundStore.getState().active;
    if (!active?.tmRegistrationId || active.tmRoundNumber == null) return null;
    return {
      round_tracking_round_id: active.roundId,
      registration_id: active.tmRegistrationId,
      tournament_slug: active.tmTournamentSlug ?? undefined,
      round_number: active.tmRoundNumber
    };
  }, []);

  const pushHole = useCallback(
    async (hole: LocalHole, status: 'IN_PROGRESS' | 'SUBMITTED') => {
      const base = baseRef();
      if (!base) return;
      const bagClubs = useBagStore.getState().clubs;

      const scorePayload: TmScorePush = {
        ...base,
        status,
        holes: [toScoreHole(hole)]
      };
      try {
        await tmIntegrationRepo.pushScores(scorePayload);
      } catch (err) {
        console.error('[tm-sync] score push failed', hole.holeNumber, err);
      }

      const shots = toShotPayloads(hole, bagClubs);
      if (shots.length) {
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
          console.error('[tm-sync] shot push failed', hole.holeNumber, err);
        }
      }
    },
    [baseRef]
  );

  /** Debounced per-hole push — call after each shot is recorded/edited/deleted. */
  const syncHole = useCallback(
    (holeNumber: number, delayMs = 600) => {
      if (!useRoundStore.getState().active?.tmRegistrationId) return;
      const existing = timers.current.get(holeNumber);
      if (existing) clearTimeout(existing);
      timers.current.set(
        holeNumber,
        setTimeout(() => {
          timers.current.delete(holeNumber);
          const hole = useRoundStore
            .getState()
            .active?.holes.find((h) => h.holeNumber === holeNumber);
          if (hole) void pushHole(hole, 'IN_PROGRESS');
        }, delayMs)
      );
    },
    [pushHole]
  );

  /**
   * Final push at round end. Flushes any pending debounced holes, then sends
   * every played hole with status SUBMITTED so TM locks the scorecard. Awaited
   * so the caller can sequence it before navigating away.
   */
  const finalizeRound = useCallback(async () => {
    const base = baseRef();
    if (!base) return;
    const active = useRoundStore.getState().active;
    if (!active) return;
    // Cancel in-flight debounces — we're about to push everything explicitly.
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();

    const played = active.holes.filter(holeWasPlayed);
    if (!played.length) return;

    // Pass 1 — push every played hole's scores + shots as IN_PROGRESS. The final
    // hole's last-shot live push was just cancelled above, so this is the only
    // chance to deliver it. We deliberately do NOT submit yet: TM locks the
    // scorecard on SUBMITTED and rejects later writes, so submitting before the
    // last hole's shots land silently drops the last shot.
    for (const hole of played) {
      // eslint-disable-next-line no-await-in-loop
      await pushHole(hole, 'IN_PROGRESS');
    }

    // Pass 2 — all shots are stored, so lock the round with a single scores-only
    // SUBMITTED push covering every played hole. Scores are idempotent per hole,
    // so re-sending them here is safe.
    const submitPayload: TmScorePush = {
      ...base,
      status: 'SUBMITTED',
      holes: played.map(toScoreHole)
    };
    try {
      await tmIntegrationRepo.pushScores(submitPayload);
    } catch (err) {
      console.error('[tm-sync] final submit failed', err);
    }
  }, [pushHole, baseRef]);

  return { isTournamentRound, syncHole, finalizeRound };
}
