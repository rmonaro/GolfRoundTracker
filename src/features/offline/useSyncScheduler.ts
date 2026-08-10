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

/** Slow enough to be invisible on battery, quick enough to catch a drive home. */
const RETRY_MS = 60_000;

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

    const timer = setInterval(run, RETRY_MS);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);
}
