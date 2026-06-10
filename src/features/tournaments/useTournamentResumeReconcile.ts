import { useEffect, useRef } from 'react';
import { roundRepo } from '@/services/roundRepo';
import { useRoundStore } from '@/stores/roundStore';
import { useAuthStore } from '@/stores/authStore';

/**
 * Self-heals the active tournament round against the database.
 *
 * The local store is a live working copy, but it can fall out of sync with the
 * source of truth — e.g. an empty duplicate round became the active one, or the
 * persisted store was cleared / is on another device. When the active round is a
 * tournament round, this loads the richest in-progress round for that
 * registration from the DB and hydrates the store from it **only when the DB has
 * more recorded shots than the store** — so a resumed round shows the holes and
 * shots already played, and an in-progress round (store ahead of DB) is never
 * clobbered.
 *
 * Call once on screens that read/show the active round (Round home, Hole
 * tracking). Reconciles once per tournament round per mount.
 */
export function useTournamentResumeReconcile() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const tmRegistrationId = useRoundStore((s) => s.active?.tmRegistrationId ?? null);
  const tmRoundNumber = useRoundStore((s) => s.active?.tmRoundNumber ?? null);
  const reconciledKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || !tmRegistrationId || tmRoundNumber == null) return;
    const key = `${tmRegistrationId}:${tmRoundNumber}`;
    if (reconciledKeyRef.current === key) return;
    reconciledKeyRef.current = key;

    (async () => {
      try {
        const best = await roundRepo.findBestTournamentRound(
          userId,
          tmRegistrationId,
          tmRoundNumber
        );
        if (!best) return;
        const storeShots = (useRoundStore.getState().active?.holes ?? []).reduce(
          (n, h) => n + h.shots.length,
          0
        );
        const [holes, shots] = await Promise.all([
          roundRepo.listHoles(best.id),
          roundRepo.listShots(best.id)
        ]);
        if (shots.length > storeShots) {
          useRoundStore.getState().hydrateFromRemote(best, holes, shots);
        }
      } catch (err) {
        console.error('[tm] resume reconcile failed', err);
      }
    })();
  }, [userId, tmRegistrationId, tmRoundNumber]);
}
