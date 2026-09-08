// Decides WHEN to sync. The what and how lives in services/roundSync.
//
// Mounted once at the app root. Four triggers, because none alone is enough:
//
//   • connectivity → online   the moment worth acting on
//   • app resume              a phone that was in a pocket for 4 hours fires no
//                             network event when it wakes somewhere with signal
//   • periodic retry          covers a failed attempt and a connectivity change
//                             the platform never reported
//   • mount                   an app relaunched after a crash mid-round

import { useEffect, useRef } from 'react';
import { subscribeConnectivity, getConnectivity } from '@/services/connectivity';
import { syncAll } from '@/services/roundSync';
import { liveRounds, useRoundStore } from '@/stores/roundStore';

/** Slow enough to be invisible on battery, quick enough to catch a drive home. */
const RETRY_MS = 60_000;

/**
 * Faster tick while a TOURNAMENT round is in progress.
 *
 * Nothing about the round itself needs this — the local store is the source of
 * truth and reconciles fine at a minute. It is about who else is reading: a
 * spectator following on a share code (migration 041) and TM's live scoring
 * both see only what has reached Supabase, so the push interval IS the latency
 * they experience. A minute is a long time to stare at an unchanged card when
 * someone has just holed out.
 *
 * Only tournament rounds, and only while one is live, so a casual round costs
 * exactly what it did before.
 */
const TOURNAMENT_RETRY_MS = 15_000;

/** Is there a live round that anyone else might be watching? */
function hasLiveTournamentRound(): boolean {
  return liveRounds(useRoundStore.getState()).some((r) => !!r.tmRegistrationId);
}

export function useSyncScheduler() {
  const lastStatus = useRef(getConnectivity().status);

  useEffect(() => {
    const run = () => {
      void syncAll();
    };

    // Relaunch / first mount.
    run();

    const unsubscribe = subscribeConnectivity(() => {
      const { status } = getConnectivity();
      const was = lastStatus.current;
      lastStatus.current = status;
      // Only on the TRANSITION into online. Firing on every connectivity
      // notification would hammer sync while the signal flaps, which is exactly
      // what a phone does driving away from a course.
      if (status === 'online' && was !== 'online') run();
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);

    // Re-armed each tick rather than a fixed interval, so starting or finishing
    // a tournament round changes the cadence without remounting anything.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      run();
      timer = setTimeout(tick, hasLiveTournamentRound() ? TOURNAMENT_RETRY_MS : RETRY_MS);
    };
    timer = setTimeout(tick, hasLiveTournamentRound() ? TOURNAMENT_RETRY_MS : RETRY_MS);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timer);
    };
  }, []);
}
